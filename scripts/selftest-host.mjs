/**
 * host 端离线自检：用 mock cordis 上下文跑 apply()，验证
 *   ① 能否定位 dsh-web-frontend/dist（含桌面版带空格的资源树、link 安装形态）；
 *   ② tapIndex 是否被调用（视口样式注入）且幂等；
 *   ③ exact 路由是否注册到正确的 /assets/index-<hash>.js，且返回体已打补丁；
 *   ④ 多份不同版本 dist 并存时是否全部接管。
 *
 * 用法：node scripts/selftest-host.mjs
 * 退出码：0 = 全绿；1 = 有断言失败。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, '..', 'lib', 'index.js')

const logs = []
const routes = []
const taps = []
let failures = 0

/**
 * 断言。
 * @param ok - 条件。
 * @param label - 断言描述。
 * @param detail - 失败细节。
 */
function check(ok, label, detail) {
  if (ok) {
    console.log('  ✓ ' + label)
  } else {
    failures += 1
    console.log('  ✗ ' + label + (detail === undefined ? '' : ' — ' + detail))
  }
}

/** 找出桌面版真实资源树（目录名含空格，必须靠 readdir 取真名）。 */
function findRuntimeAppDsh() {
  const base = 'D:/Work/Agent'
  if (!existsSync(base)) return undefined
  const dir = readdirSync(base).find((name) => name.startsWith('DeepSeek') && name !== 'DeepSeek')
  if (dir === undefined) return undefined
  const candidate = join(base, dir, 'resources', 'app', 'dsh')
  return existsSync(candidate) ? candidate : undefined
}

const runtimeDsh = findRuntimeAppDsh()
if (runtimeDsh !== undefined) {
  // 模拟真实进程 argv：桌面宿主把 app 根作为参数传入。
  process.argv.push(runtimeDsh)
  console.log('argv[+] :', runtimeDsh)
}

const ctx = {
  logger: () => ({
    info: (m) => logs.push(['info', m]),
    warn: (m) => logs.push(['warn', m]),
    error: (m) => logs.push(['error', m]),
  }),
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') dispose
  },
  webServer: {
    tapIndex(transform) {
      taps.push(transform)
      return () => {}
    },
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

console.log('entry   :', entry)
const mod = await import('file:///' + entry.replace(/\\/g, '/'))

console.log('name    :', mod.name)
console.log('inject  :', JSON.stringify(mod.inject))
console.log('exports :', Object.keys(mod).join(', '))

check(mod.inject?.includes('webServer') === true, 'inject 声明 webServer')
check(typeof mod.apply === 'function', '导出 apply()')
check(mod.Config !== undefined, '导出 Config（设置页可配置）')

mod.apply(ctx, {})

console.log('\n--- 日志 ---')
for (const [level, message] of logs) console.log('  [' + level + '] ' + message)

console.log('\n--- 断言 ---')
check(logs.some(([, m]) => m.includes('已接管')), '成功定位 dist 并接管资产路由',
  logs.find(([l]) => l === 'warn')?.[1])

check(taps.length === 1, '注册了 1 个 index.html tap', 'taps=' + taps.length)
check(routes.length >= 1, '至少注册 1 条 exact 路由', 'routes=' + routes.length)

/** 遍历每条路由，验证 handler 行为。 */
for (const route of routes) {
  const assetName = route.path.replace(/^\/assets\//, '')
  const line = logs.find(([, m]) => m.includes('已接管 ' + route.path))
  const dist = line?.[1]?.match(/dist: (.+?)[）)]/)?.[1]
  console.log('\n  路由 ' + route.path + '\n    dist: ' + dist)

  check(route.kind === 'exact', 'kind = exact')
  check(/^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(route.path), 'path 形如 /assets/index-*.js')

  const raw = dist !== undefined ? join(dist, 'assets', assetName) : undefined
  if (raw === undefined || !existsSync(raw)) {
    check(false, '能定位原始资产文件', String(raw))
    continue
  }

  const rawText = readFileSync(raw, 'utf8')
  let status
  let payload = ''
  await route.handler({}, {
    writeHead(code) { status = code },
    end(body) { payload = String(body ?? '') },
  })

  check(status === 200, 'handler 返回 200', 'status=' + status)
  check(payload.includes('__DSH_RENDER_PERF__'), '返回体含补丁标记')
  check(payload.includes('__dshRPC'), '返回体含缓存表声明')
  check(payload.length > rawText.length, '返回体比原产物更大', rawText.length + ' -> ' + payload.length)
  check(payload.slice(0, 200) === rawText.slice(0, 200), '补丁未污染文件头（前 200 字符一致）')
}

if (taps.length === 1) {
  const html = '<html><head><title>x</title></head><body></body></html>'
  const out = taps[0](html)
  check(out.includes('dsh-render-perf-style'), 'tap 注入了样式元素')
  check(out.includes('content-visibility:auto'), '样式含 content-visibility')
  check(out.indexOf('<style') < out.indexOf('</head>'), '样式插在 </head> 之前')
  check(taps[0](out) === out, 'tap 幂等（重复注入不叠加）')
}

// 幂等 / 挂载守卫：重复 apply 不应重复注册
const routeCount = routes.length
mod.apply(ctx, {})
check(routes.length === routeCount, '重复 apply 被挂载守卫拦截', routeCount + ' -> ' + routes.length)

console.log(failures === 0 ? '\n结果: 全部通过' : '\n结果: ' + failures + ' 项失败')
process.exit(failures === 0 ? 0 : 1)
