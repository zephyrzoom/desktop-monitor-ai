import { DailyAnalyzer } from './DailyAnalyzer'
import { SummaryGenerator } from './SummaryGenerator'
import { getConfigValue } from '../config/store'
import { getDailyAnalysisByDateRange } from '../database/queries/dailyAnalysis'
import { getDatesWithScreenshotsInRange } from '../database/queries/screenshots'
import { logger } from '../utils/logger'
import type { AnalysisProgress } from '../../shared/types/database'

/** 定时触发时自动补生成最近多少天内缺失的日报 */
const BACKFILL_DAYS = 30

export class AnalysisScheduler {
  private dailyAnalyzer: DailyAnalyzer | null = null
  private summaryGenerator: SummaryGenerator | null = null
  private schedulerInterval: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private analysisCompleteCallback: ((date: string) => void) | null = null

  setOnAnalysisComplete(callback: (date: string) => void): void {
    this.analysisCompleteCallback = callback
  }

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
        config.gapThresholdMinutes,
        config.taskMemoryDays,
        config.maxRetries
      )
      this.summaryGenerator = new SummaryGenerator(config.apiKey, config.baseUrl, config.model, config.maxRetries)
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
      this.triggerDailyAnalysis(today).then(async () => {
        this.analysisCompleteCallback?.(today)
        await this.backfillMissingDailyAnalyses(today)
      })
    }
  }

  /**
   * 补生成最近 BACKFILL_DAYS 天内（含今天）有截图数据但未生成日报的日期。
   * 无截图数据的日期跳过；补生成失败的日期会在下次定时触发时重试。
   */
  private async backfillMissingDailyAnalyses(today: string): Promise<void> {
    try {
      const startDate = this.addDays(today, -(BACKFILL_DAYS - 1))
      const allDates = this.getDateRange(startDate, today)

      const existingDates = new Set(getDailyAnalysisByDateRange(startDate, today).map((d) => d.date))
      const datesWithData = new Set(getDatesWithScreenshotsInRange(startDate, today))

      const missingDates = allDates.filter((d) => !existingDates.has(d) && datesWithData.has(d))

      if (missingDates.length === 0) {
        logger.info('[AnalysisScheduler] 前30天内无缺失日报需要补生成')
        return
      }

      logger.info(`[AnalysisScheduler] 检测到 ${missingDates.length} 天缺失日报，开始补生成: ${missingDates.join(', ')}`)

      for (const date of missingDates) {
        const ok = await this.triggerDailyAnalysis(date)
        if (ok) {
          this.analysisCompleteCallback?.(date)
        }
      }
    } catch (err) {
      logger.error('[AnalysisScheduler] 补生成缺失日报失败:', err)
    }
  }

  private pad(n: number): string {
    return String(n).padStart(2, '0')
  }

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00`)
    d.setDate(d.getDate() + days)
    return this.formatDate(d)
  }

  private getDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = []
    let current = startDate
    while (current <= endDate) {
      dates.push(current)
      current = this.addDays(current, 1)
    }
    return dates
  }
}
