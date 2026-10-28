use crate::db::{AppUsage, TaskMemory, WindowSwitch, WorkItem};

fn app_usage_lines(apps: &[AppUsage], with_switch_count: bool) -> String {
    apps.iter()
        .map(|app| {
            let minutes = (app.total_duration_ms as f64 / 60_000.0).round() as i64;
            if with_switch_count {
                format!("- {}: {}分钟 (切换{}次)", app.app_name, minutes, app.count)
            } else {
                format!("- {}: {}分钟", app.app_name, minutes)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn work_item_lines(items: &[WorkItem]) -> String {
    items
        .iter()
        .map(|item| {
            format!(
                "- {}: {} ({}, {})",
                item.time_range, item.activity, item.app, item.category
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn memory_apps(memory: &TaskMemory) -> String {
    serde_json::from_str::<Vec<String>>(&memory.app_cluster)
        .unwrap_or_default()
        .join("、")
}

pub fn build_daily_analysis_prompt(
    app_usage: &[AppUsage],
    time_range: (&str, &str),
    prior_work_items: &[WorkItem],
    window_sequence: &[WindowSwitch],
    task_memories: &[TaskMemory],
) -> String {
    let app_usage_text = app_usage_lines(app_usage, true);

    let prior_context = if prior_work_items.is_empty() {
        String::new()
    } else {
        let lines = prior_work_items
            .iter()
            .map(|item| format!("- {}: {} ({})", item.time_range, item.activity, item.app))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n之前已识别的工作内容（请避免重复）:\n{lines}\n")
    };

    let window_sequence_text = if window_sequence.is_empty() {
        String::new()
    } else {
        let lines = window_sequence
            .iter()
            .map(|window| {
                if window.window_title.trim().is_empty() {
                    format!("{} {}", window.time, window.app_name)
                } else {
                    format!(
                        "{} {} - {}",
                        window.time, window.app_name, window.window_title
                    )
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n应用切换序列（按时间顺序）:\n{lines}\n")
    };

    let task_memory_text = if task_memories.is_empty() {
        String::new()
    } else {
        let lines = task_memories
            .iter()
            .map(|memory| {
                format!(
                    "- [{}] {}（关联应用: {}，最后活跃: {} {}）",
                    memory.category,
                    memory.task_summary,
                    memory_apps(memory),
                    memory.last_active_date,
                    memory.last_active_time
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n用户近期的活跃任务（可能与当前工作相关）:\n{lines}\n")
    };

    let app_usage_block = if app_usage_text.is_empty() {
        "无应用使用记录".to_string()
    } else {
        app_usage_text
    };

    format!(
        r#"你是一个工作内容分析助手。根据以下桌面截图和应用使用记录，分析用户在这段时间内做了什么工作。

时间范围: {start} - {end}

应用使用记录:
{app_usage_block}
{window_sequence_text}{task_memory_text}{prior_context}
请分析这些截图，识别用户的具体工作内容。返回严格的 JSON 格式，不要包含任何其他文字:

{{
  "work_items": [
    {{
      "time_range": "14:00-14:30",
      "activity": "编写 Python 数据处理脚本",
      "app": "VS Code",
      "category": "编程开发"
    }}
  ],
  "summary": ["这段时间主要完成了..."]
}}

注意:
- work_items 中的 activity 要具体描述用户在做什么，不要泛泛而谈
- category 可以是: 编程开发、文档写作、数据分析、会议沟通、网页浏览、设计工作、学习研究、邮件处理、其他
- 如果截图内容不清晰或无法判断，请基于应用使用记录推测
- 如果这段时间与之前的工作内容相关联，请确保你的分析在时间和活动上与已有内容保持连贯
- 如果用户在多个应用间频繁切换做同一件事（如在编辑器、终端、浏览器间切换写代码），请将其识别为同一个工作任务，不要拆开
- 如果用户的活跃任务与当前活动匹配，请在 work_items 中关联同一任务，保持描述一致性
- summary 用一两句话概括这段时间内的主要工作内容"#,
        start = time_range.0,
        end = time_range.1,
        app_usage_block = app_usage_block,
        window_sequence_text = window_sequence_text,
        task_memory_text = task_memory_text,
        prior_context = prior_context,
    )
}

pub fn build_consolidation_prompt(work_items: &[WorkItem]) -> String {
    format!(
        r#"你是一个工作内容分析助手。以下是一天中识别出的工作内容列表，请将相同主题的工作内容合并为一条。

工作内容列表:
{work_items_text}

合并规则:
- 相邻或相近时间段内、同一应用、同一主题的工作内容应合并为一条
- 合并后的 time_range 应覆盖原始各项的完整时间段（如 14:00-14:30 和 14:30-15:00 合并为 14:00-15:00）
- 合并后的 activity 应概括所有原始项的内容，用更精炼的描述
- 不同应用或不同主题的工作内容不要合并
- 如果没有可以合并的项目，原样返回

返回严格的 JSON 格式，不要包含任何其他文字:

{{
  "work_items": [
    {{
      "time_range": "14:00-15:30",
      "activity": "编写用户登录模块（含验证逻辑和bug修复）",
      "app": "VS Code",
      "category": "编程开发"
    }}
  ]
}}"#,
        work_items_text = work_item_lines(work_items),
    )
}

pub fn build_task_memory_update_prompt(work_items: &[WorkItem], memories: &[TaskMemory]) -> String {
    let memories_text = if memories.is_empty() {
        "无已有任务记忆".to_string()
    } else {
        memories
            .iter()
            .map(|memory| {
                format!(
                    "- [ID:{}] [{}] {}（关联应用: {}，最后活跃: {}）",
                    memory.id,
                    memory.category,
                    memory.task_summary,
                    memory_apps(memory),
                    memory.last_active_date
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r#"你是一个任务追踪助手。根据今天识别出的工作内容和用户的已有任务记忆，判断哪些工作是已有任务的延续，哪些是新任务。

今天的工作内容:
{work_items_text}

已有任务记忆:
{memories_text}

请返回严格的 JSON 格式，不要包含任何其他文字:

{{
  "task_updates": [
    {{
      "action": "continue",
      "memory_id": 1,
      "task_summary": "开发用户登录模块",
      "category": "编程开发",
      "app_cluster": ["VS Code", "Terminal"],
      "duration_ms": 3600000
    }},
    {{
      "action": "new",
      "task_summary": "修复线上告警问题",
      "category": "编程开发",
      "app_cluster": ["VS Code", "Chrome"],
      "duration_ms": 1800000
    }}
  ]
}}

规则:
- action 为 "continue" 表示延续已有任务（必须提供 memory_id），"new" 表示新任务
- 如果今天的工作内容与已有任务记忆匹配（相似的活动描述或相同的应用组合），标记为 continue
- 如果是全新任务，标记为 new
- task_summary 用简短的中文描述任务（5-20字）
- app_cluster 是该任务关联的应用列表
- duration_ms 是今天该任务的累计时长（毫秒），根据时间范围估算
- 如果没有需要更新的内容，返回空数组: {{"task_updates": []}}"#,
        work_items_text = work_item_lines(work_items),
        memories_text = memories_text,
    )
}

pub fn build_summary_prompt(work_items: &[WorkItem], app_usage: &[AppUsage]) -> String {
    format!(
        r#"你是一个工作内容分析助手。根据以下今日工作记录和应用使用统计，生成一份简洁的工作总结。

工作记录:
{work_items_text}

应用使用统计:
{app_usage_text}

请按主题列出今天的主要工作内容和产出，每个主题一行，用 JSON 数组格式返回。例如：

["完成了用户登录模块的开发和测试", "参加了产品需求评审会议", "处理了3个线上bug"]

只返回 JSON 数组，不需要其他文字。"#,
        work_items_text = work_item_lines(work_items),
        app_usage_text = app_usage_lines(app_usage, false),
    )
}

pub fn build_periodic_summary_prompt(
    daily: &[(String, Vec<String>)],
    period_type: &str,
    period_label: &str,
) -> String {
    let daily_text = daily
        .iter()
        .map(|(date, summary)| format!("{date}: {}", summary.join("；")))
        .collect::<Vec<_>>()
        .join("\n");
    let daily_text = if daily_text.is_empty() {
        "无日报数据".to_string()
    } else {
        daily_text
    };

    let period_name = if period_type == "quarter" {
        "季度"
    } else {
        "年度"
    };

    format!(
        r#"你是一个工作内容汇总助手。根据以下每日工作日报，生成一份{period_name}工作汇总。

{period_name}: {period_label}

每日工作日报:
{daily_text}

请生成一份结构化的{period_name}工作汇总。返回严格的 JSON 格式，不要包含任何其他文字:

{{
  "period": "{period_label}",
  "highlights": [
    "完成了一个重要的数据处理项目",
    "参加了多次技术评审会议"
  ],
  "work_categories": [
    {{
      "category": "编程开发",
      "percentage": 45
    }},
    {{
      "category": "会议沟通",
      "percentage": 20
    }}
  ],
  "summary": "本{period_name}主要工作集中在..."
}}

注意:
- highlights 列出本{period_name}的所有工作亮点，覆盖日报中总结的全部工作内容，不要限制数量
- work_categories 统计各类工作的时间占比，总和应为 100
- summary 用 2-3 句话概括本{period_name}的整体工作情况"#,
        period_name = period_name,
        period_label = period_label,
        daily_text = daily_text,
    )
}

pub fn build_yearly_summary_prompt(daily: &[(String, Vec<String>)], year: &str) -> String {
    let daily_text = daily
        .iter()
        .map(|(date, summary)| format!("{date}: {}", summary.join("；")))
        .collect::<Vec<_>>()
        .join("\n");
    let daily_text = if daily_text.is_empty() {
        "无日报数据".to_string()
    } else {
        daily_text
    };

    format!(
        r#"你是一个工作内容汇总助手。根据以下每日工作日报，生成一份年度工作事迹总结。

年度: {year}

每日工作日报:
{daily_text}

请根据日报内容，归纳出本年度的主要工作事迹，按照以下格式输出。返回严格的 JSON 格式，不要包含任何其他文字:

{{
  "period": "{year}",
  "opening": "本年主要工作事迹如下：",
  "categories": [
    {{
      "title": "项目开发",
      "items": [
        {{
          "subtitle": "XX系统建设",
          "description": "主导XX系统的设计与开发工作，完成了核心模块的架构设计和功能实现，推动系统从无到有上线运行。"
        }},
        {{
          "subtitle": "YY功能优化",
          "description": "对YY功能进行性能优化和体验改进，解决了多项用户反馈的问题。"
        }}
      ]
    }},
    {{
      "title": "技术研究",
      "items": [
        {{
          "subtitle": "新技术预研",
          "description": "深入调研并实践了新技术方案，形成技术文档并在团队内推广。"
        }}
      ]
    }}
  ],
  "summary": "综上所述，本年度在项目开发、技术研究等方面取得了显著成果，为团队和业务发展做出了积极贡献。"
}}

注意:
- 根据日报内容归纳工作内容涉及的大类（如：项目开发、技术工作、问题修复、工程化建设、团队协作、学习成长等），最多 5 个大类，不要硬套模板
- 每个大类下包含该大类全部的工作内容子项，不要限制数量
- 每个子项的 subtitle 是简短标题（5-15字），description 是 2-3 句详细描述
- opening 固定为 "本年主要工作事迹如下："
- summary 用 2-3 句话做年度整体总结
- 内容要基于日报数据，不要编造"#,
        year = year,
        daily_text = daily_text,
    )
}
