import React, { useState, useEffect } from 'react'
import { PeriodSelector } from '../components/PeriodSelector'
import type { PeriodicSummaryResult, PeriodicSummary } from '../../../shared/types/database'

export function YearlySummary(): React.JSX.Element {
  const [selectedYear, setSelectedYear] = useState('')
  const [summary, setSummary] = useState<PeriodicSummary | null>(null)
  const [allSummaries, setAllSummaries] = useState<PeriodicSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    loadAllSummaries()
  }, [])

  useEffect(() => {
    if (selectedYear) {
      loadSummary(selectedYear)
    }
  }, [selectedYear])

  async function loadAllSummaries(): Promise<void> {
    try {
      const result = await window.electronAPI.getPeriodicSummary('year', 'all')
      setAllSummaries(result as PeriodicSummary[])
    } catch (err) {
      console.error('Failed to load summaries:', err)
    }
  }

  async function loadSummary(periodLabel: string): Promise<void> {
    setLoading(true)
    try {
      const result = await window.electronAPI.getPeriodicSummary('year', periodLabel)
      setSummary(result as PeriodicSummary | null)
    } catch (err) {
      console.error('Failed to load summary:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!selectedYear) return

    setGenerating(true)
    try {
      await window.electronAPI.triggerPeriodicSummary(selectedYear)
      await loadSummary(selectedYear)
      await loadAllSummaries()
    } catch (err) {
      console.error('Failed to generate summary:', err)
    } finally {
      setGenerating(false)
    }
  }

  const summaryResult: PeriodicSummaryResult | null = summary ? JSON.parse(summary.result_json) : null

  return (
    <div>
      <div className="page-header">
        <h2>年度汇总</h2>
      </div>

      <PeriodSelector type="year" value={selectedYear} onChange={setSelectedYear} />

      {allSummaries.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-title">已生成的年度汇总</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {allSummaries.map((s) => (
              <button
                key={s.period_label}
                className={`button ${s.period_label === selectedYear ? 'button-primary' : 'button-secondary'}`}
                onClick={() => setSelectedYear(s.period_label)}
              >
                {s.period_label}年
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedYear && (
        <button
          className="button button-primary"
          onClick={handleGenerate}
          disabled={generating}
          style={{ marginBottom: '24px' }}
        >
          {generating ? '生成中...' : '生成年度汇总'}
        </button>
      )}

      {loading ? (
        <div className="loading">加载中...</div>
      ) : summaryResult ? (
        <>
          <div className="summary-box">
            <p>{summaryResult.summary}</p>
          </div>

          {summaryResult.highlights.length > 0 && (
            <div className="card">
              <div className="card-title">年度工作亮点</div>
              <ul style={{ paddingLeft: '20px' }}>
                {summaryResult.highlights.map((highlight, index) => (
                  <li key={index} style={{ marginBottom: '8px' }}>
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summaryResult.work_categories.length > 0 && (
            <div className="card">
              <div className="card-title">工作分类统计</div>
              {summaryResult.work_categories.map((cat, index) => (
                <div
                  key={index}
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}
                >
                  <span>{cat.category}</span>
                  <span>{cat.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : selectedYear ? (
        <div className="empty-state">
          <p>该年度暂无汇总</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>请点击上方按钮生成年度汇总</p>
        </div>
      ) : (
        <div className="empty-state">
          <p>请选择一个年份</p>
        </div>
      )}
    </div>
  )
}
