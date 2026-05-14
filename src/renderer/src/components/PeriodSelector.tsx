import React from 'react'

interface PeriodSelectorProps {
  type: 'quarter' | 'year'
  value: string
  onChange: (value: string) => void
}

export function PeriodSelector({ type, value, onChange }: PeriodSelectorProps): React.JSX.Element {
  const currentYear = new Date().getFullYear()

  if (type === 'year') {
    const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

    return (
      <div className="date-picker">
        <label>选择年份:</label>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">请选择</option>
          {years.map((year) => (
            <option key={year} value={year.toString()}>
              {year}年
            </option>
          ))}
        </select>
      </div>
    )
  }

  const quarters: string[] = []
  for (let year = currentYear; year >= currentYear - 2; year--) {
    for (let q = 4; q >= 1; q--) {
      quarters.push(`${year}-Q${q}`)
    }
  }

  return (
    <div className="date-picker">
      <label>选择季度:</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">请选择</option>
        {quarters.map((quarter) => (
          <option key={quarter} value={quarter}>
            {quarter}
          </option>
        ))}
      </select>
    </div>
  )
}
