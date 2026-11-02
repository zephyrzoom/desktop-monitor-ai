import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { getBuildTime, getVersionLabel } from '../lib/version'

interface LayoutProps {
  children: React.ReactNode
}

interface NavItem {
  path: string
  label: string
  icon: IconName
}

/** 导航按「看今天 / 看历史 / 调设置」分组，而不是一列平行链接 */
const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: '概览',
    items: [{ path: '/', label: '今日概览', icon: 'activity' }]
  },
  {
    title: '报告',
    items: [
      { path: '/daily', label: '日报', icon: 'file-text' },
      { path: '/quarterly', label: '季度汇总', icon: 'chart' },
      { path: '/yearly', label: '年度汇总', icon: 'layers' }
    ]
  },
  {
    title: '系统',
    items: [{ path: '/settings', label: '配置', icon: 'sliders' }]
  }
]

export function Layout({ children }: LayoutProps): React.JSX.Element {
  const location = useLocation()
  const buildTime = getBuildTime()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="activity" size={17} strokeWidth={2.1} />
          </span>
          <span className="brand-text">
            <span className="brand-title">Desktop Monitor</span>
            <span className="brand-subtitle">AI 工作记录与分析</span>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <p className="nav-group-label">{group.title}</p>
              {group.items.map((item) => {
                const active = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="version-badge" title={buildTime ? `构建于 ${buildTime}` : undefined}>
            {getVersionLabel()}
          </span>
        </div>
      </aside>

      <main className="main">
        <div className="page">{children}</div>
      </main>
    </div>
  )
}
