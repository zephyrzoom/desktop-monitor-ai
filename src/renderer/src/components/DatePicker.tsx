import React from 'react'
import { Icon } from './Icon'

interface DatePickerProps {
  value: string
  onChange: (date: string) => void
}

/** 日期选择器：自带日历图标，样式与其它输入控件统一 */
export function DatePicker({ value, onChange }: DatePickerProps): React.JSX.Element {
  return (
    <label className="input-with-icon">
      <Icon name="calendar" size={15} />
      <input
        className="input"
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="选择日期"
      />
    </label>
  )
}
