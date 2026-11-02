import React from 'react'
import { Icon } from './Icon'

interface WorkItem {
  time_range: string
  activity: string
  app: string
  category: string
}

interface WorkItemListProps {
  workItems: WorkItem[]
}

/** 工作记录列表：时间轴样式，时间列对齐，应用与分类降级为次要信息 */
export function WorkItemList({ workItems }: WorkItemListProps): React.JSX.Element {
  if (workItems.length === 0) {
    return (
      <div className="empty-state empty-state-inline">
        <div className="empty-icon">
          <Icon name="clock" size={20} />
        </div>
        <p className="empty-title">暂无工作记录</p>
        <p className="empty-description">这段区间内没有识别到有效的工作内容</p>
      </div>
    )
  }

  return (
    <ul className="work-list">
      {workItems.map((item, index) => (
        <li className="work-item" key={index}>
          <div className="work-item-time">
            <Icon name="clock" size={13} />
            <span>{item.time_range}</span>
          </div>
          <div className="work-item-content">
            <p className="work-item-activity">{item.activity}</p>
            <div className="work-item-meta">
              {item.app && (
                <span className="meta-item">
                  <Icon name="window" size={12} />
                  {item.app}
                </span>
              )}
              {item.category && <span className="tag">{item.category}</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
