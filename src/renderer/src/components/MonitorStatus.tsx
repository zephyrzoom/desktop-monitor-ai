import React from 'react'

interface MonitorStatusProps {
  status: {
    monitors: { name: string; status: string }[]
    isPaused: boolean
  } | null
  onStart: () => void
  onStop: () => void
}

export function MonitorStatus({ status, onStart, onStop }: MonitorStatusProps): React.JSX.Element {
  if (!status) {
    return (
      <div className="status-bar">
        <div className="status-dot stopped" />
        <span>监控状态: 加载中...</span>
      </div>
    )
  }

  const isRunning = status.monitors.some((m) => m.status === 'running')
  const statusClass = status.isPaused ? 'paused' : isRunning ? '' : 'stopped'
  const statusText = status.isPaused ? '已暂停' : isRunning ? '运行中' : '已停止'

  return (
    <div className="status-bar">
      <div className={`status-dot ${statusClass}`} />
      <span>监控状态: {statusText}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
        {!isRunning ? (
          <button className="button button-primary" onClick={onStart}>
            启动监控
          </button>
        ) : (
          <button className="button button-secondary" onClick={onStop}>
            停止监控
          </button>
        )}
      </div>
    </div>
  )
}
