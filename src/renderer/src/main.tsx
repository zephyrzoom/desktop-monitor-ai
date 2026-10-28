import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { api } from './lib/api'

// 渲染层通过 window.api 调用 Rust 后端命令
window.api = api

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
