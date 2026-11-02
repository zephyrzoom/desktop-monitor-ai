import React from 'react'
import type { AnalysisProgress } from '../../../shared/types/database'

interface ProgressPanelProps {
  /** 当前正在执行的动作，如「正在分析今日工作」 */
  label: string
  progress: AnalysisProgress | null
}

/** 分析/生成进度面板：步骤文案 + 进度条 + 计数 */
export function ProgressPanel({ label, progress }: ProgressPanelProps): React.JSX.Element {
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0

  return (
    <section className="progress-panel" aria-live="polite">
      <div className="progress-header">
        <span className="spinner" aria-hidden="true" />
        <span className="progress-label">{label}</span>
        {progress && progress.total > 0 && (
          <span className="progress-count">
            {progress.current} / {progress.total}
          </span>
        )}
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
