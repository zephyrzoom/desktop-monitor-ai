export interface Monitor {
  name: string
  status: 'running' | 'stopped' | 'error'
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): MonitorStatus
}

export interface MonitorStatus {
  name: string
  status: 'running' | 'stopped' | 'error'
  error?: string
}
