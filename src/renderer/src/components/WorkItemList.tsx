import React from 'react'

interface WorkItem {
  time_range: string
  activity: string
  app: string
  category: string
}

interface WorkItemListProps {
  workItems: WorkItem[]
}

export function WorkItemList({ workItems }: WorkItemListProps): React.JSX.Element {
  if (workItems.length === 0) {
    return (
      <div className="empty-state">
        <p>暂无工作记录</p>
      </div>
    )
  }

  return (
    <div>
      {workItems.map((item, index) => (
        <div key={index} className="work-item">
          <div className="work-item-time">{item.time_range}</div>
          <div className="work-item-content">
            <div className="work-item-activity">{item.activity}</div>
            <div className="work-item-meta">
              <span>{item.app}</span>
              <span className="category-tag">{item.category}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
