# 项目长期记忆

## 工作方式约定

- **每次改完代码都要自动提交并 push**（用户 2026-10-29 明确要求，无需再问）。
  - 仓库：`origin` = https://github.com/zephyrzoom/desktop-monitor-ai.git
  - 开发分支：`tauri`（Electron → Tauri 2 迁移分支），推 `origin tauri`。
  - 提交信息风格：Conventional Commits 前缀（`feat:` / `fix:` / `ci:` / `docs:`）+ 中文描述，
    正文用 `-` 列要点。参考历史：`fix: 日报时间段按本地时区显示`。
  - 提交前跑 `npm run typecheck`；改 Rust 时跑 `cargo check --manifest-path src-tauri/Cargo.toml`。
  - 只 `git add` 明确路径，不用 `git add -A`；`node_modules` / `dist-renderer` /
    `src-tauri/target` / `*.log*` 已在 .gitignore。
  - `.workbuddy/memory/*.md` 是已纳入版本库的工作记忆，随改动一起提交。

## 架构要点

- `src-tauri/`（Rust 主进程全部能力）+ `src/renderer/`（React 19 + Vite）。
- 前端 IPC 收敛在 `src/renderer/src/lib/api.ts`，挂 `window.api`。
- 数据目录 `paths::resolve_data_dir` 优先复用旧 Electron 目录
  （`~/Library/Application Support/desktop-monitor`），表结构与 config.json 不变。
- `tauri.conf.json` 的 CSP 必须保留 `connect-src ipc: http://ipc.localhost`，否则 invoke 全被拦。

## 时间与时区约定（2026-10-29 确立）

- SQLite `strftime('%Y-%m-%dT%H:%M:%f','now')` 是 **UTC**，库里时间戳一律 UTC 存储。
- 读取时必须换算本地：SQL 用 `date(timestamp,'localtime')` /
  `strftime('%H:%M', timestamp,'localtime')`；Rust 用 `analyzer::parse_db_timestamp()`；
  前端日期用 `lib/date.ts` 的 `localDateString()`，**禁止** `toISOString().split('T')[0]`。
- 新增按日期过滤的查询时，别忘了 `'localtime'`，否则会有「凌晨记录归到前一天」的问题。

## 版本号约定（2026-10-30 确立）

- `package.json` 的 `version` 是唯一事实来源；**每次打包都会自动 +1 patch**
  （`build` / `build:win` / `build:linux` 前置 `npm run bump`）。
- 递增脚本 `scripts/bump-version.mjs` 同步 package.json / `tauri.conf.json` /
  `Cargo.toml` / `Cargo.lock` 四处，只做文本替换，不要整体重写 JSON。
- 界面展示：侧边栏底部 `version-badge` + 配置页「关于」卡片；
  版本经 `vite define` 的 `__APP_VERSION__` / `__BUILD_TIME__` 注入，
  统一从 `src/renderer/src/lib/version.ts` 取。
