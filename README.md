# Desktop Monitor AI

基于 Electron 的桌面监控系统，通过自动采集屏幕截图和活动窗口数据，利用 AI 智能分析并生成每日工作内容总结。

## 核心功能

### 自动数据采集

- **屏幕截图**：支持窗口切换自动截图和定时截图（默认 10 分钟），以 JPEG 格式压缩存储
- **活动窗口追踪**：每秒轮询前台窗口，记录应用名称、窗口标题和使用时长
- **智能暂停**：锁屏/熄屏/空闲时自动暂停采集，解锁/操作后自动恢复
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
| 桌面框架 | Electron 39 |
| 前端 | React 19 + TypeScript |
| 构建工具 | electron-vite |
| 数据库 | SQLite (better-sqlite3, WAL 模式) |
| AI 接口 | OpenAI 兼容 API（支持自定义 Base URL） |
| 活动窗口检测 | active-win |
| 图片处理 | Electron nativeImage |

## 项目结构

```
src/
├── main/                     # Electron 主进程
│   ├── monitors/             # 数据采集
│   │   ├── ActiveWindowMonitor.ts   # 活动窗口监控
│   │   ├── ScreenshotMonitor.ts     # 截图采集
│   │   ├── IdleDetector.ts          # 空闲检测
│   │   └── MonitorManager.ts        # 监控调度
│   ├── analyzer/             # AI 分析
│   │   ├── DailyAnalyzer.ts         # 每日分析（含任务记忆）
│   │   ├── SummaryGenerator.ts      # 周期汇总
│   │   ├── PromptBuilder.ts         # Prompt 模板
│   │   └── AnalysisScheduler.ts     # 分析调度
│   ├── database/             # 数据层
│   │   ├── connection.ts            # SQLite 连接
│   │   ├── migrations.ts            # 表结构迁移
│   │   └── queries/                 # CRUD 查询
│   ├── config/               # 配置管理
│   └── ipc/                  # IPC 通信
├── renderer/                 # React 渲染进程
│   └── src/
│       ├── pages/            # 页面组件
│       ├── components/       # 通用组件
│       ├── contexts/         # React Context
│       └── styles/           # 样式
└── shared/                   # 共享类型和常量
```

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 类型检查
npm run typecheck

# 构建
npm run build

# 打包
npm run build:win    # Windows
npm run build:mac    # macOS
```

## 配置说明

配置文件位于应用数据目录下的 `config.json`，也可通过界面设置页面修改。

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| analysis.apiKey | - | OpenAI 兼容 API Key |
| analysis.baseUrl | https://api.openai.com/v1 | API 地址，可替换为其他兼容服务 |
| analysis.model | gpt-4o | 视觉模型名称 |
| analysis.scheduleTime | 23:00 | 每日自动分析时间 |
| analysis.taskMemoryDays | 3 | 任务记忆回溯天数 |
| monitoring.screenshotIntervalMs | 600000 | 定时截图间隔（毫秒） |
| monitoring.windowChangeDebounceSec | 3 | 窗口切换截图防抖（秒） |
| monitoring.monitoringStartTime | 00:00 | 监控开始时间 |
| monitoring.monitoringEndTime | 23:59 | 监控结束时间 |
| monitoring.idleTimeoutMinutes | 5 | 空闲暂停阈值（分钟） |
| cleanup.retentionDays | 30 | 数据保留天数 |

## 权限要求

- **macOS**：需要屏幕录制权限（截图功能）
- **Windows**：部分场景可能需要管理员权限

## 工作分类

AI 分析会自动将活动归类为以下类别：

编程开发 · 文档写作 · 数据分析 · 会议沟通 · 网页浏览 · 设计工作 · 学习研究 · 邮件处理 · 其他
