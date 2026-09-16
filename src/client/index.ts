/**
 * @dsh-external/dsh-render-perf —— client 端。
 *
 * 职责：在「设置中心 → 插件」里提供一个只读诊断面板，实时显示公式渲染缓存
 * 的命中情况（数据由 host 端注入的补丁写入 `globalThis.__DSH_RENDER_PERF__`）。
 *
 * 注意：视口渲染跳过样式由 host 端通过 webServer.tapIndex 注入 index.html，
 * 本端不重复注入，避免两份规则。
 */
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

interface ClientContext {
  slots: SlotsService
  effect: (fn: () => (() => void) | void, label?: string) => void
}

/** 稳定插件名（与 host 端一致）。 */
export const name = '@dsh-external/dsh-render-perf'

/** 使用 slots 服务，必须声明。 */
export const inject = ['slots']

/** 面板条目 id。 */
const PANEL_ID = '@dsh-external/dsh-render-perf-panel'

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

/**
 * 构造面板 DOM（含自动刷新，元素脱离文档后自行停止）。
 * @returns 面板根元素。
 */
function buildPanel(): HTMLElement {
  const root = document.createElement('div')
  root.style.cssText = 'padding:14px 16px;font-size:13px;line-height:1.75;'

  const render = (): void => {
    const stats = readStats()
    const styleOn = document.getElementById('dsh-render-perf-style') !== null
    const katexCount = document.querySelectorAll('.katex').length
    const nodeCount = document.querySelectorAll('*').length
    const hitRate = stats && (stats.hits + stats.misses) > 0
      ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
      : '—'
    const cacheSize = stats?.cache ? stats.cache.size : 0

    root.innerHTML = [
      '<h3 style="font-size:15px;margin:0 0 8px;">⚡ 渲染性能</h3>',
      '<div style="margin-bottom:6px;">公式渲染缓存：',
      stats ? '<b style="color:#22c55e;">已启用</b>' : '<b style="color:#f59e0b;">未生效（请硬刷新页面）</b>',
      '</div>',
      '<table style="border-collapse:collapse;font-size:12.5px;">',
      row('缓存命中次数', stats ? String(stats.hits) : '—'),
      row('缓存未命中（实际编译）', stats ? String(stats.misses) : '—'),
      row('命中率', hitRate),
      row('缓存条目 / 上限', cacheSize + ' / ' + (stats ? String(stats.max) : '—')),
      row('视口外渲染跳过', styleOn ? '已启用' : '未启用'),
      row('当前页面公式数', String(katexCount)),
      row('当前 DOM 节点数', String(nodeCount)),
      '</table>',
      '<p style="font-size:12px;opacity:0.7;margin:8px 0 0;">',
      '切换会话时「缓存未命中」不应增长，命中次数持续增加即为缓存生效。',
      '</p>',
    ].join('')

    function row(label: string, value: string): string {
      return '<tr><td style="padding:2px 14px 2px 0;opacity:0.75;">' + label +
        '</td><td style="padding:2px 0;"><b>' + value + '</b></td></tr>'
    }
  }

  render()
  const timer = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(timer)
      return
    }
    render()
  }, 1500)

  return root
}

/**
 * 客户端入口。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      id: PANEL_ID,
      key: PANEL_ID,
      label: () => '渲染性能',
      component: () => ({
        render() {
          return buildPanel()
        },
      }),
    }),
  ), 'dsh-render-perf: settings panel')
}
