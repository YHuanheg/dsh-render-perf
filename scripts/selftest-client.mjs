/**
 * client 端离线自检：在 Node 里用最小桩跑 lib/client.js 的工厂与 apply()，验证
 *   ① bundle 形状（window.__ModuleLoader__.load({id, factory})）；
 *   ② 导出 { name, inject, apply }；
 *   ③ apply() 通过 ctx.slots.inject + register(options, component) 注册卡片，
 *      且 component 是可调用的 React 组件（当前 Slot 契约：component 是第二个参数）；
 *   ④ 注册选项能被真实 SlotCore 接受（kind=list 需要 id）。
 *
 * 用法：node scripts/selftest-client.mjs
 * 退出码：0 = 全绿；1 = 有断言失败。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = join(here, '..', 'lib', 'client.js')

let failures = 0
/**
 * 断言。
 * @param ok - 条件。
 * @param label - 描述。
 * @param detail - 细节。
 */
function check(ok, label, detail) {
  if (ok) console.log('  ✓ ' + label)
  else {
    failures += 1
    console.log('  ✗ ' + label + (detail === undefined ? '' : ' — ' + detail))
  }
}

/** 最小 React 桩：只覆盖 bundle 用到的成员。 */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  Fragment: 'Fragment',
}

let loaded
globalThis.window = {
  setInterval: () => 0,
  clearInterval: () => {},
  __ModuleLoader__: {
    load(record) {
      loaded = record
    },
  },
}
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
}

const source = readFileSync(bundle, 'utf8')
// bundle 是 classic script：执行它即可注册 factory。
new Function('window', 'document', source)(globalThis.window, globalThis.document)

console.log('bundle  :', bundle)
check(loaded !== undefined, 'bundle 调用了 window.__ModuleLoader__.load')
check(loaded?.id === '@dsh-external/dsh-render-perf', 'loader id = 包名', loaded?.id)
check(typeof loaded?.factory === 'function', 'factory 是函数')

const exportsObject = loaded.factory((id) => {
  if (id === 'react' || id === 'react/jsx-runtime') return reactStub
  throw new Error('bundle 意外依赖了 ' + id)
})

console.log('exports :', Object.keys(exportsObject).join(', '))
check(exportsObject.name === '@dsh-external/dsh-render-perf', '导出 name')
check(Array.isArray(exportsObject.inject) && exportsObject.inject.includes('slots'), 'inject 声明 slots')
check(typeof exportsObject.apply === 'function', '导出 apply()')

const registrations = []
const injections = []
const disposers = []
const ctx = {
  effect(fn) {
    const d = fn()
    disposers.push(d)
    return d
  },
  slots: {
    inject(key, callback) {
      injections.push(key)
      const d = callback()
      disposers.push(d)
      return d
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

exportsObject.apply(ctx)

console.log('\n--- 注册 ---')
for (const { options, component } of registrations) {
  console.log('  slot=' + options.name + ' id=' + options.id + ' order=' + options.order +
    ' label=' + (typeof options.label === 'function' ? options.label() : options.label) +
    ' component=' + typeof component)
}

check(injections.includes('settings.plugin.item'), '等待 settings.plugin.item 声明')
check(registrations.length === 1, '注册了 1 条卡片', 'count=' + registrations.length)

const reg = registrations[0]
if (reg !== undefined) {
  check(reg.options.name === 'settings.plugin.item', 'slot 名 = settings.plugin.item')
  check(typeof reg.options.id === 'string' && reg.options.id !== '', 'list 槽位给了 id')
  check(typeof reg.options.label === 'function' || typeof reg.options.label === 'string', 'label 合法（string 或 thunk）')
  check(reg.options.component === undefined, '未把 component 塞进 options（旧契约）')
  check(typeof reg.component === 'function', 'component 是第二个参数且为函数')
  check(reg.component.length <= 1, 'component 接受 0/1 个 props 参数', 'arity=' + reg.component.length)
  // 渲染一次（无 props）确认不抛错
  try {
    const tree = reg.component({})
    check(tree !== undefined && tree !== null, 'component 能渲染出元素')
  } catch (error) {
    check(false, 'component 渲染不抛错', String(error))
  }
}

// 用真实 SlotCore 校验选项合法（kind=list）
try {
  const { SlotCore } = await importSlots()
  const core = new SlotCore()
  core.register(
    { name: 'root', children: { 'settings.plugin.item': { kind: 'list', scope: 'root' } } },
    () => null,
  )
  const dispose = core.register(reg.options, reg.component)
  check(core.entries('settings.plugin.item').length === 1, '真实 SlotCore 接受该注册')
  dispose()
  check(core.entries('settings.plugin.item').length === 0, 'disposer 能撤回注册')
} catch (error) {
  check(false, 'SlotCore 校验通过', String(error && error.message))
}

/**
 * 从工作区或 profile 的 node_modules 里加载 dsh-client-ui-slots。
 * 工作区不带该依赖，所以按 profile 布局回退到绝对路径。
 * @returns 模块命名空间。
 */
async function importSlots() {
  const profile = process.env.DSH_PROFILE_DIR
  const bases = profile === undefined ? [] : [join(profile, 'node_modules'), join(dirname(profile), 'node_modules')]
  const specifiers = ['@deepseek-ai/dsh-client-ui-slots']
  for (const base of bases) {
    specifiers.push('file:///' + join(base, '@deepseek-ai', 'dsh-client-ui-slots', 'lib', 'index.js').replace(/\\/g, '/'))
  }
  let lastError
  for (const specifier of specifiers) {
    try {
      return await import(specifier)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

console.log(failures === 0 ? '\n结果: 全部通过' : '\n结果: ' + failures + ' 项失败')
process.exit(failures === 0 ? 0 : 1)
