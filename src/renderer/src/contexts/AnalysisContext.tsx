import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { AnalysisProgress } from '../../../shared/types/database'

interface AnalysisContextValue {
  // Daily analysis state
  analyzing: boolean
  analysisProgress: AnalysisProgress | null
  analyzingDate: string | null
  // Periodic summary state
  generating: boolean
  generatingLabel: string | null
  // Actions
  triggerAnalysis: (date: string) => Promise<void>
  triggerPeriodicSummary: (periodLabel: string) => Promise<void>
  // Completion callback registration
  onAnalysisComplete: (callback: () => void) => () => void
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null)

export function AnalysisProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analyzingDate, setAnalyzingDate] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null)

  const completeCallbacks = useRef<Set<() => void>>(new Set())

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAnalysisProgress((progress) => {
      setAnalysisProgress(progress)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAnalysisComplete(() => {
      notifyComplete()
    })
    return unsubscribe
  }, [notifyComplete])

  const onAnalysisComplete = useCallback((callback: () => void) => {
    completeCallbacks.current.add(callback)
    return () => {
      completeCallbacks.current.delete(callback)
    }
  }, [])

  const notifyComplete = useCallback(() => {
    completeCallbacks.current.forEach((cb) => cb())
  }, [])

  const triggerAnalysis = useCallback(async (date: string) => {
    setAnalyzing(true)
    setAnalysisProgress(null)
    setAnalyzingDate(date)
    try {
      await window.electronAPI.triggerAnalysis(date)
    } finally {
      setAnalyzing(false)
      setAnalysisProgress(null)
      setAnalyzingDate(null)
      notifyComplete()
    }
  }, [notifyComplete])

  const triggerPeriodicSummary = useCallback(async (periodLabel: string) => {
    setGenerating(true)
    setGeneratingLabel(periodLabel)
    try {
      await window.electronAPI.triggerPeriodicSummary(periodLabel)
    } finally {
      setGenerating(false)
      setGeneratingLabel(null)
      notifyComplete()
    }
  }, [notifyComplete])

  return (
    <AnalysisContext.Provider
      value={{
        analyzing,
        analysisProgress,
        analyzingDate,
        generating,
        generatingLabel,
        triggerAnalysis,
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
