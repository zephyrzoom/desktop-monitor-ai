/// <reference types="vite/client" />

interface ElectronAPI {
  getMonitorStatus: () => Promise<{ monitors: { name: string; status: string }[]; isPaused: boolean }>
  startMonitor: () => Promise<{ monitors: { name: string; status: string }[]; isPaused: boolean }>
  stopMonitor: () => Promise<{ monitors: { name: string; status: string }[]; isPaused: boolean }>
  getScreenshots: (date: string) => Promise<unknown[]>
  getActiveWindows: (date: string) => Promise<unknown[]>
  getDailyAnalysis: (date: string) => Promise<unknown>
  getPeriodicSummary: (periodType: 'quarter' | 'year', periodLabel: string) => Promise<unknown>
  getTodayStats: (date: string) => Promise<unknown>
  triggerAnalysis: (date: string) => Promise<unknown>
  triggerPeriodicSummary: (periodLabel: string) => Promise<unknown>
  onAnalysisProgress: (callback: (progress: { step: string; current: number; total: number }) => void) => () => void
  onMonitorStatusChanged: (callback: (status: { monitors: { name: string; status: string }[]; isPaused: boolean }) => void) => () => void
  getConfig: () => Promise<unknown>
  setConfig: (key: string, value: unknown) => Promise<unknown>
  openPath: (filePath: string) => Promise<void>
  getScreenshotsDir: () => Promise<string>
}

interface Window {
  electronAPI: ElectronAPI
}
