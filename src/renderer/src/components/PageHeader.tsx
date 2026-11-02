import React from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** 右侧主操作区 */
  actions?: React.ReactNode
}

/** 页面标题区：标题 + 说明 + 右侧操作，所有页面统一使用 */
export function PageHeader({ title, description, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h2>{title}</h2>
        {description && <p className="page-subtitle">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}
