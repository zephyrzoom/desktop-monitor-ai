import React, { useState, useEffect } from 'react'
import { DatePicker } from '../components/DatePicker'
import { WorkItemList } from '../components/WorkItemList'
import { useAnalysis } from '../contexts/AnalysisContext'
import type { DailyAnalysisResult, DailyAnalysis } from '../../../shared/types/database'

export function DailyReport(): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [allAnalyses, setAllAnalyses] = useState<DailyAnalysis[]>([])
  const [loading, setLoading] = useState(false)
  const { analyzing, analysisProgress, triggerAnalysis, onAnalysisComplete } = useAnalysis()

  useEffect(() => {
    loadAllAnalyses()
  }, [])

  useEffect(() => {
    return onAnalysisComplete(() => {
      loadAllAnalyses()
      loadAnalysis(selectedDate)
    })
  }, [onAnalysisComplete, selectedDate])

  useEffect(() => {
    loadAnalysis(selectedDate)
  }, [selectedDate])

  async function loadAllAnalyses(): Promise<void> {
    try {
      const result = await window.electronAPI.getDailyAnalysis('all')
      setAllAnalyses(result as DailyAnalysis[])
    } catch (err) {
      console.error('Failed to load analyses:', err)
    }
  }

  async function loadAnalysis(date: string): Promise<void> {
    setLoading(true)
    try {
      const result = await window.electronAPI.getDailyAnalysis(date)
      setAnalysis(result as DailyAnalysis | null)
    } catch (err) {
      console.error('Failed to load analysis:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleAnalyze(): void {
    triggerAnalysis(selectedDate)
  }

  const analysisResult: DailyAnalysisResult | null = analysis ? JSON.parse(analysis.result_json) : null

  return (
    <div>
      <div className="page-header">
        <h2>日报查看</h2>
      </div>

      <DatePicker value={selectedDate} onChange={setSelectedDate} />

      {allAnalyses.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-title">已分析的日期</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {allAnalyses.map((a) => (
              <button
                key={a.date}
                className={`button ${a.date === selectedDate ? 'button-primary' : 'button-secondary'}`}
                onClick={() => setSelectedDate(a.date)}
              >
                {a.date}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">加载中...</div>
      ) : analysisResult ? (
        <>
          <div className="summary-box">
            <ol className="summary-list">
              {analysisResult.summary.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </div>
          <h3 style={{ marginBottom: '16px' }}>工作内容</h3>
          <WorkItemList workItems={analysisResult.work_items} />
          <div style={{ marginTop: '24px' }}>
            <button className="button button-secondary" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? '分析中...' : '重新分析'}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <p>该日期暂无分析结果</p>
          <div style={{ marginTop: '16px' }}>
            <button className="button button-primary" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? '分析中...' : `分析 ${selectedDate} 的工作`}
            </button>
          </div>
        </div>
      )}

      {analyzing && (
        <div className="analysis-progress" style={{ marginTop: '16px' }}>
          <div className="analysis-progress-header">
            <div className="analysis-spinner"></div>
            <span>正在分析...</span>
          </div>
          {analysisProgress && (
            <div className="analysis-progress-detail">
              <span>{analysisProgress.step}</span>
              {analysisProgress.total > 0 && (
                <div className="analysis-progress-bar-wrapper">
                  <div
                    className="analysis-progress-bar"
                    style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                  />
                </div>
              )}
              {analysisProgress.total > 0 && (
                <span className="analysis-progress-count">
                  {analysisProgress.current} / {analysisProgress.total}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
