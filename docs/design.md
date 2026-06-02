# Desktop Monitor AI - 设计文档

## 1. 项目概述

Desktop Monitor AI 是一个基于 Electron 的桌面监控系统，通过采集屏幕截图和活动窗口数据，利用 AI 自动分析并生成用户每日工作内容总结。

### 核心价值

- 自动记录桌面活动，无需手动填写工作日志
- AI 智能分析截图内容，识别具体工作事项
- 按天/季度/年度生成结构化的工作汇总报告

### 目标平台

Windows（主），macOS/Linux（兼容）

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ ActiveWindow │  │  Screenshot  │  │   Idle       │   │
│  │   Monitor    │  │   Monitor    │  │  Detector    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │           │
│         └────────┬────────┘                  │           │
│                  ▼                           │           │
│         ┌──────────────┐                     │           │
│         │   Monitor    │◄────────────────────┘           │
│         │   Manager    │                                 │
│         └──────┬───────┘                                 │
│                │                                         │
│                ▼                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐     │
│  │    SQLite 数据库     │◄───│   Analysis          │     │
│  │  (screenshots,      │    │   Scheduler         │     │
│  │   active_windows,   │    │   (每日 23:00)       │     │
│  │   daily_analysis)   │    └──────────┬──────────┘     │
│  └─────────────────────┘               │                │
│                                         ▼                │
│                              ┌─────────────────────┐     │
│                              │   Daily Analyzer    │     │
│                              │   (OpenAI API)      │     │
│                              └─────────────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              IPC Handlers                        │    │
│  └─────────────────────┬───────────────────────────┘    │
└────────────────────────┼────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    Electron 渲染进程                      │
│                                                          │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Today   │ │  Daily   │ │Quarterly │ │ Settings │   │
│  │  Page   │ │  Report  │ │ Summary  │ │   Page   │   │
│  └─────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心流程

### 3.1 数据采集流程

```
应用启动
    │
    ▼
MonitorManager.startAll()
    │
    ├──► ActiveWindowMonitor.start()
    │      │ 每秒轮询活动窗口
    │      │ 窗口变化时触发事件
    │      └──► emit('windowChanged')
    │
    ├──► ScreenshotMonitor.start()
    │      │ 监听窗口变化事件
    │      │ 窗口变化时立即截图
    │      │ 定时兜底截图（默认10分钟）
    │      └──► 写入 screenshots 表
    │
    └──► IdleDetector.start()
           │ 监听 powerMonitor 事件
           │ 锁屏/熄屏 → 暂停采集
           └──► 解锁/唤醒 → 恢复采集
```

### 3.2 AI 分析流程

```
每日 23:00 (或手动触发)
    │
    ▼
AnalysisScheduler.checkAndRun()
    │
    ▼
DailyAnalyzer.analyze(date)
    │
    ├── 1. 查询当天所有截图
    ├── 2. 查询活动窗口记录
    ├── 3. 查询活跃任务记忆 (最近 N 天)
    ├── 4. 截图压缩 (1280x720)
    ├── 5. 截图采样 (优先窗口变化截图)
    │
    ├── 6. 分批处理 (每批最多5张)
    │      │
    │      ├─► 构建 Prompt (截图 + 窗口序列 + 任务记忆)
    │      ├─► 调用 OpenAI 兼容 API
    │      └─► 解析返回结果
    │
    ├── 7. 合并多批结果
    ├── 8. 按时间排序
    ├── 9. 更新任务记忆 (新增/更新/归档)
    └── 10. 存入 daily_analysis 表
```

---

## 4. 数据库设计

### 4.1 表结构

#### screenshots - 截图记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| timestamp | TEXT | 截图时间 |
| file_path | TEXT | 文件相对路径 |
| file_size | INTEGER | 文件大小(字节) |
| width | INTEGER | 图片宽度 |
| height | INTEGER | 图片高度 |
| trigger_type | TEXT | 触发类型: window_change / timer |
| created_at | TEXT | 记录创建时间 |

#### active_windows - 活动窗口记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| timestamp | TEXT | 记录时间 |
| app_name | TEXT | 应用名称 |
| window_title | TEXT | 窗口标题 |
| process_id | INTEGER | 进程ID |
| bundle_id | TEXT | 应用标识 |
| duration_ms | INTEGER | 持续时长(毫秒) |
| screenshot_id | INTEGER FK | 关联截图ID |

#### daily_analysis - 每日分析结果

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| date | TEXT UNIQUE | 日期 YYYY-MM-DD |
| result_json | TEXT | 分析结果JSON |
| created_at | TEXT | 记录创建时间 |

#### periodic_summary - 周期性汇总

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| period_type | TEXT | 类型: quarter / year |
| period_label | TEXT | 标签: 2026-Q2 / 2026 |
| result_json | TEXT | 汇总结果JSON |
| created_at | TEXT | 记录创建时间 |

#### task_memory - 任务记忆

用于跨天识别用户的延续性任务，解决"断断续续做同一件事"的识别问题。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| task_summary | TEXT | 任务描述（如"开发用户登录模块"） |
| category | TEXT | 任务分类 |
| app_cluster | TEXT | 关联应用组合（JSON 数组，如 ["VS Code","Terminal","Chrome"]） |
| last_active_date | TEXT | 最后活跃日期 YYYY-MM-DD |
| last_active_time | TEXT | 最后活跃时间 HH:MM |
| cumulative_duration_ms | INTEGER | 累计持续时长(毫秒) |
| status | TEXT | 状态: active / completed |
| created_at | TEXT | 记录创建时间 |
| updated_at | TEXT | 记录更新时间 |

**工作原理：**

1. 每日分析时，查询最近 N 天内状态为 `active` 的任务记忆，作为上下文传给 AI
2. AI 分析当天数据时，能识别出"用户今天继续做之前的任务"或"开始了新任务"
3. 分析完成后，自动更新任务记忆：
   - 今天继续的任务 → 更新 last_active_date/time、累加时长
   - 新开始的任务 → 新增记忆
   - 最近 N 天未出现的旧任务 → 标记为 completed

### 4.2 数据关系

```
screenshots 1 ──── N active_windows
                     (screenshot_id FK)

daily_analysis (独立存储，按日期查询)

periodic_summary (独立存储，按周期类型+标签查询)

task_memory (独立存储，按 status + last_active_date 查询)
```

---

## 5. AI 分析引擎

### 5.1 上下文控制策略

模型上下文限制: 256k tokens

| 内容类型 | Token 占用 | 策略 |
|----------|-----------|------|
| 单张压缩截图 | ~15-20k | 缩放到 1280x720 |
| 窗口摘要文本 | ~1-2k | 纯文本，占用小 |
| 单次 API 调用 | ~80-100k | 最多 5 张截图 |
| 日报文本 | ~5-10k | 季度/年度汇总输入 |

### 5.2 截图采样策略

```
一天截图来源:
├── 窗口变化触发 (核心，信息量最大)
└── 定时兜底 (每10分钟，填充空白)

采样算法:
1. 优先选取所有窗口变化截图
2. 若不足，从定时截图中均匀采样补充
3. 总数控制在 20-30 张
```

### 5.3 分批分析流程

```
20 张采样截图
    │
    ▼
分为 4 批 (每批 5 张)
    │
    ├── 批次1: 00:00-06:00 的截图 → 分析结果1
    ├── 批次2: 06:00-12:00 的截图 → 分析结果2
    ├── 批次3: 12:00-18:00 的截图 → 分析结果3
    └── 批次4: 18:00-24:00 的截图 → 分析结果4
    │
    ▼
合并结果 → 按时间排序 → 最终日报
```

### 5.4 Prompt 设计

**每日分析 Prompt:**

```
你是一个工作内容分析助手。根据以下桌面截图和应用使用记录，
分析用户在这段时间内做了什么工作。

时间范围: {start} - {end}

应用使用记录:
- Chrome: 45分钟 (切换12次)
- VS Code: 120分钟 (切换3次)
...

请分析这些截图，识别用户的具体工作内容。返回 JSON:
{
  "work_items": [{
    "time_range": "14:00-14:30",
    "activity": "编写 Python 数据处理脚本",
    "app": "VS Code",
    "category": "编程开发"
  }],
  "summary": "今天主要完成了..."
}
```

**季度/年度汇总 Prompt:**

```
根据以下每日工作日报，生成季度/年度工作汇总。

每日日报:
2026-05-01: 完成了数据处理模块开发...
2026-05-02: 参加技术评审会议...
...

返回 JSON:
{
  "period": "2026-Q2",
  "highlights": ["完成重要项目", "多次技术评审"],
  "work_categories": [
    {"category": "编程开发", "percentage": 45}
  ],
  "summary": "本季度主要工作集中在..."
}
```

### 5.5 工作分类

| 分类 | 说明 |
|------|------|
| 编程开发 | IDE、代码编辑器相关 |
| 文档写作 | Word、Typora 等 |
| 数据分析 | Excel、Python 数据处理 |
| 会议沟通 | 腾讯会议、Zoom 等 |
| 网页浏览 | 浏览器非工作页面 |
| 设计工作 | Figma、Photoshop 等 |
| 学习研究 | 技术文档、教程 |
| 邮件处理 | Outlook、邮件客户端 |
| 其他 | 无法归类的活动 |

---

## 6. 界面设计

### 6.1 页面结构

```
┌──────────┬──────────────────────────────────┐
│          │                                  │
│  今日概览 │       页面内容区域                 │
│          │                                  │
│  日报查看 │                                  │
│          │                                  │
│  季度汇总 │                                  │
│          │                                  │
│  年度汇总 │                                  │
│          │                                  │
│  配置     │                                  │
│          │                                  │
└──────────┴──────────────────────────────────┘
```

### 6.2 各页面功能

**今日概览 (Today)**
- 监控状态指示器 (运行/暂停/停止)
- 启动/停止监控按钮
- 统计卡片: 截图数、活动窗口数、应用数
- 应用使用时长 Top 5
- "立即分析"按钮
- 分析结果展示 (工作内容列表 + 总结)

**日报查看 (DailyReport)**
- 日期选择器
- 已分析日期快捷按钮
- 该日工作内容列表
- 总结摘要

**季度汇总 (QuarterlySummary)**
- 季度选择器 (2026-Q1 ~ 2026-Q4)
- "生成季度汇总"按钮
- 工作亮点列表
- 工作分类占比

**年度汇总 (YearlySummary)**
- 年份选择器
- "生成年度汇总"按钮
- 年度工作亮点
- 年度工作分类统计

**配置 (Settings)**
- AI 分析配置: API Key、Base URL、Model、分析时间
- 监控配置: 截图间隔、窗口切换防抖
- 数据清理: 保留天数

---

## 7. 关键技术实现

### 7.1 活动窗口监控

```typescript
// ActiveWindowMonitor.ts
// 使用 active-win 库获取当前活动窗口信息
const result = await activeWin()
// 返回: { title, owner: { name, processId, path } }

// 窗口变化时记录到数据库
if (appName !== this.lastAppName || windowTitle !== this.lastWindowTitle) {
  insertActiveWindow(appName, windowTitle, processId, durationMs, screenshotId)
  this.emit('windowChanged', { appName, windowTitle, ... })
}
```

### 7.2 截图采集

```typescript
// ScreenshotMonitor.ts
// 使用 Electron desktopCapturer API
const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width: 1280, height: 720 }
})

// 保存到本地文件系统
const buffer = sources[0].thumbnail.toPNG()
fs.writeFileSync(filePath, buffer)

// 记录到数据库
insertScreenshot(relativePath, buffer.length, width, height, triggerType)
```

### 7.3 锁屏检测

```typescript
// IdleDetector.ts
// 使用 Electron powerMonitor API
powerMonitor.on('lock-screen', () => {
  this.isLocked = true
  this.emit('idle', { reason: 'lock-screen' })
})

powerMonitor.on('unlock-screen', () => {
  this.isLocked = false
  this.emit('active', { reason: 'unlock-screen' })
})
```

### 7.4 AI 分析调用

```typescript
// DailyAnalyzer.ts
// 使用 OpenAI 兼容 SDK
const openai = new OpenAI({ apiKey, baseURL: baseUrl })

// 构建包含图片的请求
const content = [
  { type: 'text', text: prompt },
  ...base64Images.map(img => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${img}`, detail: 'low' }
  }))
]

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content }],
  max_tokens: 2000
})
```

### 7.5 图片压缩

```typescript
// 使用 sharp 库压缩截图
const buffer = await sharp(filePath)
  .resize(1280, 720, { fit: 'inside' })
  .png()
  .toBuffer()

// 转为 base64 用于 API 调用
const base64 = buffer.toString('base64')
```

---

## 8. IPC 通信设计

### 8.1 通道列表

| 通道 | 方向 | 说明 |
|------|------|------|
| monitor:status | Renderer → Main | 获取监控状态 |
| monitor:start | Renderer → Main | 启动监控 |
| monitor:stop | Renderer → Main | 停止监控 |
| data:screenshots | Renderer → Main | 查询截图 |
| data:activeWindows | Renderer → Main | 查询活动窗口 |
| data:dailyAnalysis | Renderer → Main | 查询日报 |
| data:periodicSummary | Renderer → Main | 查询周期汇总 |
| data:todayStats | Renderer → Main | 今日统计数据 |
| analysis:trigger | Renderer → Main | 触发分析 |
| analysis:status | Main → Renderer | 分析进度推送 |
| config:get | Renderer → Main | 获取配置 |
| config:set | Renderer → Main | 设置配置 |
| system:openPath | Renderer → Main | 打开文件路径 |

### 8.2 Preload 暴露的 API

```typescript
const electronAPI = {
  // 监控控制
  getMonitorStatus: () => Promise<MonitorStatus>,
  startMonitor: () => Promise<MonitorStatus>,
  stopMonitor: () => Promise<MonitorStatus>,

  // 数据查询
  getScreenshots: (date: string) => Promise<Screenshot[]>,
  getActiveWindows: (date: string) => Promise<ActiveWindow[]>,
  getDailyAnalysis: (date: string) => Promise<DailyAnalysis>,
  getPeriodicSummary: (type, label) => Promise<PeriodicSummary>,
  getTodayStats: (date: string) => Promise<TodayStats>,

  // 分析控制
  triggerAnalysis: (date: string) => Promise<Result>,
  onAnalysisProgress: (callback) => Unsubscribe,

  // 配置
  getConfig: () => Promise<Config>,
  setConfig: (key, value) => Promise<Config>,

  // 系统
  openPath: (path: string) => Promise<void>,
  getScreenshotsDir: () => Promise<string>
}
```

---

## 9. 配置管理

### 9.1 配置结构

```json
{
  "monitoring": {
    "enabled": true,
    "screenshotIntervalMs": 600000,
    "windowPollIntervalMs": 1000,
    "windowChangeDebounceSec": 3,
    "screenshotsDir": ""
  },
  "analysis": {
    "apiKey": "",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o",
    "scheduleTime": "23:00",
    "maxScreenshotsPerBatch": 5,
    "taskMemoryDays": 3
  },
  "cleanup": {
    "retentionDays": 30
  }
}
```

### 9.2 配置存储

使用 JSON 文件存储在 Electron userData 目录:
- Windows: `%APPDATA%/desktop-monitor/config.json`
- macOS: `~/Library/Application Support/desktop-monitor/config.json`

---

## 10. 构建与部署

### 10.1 开发环境

```bash
npm install          # 安装依赖
npm run dev          # 启动开发模式
npm run build        # 编译检查
```

### 10.2 生产构建

```bash
npm run build:win    # 打包 Windows 安装版 + 便携版
npm run build:mac    # 打包 macOS dmg
```

### 10.3 GitHub Actions

自动构建流程:
1. 推送到 main/master 分支触发构建
2. 在 Windows 环境编译打包
3. 上传 exe 产物
4. 推送 v* 标签时自动创建 Release

### 10.4 产物说明

| 文件 | 说明 |
|------|------|
| desktop-monitor-*-setup.exe | NSIS 安装版 |
| Desktop Monitor *.exe | 便携版，双击即用 |

---

## 11. 依赖清单

### 核心依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| electron | ^39 | 桌面应用框架 |
| electron-vite | ^5 | 构建工具 |
| react | ^19 | UI 框架 |
| react-router-dom | ^7 | 路由 |
| better-sqlite3 | ^12 | SQLite 数据库 |
| active-win | ^8 | 活动窗口检测 |
| openai | ^6 | AI API 调用 |
| sharp | ^0.34 | 图片处理 |

### 开发依赖

| 包名 | 用途 |
|------|------|
| typescript | 类型系统 |
| @types/better-sqlite3 | 类型定义 |
| electron-builder | 打包工具 |
| eslint | 代码检查 |

---

## 12. 注意事项

### 12.1 权限要求

- **屏幕录制权限** (macOS): 截图功能需要
- **辅助功能权限** (macOS): 如需键鼠监控

### 12.2 性能考虑

- 截图压缩到 1280x720 减少存储和 token 消耗
- 窗口轮询间隔 1 秒，平衡实时性和 CPU 占用
- SQLite WAL 模式提升并发读写性能

### 12.3 隐私保护

- 所有数据本地存储，不上传云端
- 剪贴板仅记录变化事件，不存储内容
- 截图可配置保留天数，自动清理

### 12.4 已知限制

- 256k 上下文限制需要分批处理截图
- 部分应用窗口标题可能为空
- 全屏游戏/应用可能无法正确截图
