/**
 * DSH Web 前端「公式渲染缓存」运行时补丁 —— 纯字符串变换，无副作用。
 *
 * 背景（实测 2026-09-15，dsh 0.1.6-alpha.1）：
 *   web-frontend 的 bundle 中，markdown 的 math/inlineMath 节点会调用
 *     function ks(t,r){ let i; try{ i = G4.renderToString(t,{displayMode:r,throwOnError:true}) } ... }
 *   每次调用都要走「KaTeX 编译 → DOMParser 解析 HTML → 递归把每个 DOM 节点
 *   转成 React 元素」。该函数无任何缓存，因此会话切换时整棵公式树被重建：
 *   实测「高数1000题多代理刷题解析 (1)」切走再切回耗时 1832ms（首次 2006ms）。
 *
 * 两级优化：
 *   ① 缓存：按 (displayMode, latex) 记住渲染结果，避免重复编译；
 *   ② 批量建 DOM：把「递归 createElement 出上百个 React 元素」换成
 *      「一个 <span style="display:contents" dangerouslySetInnerHTML>」，
 *      由浏览器 HTML 解析器一次性建好 DOM，React 侧只剩 1 个元素。
 *
 * 补丁只做最小改写：函数名/参数名/结果变量/jsx 工厂名/引号风格全部从原文捕获，
 * 任何一步匹配失败都原样返回，绝不产出半截代码。
 */
/** 幂等标记：出现在 bundle 中即视为已打过补丁。 */
export declare const PATCH_MARKER = "__DSH_RENDER_PERF__";
/** 补丁模式：element = 缓存 React 元素数组（实测最快）；html = 缓存 HTML + 批量建 DOM。 */
export type PatchMode = 'html' | 'element';
/** 补丁选项。 */
export interface PatchOptions {
    /** 默认 element（实测 483ms vs html 模式 699~774ms）；html 为可选变体。 */
    mode?: PatchMode;
}
/** 补丁结果。 */
export interface PatchResult {
    /** 最终要发给浏览器的代码（失败时等于入参）。 */
    code: string;
    /** 是否处于「已打补丁」状态（含本来就打过的幂等命中）。 */
    applied: boolean;
    /** 未应用时的原因，用于日志诊断。 */
    reason?: string;
    /** 命中的函数名，便于排查上游改名。 */
    functionName?: string;
    /** 实际采用的模式。 */
    mode?: PatchMode;
}
/**
 * 对前端 bundle 源码应用公式渲染缓存补丁。
 *
 * @param source - dist/assets/index-*.js 的完整文本。
 * @param options - 补丁选项（模式）。
 * @returns 补丁结果；`applied=false` 时 `code` 与入参逐字节相同。
 */
export declare function applyPatch(source: string, options?: PatchOptions): PatchResult;
