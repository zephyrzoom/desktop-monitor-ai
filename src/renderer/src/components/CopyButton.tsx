import React, { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'

interface CopyButtonProps {
  /** 需要复制的文本；为空时按钮禁用 */
  text: string
  label?: string
  copiedLabel?: string
  className?: string
}

/** 复制按钮：点击后短暂显示「已复制」，失败时提示「复制失败」 */
export function CopyButton({
  text,
  label = '复制内容',
  copiedLabel = '已复制',
  className = 'button button-secondary'
}: CopyButtonProps): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  async function handleClick(): Promise<void> {
    const ok = await copyText(text)
    setState(ok ? 'done' : 'error')
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => setState('idle'), 2000)
  }

  const disabled = !text
  const buttonLabel = state === 'done' ? copiedLabel : state === 'error' ? '复制失败' : label

  return (
    <button
      type="button"
      className={className}
      onClick={() => void handleClick()}
      disabled={disabled}
      title={disabled ? '暂无可复制的内容' : '复制汇总内容'}
      aria-live="polite"
    >
      {buttonLabel}
    </button>
  )
}
