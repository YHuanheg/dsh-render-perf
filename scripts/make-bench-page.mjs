/**
 * 基准页生成器：从真实 DSH 会话抽出全部 $$ 公式，生成一个本地浏览器基准页，
 * 用同一份 KaTeX + 与 bundle 等价的「renderToString → DOMParser → 递归建元素」
 * 逻辑，对比「每次重算」与「公式渲染结果缓存」两种路径的耗时。
 *
 * 用法：node scripts/make-bench-page.mjs <session.v4.jsonl.zstd> <outDir>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import zlib from 'node:zlib'

const [sessionFile, outDir] = process.argv.slice(2)
if (sessionFile === undefined || outDir === undefined) {
  console.error('用法: node scripts/make-bench-page.mjs <session.v4.jsonl.zstd> <outDir>')
  process.exit(2)
}

/** 收集会话里 assistant 正文。 */
const lines = zlib.zstdDecompressSync(readFileSync(sessionFile)).toString('utf8').split('\n').filter(Boolean)
let text = ''
for (const line of lines) {
  let evt
  try {
    evt = JSON.parse(line)
  } catch {
    continue
  }
  if (evt.type !== 'assistant/message') continue
  const content = evt.data?.message?.content ?? evt.data?.content
  if (!Array.isArray(content)) continue
  for (const part of content) {
    // 只取正文文本（reasoning 与 tool-call 不参与渲染）
    if (part?.type === 'text' && typeof part.text === 'string') text += part.text + '\n'
    else if (part?.type === undefined && typeof part?.text === 'string') text += part.text + '\n'
  }
}

/** 抽出块级公式（$$...$$），与前端 markdown 解析出的节点一一对应。 */
const formulas = []
const re = /\$\$([\s\S]+?)\$\$/g
let m
while ((m = re.exec(text)) !== null) {
  const latex = m[1].trim()
  if (latex !== '') formulas.push(latex)
}

console.log('会话公式数:', formulas.length)
if (formulas.length === 0) {
  console.error('未抽到 $$ 公式')
  process.exit(1)
}
console.log('样例:', JSON.stringify(formulas.slice(0, 3)))

/** 找 katex 资源。 */
const katexCandidates = [
  'D:/Work/Agent/.dsh/profiles/desktop/node_modules/katex/dist',
  'D:/Work/Agent/.dsh/profiles/node_modules/katex/dist',
]
const katexDir = katexCandidates.find((dir) => existsSync(join(dir, 'katex.min.js')))
if (katexDir === undefined) {
  console.error('未找到 katex/dist')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (const file of ['katex.min.js', 'katex.min.css']) {
  copyFileSync(join(katexDir, file), join(outDir, file))
}
/** 字体相对路径 katex.min.css 需要 fonts/，一并复制。 */
const fontsSrc = join(katexDir, 'fonts')
if (existsSync(fontsSrc)) {
  mkdirSync(join(outDir, 'fonts'), { recursive: true })
  for (const name of readdirSync(fontsSrc)) {
    copyFileSync(join(fontsSrc, name), join(outDir, 'fonts', name))
  }
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>dsh-render-perf bench</title>
<link rel="stylesheet" href="./katex.min.css" />
<script src="./katex.min.js"></script>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; }
  #out { white-space: pre; font-family: ui-monospace, monospace; font-size: 12.5px; }
  #stage { position: absolute; left: -99999px; top: 0; }
</style>
</head>
<body>
<h3>dsh-render-perf 真实会话基准</h3>
<div id="out">running…</div>
<div id="stage"></div>
<script>
const FORMULAS = ${JSON.stringify(formulas)};

/** 与 bundle 中 mapper 等价：把 DOM 节点递归转成 {type, props, children} 形态。 */
function mapNode(node, key) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node, props = { key };
  for (const attr of el.attributes) {
    if (attr.name === 'class') props.className = attr.value;
    else if (attr.name === 'style') props.style = attr.value;
    else props[attr.name] = attr.value;
  }
  const children = [...el.childNodes].map(mapNode);
  return children.length === 0
    ? { type: el.localName, props, children: [] }
    : { type: el.localName, props, children };
}

/** 未打补丁路径：每次重编译 + 重解析 + 重建元素。 */
function renderUncached(latex, display) {
  const html = katex.renderToString(latex, { displayMode: display, throwOnError: true });
  return [...new DOMParser().parseFromString(html, 'text/html').body.childNodes].map(mapNode);
}

/** 打补丁后路径：命中缓存直接复用。 */
const CACHE = new Map();
let hits = 0, misses = 0;
function renderCached(latex, display) {
  const key = (display ? 'D:' : 'I:') + latex;
  const hit = CACHE.get(key);
  if (hit !== undefined) { hits += 1; return hit; }
  misses += 1;
  const out = renderUncached(latex, display);
  CACHE.set(key, out);
  return out;
}

/** 计时一轮。 */
function measure(fn) {
  const t0 = performance.now();
  let count = 0;
  for (const latex of FORMULAS) { fn(latex, true); count += 1; }
  return { ms: performance.now() - t0, count };
}

const lines = [];
function log(s) { lines.push(s); document.getElementById('out').textContent = lines.join('\\n'); }

// 预热 KaTeX（字体/模块初始化），不计入
measure(renderUncached);

const rounds = [];
for (let i = 0; i < 3; i += 1) {
  const cold = measure(renderUncached);       // 无缓存：每次全量重算
  const warm = measure(renderUncached);       // 无缓存：再来一遍（仍全量）
  CACHE.clear(); hits = 0; misses = 0;
  const c1 = measure(renderCached);           // 有缓存：冷启动
  const c2 = measure(renderCached);           // 有缓存：热命中
  rounds.push({ cold: cold.ms, warm: warm.ms, cachedCold: c1.ms, cachedWarm: c2.ms,
                hits, misses, cacheSize: CACHE.size });
}

const avg = (pick) => rounds.reduce((s, r) => s + pick(r), 0) / rounds.length;
const result = {
  formulas: FORMULAS.length,
  rounds,
  avgUncachedWarmMs: +avg((r) => r.warm).toFixed(1),
  avgCachedWarmMs: +avg((r) => r.cachedWarm).toFixed(1),
  avgCachedColdMs: +avg((r) => r.cachedCold).toFixed(1),
  speedup: +(avg((r) => r.warm) / Math.max(avg((r) => r.cachedWarm), 0.001)).toFixed(2),
  hitsLastRound: rounds[rounds.length - 1].hits,
  cacheSize: rounds[rounds.length - 1].cacheSize,
};

log('公式数          : ' + result.formulas);
log('无缓存 · 热重算 : ' + result.avgUncachedWarmMs + ' ms');
log('有缓存 · 冷启动 : ' + result.avgCachedColdMs + ' ms');
log('有缓存 · 热命中 : ' + result.avgCachedWarmMs + ' ms');
log('加速比          : ' + result.speedup + '×');
log('末轮命中/缓存条 : ' + result.hitsLastRound + ' / ' + result.cacheSize);
log('');
log('原始数据: ' + JSON.stringify(rounds));

window.__BENCH__ = result;
</script>
</body>
</html>
`

writeFileSync(join(outDir, 'index.html'), html)
console.log('已生成:', join(outDir, 'index.html'))
