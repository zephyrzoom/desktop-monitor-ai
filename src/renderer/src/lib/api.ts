import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface MonitorStatusPayload {
  monitors: { name: string; status: string; error?: string }[]
  isPaused: boolean
}

export interface AnalysisProgressPayload {
  step: string
  current: number
  total: number
}

export interface RerunResult {
  status: string
  total: number
  succeeded: number
  /** 其中原本没有日报、本次补上的天数（其余为覆盖重写） */
  filled: number
}

/**
 * 订阅后端事件，返回取消订阅函数。
 * 组件卸载可能早于 listen() 完成，这里用 disposed 标记避免泄漏监听。
 */
function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let disposed = false

  void listen<T>(event, (e) => callback(e.payload)).then((fn) => {
    if (disposed) {
      fn()
    } else {
      unlisten = fn
    }
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}

export const api = {
  // 监控控制
  getMonitorStatus: () => invoke<MonitorStatusPayload>('monitor_status'),
  startMonitor: () => invoke<MonitorStatusPayload>('monitor_start'),
  stopMonitor: () => invoke<MonitorStatusPayload>('monitor_stop'),
  onMonitorStatusChanged: (callback: (status: MonitorStatusPayload) => void) =>
    subscribe<MonitorStatusPayload>('monitor:statusChanged', callback),

  // 数据查询
  getScreenshots: (date: string) => invoke<unknown[]>('data_screenshots', { date }),
  getActiveWindows: (date: string) => invoke<unknown[]>('data_active_windows', { date }),
  getDailyAnalysis: (date: string) => invoke<unknown>('data_daily_analysis', { date }),
  getPeriodicSummary: (periodType: 'quarter' | 'year', periodLabel: string) =>
    invoke<unknown>('data_periodic_summary', { periodType, periodLabel }),
  getTodayStats: (date: string) => invoke<unknown>('data_today_stats', { date }),

  // AI 分析
  triggerAnalysis: (date: string) =>
    invoke<{ status: string; date: string }>('analysis_trigger', { date }),
  /** 批量补算/重算：days 为 null 表示全部历史；范围内缺失的补上、已有的覆盖 */
  rerunAnalysis: (days: number | null) => invoke<RerunResult>('analysis_rerun', { days }),
  triggerPeriodicSummary: (periodLabel: string) =>
    invoke<{ status: string; periodLabel: string }>('summary_trigger', { periodLabel }),
  onAnalysisProgress: (callback: (progress: AnalysisProgressPayload) => void) =>
    subscribe<AnalysisProgressPayload>('analysis:status', callback),
  onAnalysisComplete: (callback: (date: string) => void) =>
    subscribe<string>('analysis:result', callback),
  /** 定时任务自动生成季度/年度汇总后通知，payload 为周期标签（如 2026-Q3 / 2025） */
  onSummaryGenerated: (callback: (periodLabel: string) => void) =>
    subscribe<string>('summary:result', callback),

  // 配置
  getConfig: () => invoke<unknown>('config_get'),
  setConfig: (key: string, value: unknown) => invoke<unknown>('config_set', { key, value }),
  getActiveBackend: () => invoke<string>('storage_active_backend'),

  // 系统
  openPath: (filePath: string) => invoke<void>('system_open_path', { path: filePath }),
  getScreenshotsDir: () => invoke<string>('system_get_screenshots_dir'),
  quit: () => invoke<void>('app_quit')
}

export type Api = typeof api
