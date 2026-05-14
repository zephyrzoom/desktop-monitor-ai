import React from 'react'
import { Link, useLocation } from 'react-router-dom'

interface LayoutProps {
  children: React.ReactNode
}

const navItems = [
  { path: '/', label: '今日概览' },
  { path: '/daily', label: '日报查看' },
  { path: '/quarterly', label: '季度汇总' },
  { path: '/yearly', label: '年度汇总' },
  { path: '/settings', label: '配置' }
]

export function Layout({ children }: LayoutProps): React.JSX.Element {
  const location = useLocation()

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Desktop Monitor</h1>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  )
}
