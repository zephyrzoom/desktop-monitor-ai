import { contextBridge, ipcRenderer } from 'electron'
import {
  MONITOR_STATUS,
  MONITOR_START,
  MONITOR_STOP,
  MONITOR_STATUS_CHANGED,
  DATA_SCREENSHOTS,
  DATA_ACTIVE_WINDOWS,
  DATA_DAILY_ANALYSIS,
  DATA_PERIODIC_SUMMARY,
  DATA_TODAY_STATS,
  ANALYSIS_TRIGGER,
  ANALYSIS_STATUS,
  ANALYSIS_RESULT,
  SUMMARY_TRIGGER,
  CONFIG_GET,
  CONFIG_SET,
  STORAGE_ACTIVE_BACKEND,
  SYSTEM_OPEN_PATH,
  SYSTEM_GET_SCREENSHOTS_DIR
} from '../shared/constants/ipc-channels'
import type { AnalysisProgress } from '../shared/types/database'

const electronAPI = {
  getMonitorStatus: () => ipcRenderer.invoke(MONITOR_STATUS),
  startMonitor: () => ipcRenderer.invoke(MONITOR_START),
  stopMonitor: () => ipcRenderer.invoke(MONITOR_STOP),

  getScreenshots: (date: string) => ipcRenderer.invoke(DATA_SCREENSHOTS, date),
  getActiveWindows: (date: string) => ipcRenderer.invoke(DATA_ACTIVE_WINDOWS, date),
  getDailyAnalysis: (date: string) => ipcRenderer.invoke(DATA_DAILY_ANALYSIS, date),
  getPeriodicSummary: (periodType: 'quarter' | 'year', periodLabel: string) =>
    ipcRenderer.invoke(DATA_PERIODIC_SUMMARY, periodType, periodLabel),
  getTodayStats: (date: string) => ipcRenderer.invoke(DATA_TODAY_STATS, date),

  triggerAnalysis: (date: string) => ipcRenderer.invoke(ANALYSIS_TRIGGER, date),
  triggerPeriodicSummary: (periodLabel: string) => ipcRenderer.invoke(SUMMARY_TRIGGER, periodLabel),

  onAnalysisProgress: (callback: (progress: AnalysisProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress) => {
      callback(progress)
    }
    ipcRenderer.on(ANALYSIS_STATUS, listener)
    return () => {
      ipcRenderer.removeListener(ANALYSIS_STATUS, listener)
    }
  },

  onMonitorStatusChanged: (callback: (status: { monitors: { name: string; status: string }[]; isPaused: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { monitors: { name: string; status: string }[]; isPaused: boolean }) => {
      callback(status)
    }
    ipcRenderer.on(MONITOR_STATUS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(MONITOR_STATUS_CHANGED, listener)
    }
  },

  onAnalysisComplete: (callback: (date: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, date: string) => {
      callback(date)
    }
    ipcRenderer.on(ANALYSIS_RESULT, listener)
    return () => {
      ipcRenderer.removeListener(ANALYSIS_RESULT, listener)
    }
  },

  getConfig: () => ipcRenderer.invoke(CONFIG_GET),
  setConfig: (key: string, value: unknown) => ipcRenderer.invoke(CONFIG_SET, key, value),
  getActiveBackend: () => ipcRenderer.invoke(STORAGE_ACTIVE_BACKEND),

  openPath: (filePath: string) => ipcRenderer.invoke(SYSTEM_OPEN_PATH, filePath),
  getScreenshotsDir: () => ipcRenderer.invoke(SYSTEM_GET_SCREENSHOTS_DIR)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
