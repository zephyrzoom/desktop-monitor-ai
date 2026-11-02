import React from 'react'
import { Icon, type IconName } from './Icon'

type AlertTone = 'success' | 'error' | 'info' | 'warning'

interface AlertProps {
  tone?: AlertTone
  children: React.ReactNode
}

const toneIcon: Record<AlertTone, IconName> = {
  success: 'check-circle',
  error: 'alert',
  info: 'info',
  warning: 'alert'
}

/** 行内提示条：保存结果、批处理结果等场景 */
export function Alert({ tone = 'info', children }: AlertProps): React.JSX.Element {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={toneIcon[tone]} size={16} className="alert-icon" />
      <div className="alert-body">{children}</div>
    </div>
  )
}
