# Electron → Tauri 迁移说明

本次迁移把桌面框架从 Electron 39 换成 Tauri 2：主进程能力（数据采集、SQLite、AI 分析、托盘）
全部用 Rust 重写，渲染层仍是 React 19 + TypeScript，只把 IPC 层从 `ipcRenderer` 换成
`invoke` / `listen`。

## 能力映射

| 旧实现（Electron / Node） | 新实现（Tauri / Rust） |
|---|---|
| `BrowserWindow` | `tauri::WebviewWindow`（`tauri.conf.json` 中声明） |
| `preload` + `contextBridge` + `ipcMain.handle` | `#[tauri::command]` + `invoke()`（`src-tauri/src/commands.rs`） |
| `webContents.send` | `app.emit` + 前端 `listen()` |
| `Tray` + `Menu` | `TrayIconBuilder` + `tauri::menu`（`tray.rs`） |
| `app.requestSingleInstanceLock()` | `tauri-plugin-single-instance` |
| `app.setLoginItemSettings()` | `tauri-plugin-autostart` |
| `shell.openPath()` | `tauri-plugin-opener` |
| `app.getPath('userData')` | `app.path().app_data_dir()` + 旧目录兼容（`paths.rs`） |
| `better-sqlite3` / `sql.js` | `rusqlite`（`bundled`，WAL 模式） |
| `active-win` | `active-win-pos-rs` |
| `desktopCapturer` + `nativeImage` | `xcap` + `image` |
| `powerMonitor`（锁屏 / 挂起 / 空闲） | `user-idle` + 休眠间隔检测 |
| `openai` SDK | `reqwest` 直连 `/chat/completions` |
| `electron-vite` | `vite` + `@tauri-apps/cli` |
| `electron-builder` | `tauri build`（NSIS / deb） |

## IPC 通道对照

旧版通过 `ipc-channels.ts` 里的字符串常量分发，现在一一对应为命令名（事件名保持不变）：

| 旧通道 | 新命令 / 事件 |
|---|---|
| `monitor:status` | `monitor_status` |
| `monitor:start` / `monitor:stop` | `monitor_start` / `monitor_stop` |
| `monitor:statusChanged`（事件） | `monitor:statusChanged`（事件，载荷不变） |
| `data:screenshots` | `data_screenshots` |
| `data:activeWindows` | `data_active_windows` |
| `data:dailyAnalysis` | `data_daily_analysis` |
| `data:periodicSummary` | `data_periodic_summary` |
| `data:todayStats` | `data_today_stats` |
| `analysis:trigger` / `analysis:backfill` | `analysis_trigger` / `analysis_backfill` |
| `analysis:status` / `analysis:result`（事件） | 同名事件 |
| `summary:trigger` | `summary_trigger` |
| `config:get` / `config:set` | `config_get` / `config_set` |
| `storage:activeBackend` | `storage_active_backend` |
| `system:openPath` | `system_open_path` |
| `system:getDefaultScreenshotsDir` | `system_get_screenshots_dir` |

渲染层不再需要 `preload`：`src/renderer/src/lib/api.ts` 封装所有命令调用，
在 `main.tsx` 里挂到 `window.api`，页面代码只改了 `window.electronAPI` → `window.api`。

## 数据兼容

- **表结构完全一致**：迁移脚本原样保留，旧 `monitor.db` 可直接打开，`schema_version` 继续沿用。
- **配置文件格式一致**：`config.json` 仍是 `general / monitoring / analysis / cleanup / storage`
  五个分区（camelCase 字段名），老配置读入后自动补齐新增/缺失字段。
- **数据目录自动复用**：启动时若发现历史 Electron 目录（`Desktop Monitor` 或 `desktop-monitor`）
  下存在 `config.json` / `monitor.db`，则继续使用该目录，不做拷贝，截图相对路径保持有效。
- **时间戳语义不变**：数据库仍写入 UTC 时间（SQLite `strftime`），截图目录仍按 UTC 日期、
  文件名按本地时间，因此新旧数据可以混排。

## 行为差异（有意为之）

1. **暂停时不再记录窗口**：旧实现在暂停（空闲/锁屏）后轮询仍在继续，会重新开始一段记录，
   把空闲时长算进使用时长的概率很高。新实现暂停时直接丢弃当前片段，恢复后重新计时。
2. **季度/年度汇总的结束日期修正**：旧实现用 `new Date(y, m, 0).toISOString()` 取月末，
   在 UTC+8 时区会少一天。新实现按本地日历月末计算。
3. **数据库后端固定为 rusqlite**：不再保留 better-sqlite3 / sql.js 双后端与降级逻辑，
   设置页对应项改为只读展示。
4. **单实例 / 开机自启 / 托盘** 改由 Tauri 插件实现，语义一致；便携版不再需要
   `PORTABLE_EXECUTABLE_FILE` 这种临时目录兜底。

## 已知限制

- **锁屏事件**：Tauri 没有 `powerMonitor` 的等价物。当前通过「空闲超时」+「轮询间隔异常检测
  （系统休眠/唤醒）」来近似暂停监控；锁屏后会按空闲阈值（默认 5 分钟）后暂停，而不是立即暂停。
- **Windows 便携版依赖 WebView2**：Win10 1803 及以上默认内置；更老的系统需要单独安装运行时。
  安装包（NSIS）默认使用 `currentUser` 安装模式，不需要管理员权限。
- **macOS 权限**：截图需要「屏幕录制」授权，读取窗口标题需要「辅助功能」授权，首次运行需手动允许。

## 常用命令

```bash
npm run dev          # tauri dev：Vite + 原生窗口
npm run rust:check   # cargo check
npm run build:web    # 只构建前端产物到 dist-renderer/
npm run build        # 类型检查 + tauri build
npm run build:win    # Windows NSIS 安装包
npm run build:linux  # Linux deb
```
