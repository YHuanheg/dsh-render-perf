/**
 * 补丁自检脚本：对真实的前端 bundle 应用补丁并输出诊断信息。
 *
 * 用法：
 *   node scripts/verify-patch.mjs [bundle.js 路径]
 * 不传路径时自动探测 dsh 全局安装目录下的 dsh-web-frontend/dist。
 *
 * 退出码：0 = 补丁成功应用且幂等；1 = 未应用（打印原因）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { applyPatch } from '../lib/patch.js'

/**
 * 自动探测前端 bundle 路径。
 * @returns bundle 绝对路径，失败返回 undefined。
 */
function detectBundle() {
  for (const argv of process.argv.slice(2)) {
    if (/index-[A-Za-z0-9_-]+\.js$/.test(argv) && existsSync(argv)) return resolve(argv)
  }
  const appData = process.env.APPDATA
  if (typeof appData === 'string' && appData !== '') {
    const dist = join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
    if (existsSync(join(dist, 'index.html'))) {
      const html = readFileSync(join(dist, 'index.html'), 'utf8')
      const matched = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)
      if (matched !== null) return join(dist, 'assets', matched[1])
    }
  }
  return undefined
}

const target = detectBundle()
if (target === undefined) {
  console.error('verify-patch: 未能探测到前端 bundle，请显式传入路径')
  process.exit(2)
}

const src = readFileSync(target, 'utf8')
const modeArg = process.argv.find((a) => a.startsWith('--mode='))
const mode = modeArg === '--mode=element' ? 'element' : 'html'
const result = applyPatch(src, { mode })

console.log('bundle   :', target)
console.log('mode     :', mode)
console.log('bytes    :', src.length, '->', result.code.length, '(+' + (result.code.length - src.length) + ')')
console.log('applied  :', result.applied, '| reason:', result.reason ?? '-', '| function:', result.functionName ?? '-')

if (!result.applied) process.exit(1)

const headAt = result.code.indexOf('__dshRPC')
console.log('\n--- head ---\n' + result.code.slice(Math.max(0, headAt - 90), headAt + 240))
const tailAt = result.code.indexOf(mode === 'html' ? '__dshRPC.set(__dshRPK,i)' : '__dshRPO=[')
console.log('\n--- tail ---\n' + result.code.slice(Math.max(0, tailAt - 170), tailAt + 240))

const again = applyPatch(result.code, { mode })
const idempotent = again.applied && again.code === result.code
console.log('\nidempotent:', idempotent, '(reason: ' + String(again.reason) + ')')

const out = join(process.env.TEMP ?? dirname(target), 'dsh-render-perf-patched.mjs')
writeFileSync(out, result.code)
console.log('patched  :', out, '(可用 node --check 做语法校验)')
process.exit(idempotent ? 0 : 1)
