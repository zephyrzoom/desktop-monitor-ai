import React from 'react'
import type { AnalysisProgress } from '../../../shared/types/database'

interface ProgressPanelProps {
  /** 当前正在执行的动作，如「正在分析今日工作」 */
  label: string
  progress: AnalysisProgress | null
  /** 已请求取消，取消按钮显示「取消中…」并禁用 */
  cancelling?: boolean
  /** 传入后展示「取消」按钮；不可中断的流程不传 */
  onCancel?: () => void
}

/** 分析/生成进度面板：步骤文案 + 进度条 + 计数 + 取消入口 */
export function ProgressPanel({
  label,
  progress,
  cancelling = false,
  onCancel
}: ProgressPanelProps): React.JSX.Element {
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0

  return (
    <section className="progress-panel" aria-live="polite">
      <div className="progress-header">
        <span className="spinner" aria-hidden="true" />
        <span className="progress-label">{label}</span>
        <span className="progress-actions">
          {progress && progress.total > 0 && (
            <span className="progress-count">
              {progress.current} / {progress.total}
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              className="button button-ghost button-sm progress-cancel"
              onClick={onCancel}
              disabled={cancelling}
              title="终止当前分析，已完成的部分会保留"
            >
              {cancelling ? '取消中…' : '取消'}
            </button>
          )}
        </span>
      </div>
      {progress?.step && <p className="progress-step">{progress.step}</p>}
      {progress && progress.total > 0 && (
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </section>
  )
}
