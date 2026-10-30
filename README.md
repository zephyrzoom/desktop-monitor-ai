# Desktop Monitor AI

基于 Tauri 的桌面监控系统，通过自动采集屏幕截图和活动窗口数据，利用 AI 智能分析并生成每日工作内容总结。

## 核心功能

### 自动数据采集

- **屏幕截图**：支持窗口切换自动截图和定时截图（默认 10 分钟），以 JPEG 格式压缩存储
- **活动窗口追踪**：每秒轮询前台窗口，记录应用名称、窗口标题和使用时长
- **智能暂停**：空闲无操作时自动暂停采集，恢复操作后自动继续；系统休眠/唤醒同样会结束当前片段
- **监控时段**：可配置监控的时间范围，默认全天

### AI 智能分析

- **每日分析**：定时（默认 23:00）或手动触发，对当天截图分批调用视觉模型分析
- **窗口切换序列**：将应用切换的完整时间序列传给 AI，准确识别跨应用协作任务
- **任务记忆系统**：自动维护活跃任务上下文，支持跨天延续任务识别，可配置回溯天数
- **内容合并**：AI 自动合并同主题的工作条目，生成精炼的工作记录
- **工作总结**：基于工作记录和应用使用统计，生成简洁的每日总结

### 周期性汇总

- **季度汇总**：汇总一个季度的每日日报，生成工作亮点和分类占比
- **年度汇总**：归纳全年工作事迹，按项目/技术/协作等维度分类输出

### 数据管理

- **本地存储**：所有数据（截图、数据库、配置）完全本地化，不上传云端
- **自动清理**：可配置数据保留天数，自动清理过期截图和记录
- **截图保留策略**：优先保留窗口变化触发的截图，信息量更高

## 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript |
| 构建工具 | Vite 7 + Tauri CLI |
| 数据库 | SQLite（rusqlite，bundled + WAL 模式） |
| AI 接口 | OpenAI 兼容 API（reqwest，支持自定义 Base URL / 请求头） |
| 活动窗口检测 | active-win-pos-rs |
| 屏幕截图 | xcap + image |
| 空闲检测 | user-idle |

## 项目结构

```
src-tauri/                    # Rust 后端
├── src/
│   ├── main.rs               # 程序入口
│   ├── lib.rs                # 应用装配（托盘、单实例、窗口事件）
│   ├── runtime.rs            # 运行时共享状态（配置 / 数据库 / 事件）
│   ├── paths.rs              # 数据目录解析（兼容旧 Electron 目录）
│   ├── config.rs             # 配置读写
│   ├── logger.rs             # 文件日志（保留 7 天）
│   ├── commands.rs           # 前端可调用的命令（IPC）
│   ├── tray.rs               # 托盘图标与菜单
│   ├── db/                   # SQLite 连接、迁移与查询
│   ├── monitors/             # 数据采集
│   │   ├── mod.rs            # 活动窗口轮询 / 空闲 / 时段调度
│   │   └── screenshot.rs     # 截图采集与清理
│   └── analyzer/             # AI 分析
│       ├── mod.rs            # 每日分析、周期汇总、定时调度
│       ├── prompts.rs        # Prompt 模板
│       └── llm.rs            # OpenAI 兼容调用（重试 / 自定义头）
├── capabilities/             # 前端权限声明
├── icons/                    # 应用与托盘图标
└── tauri.conf.json           # 窗口 / 打包配置

src/
├── renderer/                 # React 渲染层
│   └── src/
│       ├── lib/api.ts        # 前端 IPC 封装（invoke / listen）
│       ├── pages/            # 页面组件
│       ├── components/       # 通用组件
│       ├── contexts/         # React Context
│       └── styles/           # 样式
└── shared/                   # 前后端共享类型

scripts/
└── bump-version.mjs          # 版本号递增（打包前自动执行，同步 4 处版本声明）
```

## 开发

依赖：Node.js 20+、Rust 1.77+、Tauri 相关系统依赖（Linux 需 WebKitGTK）。

```bash
# 安装依赖
npm install

# 启动开发模式（自动拉起 Vite 与 Tauri 窗口）
npm run dev

# 仅启动前端（浏览器里调不通 IPC，仅用于看样式）
npm run dev:web

# 类型检查 / Rust 检查
npm run typecheck
npm run rust:check

# 构建前端产物
npm run build:web

# 构建并打包安装包（打包前自动递增 patch 版本号）
npm run build          # 当前平台默认产物
npm run build:win      # Windows NSIS 安装包
npm run build:linux    # Linux deb

# 手动递增版本号，同步写入 package.json / tauri.conf.json / Cargo.toml
npm run bump           # 1.0.0 -> 1.0.1
npm run bump minor     # 1.0.0 -> 1.1.0
npm run bump major     # 1.0.0 -> 2.0.0
npm run bump 1.2.3     # 直接指定版本
npm run bump -- --dry-run   # 只看结果，不写文件
```

## 版本号

`package.json` 的 `version` 是唯一事实来源，打包脚本会自动递增并同步到
`src-tauri/tauri.conf.json`（决定安装包版本）、`src-tauri/Cargo.toml` 与 `Cargo.lock`。

构建时 vite 会把版本号与构建时间注入前端，展示在两处：

- 左侧边栏底部（常驻，鼠标悬停显示构建时间）
- 配置页 →「关于」卡片（版本 / 构建时间 / 运行平台）

所以界面上看到的版本一定与实际安装包一致。

## 配置说明

配置文件位于应用数据目录下的 `config.json`，也可通过界面设置页面修改。

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| analysis.apiKey | - | OpenAI 兼容 API Key |
| analysis.baseUrl | https://api.openai.com/v1 | API 地址，可替换为其他兼容服务 |
| analysis.model | gpt-4o | 视觉模型名称 |
| analysis.customHeaders | - | 自定义请求头，每行 `Key: Value` |
| analysis.scheduleTime | 23:00 | 每日自动分析时间 |
| analysis.taskMemoryDays | 3 | 任务记忆回溯天数 |
| monitoring.screenshotIntervalMs | 600000 | 定时截图间隔（毫秒） |
| monitoring.windowChangeDebounceSec | 3 | 窗口切换截图防抖（秒） |
| monitoring.monitoringStartTime | 00:00 | 监控开始时间 |
| monitoring.monitoringEndTime | 23:59 | 监控结束时间 |
| monitoring.idleTimeoutMinutes | 5 | 空闲暂停阈值（分钟） |
| cleanup.retentionDays | 30 | 数据保留天数 |

## 数据与权限

数据目录（数据库 `monitor.db`、配置 `config.json`、截图 `screenshots/`、日志 `logs/`）：

- **Windows**：`%APPDATA%\com.desktop-monitor.app\`
- **macOS**：`~/Library/Application Support/com.desktop-monitor.app/`
- **Linux**：`~/.local/share/com.desktop-monitor.app/`

从旧 Electron 版本升级时，若检测到历史目录（`Desktop Monitor` / `desktop-monitor`）已存在数据，会直接复用该目录，无需手动迁移。

权限要求：

- **macOS**：需要「屏幕录制」权限（截图）与「辅助功能」权限（读取窗口标题）
- **Windows**：无需管理员权限；便携版依赖系统自带的 WebView2 运行时（Win10 1803+ 默认内置）

## 工作分类

AI 分析会自动将活动归类为以下类别：

编程开发 · 文档写作 · 数据分析 · 会议沟通 · 网页浏览 · 设计工作 · 学习研究 · 邮件处理 · 其他
