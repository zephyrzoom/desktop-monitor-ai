use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};

use crate::logger;
use crate::runtime::Runtime;

const REQUEST_TIMEOUT_SECS: u64 = 300;

/// 解析设置中填写的自定义请求头文本：每行 `Key: Value`，`#` 开头为注释。
pub fn parse_custom_headers(raw: &str) -> Vec<(String, String)> {
    let mut headers = Vec::new();
    for line in raw.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(index) = trimmed.find(':') else {
            continue;
        };
        if index == 0 {
            continue;
        }
        let key = trimmed[..index].trim();
        let value = trimmed[index + 1..].trim();
        if key.is_empty() {
            continue;
        }
        headers.push((key.to_string(), value.to_string()));
    }
    headers
}

/// 调用 OpenAI 兼容的 /chat/completions 接口，带指数退避重试。
///
/// 自定义请求头在每次请求时实时读取配置，保存设置后无需重启即可生效。
pub async fn chat(
    rt: &Runtime,
    content: Value,
    max_tokens: u32,
    label: &str,
) -> Result<String, String> {
    let config = rt.config.analysis();
    if config.api_key.trim().is_empty() {
        return Err("未配置 API Key".to_string());
    }

    let url = format!(
        "{}/chat/completions",
        config.base_url.trim().trim_end_matches('/')
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", config.api_key.trim()))
            .map_err(|e| format!("API Key 非法: {e}"))?,
    );
    for (key, value) in parse_custom_headers(&config.custom_headers) {
        match (
            HeaderName::from_bytes(key.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            (Ok(name), Ok(val)) => {
                headers.insert(name, val);
            }
            _ => logger::warn(format!("忽略非法的自定义请求头: {key}")),
        }
    }

    let body = json!({
        "model": config.model,
        "messages": [{ "role": "user", "content": content }],
        "max_tokens": max_tokens,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let attempts = config.max_retries.max(1);
    let mut last_error = String::from("未知错误");

    for attempt in 1..=attempts {
        let result = client
            .post(url.as_str())
            .headers(headers.clone())
            .json(&body)
            .send()
            .await;

        match result {
            Ok(response) => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();

                if !status.is_success() {
                    last_error = format!("HTTP {} - {}", status.as_u16(), truncate(&text, 300));
                } else {
                    match extract_content(&text) {
                        Some(content) if !content.trim().is_empty() => return Ok(content),
                        _ => {
                            last_error = format!("{}: 返回内容为空", label);
                        }
                    }
                }
            }
            Err(err) => {
                last_error = format!("{}: {err}", label);
            }
        }

        if attempt < attempts {
            let delay = Duration::from_secs(2u64.pow(attempt - 1).min(10));
            logger::warn(format!(
                "[Retry] {label} 第 {attempt} 次失败，{}s 后重试: {last_error}",
                delay.as_secs()
            ));
            tokio::time::sleep(delay).await;
        }
    }

    logger::error(format!("[Retry] {label} 重试 {attempts} 次后仍然失败"));
    Err(last_error)
}

fn extract_content(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    let content = value
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?;

    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => {
            let joined = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
                .collect::<Vec<_>>()
                .join("");
            Some(joined)
        }
        _ => None,
    }
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        text.to_string()
    } else {
        text.chars().take(limit).collect::<String>() + "..."
    }
}
