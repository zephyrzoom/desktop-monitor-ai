import React from 'react'

/**
 * 统一图标集。
 *
 * 手写 24×24 线性图标（1.8 描边、圆角端点），不引入第三方图标库，
 * 保证体积和风格可控：所有图标跟随 currentColor，尺寸由 size 控制。
 */
export type IconName =
  | 'activity'
  | 'file-text'
  | 'chart'
  | 'layers'
  | 'sliders'
  | 'play'
  | 'stop'
  | 'pause'
  | 'sparkles'
  | 'copy'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'info'
  | 'clock'
  | 'monitor'
  | 'image'
  | 'window'
  | 'folder'
  | 'save'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'refresh'
  | 'history'
  | 'database'
  | 'trash'
  | 'x'
  | 'trending-up'
  | 'pie'
  | 'inbox'
  | 'calendar'
  | 'edit'
  | 'target'

const icons: Record<IconName, React.ReactNode> = {
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  'file-text': (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7.5 16v-4M12 16V8M16.5 16v-6" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3" />
      <path d="M1.5 15h5M9.5 8h5M17.5 17h5" />
    </>
  ),
  play: <path d="M7 4.5 19 12 7 19.5z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2.5" />,
  pause: <path d="M8.5 4v16M15.5 4v16" />,
  sparkles: (
    <>
      <path d="M12 3l1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6L12 3Z" />
      <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  'check-circle': (
    <>
      <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
      <path d="M22 4 12 14l-3-3" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5M12 16.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 16.5v-5M12 7.8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3.5" width="20" height="13.5" rx="2.5" />
      <path d="M8.5 21h7M12 17v4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="8.6" cy="8.6" r="1.6" />
      <path d="m21 15.5-4.6-4.6L5 21" />
    </>
  ),
  window: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="M2.5 9h19M6 6.6h.01M8.8 6.6h.01" />
    </>
  ),
  folder: (
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.4h8.8A2.5 2.5 0 0 1 22 9.9v7.6A2.5 2.5 0 0 1 19.5 20h-14A2.5 2.5 0 0 1 3 17.5z" />
  ),
  save: (
    <>
      <path d="M19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3H16l5 5v11.5A1.5 1.5 0 0 1 19.5 21Z" />
      <path d="M7.5 21v-7h9v7M7.5 3v5h8" />
    </>
  ),
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
      <path d="M21 3.5V10h-6.5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a8.5 8.5 0 1 0 2.9-6.4" />
      <path d="M3 3.5V10h6.5" />
      <path d="M12 8v4.5l3.2 1.9" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="8.5" ry="3.2" />
      <path d="M3.5 5.5v13c0 1.8 3.8 3.2 8.5 3.2s8.5-1.4 8.5-3.2v-13" />
      <path d="M3.5 12c0 1.8 3.8 3.2 8.5 3.2s8.5-1.4 8.5-3.2" />
    </>
  ),
  trash: (
    <>
      <path d="M3.5 6.5h17M9 6.5V4h6v2.5" />
      <path d="M6 6.5 7.2 20a1.5 1.5 0 0 0 1.5 1.4h6.6a1.5 1.5 0 0 0 1.5-1.4L18 6.5" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  'trending-up': <path d="m22 7-8.5 8.5-4-4L2 19M16 7h6v6" />,
  pie: (
    <>
      <path d="M21.2 15.9A9.5 9.5 0 1 1 8.1 2.8" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </>
  ),
  inbox: (
    <>
      <path d="M21 12h-5l-1.6 2.6H9.6L8 12H3" />
      <path d="M5.6 5h12.8a2 2 0 0 1 1.9 1.4L22 12v4.6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V12l1.7-5.6A2 2 0 0 1 5.6 5Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  )
}

interface IconProps {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.8
}: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  )
}
