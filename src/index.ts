/**
 * @dsh-external/dsh-render-perf —— host 端。
 *
 * 职责：在不修改 npm 安装目录任何文件的前提下，拦截 DSH Web 前端 JS 资产的
 * HTTP 响应，在响应流中注入「公式渲染结果缓存」补丁（见 ./patch.ts）。
 *
 * 技术依据（已对 @deepseek-ai/dsh-host-webserver 0.1.0-rc.6 源码核对）：
 *   - `WebServer.match()` 先查 exact 表、再走 fallback；
 *   - `@deepseek-ai/dsh-host-frontend-static` 只占据 fallback seat，且非 index
 *     资源本来就是公开的（无需认证）；
 *   ⇒ 注册 exact 路由 `/assets/index-<hash>.js` 可无冲突地截获并改写该资产。
 *
 * 多份 dist 并存（桌面版资源树 / profile 联动的 npm 树可能是不同版本的前端）
 * 时，本插件对**每个**找到的 dist 各注册一条 exact 路由：运行期到底加载哪一份
 * 都能被接管，且不会因为挑错版本而让页面 404。
 *
 * 卸载即净：路由通过 ctx.effect 绑定到本插件 fiber，卸载自动摘除，
 * 浏览器刷新即回到原始未打补丁的 bundle。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { applyPatch } from './patch.js'
import { injectStyles, STYLE_ID } from './styles.js'

/** 稳定插件名。 */
export const name = '@dsh-external/dsh-render-perf'

/** 需要 webServer 服务就绪后才 apply。 */
export const inject = ['webServer']

/**
 * 插件配置 schema（schemastery）。
 *
 * 导出 Config 后，本插件才会在「设置 → 插件」里带出可配置项。
 */
export const Config = z.object({
  /** 总开关。 */
  enabled: z.boolean().default(true),
  /** 手动指定 dsh-web-frontend 的 dist 目录（留空自动探测）。 */
  distDir: z.string().default(''),
  /** 补丁模式：element（默认，实测最快）/ html（可选的 innerHTML 变体，较慢）。 */
  mode: z.union([z.const('element'), z.const('html')]).default('element'),
})

/** 解析后的配置形态。 */
export interface ConfigShape {
  enabled: boolean
  distDir: string
  mode: 'element' | 'html'
}

interface LoggerLike {
  info?: (msg: string) => void
  warn?: (msg: string) => void
  error?: (msg: string) => void
}

/** 前端包名（`exports` 暴露 `./dist/*` 与 `./package.json`）。 */
const FRONTEND_PKG = '@deepseek-ai/dsh-web-frontend'

/** 进程级挂载标记：防止热挂载 / bundle 重复加载导致 exact 路由重复注册。 */
const MOUNTED = Symbol.for('@dsh-external/dsh-render-perf.host-mounted')

/**
 * 判定一个 `.../node_modules` 目录下是否装着可用的前端 dist。
 * @param nodeModulesDir - 候选 node_modules 目录（也可以直接是 dist 的父目录）。
 * @returns dist 绝对路径，缺失 index.html 返回 undefined。
 */
function distUnder(nodeModulesDir: string): string | undefined {
  for (const rel of [
    [...FRONTEND_PKG.split('/'), 'dist'],
    ['node_modules', ...FRONTEND_PKG.split('/'), 'dist'],
  ]) {
    const dist = join(nodeModulesDir, ...rel)
    if (existsSync(join(dist, 'index.html'))) return dist
  }
  return undefined
}

/**
 * 从任意深度的路径向上收集候选 node_modules 目录。
 * @param start - 起始文件或目录。
 * @returns 候选目录（按由近及远排列）。
 */
function nodeModulesUpward(start: string): string[] {
  const found: string[] = []
  let dir = start
  for (let i = 0; i < 12; i += 1) {
    found.push(dir)
    found.push(join(dir, 'node_modules'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return found
}

/**
 * 收集所有可用的前端 dist 目录，按「运行期真实安装」优先排序。
 *
 * 顺序：显式配置 → 进程参数推导（桌面版/CLI 的真实资源树）→ profile 环境
 * → 模块解析 → 常见全局路径。返回的是**全部**候选而不是单选：不同树里可能
 * 装着不同版本的前端，多注册一条路由比挑错版本安全。
 *
 * @param config - 插件配置。
 * @returns 去重后的 dist 目录列表。
 */
function candidateDistDirs(config: Partial<ConfigShape>): string[] {
  const out: string[] = []
  const push = (dist?: string): void => {
    if (dist !== undefined && !out.includes(dist)) out.push(dist)
  }

  if (typeof config.distDir === 'string' && config.distDir !== '') {
    if (existsSync(join(config.distDir, 'index.html'))) {
      push(config.distDir)
      return out
    }
  }

  // ① 进程参数：Electron/Node 启动时 argv 里带 app 根、profile、bin.js 等路径。
  for (const raw of process.argv) {
    if (typeof raw !== 'string' || raw === '' || !existsSync(raw)) continue
    let base = raw
    try {
      if (!statSync(base).isDirectory()) base = dirname(base)
    } catch { continue }
    for (const probe of nodeModulesUpward(base)) push(distUnder(probe))
  }

  // ② profile 环境（DSH_PROFILE_DIR 指向 profile，@deepseek-ai 在 profile 或其父层）
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir !== '') {
    push(distUnder(join(profileDir, 'node_modules')))
    push(distUnder(join(dirname(resolve(profileDir)), 'node_modules')))
  }

  // ③ 模块解析（插件以真实目录装进 profile 的 node_modules 时最可靠）
  for (const resolver of [
    () => import.meta.resolve(FRONTEND_PKG + '/package.json'),
    () => createRequire(import.meta.url).resolve(FRONTEND_PKG + '/package.json'),
  ]) {
    try {
      const resolved = resolver()
      const pkgJson = resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved
      push(distUnder(dirname(dirname(dirname(pkgJson)))))
    } catch { /* 插件真实路径不在 profile 树内时解析不到，继续探测 */ }
  }

  // ④ 常见全局路径
  const dshHome = join(homedir(), '.dsh')
  push(distUnder(join(dshHome, 'profiles', 'node_modules')))
  for (const profile of ['web', 'desktop']) {
    push(distUnder(join(dshHome, 'profiles', profile, 'node_modules')))
  }
  const appData = process.env.APPDATA
  if (typeof appData === 'string' && appData !== '') {
    push(distUnder(join(appData, 'npm', 'node_modules')))
    push(distUnder(join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules')))
  }

  return out
}

/**
 * 从一个 dist 的 index.html 中读出主 JS 资产名。
 * @param distDir - dist 目录。
 * @returns `index-*.js` 文件名，读不到返回 undefined。
 */
function readAssetName(distDir: string): string | undefined {
  try {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8')
    return /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1]
  } catch {
    return undefined
  }
}

/**
 * 插件入口。
 * @param ctx - cordis 上下文（含 webServer 服务）。
 * @param config - 插件配置。
 */
export function apply(ctx: any, config: Partial<ConfigShape> = {}): void {
  const logger: LoggerLike = typeof ctx.logger === 'function' ? ctx.logger('render-perf') : console

  if (config.enabled === false) {
    logger.info?.('[dsh-render-perf] 已禁用，未注册任何路由')
    return
  }

  // 进程级挂载守卫：热挂载与 bundle 层可能拿到两个模块实例，globalThis 上只有一个标记。
  const g = globalThis as unknown as Record<symbol, unknown>
  if (g[MOUNTED] === true) {
    logger.info?.('[dsh-render-perf] 已在本进程挂载，跳过重复注册')
    return
  }
  g[MOUNTED] = true
  ctx.effect(() => () => { g[MOUNTED] = false }, 'dsh-render-perf: mount guard release')

  // ① 视口外 turn 渲染跳过：把样式注入 index.html（幂等，随 fiber 卸载摘除）
  ctx.effect(() => {
    const dispose = ctx.webServer.tapIndex((html: string) => injectStyles(html))
    logger.info?.('[dsh-render-perf] 已注入视口渲染跳过样式 #' + STYLE_ID)
    return () => {
      dispose()
      logger.info?.('[dsh-render-perf] 已摘除 index.html 样式 tap')
    }
  }, 'dsh-render-perf: viewport render skip styles')

  // ② 公式渲染缓存：逐个候选 dist 接管其主资产
  const distDirs = candidateDistDirs(config)
  if (distDirs.length === 0) {
    logger.warn?.('[dsh-render-perf] 未能定位 ' + FRONTEND_PKG + '/dist，插件不生效（可用 distDir 配置项手动指定）')
    return
  }

  const registered = new Set<string>()
  for (const distDir of distDirs) {
    const assetName = readAssetName(distDir)
    if (assetName === undefined) {
      logger.warn?.('[dsh-render-perf] ' + distDir + ' 中未找到 index-*.js 资产条目，跳过')
      continue
    }
    if (registered.has(assetName)) continue
    registered.add(assetName)

    const assetFile = join(distDir, 'assets', assetName)
    const routePath = '/assets/' + assetName
    let patchedBody: string | undefined

    /**
     * 惰性读取并打补丁（资产在进程生命周期内不会变，读一次即可）。
     * @returns 要发给浏览器的 JS 文本。
     */
    const body = (): string => {
      if (patchedBody !== undefined) return patchedBody
      const raw = readFileSync(assetFile, 'utf8')
      const result = applyPatch(raw, { mode: config.mode ?? 'element' })
      if (result.applied) {
        const how = result.reason === 'already-patched' ? '已存在补丁标记' : ('命中函数 ' + String(result.functionName))
        logger.info?.('[dsh-render-perf] 公式渲染缓存补丁已注入 ' + assetName + '（' + how + '）')
      } else {
        logger.warn?.('[dsh-render-perf] 补丁未应用（' + String(result.reason) + '），已回退为原样返回前端产物')
      }
      patchedBody = result.code
      return patchedBody
    }

    /**
     * exact 路由处理：直接返回改写后的 JS，并禁止缓存以确保刷新即生效。
     * @param _req - 请求对象（未使用）。
     * @param res - 响应对象。
     */
    const handler = async (_req: any, res: any): Promise<void> => {
      try {
        const payload = body()
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(payload)
      } catch (error) {
        logger.warn?.('[dsh-render-perf] 资产响应失败: ' + String(error))
        try {
          res.writeHead(500)
          res.end()
        } catch { /* 响应已发出，忽略 */ }
      }
    }

    ctx.effect(() => {
      const dispose = ctx.webServer.register({ kind: 'exact', path: routePath, handler })
      logger.info?.('[dsh-render-perf] 已接管 ' + routePath + '（dist: ' + distDir + '）')
      return () => {
        dispose()
        logger.info?.('[dsh-render-perf] 已释放 ' + routePath)
      }
    }, 'dsh-render-perf: patched asset route ' + routePath)
  }

  if (registered.size === 0) {
    logger.warn?.('[dsh-render-perf] 所有候选 dist 都没有可接管的资产，插件不生效')
  }
}
