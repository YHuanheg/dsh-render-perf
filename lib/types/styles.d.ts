/**
 * DSH Web 渲染性能样式（host 端通过 webServer.tapIndex 注入 index.html）。
 *
 * 实测 DOM 层级（2026-09-15，dsh 0.1.6-alpha.1）：
 *   div.wSkVaW_scrollBody[data-conversation-scroll]        ← 会话滚动容器
 *     └ div.EvIC1a_column[data-chat-flow]                  ← 消息列
 *         └ div.EvIC1a_flowItem[data-chat-turn][data-chat-flow-key]  ← 单条 turn（落点）
 *             └ div.hWmORq_body > div._markdown_5pusd_5 > .katex
 *
 * 选择器刻意使用 data 属性而非 CSS Modules 哈希类名（EvIC1a_flowItem 这类
 * 哈希随构建变化，data 属性是稳定契约）。
 *
 * content-visibility:auto 让视口外的 turn 跳过样式计算/布局/绘制/合成，
 * 直接削减 GPU 与显存压力；contain-intrinsic-size 提供占位高度，
 * 并用 auto 关键字记住上次实测尺寸，抑制滚动条跳动。
 */
/** 注入到 <head> 的样式元素 id（幂等标记）。 */
export declare const STYLE_ID = "dsh-render-perf-style";
/** 渲染性能样式表。 */
export declare const RENDER_PERF_STYLES = "[data-chat-turn][data-chat-flow-key]{content-visibility:auto;contain-intrinsic-size:auto 1200px}";
/**
 * 把样式插入 index.html 的 </head> 之前（幂等：已存在则原样返回）。
 * @param html - 原始 index.html 文本。
 * @returns 注入样式后的 HTML。
 */
export declare function injectStyles(html: string): string;
