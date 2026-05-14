import { EventEmitter } from 'events'
import activeWin from 'active-win'
import type { Monitor, MonitorStatus } from './types'
import { insertActiveWindow } from '../database/queries/activeWindows'

export interface WindowChangeEvent {
  appName: string
  windowTitle: string
  processId: number | null
  bundleId: string | null
  timestamp: Date
}

export class ActiveWindowMonitor extends EventEmitter implements Monitor {
  name = 'active-window'
  status: 'running' | 'stopped' | 'error' = 'stopped'

  private interval: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs: number
  private lastAppName: string | null = null
  private lastWindowTitle: string | null = null
  private lastChangeTime: Date | null = null
  private currentScreenshotId: number | null = null

  constructor(pollIntervalMs = 1000) {
    super()
    this.pollIntervalMs = pollIntervalMs
  }

  async start(): Promise<void> {
    if (this.status === 'running') return

    this.status = 'running'
    this.lastChangeTime = new Date()

    this.interval = setInterval(() => this.poll(), this.pollIntervalMs)
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }

    if (this.lastAppName && this.lastChangeTime) {
      const durationMs = Date.now() - this.lastChangeTime.getTime()
      if (durationMs > 0) {
        insertActiveWindow(
          this.lastAppName,
          this.lastWindowTitle || '',
          null,
          null,
          durationMs,
          this.currentScreenshotId
        )
      }
    }

    this.status = 'stopped'
    this.lastAppName = null
    this.lastWindowTitle = null
    this.lastChangeTime = null
    this.currentScreenshotId = null
  }

  getStatus(): MonitorStatus {
    return {
      name: this.name,
      status: this.status
    }
  }

  setCurrentScreenshotId(id: number | null): void {
    this.currentScreenshotId = id
  }

  private async poll(): Promise<void> {
    try {
      const result = await activeWin()

      if (!result) return

      const appName = result.owner.name || 'Unknown'
      const windowTitle = result.title || ''

      if (appName !== this.lastAppName || windowTitle !== this.lastWindowTitle) {
        const now = new Date()

        if (this.lastAppName && this.lastChangeTime) {
          const durationMs = now.getTime() - this.lastChangeTime.getTime()
          if (durationMs > 0) {
            insertActiveWindow(
              this.lastAppName,
              this.lastWindowTitle || '',
              null,
              null,
              durationMs,
              this.currentScreenshotId
            )
          }
        }

        this.lastAppName = appName
        this.lastWindowTitle = windowTitle
        this.lastChangeTime = now
        this.currentScreenshotId = null

        this.emit('windowChanged', {
          appName,
          windowTitle,
          processId: result.owner.processId || null,
          bundleId: (result.owner as unknown as Record<string, unknown>).bundleId as string || null,
          timestamp: now
        } as WindowChangeEvent)
      }
    } catch (err) {
      this.status = 'error'
      this.emit('error', err)
    }
  }
}
