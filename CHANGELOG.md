# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-03

适配 DSH `0.1.0-rc.6`（`@deepseek-ai/cordis` 命名空间 + 新版 Slot 注册契约）。

### Changed

- **client 端改用当前 Slot 契约**：`ctx.slots.register(options, component)` —— component 是
  **第二个参数**（React 函数组件），不再支持把 `component` 塞进 options，也不再是 `{ render() }` 对象。
  诊断卡片重写为 `createElement` 组件，通过 `require('react')` 取运行时 React。
- **peerDependencies 跟上游改名**：`cordis` → `@deepseek-ai/cordis`。
- **dist 探测改为多候选全接管**：桌面版资源树与 profile npm 树可能装着不同版本前端
  （实测 `index-BXV-oxvX.js` vs `index-Dqw48FrP.js`），现在按「进程参数 → profile 环境 →
  模块解析 → 常见全局路径」收集全部候选并逐个注册 exact 路由，同名去重、优先运行期资源树。
- **补丁锚点在两代 bundle 上复验**：`function a2(e,t)` / `ql(n,r)` 均命中，
  `renderToString` → `DOMParser` → `map(mapper)` 形态未变。

### Added

- `cordis.patch.yml` + `dsh.bundle.patch`：可从包目录直接安装为 profile bundle。
- 进程级挂载守卫（`globalThis[Symbol.for(...)]`）：避免热挂载/重复加载导致 exact 路由重复注册。
- `scripts/selftest-host.mjs`：mock cordis 上下文跑 `apply()`，验证 dist 探测、路由注册、
  补丁注入、样式 tap 幂等与挂载守卫。

### Notes

- host 端 fiber 加载后**刷新页面**即生效；client 端诊断卡片需**重启 DSH**（client bundle 在启动时进 boot manifest）。
- **真实会话基准**（会话「高等数学习题解答」，322 处块级公式 / 274 个不同表达式）：
  KaTeX 编译 38 ms + DOMParser/建元素 131 ms → 无缓存热重算 **206 ms**，有缓存热命中 **0.1 ms**。
  复现脚本 `scripts/make-bench-page.mjs` + `scripts/probe-session.mjs`。
- **安装方式改为从 GitHub 安装**：仓库随包带上构建产物 `lib/`，`github:YHuanheg/dsh-render-perf`
  直接可装，无需在目标机器上编译。

## [0.1.0] - 2026-09-16

### Added

- **公式渲染结果缓存（host 端，不修改 DSH 安装目录）**：注册 `webServer` exact 路由拦截
  `/assets/index-<hash>.js` 响应，在响应流中为数学渲染函数注入 `(displayMode, LaTeX) → React 元素数组`
  的 LRU 缓存（上限 20000 条）。命中时跳过 KaTeX 编译、DOMParser 解析与递归 React 元素构造。
- **视口外渲染跳过（client 端样式 / host 端 tapIndex 注入）**：对 `[data-chat-turn][data-chat-flow-key]`
  应用 `content-visibility: auto` + `contain-intrinsic-size: auto 1200px`，让滚动视口外的 turn
  不参与样式计算、布局、绘制与合成。
- **设置中心诊断面板**：实时显示缓存命中/未命中次数、命中率、缓存条目、视口跳过状态与当前页面规模。
- **补丁自检脚本** `scripts/verify-patch.mjs`：对真实前端 bundle 应用补丁并做幂等与语法校验。
- **fail-safe 设计**：补丁锚点匹配失败时原样返回未修改产物并在日志告警，页面行为等同未安装。

### Performance

实测会话「公式密集型长会话」（34,414 DOM 元素 / 502 个 KaTeX 表达式，
Chrome 151 / PerformanceObserver longtask）：

| 场景 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| 切走再切回（热，公式全命中缓存） | 1832 ms | 455 ms | −75% |
| 打开会话（冷 / 部分命中） | ~2000 ms | 535 ms | −73% |
| 热切回时缓存 miss 增长 | — | 0 | 零重复编译 |
| JS 堆 | 110 MB | 72 MB | 下降 |

按 DOM 元素归一化：每元素渲染成本 0.0671 ms → 0.0132 ms（约 5×）。

### Notes

- 补丁模式默认为 `element`（缓存 React 元素数组）。另提供 `html` 模式
  （缓存 HTML 字符串 + `dangerouslySetInnerHTML`），实测**更慢**（699~774 ms），
  已在代码中保留但默认不启用。
- 跨会话切换时 React 仍需为新挂载的 fiber 创建 DOM 节点（剩余约 455 ms），
  要进一步消除需要前端源码级的 keep-alive 或虚拟化。
- Electron 桌面端走 `file://` 协议，不经 webserver，本插件不适用。
