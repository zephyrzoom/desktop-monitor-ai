import OpenAI from 'openai'
import { nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getScreenshotsByDate } from '../database/queries/screenshots'
import { getAppUsageSummaryByDate, getAppUsageSummaryByTimeRange } from '../database/queries/activeWindows'
import { insertOrUpdateDailyAnalysis } from '../database/queries/dailyAnalysis'
import { buildDailyAnalysisPrompt, buildConsolidationPrompt, buildSummaryPrompt, parseAnalysisResult } from './PromptBuilder'
import { getConfigValue } from '../config/store'
import type { Screenshot, DailyAnalysisResult, AnalysisProgress, WorkItem } from '../../shared/types/database'

export class DailyAnalyzer {
  private openai: OpenAI
  private model: string
  private maxScreenshotsPerBatch: number
  private gapThresholdMinutes: number

  constructor(
    apiKey: string,
    baseUrl: string,
    model: string,
    maxScreenshotsPerBatch = 15,
    gapThresholdMinutes = 15
  ) {
    this.openai = new OpenAI({ apiKey, baseURL: baseUrl })
    this.model = model || 'gpt-4o'
    this.maxScreenshotsPerBatch = maxScreenshotsPerBatch
    this.gapThresholdMinutes = gapThresholdMinutes
  }

  async analyze(date: string, onProgress?: (progress: AnalysisProgress) => void): Promise<DailyAnalysisResult | null> {
    const screenshots = getScreenshotsByDate(date)
    const appUsage = getAppUsageSummaryByDate(date)

    if (screenshots.length === 0) {
      return null
    }

    onProgress?.({ step: '获取截图数据', current: 0, total: 0 })

    const sortedScreenshots = [...screenshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const batches = this.createBatches(sortedScreenshots)

    onProgress?.({ step: `已准备 ${sortedScreenshots.length} 张截图，分为 ${batches.length} 批`, current: 0, total: 0 })

    const allWorkItems: WorkItem[] = []
    const priorWorkItems: WorkItem[] = []

    for (let i = 0; i < batches.length; i++) {
      onProgress?.({ step: `正在分析第 ${i + 1}/${batches.length} 批...`, current: i + 1, total: batches.length })

      const batchAppUsage = this.getBatchAppUsage(batches[i])
      const priorContext = i > 0 ? [...priorWorkItems] : undefined

      const result = await this.analyzeBatch(batches[i], batchAppUsage, date, priorContext)
      if (result) {
        allWorkItems.push(...result.work_items)
        priorWorkItems.push(...result.work_items)
      }
    }

    if (allWorkItems.length === 0) {
      return null
    }

    onProgress?.({ step: '正在合并同类工作内容...', current: 0, total: 0 })

    allWorkItems.sort((a, b) => a.time_range.localeCompare(b.time_range))

    const consolidatedItems = await this.consolidateWorkItems(allWorkItems)

    onProgress?.({ step: '正在生成工作总结...', current: 0, total: 0 })

    const overallSummary = await this.generateOverallSummary(consolidatedItems, appUsage, date)

    const finalResult: DailyAnalysisResult = {
      work_items: consolidatedItems,
      summary: overallSummary
    }

    insertOrUpdateDailyAnalysis(date, JSON.stringify(finalResult))

    return finalResult
  }

  private createBatches(screenshots: Screenshot[]): Screenshot[][] {
    if (screenshots.length === 0) return []

    const gapMs = this.gapThresholdMinutes * 60 * 1000
    const rawBatches: Screenshot[][] = []
    let currentBatch: Screenshot[] = [screenshots[0]]

    for (let i = 1; i < screenshots.length; i++) {
      const prevTime = new Date(screenshots[i - 1].timestamp).getTime()
      const currTime = new Date(screenshots[i].timestamp).getTime()
      const gap = currTime - prevTime

      if (gap > gapMs) {
        rawBatches.push(currentBatch)
        currentBatch = [screenshots[i]]
      } else {
        currentBatch.push(screenshots[i])
      }
    }
    rawBatches.push(currentBatch)

    const finalBatches: Screenshot[][] = []
    for (const batch of rawBatches) {
      finalBatches.push(...this.splitOversizedBatch(batch))
    }

    return finalBatches
  }

  private splitOversizedBatch(batch: Screenshot[]): Screenshot[][] {
    if (batch.length <= this.maxScreenshotsPerBatch) {
      return [batch]
    }

    let maxGap = 0
    let splitIndex = -1
    for (let i = 1; i < batch.length; i++) {
      const gap =
        new Date(batch[i].timestamp).getTime() - new Date(batch[i - 1].timestamp).getTime()
      if (gap > maxGap) {
        maxGap = gap
        splitIndex = i
      }
    }

    if (splitIndex === -1 || maxGap === 0) {
      splitIndex = Math.ceil(batch.length / 2)
    }

    const left = batch.slice(0, splitIndex)
    const right = batch.slice(splitIndex)

    return [...this.splitOversizedBatch(left), ...this.splitOversizedBatch(right)]
  }

  private getBatchAppUsage(screenshots: Screenshot[]): { app_name: string; total_duration_ms: number; count: number }[] {
    if (screenshots.length === 0) return []
    const startTime = screenshots[0].timestamp
    const endTime = screenshots[screenshots.length - 1].timestamp
    return getAppUsageSummaryByTimeRange(startTime, endTime)
  }

  private async analyzeBatch(
    screenshots: Screenshot[],
    appUsage: { app_name: string; total_duration_ms: number; count: number }[],
    _date: string,
    priorWorkItems?: WorkItem[]
  ): Promise<DailyAnalysisResult | null> {
    try {
      const base64Images = await this.prepareImages(screenshots)

      const timeRange = {
        start: screenshots[0].timestamp.split('T')[1]?.substring(0, 5) || '00:00',
        end: screenshots[screenshots.length - 1].timestamp.split('T')[1]?.substring(0, 5) || '23:59'
      }

      const prompt = buildDailyAnalysisPrompt(appUsage, timeRange, priorWorkItems)

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: 'text', text: prompt }
      ]

      for (const base64 of base64Images) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' }
        })
      }

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content }],
        max_tokens: 2000
      })

      const responseContent = response.choices[0]?.message?.content
      if (!responseContent) return null

      return parseAnalysisResult(responseContent)
    } catch (err) {
      console.error('AI analysis batch error:', err)
      return null
    }
  }

  private async generateOverallSummary(
    workItems: WorkItem[],
    fullDayAppUsage: { app_name: string; total_duration_ms: number; count: number }[],
    _date: string
  ): Promise<string[]> {
    try {
      const prompt = buildSummaryPrompt(workItems, fullDayAppUsage)
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500
      })
      const content = response.choices[0]?.message?.content || '[]'
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.map((s: unknown) => String(s))
        }
      }
      return ['无法生成工作总结']
    } catch (err) {
      console.error('Summary generation error:', err)
      return ['工作总结生成失败']
    }
  }

  private async consolidateWorkItems(workItems: WorkItem[]): Promise<WorkItem[]> {
    if (workItems.length <= 1) return workItems

    try {
      const prompt = buildConsolidationPrompt(workItems)
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000
      })

      const responseContent = response.choices[0]?.message?.content
      if (!responseContent) return workItems

      const jsonMatch = responseContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return workItems

      const result = JSON.parse(jsonMatch[0])
      if (!result.work_items || !Array.isArray(result.work_items)) return workItems

      return result.work_items.map((item: Record<string, unknown>) => ({
        time_range: String(item.time_range || ''),
        activity: String(item.activity || ''),
        app: String(item.app || ''),
        category: String(item.category || '其他')
      }))
    } catch (err) {
      console.error('Work items consolidation error:', err)
      return workItems
    }
  }

  private async prepareImages(screenshots: Screenshot[]): Promise<string[]> {
    const configDir = getConfigValue('monitoring').screenshotsDir
    const screenshotsDir = configDir || path.join(app.getPath('userData'), 'screenshots')
    const results: string[] = []

    for (const screenshot of screenshots) {
      try {
        const filePath = path.join(screenshotsDir, screenshot.file_path)
        if (!fs.existsSync(filePath)) continue

        const img = nativeImage.createFromPath(filePath)
        const size = img.getSize()
        const maxW = 1280
        let resized = img
        if (size.width > maxW) {
          resized = img.resize({ width: maxW })
        }
        const buffer = resized.toJPEG(80)

        results.push(buffer.toString('base64'))
      } catch (err) {
        console.error('Failed to process screenshot:', err)
      }
    }

    return results
  }
}
