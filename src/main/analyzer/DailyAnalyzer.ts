import OpenAI from 'openai'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getScreenshotsByDate } from '../database/queries/screenshots'
import { getAppUsageSummaryByDate } from '../database/queries/activeWindows'
import { insertOrUpdateDailyAnalysis } from '../database/queries/dailyAnalysis'
import { buildDailyAnalysisPrompt, parseAnalysisResult } from './PromptBuilder'
import { getConfigValue } from '../config/store'
import type { Screenshot, DailyAnalysisResult, AnalysisProgress } from '../../shared/types/database'

export class DailyAnalyzer {
  private openai: OpenAI
  private maxScreenshotsPerBatch: number

  constructor(apiKey: string, baseUrl: string, _model: string, maxScreenshotsPerBatch = 5) {
    this.openai = new OpenAI({ apiKey, baseURL: baseUrl })
    this.maxScreenshotsPerBatch = maxScreenshotsPerBatch
  }

  async analyze(date: string, onProgress?: (progress: AnalysisProgress) => void): Promise<DailyAnalysisResult | null> {
    const screenshots = getScreenshotsByDate(date)
    const appUsage = getAppUsageSummaryByDate(date)

    if (screenshots.length === 0) {
      return null
    }

    onProgress?.({ step: '获取截图数据', current: 0, total: 0 })

    const sampledScreenshots = this.sampleScreenshots(screenshots)
    const batches = this.createBatches(sampledScreenshots)

    onProgress?.({ step: `已准备 ${sampledScreenshots.length} 张截图，分为 ${batches.length} 批`, current: 0, total: 0 })

    const allWorkItems: DailyAnalysisResult['work_items'] = []
    let overallSummary = ''

    for (let i = 0; i < batches.length; i++) {
      onProgress?.({ step: `正在分析第 ${i + 1} 批，调用 AI 中...`, current: i + 1, total: batches.length })
      const result = await this.analyzeBatch(batches[i], appUsage, date)
      if (result) {
        allWorkItems.push(...result.work_items)
        overallSummary = result.summary
      }
    }

    if (allWorkItems.length === 0) {
      return null
    }

    onProgress?.({ step: '正在保存分析结果...', current: 0, total: 0 })

    allWorkItems.sort((a, b) => a.time_range.localeCompare(b.time_range))

    const finalResult: DailyAnalysisResult = {
      work_items: allWorkItems,
      summary: overallSummary
    }

    insertOrUpdateDailyAnalysis(date, JSON.stringify(finalResult))

    return finalResult
  }

  private sampleScreenshots(screenshots: Screenshot[]): Screenshot[] {
    if (screenshots.length <= this.maxScreenshotsPerBatch * 3) {
      return screenshots
    }

    const windowChangeScreenshots = screenshots.filter((s) => s.trigger_type === 'window_change')
    const timerScreenshots = screenshots.filter((s) => s.trigger_type === 'timer')

    const sampled: Screenshot[] = []

    for (const s of windowChangeScreenshots) {
      if (sampled.length < this.maxScreenshotsPerBatch * 3) {
        sampled.push(s)
      }
    }

    const remaining = this.maxScreenshotsPerBatch * 3 - sampled.length
    if (remaining > 0 && timerScreenshots.length > 0) {
      const step = Math.max(1, Math.floor(timerScreenshots.length / remaining))
      for (let i = 0; i < timerScreenshots.length && sampled.length < this.maxScreenshotsPerBatch * 3; i += step) {
        sampled.push(timerScreenshots[i])
      }
    }

    return sampled.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  private createBatches(screenshots: Screenshot[]): Screenshot[][] {
    const batches: Screenshot[][] = []
    for (let i = 0; i < screenshots.length; i += this.maxScreenshotsPerBatch) {
      batches.push(screenshots.slice(i, i + this.maxScreenshotsPerBatch))
    }
    return batches
  }

  private async analyzeBatch(
    screenshots: Screenshot[],
    appUsage: { app_name: string; total_duration_ms: number; count: number }[],
    _date: string
  ): Promise<DailyAnalysisResult | null> {
    try {
      const base64Images = await this.prepareImages(screenshots)

      const timeRange = {
        start: screenshots[0].timestamp.split('T')[1]?.substring(0, 5) || '00:00',
        end: screenshots[screenshots.length - 1].timestamp.split('T')[1]?.substring(0, 5) || '23:59'
      }

      const prompt = buildDailyAnalysisPrompt(appUsage, timeRange)

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: 'text', text: prompt }
      ]

      for (const base64 of base64Images) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' }
        })
      }

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
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

  private async prepareImages(screenshots: Screenshot[]): Promise<string[]> {
    const configDir = getConfigValue('monitoring').screenshotsDir
    const screenshotsDir = configDir || path.join(app.getPath('userData'), 'screenshots')
    const results: string[] = []

    for (const screenshot of screenshots) {
      try {
        const filePath = path.join(screenshotsDir, screenshot.file_path)
        if (!fs.existsSync(filePath)) continue

        const buffer = await sharp(filePath).resize(1280, 720, { fit: 'inside' }).png().toBuffer()

        results.push(buffer.toString('base64'))
      } catch (err) {
        console.error('Failed to process screenshot:', err)
      }
    }

    return results
  }
}
