# dsh-render-perf —— 维护约定

> 本文件是给后续会话/维护者看的执行约定，不是文档。

## 铁律：改完 → 构建 → 推送 → 从 GitHub 重装

profile 的依赖是 `github:YHuanheg/dsh-render-perf`，**不是** `link:`。
本地源码改动不会自动生效。任何代码/配置改动完成后，必须依次做完这四步：

```bash
# 1. 构建（lib/ 已纳入版本控制，dist 必须与 src 同步）
npm run build

# 2. 自检（两端，全绿才允许推送）
npm run selftest
node scripts/verify-patch.mjs   # 需要时传入运行期 bundle 路径

# 3. 提交并推送
git add -A -- . ':!package-lock.json'
git commit -m "fix|feat(...): ..."
git push origin main

# 4. 从 GitHub 重装最新版（先卸后装，避免 pnpm 复用旧 commit 缓存）
```

第 4 步用 DSH 工具做，不是 shell：

```text
plugin_manager  action=remove_bundle  target=@dsh-external/dsh-render-perf
plugin_manager  action=install_bundle  target=github:YHuanheg/dsh-render-perf
```

## 装完必须验证的三件事

```bash
# ① 安装快照与本地构建产物逐字节一致
sha1sum lib/index.js lib/client.js
sha1sum "C:/Users/YHuanheg/.dsh/profiles/desktop/node_modules/@dsh-external/dsh-render-perf/lib/index.js" \
        "C:/Users/YHuanheg/.dsh/profiles/desktop/node_modules/@dsh-external/dsh-render-perf/lib/client.js"

# ② fiber 活着
#    plugin_manager action=list_plugins，找 include:render-perf → enabled=true / fiberPhase=active

# ③ 资产确实被改写（端口取当前 Web GUI URL）
curl -s -o /tmp/a.js -w "%{http_code}\n" "http://127.0.0.1:<PORT>/assets/index-<hash>.js"
grep -c __DSH_RENDER_PERF__ /tmp/a.js      # 必须 >= 1
```

## 已知坑

| 现象 | 根因 | 处理 |
|---|---|---|
| `ERR_PNPM_EPERM ... rename ..._tmp_ -> dsh-render-perf` | profile 里还留着指向源码的 symlink | 先 `fs.unlinkSync` 掉该链接（只删链接，别 `rm -rf`），再装 |
| 重装后行为没变 | pnpm 复用了旧 commit 的 tarball | 先 `remove_bundle` 清掉，再 `install_bundle` |
| 补丁没生效但路由 200 | dist 探测挑错了树（桌面资源树 / profile npm 树版本不同） | 本插件会全量接管；若仍异常，用 `distDir` 配置项显式指定 |
| client 卡片不出现 | client bundle 只在启动时进 boot manifest | 重启 DeepSeekRuntime |

## 版本与产物

- `lib/` 随仓库分发（`.gitignore` 里已移除），GitHub 安装无需在目标机编译。
- `package-lock.json` 不入库（本机 npm 安装用，与插件运行无关）。
- 发版时同步升 `package.json` 的 `version` 并写 `CHANGELOG.md`。
