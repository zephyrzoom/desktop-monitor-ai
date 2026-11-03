import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * 单行胶囊容器：只排一行，放不下的胶囊直接隐藏。
 *
 * 之所以用脚本量宽度而不是纯 CSS：`overflow: hidden` 会把最后一个胶囊切成半截，
 * 看起来像渲染错误。这里按「右边界是否越过容器」判断，整颗放不下就整颗隐藏；
 * 隐藏用 `visibility` 而不是 `display`，否则后面的胶囊会顶上来形成连锁，越藏越多。
 */
export function PillGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  const update = useCallback((): void => {
    const node = ref.current
    if (!node) return

    const items = Array.from(node.children) as HTMLElement[]
    // 先全部恢复可见再量，窗口变宽时才能把藏起来的胶囊放回来
    items.forEach((item) => {
      item.style.visibility = ''
    })

    const limit = node.getBoundingClientRect().right + 0.5
    items.forEach((item) => {
      if (item.getBoundingClientRect().right > limit) item.style.visibility = 'hidden'
    })
  }, [])

  // 每次渲染后重算：胶囊数量、文案、选中态都可能变
  useLayoutEffect(() => {
    update()
  })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // 容器宽度随窗口/侧栏变化，宽度一变就得重新决定谁能显示
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [update])

  return (
    <div className="pill-group" ref={ref}>
      {children}
    </div>
  )
}
