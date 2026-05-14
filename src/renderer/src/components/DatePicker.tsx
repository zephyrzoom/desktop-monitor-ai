import React from 'react'

interface DatePickerProps {
  value: string
  onChange: (date: string) => void
}

export function DatePicker({ value, onChange }: DatePickerProps): React.JSX.Element {
  return (
    <div className="date-picker">
      <label>选择日期:</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
