import { ipcMain, shell, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { MonitorManager } from '../monitors/MonitorManager'
import { AnalysisScheduler } from '../analyzer/AnalysisScheduler'
import { getScreenshotsByDate, getScreenshotCountByDate } from '../database/queries/screenshots'
import { getActiveWindowsByDate, getAppUsageSummaryByDate } from '../database/queries/activeWindows'
import { getDailyAnalysisByDate, getAllDailyAnalysis } from '../database/queries/dailyAnalysis'
import { getPeriodicSummary, getPeriodicSummariesByType } from '../database/queries/periodicSummary'
import { getFullConfig, setConfigValue } from '../config/store'
import {
  MONITOR_STATUS,
  MONITOR_START,
  MONITOR_STOP,
  DATA_SCREENSHOTS,
  DATA_ACTIVE_WINDOWS,
  DATA_DAILY_ANALYSIS,
  DATA_PERIODIC_SUMMARY,
  DATA_TODAY_STATS,
  ANALYSIS_TRIGGER,
  ANALYSIS_STATUS,
  CONFIG_GET,
  CONFIG_SET,
  SYSTEM_OPEN_PATH,
  SYSTEM_GET_SCREENSHOTS_DIR
} from '../../shared/constants/ipc-channels'
import type { AnalysisProgress } from '../../shared/types/database'

export function registerIpcHandlers(
  monitorManager: MonitorManager,
  analysisScheduler: AnalysisScheduler,
  mainWindow: BrowserWindow
): void {
  ipcMain.handle(MONITOR_STATUS, () => {
    return monitorManager.getStatus()
  })

  ipcMain.handle(MONITOR_START, async () => {
    await monitorManager.startAll()
    return monitorManager.getStatus()
  })

  ipcMain.handle(MONITOR_STOP, async () => {
    await monitorManager.stopAll()
    return monitorManager.getStatus()
  })

  ipcMain.handle(DATA_SCREENSHOTS, (_event, date: string) => {
    return getScreenshotsByDate(date)
  })

  ipcMain.handle(DATA_ACTIVE_WINDOWS, (_event, date: string) => {
    return getActiveWindowsByDate(date)
  })

  ipcMain.handle(DATA_DAILY_ANALYSIS, (_event, date: string) => {
    if (date === 'all') {
      return getAllDailyAnalysis()
    }
    return getDailyAnalysisByDate(date)
  })

  ipcMain.handle(
    DATA_PERIODIC_SUMMARY,
    (_event, periodType: 'quarter' | 'year', periodLabel: string) => {
      if (periodLabel === 'all') {
        return getPeriodicSummariesByType(periodType)
      }
      return getPeriodicSummary(periodType, periodLabel)
    }
  )

  ipcMain.handle(DATA_TODAY_STATS, (_event, date: string) => {
    const screenshots = getScreenshotCountByDate(date)
    const activeWindows = getActiveWindowsByDate(date)
    const appUsage = getAppUsageSummaryByDate(date)
    const analysis = getDailyAnalysisByDate(date)

    return {
      screenshots,
      activeWindows: activeWindows.length,
      appUsage,
      analysis
    }
  })

  ipcMain.handle(ANALYSIS_TRIGGER, async (_event, date: string) => {
    const onProgress = (progress: AnalysisProgress) => {
      mainWindow.webContents.send(ANALYSIS_STATUS, progress)
    }

    try {
      const success = await analysisScheduler.triggerDailyAnalysis(date, onProgress)
      return { status: success ? 'completed' : 'failed', date }
    } catch (err) {
      console.error('Analysis trigger failed:', err)
      return { status: 'failed', date }
    }
  })

  ipcMain.handle(CONFIG_GET, () => {
    return getFullConfig()
  })

  ipcMain.handle(CONFIG_SET, (_event, key: string, value: unknown) => {
    setConfigValue(key as keyof ReturnType<typeof getFullConfig>, value as never)
    return getFullConfig()
  })

  ipcMain.handle(SYSTEM_OPEN_PATH, (_event, filePath: string) => {
    if (filePath) {
      fs.mkdirSync(filePath, { recursive: true })
      shell.openPath(filePath)
    }
  })

  ipcMain.handle(SYSTEM_GET_SCREENSHOTS_DIR, () => {
    const config = getFullConfig()
    return config.monitoring.screenshotsDir || path.join(app.getPath('userData'), 'screenshots')
  })
}
