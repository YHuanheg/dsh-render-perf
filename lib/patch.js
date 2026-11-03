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
export const PATCH_MARKER = '__DSH_RENDER_PERF__';
/**
 * 顶层声明：缓存表 + 上限 + wrapper 样式常量 + 浏览器侧统计对象。
 * @param mode - 实际采用的模式（写入统计对象便于诊断）。
 * @returns 顶层声明源码。
 */
function declaration(mode) {
    return 'const __dshRPC=new Map(),__dshRPX=20000,__dshRPStyle={display:"contents"},' +
        '__dshRPS={hits:0,misses:0,max:20000,patched:true,mode:"' + mode + '"};' +
        'globalThis.' + PATCH_MARKER + '=__dshRPS;__dshRPS.cache=__dshRPC;\n';
}
/**
 * 函数体首部的缓存查询语句。
 * @param argLatex - 原函数第一个参数（LaTeX 源码）。
 * @param argDisplay - 原函数第二个参数（是否 displayMode）。
 * @param jsxFactory - 原文中的 jsx 工厂变量名。
 * @param mode - 补丁模式。
 * @returns 注入源码。
 */
function headCode(argLatex, argDisplay, jsxFactory, mode) {
    const key = 'const __dshRPK=(' + argDisplay + "?'D':'I')+" + argLatex + ',__dshRPH=__dshRPC.get(__dshRPK);';
    if (mode === 'html') {
        return key + 'if(__dshRPH!==void 0){__dshRPS.hits++;return ' + jsxFactory +
            '.jsx("span",{style:__dshRPStyle,dangerouslySetInnerHTML:{__html:__dshRPH}})}__dshRPS.misses++;';
    }
    return key + 'if(__dshRPH!==void 0){__dshRPS.hits++;return __dshRPH}__dshRPS.misses++;';
}
/**
 * 结尾 return 的替换文本（同时负责写缓存）。
 * @param varHtml - 原函数中承载 renderToString 结果的变量名。
 * @param mapper - 原函数中把 DOM 节点递归转成 React 元素的转换器名。
 * @param jsxFactory - 原文中的 jsx 工厂变量名。
 * @param mode - 补丁模式。
 * @returns 替换源码（含结尾 `}`）。
 */
function tailCode(varHtml, mapper, jsxFactory, mode) {
    const evict = 'if(__dshRPC.size>=__dshRPX)__dshRPC.delete(__dshRPC.keys().next().value);';
    if (mode === 'html') {
        return evict + '__dshRPC.set(__dshRPK,' + varHtml + ');return ' + jsxFactory +
            '.jsx("span",{style:__dshRPStyle,dangerouslySetInnerHTML:{__html:' + varHtml + '}})}';
    }
    return 'const __dshRPO=[...new DOMParser().parseFromString(' + varHtml + ',"text/html").body.childNodes].map(' + mapper + ');' +
        evict + '__dshRPC.set(__dshRPK,__dshRPO);return __dshRPO}';
}
/**
 * 函数头锚点：function 名(参数A,参数B){
 * 捕获组：1=函数名 2=参数A(LaTeX) 3=参数B(display)
 */
const FUNC_RE = /function\s+([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{/g;
/**
 * 函数体特征锚点（紧跟在 `{` 之后）：let 变量;try{变量=KaTeX对象.renderToString(
 * 用于在众多同形态函数中确认「就是数学渲染函数」。
 */
const BODY_RE = /^let\s+([A-Za-z_$][\w$]*);try\{\1=([A-Za-z_$][\w$]*)\.renderToString\(/;
/** 结尾锚点：return[...new DOMParser().parseFromString(<var>,"text/html").body.childNodes].map(<mapper>)} */
const TAIL_RE = /return\[\.\.\.new DOMParser\(\)\.parseFromString\(([A-Za-z_$][\w$]*),["']text\/html["']\)\.body\.childNodes\]\.map\(([A-Za-z_$][\w$]*)\)\}/;
/** jsx 工厂锚点：<factory>.jsx("span",{className:"katex-error" —— 从 KaTeX 错误分支提取。 */
const JSX_RE = /([A-Za-z_$][\w$]*)\.jsx\(\s*["']span["']\s*,\s*\{\s*className\s*:\s*["']katex-error["']/;
/**
 * 在 bundle 中定位数学渲染函数：函数头匹配 {@link FUNC_RE}，且函数体紧跟
 * KaTeX renderToString 特征（{@link BODY_RE}），避免误伤其他同类签名的函数。
 *
 * @param source - bundle 源码。
 * @returns 命中信息（含匹配位置），未命中返回 null。
 */
function findMathRenderFunction(source) {
    const re = new RegExp(FUNC_RE.source, 'g');
    let m;
    while ((m = re.exec(source)) !== null) {
        const after = source.slice(m.index + m[0].length);
        if (BODY_RE.test(after))
            return { match: m };
    }
    return null;
}
/**
 * 对前端 bundle 源码应用公式渲染缓存补丁。
 *
 * @param source - dist/assets/index-*.js 的完整文本。
 * @param options - 补丁选项（模式）。
 * @returns 补丁结果；`applied=false` 时 `code` 与入参逐字节相同。
 */
export function applyPatch(source, options = {}) {
    const mode = options.mode ?? 'element';
    if (source.includes(PATCH_MARKER)) {
        return { code: source, applied: true, reason: 'already-patched', mode };
    }
    const fm = findMathRenderFunction(source);
    if (fm === null) {
        return { code: source, applied: false, reason: 'anchor-not-found' };
    }
    const fnName = fm.match[1];
    const argLatex = fm.match[2];
    const argDisplay = fm.match[3];
    const afterBrace = fm.match.index + fm.match[0].length; // 函数体 '{' 之后的位置
    const rest = source.slice(afterBrace);
    const tm = TAIL_RE.exec(rest);
    if (tm === null) {
        return { code: source, applied: false, reason: 'tail-not-found', functionName: fnName };
    }
    const tailStart = afterBrace + tm.index;
    const tailEnd = tailStart + tm[0].length;
    const varHtml = tm[1];
    const mapper = tm[2];
    // jsx 工厂名从 KaTeX 错误分支提取（html 模式必需）
    const body = source.slice(afterBrace, tailEnd);
    const jm = JSX_RE.exec(body);
    if (jm === null) {
        return { code: source, applied: false, reason: 'jsx-factory-not-found', functionName: fnName };
    }
    const jsxFactory = jm[1];
    const code = source.slice(0, fm.match.index) + // 函数声明之前
        declaration(mode) + // 顶层缓存声明
        source.slice(fm.match.index, afterBrace) + // function ks(t,r){
        headCode(argLatex, argDisplay, jsxFactory, mode) + // 缓存命中查询
        source.slice(afterBrace, tailStart) + // 原函数中段（渲染 + 错误分支）原样保留
        tailCode(varHtml, mapper, jsxFactory, mode) + // 写缓存 + 返回
        source.slice(tailEnd); // 函数之后的 bundle 其余部分
    return { code, applied: true, functionName: fnName, mode };
}
//# sourceMappingURL=patch.js.map