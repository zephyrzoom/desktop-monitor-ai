import React from 'react'
import { Icon } from './Icon'

interface MonitorStatusProps {
  status: {
    monitors: { name: string; status: string }[]
    isPaused: boolean
  } | null
  onStart: () => void
  onStop: () => void
}

/**
 * 监控状态卡片。
 *
 * 左侧状态灯 + 文案回答「现在在不在记录」，右侧才是唯一的启停按钮，
 * 避免原来「状态条 + 按钮混排」看不清主次的问题。
 */
export function MonitorStatus({ status, onStart, onStop }: MonitorStatusProps): React.JSX.Element {
  if (!status) {
    return (
      <section className="status-card">
        <span className="status-dot stopped" />
        <div className="status-text">
          <p className="status-title">监控状态加载中</p>
          <p className="status-subtitle">正在读取屏幕监控进程…</p>
        </div>
      </section>
    )
  }

  const isRunning = status.monitors.some((m) => m.status === 'running')
  const state = status.isPaused ? 'paused' : isRunning ? 'running' : 'stopped'
  const stateText = status.isPaused ? '已暂停' : isRunning ? '运行中' : '已停止'
  const subtitle = status.isPaused
    ? '检测到空闲或处于非监控时段，恢复操作后会自动继续记录'
    : isRunning
      ? '正在记录当前窗口与截图，数据将在分析时间内自动汇总'
      : '监控未启动，今日数据不会产生新的记录'

  return (
    <section className="status-card">
      <span className={`status-dot ${state === 'running' ? '' : state}`} />

      <div className="status-text">
        <p className="status-title">
          监控{stateText}
          {isRunning && status.monitors.length > 0 && (
            <span className="status-meta">共 {status.monitors.length} 个屏幕</span>
          )}
        </p>
        <p className="status-subtitle">{subtitle}</p>
      </div>

      <div className="status-monitors">
        {status.monitors.map((monitor, index) => (
          <span className="chip chip-sm" key={`${monitor.name}-${index}`}>
            <Icon name="monitor" size={12} />
            {monitor.name}
          </span>
        ))}
      </div>

      {isRunning ? (
        <button type="button" className="button button-secondary" onClick={onStop}>
          <Icon name="stop" size={14} />
          停止监控
        </button>
      ) : (
        <button type="button" className="button button-primary" onClick={onStart}>
          <Icon name="play" size={14} />
          启动监控
        </button>
      )}
    </section>
  )
}
