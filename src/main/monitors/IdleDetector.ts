import { powerMonitor } from 'electron'
import { EventEmitter } from 'events'
import { getConfigValue } from '../config/store'

export class IdleDetector extends EventEmitter {
  private isLocked = false
  private isSuspended = false
  private isInputIdle = false
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private readonly POLL_INTERVAL_MS = 10_000

  start(): void {
    powerMonitor.on('lock-screen', () => {
      this.isLocked = true
      this.emit('idle', { reason: 'lock-screen' })
    })

    powerMonitor.on('unlock-screen', () => {
      this.isLocked = false
      if (!this.isSuspended && !this.isInputIdle) {
        this.emit('active', { reason: 'unlock-screen' })
      }
    })

    powerMonitor.on('suspend', () => {
      this.isSuspended = true
      this.emit('idle', { reason: 'suspend' })
    })

    powerMonitor.on('resume', () => {
      this.isSuspended = false
      if (!this.isLocked && !this.isInputIdle) {
        this.emit('active', { reason: 'resume' })
      }
    })

    this.idleCheckTimer = setInterval(() => this.checkInputIdle(), this.POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }
  }

  private checkInputIdle(): void {
    if (this.isLocked || this.isSuspended) return

    const idleSeconds = powerMonitor.getSystemIdleTime()
    const timeoutMinutes = getConfigValue('monitoring').idleTimeoutMinutes ?? 5

    if (idleSeconds >= timeoutMinutes * 60 && !this.isInputIdle) {
      this.isInputIdle = true
      this.emit('idle', { reason: 'input-idle' })
    } else if (idleSeconds < timeoutMinutes * 60 && this.isInputIdle) {
      this.isInputIdle = false
      this.emit('active', { reason: 'input-active' })
    }
  }

  isIdle(): boolean {
    return this.isLocked || this.isSuspended || this.isInputIdle
  }
}
