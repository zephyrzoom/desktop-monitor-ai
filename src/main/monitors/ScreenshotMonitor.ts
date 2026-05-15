import { desktopCapturer } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import sharp from 'sharp'
import type { Monitor, MonitorStatus } from './types'
import { insertScreenshot, getScreenshotsBeforeDate, deleteScreenshotsBeforeDate } from '../database/queries/screenshots'
import { getConfigValue } from '../config/store'

export class ScreenshotMonitor implements Monitor {
  name = 'screenshot'
  status: 'running' | 'stopped' | 'error' = 'stopped'

  private timerInterval: ReturnType<typeof setInterval> | null = null
  private timerIntervalMs: number
  private screenshotsDir: string
  private onScreenshotTaken?: (screenshotId: number) => void

  constructor(timerIntervalMs = 10 * 60 * 1000, screenshotsDir?: string) {
    this.timerIntervalMs = timerIntervalMs
    this.screenshotsDir = screenshotsDir || path.join(app.getPath('userData'), 'screenshots')
  }

  setOnScreenshotTaken(callback: (screenshotId: number) => void): void {
    this.onScreenshotTaken = callback
  }

  async start(): Promise<void> {
    if (this.status === 'running') return

    this.status = 'running'
    fs.mkdirSync(this.screenshotsDir, { recursive: true })

    this.cleanup()

    this.timerInterval = setInterval(() => this.captureScreenshot('timer'), this.timerIntervalMs)
  }

  private cleanup(): void {
    try {
      const retentionDays = getConfigValue('cleanup').retentionDays
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - retentionDays)
      const cutoffDate = cutoff.toISOString().split('T')[0]

      const expired = getScreenshotsBeforeDate(cutoffDate)
      for (const s of expired) {
        const filePath = path.join(this.screenshotsDir, s.file_path)
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        } catch {}
      }

      const deleted = deleteScreenshotsBeforeDate(cutoffDate)
      if (deleted > 0) {
        console.log(`Cleanup: removed ${deleted} screenshots before ${cutoffDate}`)
      }

      // Remove empty date directories
      try {
        const entries = fs.readdirSync(this.screenshotsDir)
        for (const entry of entries) {
          const entryPath = path.join(this.screenshotsDir, entry)
          if (fs.statSync(entryPath).isDirectory() && entry < cutoffDate) {
            fs.rmSync(entryPath, { recursive: true, force: true })
          }
        }
      } catch {}
    } catch (err) {
      console.error('Cleanup failed:', err)
    }
  }

  async stop(): Promise<void> {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
    this.status = 'stopped'
  }

  getStatus(): MonitorStatus {
    return {
      name: this.name,
      status: this.status
    }
  }

  async captureScreenshot(triggerType: 'window_change' | 'timer'): Promise<number | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 }
      })

      if (sources.length === 0) return null

      const source = sources[0]
      const now = new Date()
      const dateStr = now.toISOString().split('T')[0]
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-')
      const fileName = `${timeStr}_${triggerType}.jpg`

      const dateDir = path.join(this.screenshotsDir, dateStr)
      fs.mkdirSync(dateDir, { recursive: true })

      const filePath = path.join(dateDir, fileName)
      const pngBuffer = source.thumbnail.toPNG()
      const buffer = await sharp(pngBuffer).jpeg({ quality: 80 }).toBuffer()
      fs.writeFileSync(filePath, buffer)

      const screenshotId = insertScreenshot(
        path.relative(this.screenshotsDir, filePath),
        buffer.length,
        source.thumbnail.getSize().width,
        source.thumbnail.getSize().height,
        triggerType
      )

      if (this.onScreenshotTaken) {
        this.onScreenshotTaken(screenshotId)
      }

      return screenshotId
    } catch (err) {
      this.status = 'error'
      return null
    }
  }
}
