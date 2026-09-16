/**
 * @dsh-external/dsh-render-perf —— host 端。
 *
 * 职责：在不修改 npm 安装目录任何文件的前提下，拦截 DSH Web 前端 JS 资产的
 * HTTP 响应，在响应流中注入「公式渲染结果缓存」补丁（见 ./patch.ts）。
 *
 * 技术依据（已核对 dsh 0.1.6-alpha.1 源码）：
 *   - @deepseek-ai/dsh-host-webserver 的 match() 先查 exact 表、再走 fallback；
 *   - @deepseek-ai/dsh-host-frontend-static 只占据 fallback seat，且非 index
 *     资源本来就是公开的（无需认证）；
 *   ⇒ 注册 exact 路由 `/assets/index-<hash>.js` 可无冲突地截获并改写该资产。
 *
 * 卸载即净：路由通过 ctx.effect 绑定到本插件 fiber，卸载自动摘除，
 * 浏览器刷新即回到原始未打补丁的 bundle。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
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
 * 导出 Config 后，本插件才会在「设置 → 插件」里带出可配置项，
 * client 端注册的 `settings.plugin.item` 诊断面板也才有着落点。
 */
export const Config = z.object({
  /** 总开关。 */
  enabled: z.boolean().default(true),
  /** 手动指定 dsh-web-frontend 的 dist 目录（留空自动探测）。 */
  distDir: z.string().default(''),
  /** 补丁模式：element（默认，实测 515~601ms）/ html（可选的 innerHTML 变体，较慢）。 */
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

/** dsh-web-frontend 相对 dsh 安装根的路径。 */
const FRONTEND_REL = ['@deepseek-ai', 'dsh-web-frontend'] as const

/**
 * 从 dsh CLI 入口（node_modules/@deepseek-ai/dsh/lib/bin.js）推导前端 dist 目录。
 * @param entry - 候选入口路径。
 * @returns dist 目录绝对路径，推导失败返回 undefined。
 */
function distFromEntry(entry: string): string | undefined {
  const normalized = resolve(entry)
  if (!existsSync(normalized)) return undefined
  // <...>/node_modules/@deepseek-ai/dsh/lib/bin.js
  const deepseekScope = dirname(dirname(dirname(normalized))) // => <...>/node_modules/@deepseek-ai
  const nodeModules = dirname(deepseekScope)                  // => <...>/node_modules
  const dist = join(nodeModules, ...FRONTEND_REL, 'dist')
  return existsSync(dist) ? dist : undefined
}

/**
 * 探测前端 dist 目录：显式配置 → 模块解析 → 进程入口推导 → 常见全局路径。
 * @param config - 插件配置。
 * @returns dist 目录绝对路径，全失败返回 undefined。
 */
function resolveDistDir(config: Partial<ConfigShape>): string | undefined {
  if (typeof config.distDir === 'string' && config.distDir !== '') {
    return existsSync(config.distDir) ? config.distDir : undefined
  }

  try {
    const resolved = import.meta.resolve('@deepseek-ai/dsh-web-frontend/package.json')
    const dist = join(dirname(fileURLToPath(resolved)), 'dist')
    if (existsSync(dist)) return dist
  } catch { /* 插件自身 node_modules 里通常解析不到，继续探测 */ }

  for (const argv of process.argv) {
    if (typeof argv !== 'string') continue
    if (!/[\\/]dsh[\\/]lib[\\/]bin\.js$/.test(argv)) continue
    const dist = distFromEntry(argv)
    if (dist !== undefined) return dist
  }

  const appData = process.env.APPDATA
  const guesses: string[] = []
  if (typeof appData === 'string' && appData !== '') {
    guesses.push(join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', ...FRONTEND_REL, 'dist'))
    guesses.push(join(appData, 'npm', 'node_modules', ...FRONTEND_REL, 'dist'))
  }
  guesses.push(join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', ...FRONTEND_REL, 'dist'))
  for (const guess of guesses) {
    if (existsSync(guess)) return guess
  }
  return undefined
}

/**
 * 插件入口。
 * @param ctx - cordis 上下文（含 webServer 服务）。
 * @param config - 插件配置。
 */
export function apply(ctx: any, config: Partial<ConfigShape> = {}): void {
  const logger: LoggerLike = ctx.logger ? ctx.logger('render-perf') : console

  if (config.enabled === false) {
    logger.info?.('[dsh-render-perf] 已禁用，未注册任何路由')
    return
  }

  // ① 视口外 turn 渲染跳过：把样式注入 index.html（幂等，随 fiber 卸载摘除）
  ctx.effect(() => {
    const dispose = ctx.webServer.tapIndex((html: string) => injectStyles(html))
    logger.info?.('[dsh-render-perf] 已注入视口渲染跳过样式 #' + STYLE_ID)
    return () => {
      dispose()
      logger.info?.('[dsh-render-perf] 已摘除 index.html 样式 tap')
    }
  }, 'dsh-render-perf: viewport render skip styles')

  // ② 公式渲染缓存：拦截前端 JS 资产响应（下面继续）
  const distDir = resolveDistDir(config)
  if (distDir === undefined) {
    logger.warn?.('[dsh-render-perf] 未能定位 dsh-web-frontend/dist，插件不生效（可用 distDir 配置项手动指定）')
    return
  }

  let assetName: string | undefined
  try {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8')
    const matched = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)
    assetName = matched?.[1]
  } catch (error) {
    logger.warn?.('[dsh-render-perf] 读取 index.html 失败: ' + String(error))
    return
  }

  if (assetName === undefined) {
    logger.warn?.('[dsh-render-perf] index.html 中未找到 index-*.js 资产条目，插件不生效')
    return
  }

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
  }, 'dsh-render-perf: patched frontend asset route')
}
