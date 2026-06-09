import OpenAI from 'openai'
import { getDailyAnalysisByDateRange } from '../database/queries/dailyAnalysis'
import { insertOrUpdatePeriodicSummary } from '../database/queries/periodicSummary'
import { buildPeriodicSummaryPrompt, buildYearlySummaryPrompt } from './PromptBuilder'
import { logger } from '../utils/logger'
import { withRetry } from '../utils/retry'
import type { PeriodicSummaryResult, YearlySummaryResult } from '../../shared/types/database'

export class SummaryGenerator {
  private openai: OpenAI
  private model: string
  private maxRetries: number

  constructor(apiKey: string, baseUrl: string, model?: string, maxRetries = 3) {
    this.openai = new OpenAI({ apiKey, baseURL: baseUrl })
    this.model = model || 'gpt-4o'
    this.maxRetries = maxRetries
  }

  async generateQuarterly(year: number, quarter: number): Promise<PeriodicSummaryResult | null> {
    const startDate = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
    const endMonth = quarter * 3
    const endDate = new Date(year, endMonth, 0).toISOString().split('T')[0]
    const periodLabel = `${year}-Q${quarter}`

    return this.generate('quarter', periodLabel, startDate, endDate)
  }

  async generateYearly(year: number): Promise<YearlySummaryResult | null> {
    const startDate = `${year}-01-01`
    const endDate = `${year}-12-31`
    const periodLabel = `${year}`

    try {
      const dailyAnalyses = getDailyAnalysisByDateRange(startDate, endDate)

      if (dailyAnalyses.length === 0) {
        logger.info(`[SummaryGenerator] ${periodLabel} 无日报数据，跳过生成`)
        return null
      }

      logger.info(`[SummaryGenerator] 开始生成 ${periodLabel} 年度总结，共 ${dailyAnalyses.length} 天数据`)

      const dailyData = dailyAnalyses.map((d) => {
        const result = JSON.parse(d.result_json)
        return {
          date: d.date,
          summary: Array.isArray(result.summary) ? result.summary : [result.summary || '']
        }
      })

      const prompt = buildYearlySummaryPrompt(dailyData, periodLabel)

      logger.info(`[SummaryGenerator] 调用 AI 生成 ${periodLabel} 年度总结，模型: ${this.model}`)
      const response = await withRetry(
        () => this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4000
        }),
        {
          maxRetries: this.maxRetries,
          label: 'generateYearly',
          validate: (res) => !!(res.choices?.length && res.choices[0]?.message?.content)
        }
      )

      const content = response.choices[0]?.message?.content
      if (!content) return null

      logger.info(`[SummaryGenerator] AI 响应完成，长度: ${content.length} 字符`)

      const result = this.parseYearlySummaryResult(content)
      if (!result) {
        logger.warn(`[SummaryGenerator] 解析年度总结结果失败`)
        return null
      }

      logger.info(`[SummaryGenerator] ${periodLabel} 年度总结生成完成: ${result.categories.length} 个分类`)
      insertOrUpdatePeriodicSummary('year', periodLabel, JSON.stringify(result))

      return result
    } catch (err) {
      logger.error('Yearly summary generation error:', err)
      return null
    }
  }

  private async generate(
    periodType: 'quarter' | 'year',
    periodLabel: string,
    startDate: string,
    endDate: string
  ): Promise<PeriodicSummaryResult | null> {
    try {
      const dailyAnalyses = getDailyAnalysisByDateRange(startDate, endDate)

      if (dailyAnalyses.length === 0) {
        logger.info(`[SummaryGenerator] ${periodLabel} 无日报数据，跳过生成`)
        return null
      }

      logger.info(`[SummaryGenerator] 开始生成 ${periodLabel} 总结，共 ${dailyAnalyses.length} 天数据`)

      const dailyData = dailyAnalyses.map((d) => {
        const result = JSON.parse(d.result_json)
        return {
          date: d.date,
          summary: Array.isArray(result.summary) ? result.summary : [result.summary || '']
        }
      })

      const prompt = buildPeriodicSummaryPrompt(dailyData, periodType, periodLabel)

      logger.info(`[SummaryGenerator] 调用 AI 生成 ${periodLabel} 总结，模型: ${this.model}`)
      const response = await withRetry(
        () => this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000
        }),
        {
          maxRetries: this.maxRetries,
          label: 'generateQuarterly',
          validate: (res) => !!(res.choices?.length && res.choices[0]?.message?.content)
        }
      )

      const content = response.choices[0]?.message?.content
      if (!content) return null

      logger.info(`[SummaryGenerator] AI 响应完成，长度: ${content.length} 字符`)

      const result = this.parseSummaryResult(content)
      if (!result) {
        logger.warn(`[SummaryGenerator] 解析结果失败`)
        return null
      }

      logger.info(`[SummaryGenerator] ${periodLabel} 总结生成完成: ${result.highlights.length} 个亮点, ${result.work_categories.length} 个分类`)
      insertOrUpdatePeriodicSummary(periodType, periodLabel, JSON.stringify(result))

      return result
    } catch (err) {
      logger.error('Summary generation error:', err)
      return null
    }
  }

  private parseSummaryResult(content: string): PeriodicSummaryResult | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const result = JSON.parse(jsonMatch[0])

      if (!result.highlights || !Array.isArray(result.highlights)) return null
      if (!result.summary || typeof result.summary !== 'string') return null

      return {
        period: result.period || '',
        highlights: result.highlights.map(String),
        work_categories: (result.work_categories || []).map((c: Record<string, unknown>) => ({
          category: String(c.category || ''),
          percentage: Number(c.percentage || 0)
        })),
        summary: result.summary
      }
    } catch {
      return null
    }
  }

  private parseYearlySummaryResult(content: string): YearlySummaryResult | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const result = JSON.parse(jsonMatch[0])

      if (!result.categories || !Array.isArray(result.categories)) return null
      if (!result.opening || typeof result.opening !== 'string') return null
      if (!result.summary || typeof result.summary !== 'string') return null

      return {
        period: result.period || '',
        opening: result.opening,
        categories: result.categories.map((cat: Record<string, unknown>) => ({
          title: String(cat.title || ''),
          items: Array.isArray(cat.items)
            ? cat.items.map((item: Record<string, unknown>) => ({
                subtitle: String(item.subtitle || ''),
                description: String(item.description || '')
              }))
            : []
        })),
        summary: result.summary
      }
    } catch {
      return null
    }
  }
}
