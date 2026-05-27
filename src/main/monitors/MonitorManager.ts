import { ActiveWindowMonitor, type WindowChangeEvent } from './ActiveWindowMonitor'
import { ScreenshotMonitor } from './ScreenshotMonitor'
import { IdleDetector } from './IdleDetector'
import { getConfigValue } from '../config/store'
import type { MonitorStatus } from './types'

export class MonitorManager {
  private activeWindowMonitor: ActiveWindowMonitor
  private screenshotMonitor: ScreenshotMonitor
  private idleDetector: IdleDetector
  private isPaused = false
  private isTimePaused = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number
  private scheduleCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    const config = getConfigValue('monitoring')
    this.activeWindowMonitor = new ActiveWindowMonitor(config.windowPollIntervalMs)
    this.screenshotMonitor = new ScreenshotMonitor(config.screenshotIntervalMs, config.screenshotsDir || undefined)
    this.idleDetector = new IdleDetector()
    this.debounceMs = (config.windowChangeDebounceSec ?? 3) * 1000

    this.activeWindowMonitor.on('windowChanged', (_event: WindowChangeEvent) => {
      if (this.effectivePaused) return

      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null
        const screenshotId = await this.screenshotMonitor.captureScreenshot('window_change')
        if (screenshotId) {
          this.activeWindowMonitor.setCurrentScreenshotId(screenshotId)
        }
      }, this.debounceMs)
    })

    this.activeWindowMonitor.on('error', (err) => {
      console.error('ActiveWindowMonitor error:', err)
    })

    this.idleDetector.on('idle', () => {
      this.pause()
    })

    this.idleDetector.on('active', () => {
      this.resume()
    })
  }

  async startAll(): Promise<void> {
    this.idleDetector.start()
    await this.activeWindowMonitor.start()
    await this.screenshotMonitor.start()
    this.checkSchedule()
    this.scheduleCheckTimer = setInterval(() => this.checkSchedule(), 60 * 1000)
  }

  async stopAll(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.scheduleCheckTimer) {
      clearInterval(this.scheduleCheckTimer)
      this.scheduleCheckTimer = null
    }
    this.idleDetector.stop()
    await this.activeWindowMonitor.stop()
    await this.screenshotMonitor.stop()
  }

  pause(): void {
    this.isPaused = true
    this.screenshotMonitor.pause()
    console.log('Monitors paused (screen locked or suspended)')
  }

  resume(): void {
    this.isPaused = false
    if (!this.isTimePaused) {
      this.screenshotMonitor.resume()
      console.log('Monitors resumed')
    }
  }

  private checkSchedule(): void {
    const config = getConfigValue('monitoring')
    const startTime = config.monitoringStartTime || '00:00'
    const endTime = config.monitoringEndTime || '23:59'

    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const inRange = startTime <= endTime
      ? currentTime >= startTime && currentTime < endTime
      : currentTime >= startTime || currentTime < endTime

    if (!inRange && !this.isTimePaused) {
      this.isTimePaused = true
      this.screenshotMonitor.pause()
      console.log(`Monitors paused (outside monitoring hours ${startTime}-${endTime})`)
    } else if (inRange && this.isTimePaused) {
      this.isTimePaused = false
      if (!this.isPaused) this.screenshotMonitor.resume()
      console.log(`Monitors resumed (within monitoring hours ${startTime}-${endTime})`)
    }
  }

  private get effectivePaused(): boolean {
    return this.isPaused || this.isTimePaused
  }

  getStatus(): { monitors: MonitorStatus[]; isPaused: boolean } {
    return {
      monitors: [this.activeWindowMonitor.getStatus(), this.screenshotMonitor.getStatus()],
      isPaused: this.effectivePaused
    }
  }
}
