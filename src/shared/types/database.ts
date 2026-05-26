export interface Screenshot {
  id: number
  timestamp: string
  file_path: string
  file_size: number
  width: number | null
  height: number | null
  trigger_type: 'window_change' | 'timer'
  created_at: string
}

export interface ActiveWindow {
  id: number
  timestamp: string
  app_name: string
  window_title: string
  process_id: number | null
  bundle_id: string | null
  duration_ms: number
  screenshot_id: number | null
  created_at: string
}

export interface DailyAnalysis {
  id: number
  date: string
  result_json: string
  created_at: string
}

export interface PeriodicSummary {
  id: number
  period_type: 'quarter' | 'year'
  period_label: string
  result_json: string
  created_at: string
}

export interface MonitorState {
  key: string
  value: string
  updated_at: string
}

export interface WorkItem {
  time_range: string
  activity: string
  app: string
  category: string
}

export interface DailyAnalysisResult {
  work_items: WorkItem[]
  summary: string[]
}

export interface PeriodicSummaryResult {
  period: string
  highlights: string[]
  work_categories: { category: string; percentage: number }[]
  summary: string
}

export interface AnalysisProgress {
  step: string
  current: number
  total: number
}
