/// <reference types="vite/client" />

import type { Api } from './lib/api'

declare global {
  interface Window {
    api: Api
  }

  /** 构建期由 vite define 注入的应用版本（来源 package.json） */
  const __APP_VERSION__: string
  /** 构建期由 vite define 注入的构建时间（ISO 字符串） */
  const __BUILD_TIME__: string
}

export {}
