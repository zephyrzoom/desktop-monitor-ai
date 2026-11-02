import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { AnalysisProgress } from '../../../shared/types/database'

interface AnalysisContextValue {
  // Daily analysis state
  analyzing: boolean
  analysisProgress: AnalysisProgress | null
  analyzingDate: string | null
  // 批量补算/重算 state
  rerunning: boolean
  // Periodic summary state
  generating: boolean
  generatingLabel: string | null
  // Actions
  triggerAnalysis: (date: string) => Promise<void>
  /** days 为 null 表示全部历史；范围内缺失的补上、已有的覆盖，始终不含今天 */
  triggerRerun: (days: number | null) => Promise<{
    status: string
    total: number
    succeeded: number
    filled: number
  } | null>
  triggerPeriodicSummary: (periodLabel: string) => Promise<void>
  // Completion callback registration
  onAnalysisComplete: (callback: () => void) => () => void
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null)

export function AnalysisProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analyzingDate, setAnalyzingDate] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null)

  const completeCallbacks = useRef<Set<() => void>>(new Set())

  useEffect(() => {
    const unsubscribe = window.api.onAnalysisProgress((progress) => {
      setAnalysisProgress(progress)
    })
    return unsubscribe
  }, [])

  const onAnalysisComplete = useCallback((callback: () => void) => {
    completeCallbacks.current.add(callback)
    return () => {
      completeCallbacks.current.delete(callback)
    }
  }, [])

  const notifyComplete = useCallback(() => {
    completeCallbacks.current.forEach((cb) => cb())
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.onAnalysisComplete(() => {
      notifyComplete()
    })
    return unsubscribe
  }, [notifyComplete])

  // 定时任务自动生成季度/年度汇总后，让汇总页重新拉取结果
  useEffect(() => {
    const unsubscribe = window.api.onSummaryGenerated(() => {
      notifyComplete()
    })
    return unsubscribe
  }, [notifyComplete])

  const triggerAnalysis = useCallback(
    async (date: string) => {
      setAnalyzing(true)
      setAnalysisProgress(null)
      setAnalyzingDate(date)
      try {
        await window.api.triggerAnalysis(date)
      } finally {
        setAnalyzing(false)
        setAnalysisProgress(null)
        setAnalyzingDate(null)
        notifyComplete()
      }
    },
    [notifyComplete]
  )

  const triggerRerun = useCallback(
    async (days: number | null) => {
      setRerunning(true)
      setAnalysisProgress(null)
      try {
        return await window.api.rerunAnalysis(days)
      } finally {
        setRerunning(false)
        setAnalysisProgress(null)
        notifyComplete()
      }
    },
    [notifyComplete]
  )

  const triggerPeriodicSummary = useCallback(
    async (periodLabel: string) => {
      setGenerating(true)
      setGeneratingLabel(periodLabel)
      try {
        await window.api.triggerPeriodicSummary(periodLabel)
      } finally {
        setGenerating(false)
        setGeneratingLabel(null)
        notifyComplete()
      }
    },
    [notifyComplete]
  )

  return (
    <AnalysisContext.Provider
      value={{
        analyzing,
        analysisProgress,
        analyzingDate,
        rerunning,
        generating,
        generatingLabel,
        triggerAnalysis,
        triggerRerun,
        triggerPeriodicSummary,
        onAnalysisComplete
      }}
    >
      {children}
    </AnalysisContext.Provider>
  )
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error('useAnalysis must be used within AnalysisProvider')
  return ctx
}
