import { DailyAnalyzer } from './DailyAnalyzer'
import { SummaryGenerator } from './SummaryGenerator'
import { getConfigValue } from '../config/store'
import { logger } from '../utils/logger'
import type { AnalysisProgress } from '../../shared/types/database'

export class AnalysisScheduler {
  private dailyAnalyzer: DailyAnalyzer | null = null
  private summaryGenerator: SummaryGenerator | null = null
  private schedulerInterval: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  start(): void {
    this.initClients()

    this.schedulerInterval = setInterval(() => this.checkAndRun(), 60 * 1000)

    this.checkAndRun()
  }

  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = null
    }
  }

  updateConfig(): void {
    this.initClients()
  }

  async triggerDailyAnalysis(date?: string, onProgress?: (progress: AnalysisProgress) => void): Promise<boolean> {
    if (!this.dailyAnalyzer) {
      this.initClients()
      if (!this.dailyAnalyzer) {
        logger.warn('[AnalysisScheduler] 无法初始化 DailyAnalyzer，可能缺少 API Key')
        return false
      }
    }

    const targetDate = date || new Date().toISOString().split('T')[0]
    logger.info(`[AnalysisScheduler] 触发每日分析: ${targetDate}`)

    try {
      this.isRunning = true
      const result = await this.dailyAnalyzer.analyze(targetDate, onProgress)
      this.isRunning = false
      logger.info(`[AnalysisScheduler] 每日分析 ${targetDate} 完成: ${result ? '成功' : '失败'}`)
      return result !== null
    } catch (err) {
      logger.error('Daily analysis failed:', err)
      this.isRunning = false
      return false
    }
  }

  async triggerPeriodicSummary(
    periodType: 'quarter' | 'year',
    year: number,
    quarter?: number
  ): Promise<boolean> {
    if (!this.summaryGenerator) {
      this.initClients()
      if (!this.summaryGenerator) return false
    }

    try {
      this.isRunning = true
      logger.info(`[AnalysisScheduler] 触发周期总结: ${periodType} ${year}${quarter ? ` Q${quarter}` : ''}`)
      let result

      if (periodType === 'quarter' && quarter) {
        result = await this.summaryGenerator.generateQuarterly(year, quarter)
      } else if (periodType === 'year') {
        result = await this.summaryGenerator.generateYearly(year)
      }

      this.isRunning = false
      logger.info(`[AnalysisScheduler] 周期总结完成: ${result ? '成功' : '失败'}`)
      return result !== null
    } catch (err) {
      logger.error('Periodic summary failed:', err)
      this.isRunning = false
      return false
    }
  }

  private initClients(): void {
    const config = getConfigValue('analysis')

    if (config.apiKey) {
      this.dailyAnalyzer = new DailyAnalyzer(
        config.apiKey,
        config.baseUrl,
        config.model,
        config.maxScreenshotsPerBatch,
        config.gapThresholdMinutes
      )
      this.summaryGenerator = new SummaryGenerator(config.apiKey, config.baseUrl, config.model)
    }
  }

  private checkAndRun(): void {
    if (this.isRunning) return

    const config = getConfigValue('analysis')
    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    if (currentTime === config.scheduleTime) {
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      logger.info(`[AnalysisScheduler] 定时触发分析: ${today} ${currentTime}`)
      this.triggerDailyAnalysis(today)
    }
  }
}
