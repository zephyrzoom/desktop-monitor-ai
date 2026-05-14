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

  constructor() {
    const config = getConfigValue('monitoring')
    this.activeWindowMonitor = new ActiveWindowMonitor(config.windowPollIntervalMs)
    this.screenshotMonitor = new ScreenshotMonitor(config.screenshotIntervalMs, config.screenshotsDir || undefined)
    this.idleDetector = new IdleDetector()

    this.activeWindowMonitor.on('windowChanged', async (_event: WindowChangeEvent) => {
      if (this.isPaused) return

      const screenshotId = await this.screenshotMonitor.captureScreenshot('window_change')
      if (screenshotId) {
        this.activeWindowMonitor.setCurrentScreenshotId(screenshotId)
      }
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
  }

  async stopAll(): Promise<void> {
    await this.activeWindowMonitor.stop()
    await this.screenshotMonitor.stop()
  }

  pause(): void {
    this.isPaused = true
    console.log('Monitors paused (screen locked or suspended)')
  }

  resume(): void {
    this.isPaused = false
    console.log('Monitors resumed')
  }

  getStatus(): { monitors: MonitorStatus[]; isPaused: boolean } {
    return {
      monitors: [this.activeWindowMonitor.getStatus(), this.screenshotMonitor.getStatus()],
      isPaused: this.isPaused
    }
  }
}
