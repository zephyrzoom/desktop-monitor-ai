import React, { useState, useEffect } from 'react'
import { DatePicker } from '../components/DatePicker'
import { WorkItemList } from '../components/WorkItemList'
import type { DailyAnalysisResult, DailyAnalysis } from '../../../shared/types/database'

export function DailyReport(): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [allAnalyses, setAllAnalyses] = useState<DailyAnalysis[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadAllAnalyses()
  }, [])

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
            <p>{analysisResult.summary}</p>
          </div>
          <h3 style={{ marginBottom: '16px' }}>工作内容</h3>
          <WorkItemList workItems={analysisResult.work_items} />
        </>
      ) : (
        <div className="empty-state">
          <p>该日期暂无分析结果</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>
            请先在今日概览页面触发分析，或等待每日自动分析
          </p>
        </div>
      )}
    </div>
  )
}
