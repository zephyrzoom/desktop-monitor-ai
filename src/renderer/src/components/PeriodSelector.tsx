import React from 'react'
import { Icon } from './Icon'

interface PeriodSelectorProps {
  type: 'quarter' | 'year'
  value: string
  onChange: (value: string) => void
}

/** 周期选择：下拉框带图标和固定宽度，选项文案统一带中文单位 */
export function PeriodSelector({ type, value, onChange }: PeriodSelectorProps): React.JSX.Element {
  const currentYear = new Date().getFullYear()

  const options: { value: string; label: string }[] =
    type === 'year'
      ? Array.from({ length: 6 }, (_, i) => {
          const year = currentYear - i
          return { value: String(year), label: `${year} 年` }
        })
      : Array.from({ length: 3 }, (_, i) => currentYear - i).flatMap((year) =>
          [4, 3, 2, 1].map((q) => ({ value: `${year}-Q${q}`, label: `${year} 年 Q${q}` }))
        )

  return (
    <label className="select-with-icon">
      <Icon name="calendar" size={15} />
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={type === 'year' ? '选择年份' : '选择季度'}
      >
        <option value="">请选择{type === 'year' ? '年份' : '季度'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
