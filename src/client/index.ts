/**
 * @dsh-external/dsh-render-perf —— client 端。
 *
 * 职责：在「设置 → 插件」里注册一张只读诊断卡片，实时显示公式渲染缓存
 * 的命中情况（数据由 host 端注入的补丁写入 `globalThis.__DSH_RENDER_PERF__`）。
 *
 * 契约（已对 @deepseek-ai/dsh-client-ui-slots 0.1.0-rc.6 核对）：
 *   - `ctx.slots.register(options, component)` —— component 是第二个参数，
 *     形状为 React 函数组件 `(props) => ReactNode`；
 *   - `ctx.slots.inject(key, () => dispose)` —— 等槽位被父级声明后才注册；
 *   - `settings.plugin.item` 是 list 槽位，必须给 `id`，`label` 可为字符串或 thunk。
 *
 * 注意：视口渲染跳过样式由 host 端通过 webServer.tapIndex 注入 index.html，
 * 本端不重复注入，避免两份规则。
 */
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'
import * as React from 'react'

interface ClientContext {
  slots: SlotsService
  effect: (fn: () => (() => void) | void, label?: string) => void
}

/** 稳定插件名（与 host 端一致）。 */
export const name = '@dsh-external/dsh-render-perf'

/** 使用 slots 服务，必须声明。 */
export const inject = ['slots']

/** 卡片条目 id（同槽位内唯一）。 */
const PANEL_ID = '@dsh-external/dsh-render-perf'

/** host 端补丁在浏览器侧暴露的统计对象。 */
interface RenderPerfStats {
  hits: number
  misses: number
  max: number
  patched?: boolean
  cache?: Map<string, unknown>
}

/**
 * 读取统计数据。
 * @returns 统计对象；补丁未生效时为 undefined。
 */
function readStats(): RenderPerfStats | undefined {
  return (globalThis as { __DSH_RENDER_PERF__?: RenderPerfStats }).__DSH_RENDER_PERF__
}

/** 表格行样式。 */
const rowLabelStyle: React.CSSProperties = { padding: '3px 16px 3px 0', opacity: 0.72 }
const rowValueStyle: React.CSSProperties = { padding: '3px 0' }

/**
 * 一行指标。
 * @param props - 标签与取值。
 * @returns 表格行。
 */
function MetricRow(props: { label: string; value: string; accent?: string }): React.ReactElement {
  return React.createElement(
    'tr',
    null,
    React.createElement('td', { style: rowLabelStyle }, props.label),
    React.createElement(
      'td',
      { style: rowValueStyle },
      React.createElement('b', { style: props.accent !== undefined ? { color: props.accent } : undefined }, props.value),
    ),
  )
}

/**
 * 诊断卡片（React 函数组件）。
 * @returns 卡片内容。
 */
function RenderPerfCard(): React.ReactElement {
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1500)
    return () => window.clearInterval(timer)
  }, [])

  // tick 只用于触发重渲染；所有数字每次渲染重新读取实时状态。
  void tick

  const stats = readStats()
  const styleOn = document.getElementById('dsh-render-perf-style') !== null
  const katexCount = document.querySelectorAll('.katex').length
  const nodeCount = document.querySelectorAll('*').length
  const total = stats !== undefined ? stats.hits + stats.misses : 0
  const hitRate = stats !== undefined && total > 0 ? ((stats.hits / total) * 100).toFixed(1) + '%' : '—'
  const cacheSize = stats?.cache !== undefined ? stats.cache.size : 0

  return React.createElement(
    'div',
    { style: { padding: '14px 16px', fontSize: 13, lineHeight: 1.75 } },
    React.createElement('h3', { style: { fontSize: 15, margin: '0 0 8px' } }, '⚡ 渲染性能'),
    React.createElement(
      'div',
      { style: { marginBottom: 6 } },
      '公式渲染缓存：',
      stats !== undefined
        ? React.createElement('b', { style: { color: '#22c55e' } }, '已启用')
        : React.createElement('b', { style: { color: '#f59e0b' } }, '未生效（请硬刷新页面）'),
    ),
    React.createElement(
      'table',
      { style: { borderCollapse: 'collapse', fontSize: 12.5 } },
      React.createElement(
        'tbody',
        null,
        React.createElement(MetricRow, { label: '缓存命中次数', value: stats !== undefined ? String(stats.hits) : '—' }),
        React.createElement(MetricRow, { label: '缓存未命中（实际编译）', value: stats !== undefined ? String(stats.misses) : '—' }),
        React.createElement(MetricRow, { label: '命中率', value: hitRate }),
        React.createElement(MetricRow, { label: '缓存条目 / 上限', value: cacheSize + ' / ' + (stats !== undefined ? String(stats.max) : '—') }),
        React.createElement(MetricRow, { label: '视口外渲染跳过', value: styleOn ? '已启用' : '未启用', accent: styleOn ? '#22c55e' : '#f59e0b' }),
        React.createElement(MetricRow, { label: '当前页面公式数', value: String(katexCount) }),
        React.createElement(MetricRow, { label: '当前 DOM 节点数', value: String(nodeCount) }),
      ),
    ),
    React.createElement(
      'p',
      { style: { fontSize: 12, opacity: 0.7, margin: '8px 0 0' } },
      '切换会话时「缓存未命中」不应增长，命中次数持续增加即为缓存生效。',
    ),
  )
}

/**
 * 客户端入口。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
      {
        name: 'settings.plugin.item',
        id: PANEL_ID,
        order: 60,
        label: () => '渲染性能',
      },
      RenderPerfCard,
    )),
    'dsh-render-perf: settings card',
  )
}
