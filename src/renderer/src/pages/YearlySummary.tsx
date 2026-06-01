import React, { useState, useEffect } from 'react'
import { PeriodSelector } from '../components/PeriodSelector'
import { useAnalysis } from '../contexts/AnalysisContext'
import type { YearlySummaryResult, PeriodicSummary } from '../../../shared/types/database'

export function YearlySummary(): React.JSX.Element {
  const [selectedYear, setSelectedYear] = useState('')
  const [summary, setSummary] = useState<PeriodicSummary | null>(null)
  const [allSummaries, setAllSummaries] = useState<PeriodicSummary[]>([])
  const [loading, setLoading] = useState(false)
  const { generating, triggerPeriodicSummary, onAnalysisComplete } = useAnalysis()

  useEffect(() => {
    loadAllSummaries()
  }, [])

  useEffect(() => {
    if (selectedYear) {
      loadSummary(selectedYear)
    }
  }, [selectedYear])

  useEffect(() => {
    return onAnalysisComplete(() => {
      if (selectedYear) {
        loadSummary(selectedYear)
      }
      loadAllSummaries()
    })
  }, [onAnalysisComplete, selectedYear])

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

  function handleGenerate(): void {
    if (!selectedYear) return
    triggerPeriodicSummary(selectedYear)
  }

  const summaryResult: YearlySummaryResult | null = summary ? JSON.parse(summary.result_json) : null

  const categoryNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

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
            <p>{summaryResult.opening}</p>
          </div>

          {summaryResult.categories.map((category, catIndex) => (
            <div className="card" key={catIndex} style={{ marginBottom: '16px' }}>
              <div className="card-title">
                {categoryNumbers[catIndex] || catIndex + 1}、{category.title}
              </div>
              {category.items.map((item, itemIndex) => (
                <div key={itemIndex} style={{ marginBottom: '16px', paddingLeft: '8px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                    {itemIndex + 1}）{item.subtitle}
                  </div>
                  <p style={{ margin: 0, lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          ))}

          <div className="summary-box">
            <p>{summaryResult.summary}</p>
          </div>
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
