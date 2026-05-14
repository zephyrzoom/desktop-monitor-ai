import { powerMonitor } from 'electron'
import { EventEmitter } from 'events'

export class IdleDetector extends EventEmitter {
  private isLocked = false
  private isSuspended = false

  start(): void {
    powerMonitor.on('lock-screen', () => {
      this.isLocked = true
      this.emit('idle', { reason: 'lock-screen' })
    })

    powerMonitor.on('unlock-screen', () => {
      this.isLocked = false
      this.emit('active', { reason: 'unlock-screen' })
    })

    powerMonitor.on('suspend', () => {
      this.isSuspended = true
      this.emit('idle', { reason: 'suspend' })
    })

    powerMonitor.on('resume', () => {
      this.isSuspended = false
      this.emit('active', { reason: 'resume' })
    })
  }

  isIdle(): boolean {
    return this.isLocked || this.isSuspended
  }
}
