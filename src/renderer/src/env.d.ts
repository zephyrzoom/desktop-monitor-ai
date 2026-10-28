/// <reference types="vite/client" />

import type { Api } from './lib/api'

declare global {
  interface Window {
    api: Api
  }
}

export {}
