import OpenAI from 'openai'
import { getDailyAnalysisByDateRange } from '../database/queries/dailyAnalysis'
import { insertOrUpdatePeriodicSummary } from '../database/queries/periodicSummary'
import { buildPeriodicSummaryPrompt } from './PromptBuilder'
import { logger } from '../utils/logger'
import type { PeriodicSummaryResult } from '../../shared/types/database'

export class SummaryGenerator {
  private openai: OpenAI
  private model: string

  constructor(apiKey: string, baseUrl: string, model?: string) {
    this.openai = new OpenAI({ apiKey, baseURL: baseUrl })
    this.model = model || 'gpt-4o'
  }

  async generateQuarterly(year: number, quarter: number): Promise<PeriodicSummaryResult | null> {
    const startDate = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
    const endMonth = quarter * 3
    const endDate = new Date(year, endMonth, 0).toISOString().split('T')[0]
    const periodLabel = `${year}-Q${quarter}`

    return this.generate('quarter', periodLabel, startDate, endDate)
  }

  async generateYearly(year: number): Promise<PeriodicSummaryResult | null> {
    const startDate = `${year}-01-01`
    const endDate = `${year}-12-31`
    const periodLabel = `${year}`

    return this.generate('year', periodLabel, startDate, endDate)
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
        return null
      }

      const dailyData = dailyAnalyses.map((d) => {
        const result = JSON.parse(d.result_json)
        return {
          date: d.date,
          summary: Array.isArray(result.summary) ? result.summary : [result.summary || '']
        }
      })

      const prompt = buildPeriodicSummaryPrompt(dailyData, periodType, periodLabel)

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000
      })

      if (!response.choices?.length) {
        logger.error('Summary generation: empty response', JSON.stringify(response))
        return null
      }

      const content = response.choices[0]?.message?.content
      if (!content) return null

      const result = this.parseSummaryResult(content)
      if (!result) return null

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
}
