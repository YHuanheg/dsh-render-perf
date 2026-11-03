# ⚡ DSH 渲染性能治理 (dsh-render-perf)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH Compatibility](https://img.shields.io/badge/DSH-Web%20(0.1.6--alpha)-green.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bundled with tsdown](https://img.shields.io/badge/Bundler-tsdown%20(Rolldown)-orange.svg)](https://github.com/sxzz/tsdown)
[![Cordis Microkernel](https://img.shields.io/badge/Architecture-Cordis%20Fiber-purple.svg)](https://cordis.moe/)

**`dsh-render-perf`** 是专为 **DeepSeek Harness (DSH)** Web 端打造的**公式渲染性能治理插件**。

它解决一个非常具体的痛点：**公式密集的长会话（考研数学、论文推导、竞赛题解）每次点击切换都要卡上十几甚至几十秒**。

插件在**不修改 DSH 安装目录任何一个字节**的前提下，运行时给前端数学渲染函数注入结果缓存，并把滚动视口外的消息块移出渲染流水线。

---

## 🔥 问题背景：不是浏览器卡，是每次都在重算

DSH Web 前端的 markdown 渲染器里，所有行内/块级公式都会调用同一个函数：

```js
function ks(t,r){let i;try{i=G4.renderToString(t,{displayMode:r,throwOnError:!0})}
 catch(s){try{i=G4.renderToString(t,{displayMode:r,strict:"ignore",throwOnError:!1})}
 catch{return u.jsx("span",{className:"katex-error",...})}}
 return[...new DOMParser().parseFromString(i,"text/html").body.childNodes].map(C8)}
```

每次调用都要完整走一遍：

1. **KaTeX 编译**：LaTeX 源码 → 语法树 → 布局 → HTML 字符串；
2. **DOMParser 解析**：HTML 字符串 → 真实 DOM 子树；
3. **递归转 React 元素**：每一个 DOM 节点都变成独立的 React element 对象（单个公式往往 70+ 个节点）。

而这个函数**没有任何缓存，也没有虚拟化**——整个前端 bundle 里 `content-visibility` 出现 0 次。

于是每次切换会话，就是把这棵公式 DOM 树从零重建一遍。

### 实测基线（真实会话，Chrome 151）

会话「高数1000题多代理刷题解析」：解压后 3.26 MB 文本，含 **1629 个块级公式 + 6484 个行内公式 = 8113 个 KaTeX 表达式**。

| 场景 | DOM 元素 | KaTeX 公式 | 主线程长任务 |
|---|---|---|---|
| 打开会话（首次） | 27,291 | 352 | **2006 ms** |
| 切走再切回（第 2 次） | 27,291 | 352 | **1832 ms** |
| 打开另一个较大会话 | 46,091 | 696 | 2330 + 1437 ms |

第二次与第一次几乎同耗时——**每次点击都在全量重建**。视图完整展开上万条公式时，就是 20~40 秒级别的冻结，以及随之飙升的 GPU 显存占用。

---

## ✨ 核心特性矩阵

### 1. 🧠 公式渲染结果缓存（治本 · host 端）

- 注册 `webServer` **exact 路由**拦截前端 JS 资产 `/assets/index-<hash>.js` 的响应，在**响应流中**为渲染函数注入缓存层；
- 缓存键 = `displayMode + LaTeX 源码`，**跨会话共享**，LRU 上限 20000 条；
- 命中时 **KaTeX 编译、DOMParser 解析、递归 React 元素构造三件事全部跳过**；
- 资产名从 `dist/index.html` **实时解析**，DSH 升级更换 hash 后自动适配。

### 2. 👁️ 视口外渲染跳过（降本 · 双端）

- 对 `[data-chat-turn][data-chat-flow-key]` 应用 `content-visibility: auto` + `contain-intrinsic-size: auto 1200px`；
- 滚动视口外的 turn **不参与样式计算、布局、绘制与合成**，直接缓解 GPU 与显存压力；
- `contain-intrinsic-size` 用 `auto` 关键字记住上次实测尺寸，**滚动条零跳动**（实测 `scrollTop` 漂移 0 px）。

### 3. 📊 设置中心实时诊断面板（client 端）

设置 → 插件 → 搜索 `render-perf` 即可展开，实时显示：

- 缓存命中次数 / 未命中次数（= 实际编译次数）/ 命中率
- 缓存条目 / 上限
- 视口外渲染跳过是否启用
- 当前页面公式数与 DOM 节点数

**判读方法**：切换会话时 `misses` 不应增长，`hits` 持续增加即为缓存生效。也可在控制台直接读：

```js
__DSH_RENDER_PERF__   // { hits, misses, max, mode, cache }
```

### 4. 🛡️ Fail-safe 设计（绝不帮倒忙）

- 补丁采用**结构化锚点匹配**（函数名、参数名、结果变量、jsx 工厂名全部从原文捕获），对上游压缩变量名变化有较强容错；
- 任何一步匹配失败 → **原样返回未修改的产物** + 日志告警，页面行为等同未安装；
- 路由通过 `ctx.effect` 绑定插件 fiber，**卸载即净**；
- 提供自检脚本 `npm run verify`，随时确认当前 DSH 版本是否仍可注入。

### 5. 🔒 零侵入安装

- **不修改 `node_modules` 里任何文件**，只在 HTTP 响应流里做文章；
- **不写 profile patch、不重启进程**（配合超级注入器热加载）；
- 随插件卸载，一切回到原样。

---

## 📈 优化后实测

同一会话、同一测量口径（PerformanceObserver longtask）：

| 场景 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| **切走再切回（热，公式全命中缓存）** | 1832 ms | **455 ms** | **−75%** |
| 打开会话（冷 / 部分命中） | ~2000 ms | **535 ms** | **−73%** |
| 热切回时缓存 miss 增长 | — | **0** | 零重复编译 |
| JS 堆占用 | 110 MB | 72 MB | 下降 |

按 DOM 元素归一化：**每元素渲染成本 0.0671 ms → 0.0132 ms（约 5×）**。

### 真实会话基准（2026-11-03 · 会话「高等数学习题解答」）

数据源：该会话 assistant 正文里的 **322 处块级公式**（274 个不同表达式、48 处重复），
在 Chromium 128 中用与 bundle 同一套 `renderToString → DOMParser → 递归建元素` 逻辑计时：

| 环节 | 322 处耗时 | 均摊 |
|---|---|---|
| KaTeX 编译（`renderToString`） | 38 ms | 0.118 ms/处 |
| `DOMParser` 解析 + 递归构造 React 元素 | 131 ms | 0.407 ms/处 |
| 无缓存 · 每次全量重算（3 轮均值） | **206 ms** | — |
| 有缓存 · 热命中 | **0.1 ms** | 纯 Map 查找 |

结论：重挂载同一会话时公式节点构造从 206 ms 降到 0.1 ms；且 **DOM 解析+建元素占 2/3**，
这正是 `element` 模式（缓存整个 React 元素数组）优于只缓存 HTML 的原因。

复现方式：

```bash
node scripts/make-bench-page.mjs <session.v4.jsonl.zstd> .bench
# 用任意静态服务器打开 .bench/index.html，结果在 window.__BENCH__
```

口径说明：以上只覆盖「公式节点构造」这一段；React commit、布局、绘制不在内
（那部分由 `content-visibility` 样式处理）。

### 正确性回归（全部通过）

| 检查项 | 结果 |
|---|---|
| `.katex` / `.katex-mathml` / `.katex-html` 数量 | 与基线一致 |
| MathML `<annotation>` 公式源码 | 完整保留 |
| 公式视觉渲染（积分号/根号/上下标/分数） | 一致 |
| 控制台 React key 警告 / 新增错误 | 无 |
| 滚动到顶后 `scrollTop` 漂移 | 0 px |
| 既有插件（公式点击复制 / render-guardian） | 不受影响 |

---

## 📦 安装与使用指南

本包是一个 **Cordis bundle**：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，
安装时由 DSH 自己把它写进 profile 的 `dependencies` 与 `dsh.profile.bundles`，无需手改 profile。
仓库**已带构建产物 `lib/`**，从 GitHub 安装时不需要本地编译。

### 方式一：从 GitHub 安装（推荐）

```text
plugin_manager  action=install_bundle  target=github:YHuanheg/dsh-render-perf
```

等价的手工写法（写进 profile `package.json`）：

```json
{
  "dependencies": {
    "@dsh-external/dsh-render-perf": "github:YHuanheg/dsh-render-perf"
  },
  "dsh": { "profile": { "bundles": ["@dsh-external/dsh-render-perf"] } }
}
```

> 从 git 安装拿到的是仓库快照，`lib/` 已在仓库内；若要让 DSH 从源码重建，
> 需自行 `npm install && npm run build`，或改用方式二。

### 方式二：本地开发安装

```bash
npm install
npm run build

# 让 DSH 安装这个本地包目录（link 进 profile）
# plugin_manager action=install_bundle target=<abs package dir>
```

安装返回 `application: "applied"` 即表示 profile 行已装配；`plugin_manager list_plugins`
里应看到 `include:render-perf`、`enabled: true`、`fiberPhase: "active"`。

### 生效

| 部分 | 生效条件 |
|---|---|
| host 端（公式渲染缓存 + 视口跳过样式） | fiber 加载后**硬刷新页面**（`Ctrl+Shift+R`）即可 |
| client 端（设置中心诊断卡片） | client bundle 在启动时扫描进 boot manifest，需**重启 DSH** 后才会出现 |

### 卸载

```text
plugin_manager  action=remove_bundle  target=@dsh-external/dsh-render-perf
```

卸载后刷新页面即回到原始未打补丁的前端。

---

## ⚙️ 配置项说明

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 总开关，关闭时插件不注册任何路由与样式 |
| `distDir` | `string` | `''` | 手动指定 `dsh-web-frontend/dist` 目录；留空自动探测（进程参数 / profile 环境 / 模块解析 / 常见全局路径），**所有命中的 dist 都会被接管** |
| `mode` | `'element' \| 'html'` | `element` | 补丁形态，见下 |

### 关于 `html` 模式（实测负优化，默认不启用）

`html` 模式把每个公式的子树交给 `dangerouslySetInnerHTML`，理论上省掉上百个 React 元素对象。**实测反而更慢**：

| 模式 | 热切回主线程长任务 |
|---|---|
| `element`（默认） | **455 ~ 601 ms** |
| `html` | 699 ~ 774 ms |

原因：数百次独立 `innerHTML` 赋值各自的解析与样式失效开销，超过了 React 批量建 DOM 的成本。该模式保留在代码中供不同 DSH 版本对比验证，默认不启用。

---

## 🔬 工作原理

### 补丁是怎么绕过安装目录进去的

`@deepseek-ai/dsh-host-webserver` 的路由匹配**先查 exact 路由表、再走 fallback**，而
`@deepseek-ai/dsh-host-frontend-static` 只占据 fallback seat。因此本插件注册一条 exact 路由：

```
GET /assets/index-<hash>.js
  → 读取原始产物（磁盘文件只读）
  → 应用补丁
  → 返回改写内容（cache-control: no-store，确保刷新即生效）
```

### 多份 dist 并存时怎么选

桌面版（Electron）与 `dsh web` 可能装载**不同版本**的前端：桌面版从自己的资源树
（`…resources/app/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist`）取资产，而 profile 的
`node_modules/@deepseek-ai/...` 是另一棵 npm 树，两者 `index-<hash>.js` 名字可以完全不同。

本插件因此不做单选：它按「进程参数 → profile 环境 → 模块解析 → 常见全局路径」收集**所有**
含 `index.html` 的 dist，为每个不同资产名各注册一条 exact 路由（同名去重，运行期资源树优先）。
这样无论运行时加载哪一份都能被接管，也不会因为挑错版本让页面 404。

### 补丁做了什么

只「包裹」不「重写」——在渲染函数体首部插入缓存查询，把结尾的 `return` 改成「写缓存后返回」：

```js
const __dshRPC = new Map(), __dshRPX = 20000, ...;

function ks(t, r) {
  const __dshRPK = (r ? 'D' : 'I') + t;          // 缓存键：displayMode + LaTeX
  const __dshRPH = __dshRPC.get(__dshRPK);
  if (__dshRPH !== void 0) { __dshRPS.hits++; return __dshRPH; }
  __dshRPS.misses++;

  /* ……原渲染逻辑与 KaTeX 错误分支原样保留…… */

  const __dshRPO = [...new DOMParser().parseFromString(i, "text/html").body.childNodes].map(C8);
  if (__dshRPC.size >= __dshRPX) __dshRPC.delete(__dshRPC.keys().next().value);
  __dshRPC.set(__dshRPK, __dshRPO);
  return __dshRPO;
}
```

### 为什么不做「让渲染进程常驻后台」

渲染进程**本来就是常驻的**；切换会话时销毁重建的是 React 组件树与 DOM，不是进程。所以正确方向是「别每次重算」+「视口外的别参与渲染」，而不是进程保活。

---

## 🧩 与 dsh-web-enhancements 的关系

**完全独立、零耦合、可叠加使用**，两者没有代码依赖：

| | [dsh-web-enhancements](https://github.com/wendou-chen/dsh-web-enhancements) | dsh-render-perf |
|---|---|---|
| 定位 | UI / 交互增强套件 | 渲染性能治理 |
| 形态 | client-only（DOM / Slot 注入） | host + client（HTTP 响应改写 + 样式注入） |
| 与 DSH 版本耦合度 | 低（走稳定 DOM 契约） | **高**（补丁锚定前端产物内部函数，需随版本适配） |
| 迭代节奏 | 跟随功能需求 | 跟随 DSH 前端渲染实现变化 |

之所以独立成库而**不并入增强套件**：补丁与 DSH 前端实现强绑定，需要独立的版本适配节奏与 fail-safe 策略；而增强套件走的是稳定 DOM 契约，两者生命周期完全不同。合并会让前者的版本适配牵动后者的发布。

两者同时安装没有任何冲突；`dsh-web-enhancements` 的公式点击复制、render-guardian 等特性在补丁生效后工作正常（已回归验证）。

---

## ⚠️ 已知边界

- **首次遇到的公式仍需编译一次**：缓存是进程内内存缓存，页面刷新后清空。刷新后第一次打开某会话会付一次编译成本（实测 535 ms），之后来回切换接近零编译。
- **跨会话切换仍要建 DOM**：缓存消除的是「编译」成本；React 在新挂载时仍要为新 fiber 创建 DOM 节点（剩余约 455 ms）。要进一步消除，需要前端源码级的 keep-alive 或虚拟化。
- **仅适用于 DSH Web 端**：Electron 桌面端走 `file://` 协议而非 webserver，路由拦截不生效，需要另做本地文件注入方案。
- **DSH 升级后**：若上游改了渲染函数写法导致补丁失配，插件会告警并**原样返回未打补丁的产物**（页面正常，只是没有优化）。升级后建议跑一次自检：

  ```powershell
  npm run verify                      # element 模式
  node scripts/verify-patch.mjs --mode=html
  ```

- **本插件是运行时补丁，不是官方方案**：上游若在 `ks()` 层实现缓存或改用虚拟滚动，本插件即可退役。如果你在用 DSH，欢迎顺手给上游提一个 issue。

---

## 📂 目录结构

```
dsh-render-perf/
├── LICENSE                   # MIT
├── CHANGELOG.md              # Keep a Changelog
├── README.md
├── package.json              # 模块元数据与 Peer 依赖声明
├── tsdown.config.ts          # 基于 Rolldown 的客户端打包配置 (window.__ModuleLoader__)
├── tsconfig.json             # TypeScript 编译配置 (ES2023 / NodeNext)
├── scripts/
│   └── verify-patch.mjs      # 补丁自检：对真实 bundle 应用补丁 + 幂等/语法校验
└── src/
    ├── index.ts              # Host 侧入口：dist 探测 + exact 路由 + Config 契约
    ├── patch.ts              # 补丁引擎：结构化锚点匹配 + element/html 双模式 + fail-safe
    ├── styles.ts             # 视口渲染跳过样式与 index.html 幂等注入
    └── client/
        └── index.ts          # Client 侧：设置中心「渲染性能」诊断面板
```

---

## 📄 License

[MIT](LICENSE) © 2026 wendou-chen

> DSH (DeepSeek Harness) 是 DeepSeek 的开源项目。本插件为第三方社区增强，与 DeepSeek 官方无隶属关系。
