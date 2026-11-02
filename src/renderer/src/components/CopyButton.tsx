import React, { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'

type CopyState = 'idle' | 'done' | 'error'

/** 复制状态机：成功后 2 秒回到初始态，卸载时清理定时器 */
function useCopyState(text: string): { state: CopyState; copy: () => Promise<void> } {
  const [state, setState] = useState<CopyState>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  async function copy(): Promise<void> {
    const ok = await copyText(text)
    setState(ok ? 'done' : 'error')
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => setState('idle'), 2000)
  }

  return { state, copy }
}

interface CopyButtonProps {
  /** 需要复制的文本；为空时按钮禁用 */
  text: string
  label?: string
  copiedLabel?: string
  className?: string
}

/** 文字复制按钮：点击后短暂显示「已复制」，失败时提示「复制失败」 */
export function CopyButton({
  text,
  label = '复制内容',
  copiedLabel = '已复制',
  className = 'button button-secondary'
}: CopyButtonProps): React.JSX.Element {
  const { state, copy } = useCopyState(text)
  const disabled = !text
  const buttonLabel = state === 'done' ? copiedLabel : state === 'error' ? '复制失败' : label

  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      disabled={disabled}
      title={disabled ? '暂无可复制的内容' : '复制汇总内容'}
      aria-live="polite"
    >
      {buttonLabel}
    </button>
  )
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

interface CopyIconButtonProps {
  /** 需要复制的文本；为空时按钮禁用 */
  text: string
  /** 悬浮提示，也会作为无障碍标签，例如「复制工作亮点」 */
  title?: string
  className?: string
}

/** 小图标复制按钮：点击后图标变成对勾，复制失败则保持原图标并给出提示 */
export function CopyIconButton({
  text,
  title = '复制此部分',
  className = 'copy-icon-button'
}: CopyIconButtonProps): React.JSX.Element {
  const { state, copy } = useCopyState(text)
  const disabled = !text
  const tip = disabled
    ? '暂无可复制的内容'
    : state === 'done'
      ? '已复制'
      : state === 'error'
        ? '复制失败'
        : title

  return (
    <button
      type="button"
      className={`${className}${state === 'done' ? ' copied' : ''}`}
      onClick={() => void copy()}
      disabled={disabled}
      title={tip}
      aria-label={title}
    >
      {state === 'done' ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
