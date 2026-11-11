use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};

use crate::logger;
use crate::runtime::Runtime;

const REQUEST_TIMEOUT_SECS: u64 = 300;
/// 模型列表只是配置页的一次探测，超时不宜拖住界面
const MODELS_TIMEOUT_SECS: u64 = 15;

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

/// 构造 Bearer 鉴权 + 自定义请求头，/chat/completions 与 /models 共用。
///
/// 自定义请求头在每次请求时实时读取配置，保存设置后无需重启即可生效。
fn request_headers(api_key: &str, custom_headers: &str) -> Result<HeaderMap, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("未配置 API Key".to_string());
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}"))
            .map_err(|e| format!("API Key 非法: {e}"))?,
    );
    for (key, value) in parse_custom_headers(custom_headers) {
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
    Ok(headers)
}

/// 从用户填写的 Base URL 推导出 `GET /models` 地址。
///
/// 常见写法是 `https://host/v1`；也有人把整个对话接口地址或 `/models`
/// 贴进来，这里顺手归一化，避免出现 `/v1/chat/completions/models` 这类路径。
fn models_url(base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    let base = base
        .strip_suffix("/chat/completions")
        .unwrap_or(base)
        .trim_end_matches('/');
    let base = base
        .strip_suffix("/models")
        .unwrap_or(base)
        .trim_end_matches('/');
    if base.is_empty() {
        return Err("未配置 Base URL".to_string());
    }
    Ok(format!("{base}/models"))
}

/// 解析各家 OpenAI 兼容服务返回的模型列表。
///
/// 主流格式是 `{"data":[{"id":"gpt-4o"}]}`，也有 `{"models":[{"name":...}]}`、
/// 字符串数组、以及元素用 `name` / `model` 代替 `id` 的中转服务。
fn extract_models(text: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };

    let entries: Vec<&Value> = match &value {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => value
            .get("data")
            .or_else(|| value.get("models"))
            .and_then(Value::as_array)
            .map(|items| items.iter().collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let mut names: Vec<String> = entries
        .iter()
        .filter_map(|entry| match entry {
            Value::String(name) => Some(name.trim().to_string()),
            Value::Object(_) => ["id", "name", "model"].iter().find_map(|key| {
                entry
                    .get(key)
                    .and_then(Value::as_str)
                    .map(|name| name.trim().to_string())
            }),
            _ => None,
        })
        .filter(|name| !name.is_empty())
        .collect();

    names.sort_by_cached_key(|name| name.to_lowercase());
    names.dedup();
    names
}

/// 拉取 OpenAI 兼容接口的可用模型，供设置页下拉选择。
///
/// 失败时返回可直接展示给用户的中文原因；不支持该接口的服务仍可手动填写模型名。
pub async fn list_models(
    api_key: &str,
    base_url: &str,
    custom_headers: &str,
) -> Result<Vec<String>, String> {
    let headers = request_headers(api_key, custom_headers)?;
    let url = models_url(base_url)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(MODELS_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建请求失败: {e}"))?;

    let response = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|err| format!("连接模型列表接口失败: {err}"))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let reason = match status.as_u16() {
            401 | 403 => "API Key 无效或无权访问模型列表".to_string(),
            404 => "该服务不提供 /models 接口".to_string(),
            429 => "请求过于频繁，请稍后再试".to_string(),
            code => format!("HTTP {code} - {}", truncate(&text, 200)),
        };
        logger::warn(format!("获取模型列表失败: {reason}"));
        return Err(reason);
    }

    let models = extract_models(&text);
    if models.is_empty() {
        return Err("接口未返回可用的模型列表".to_string());
    }
    Ok(models)
}

/// 调用 OpenAI 兼容的 /chat/completions 接口，带指数退避重试。
pub async fn chat(
    rt: &Runtime,
    content: Value,
    max_tokens: u32,
    label: &str,
) -> Result<String, String> {
    let config = rt.config.analysis();
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim().trim_end_matches('/')
    );
    let headers = request_headers(&config.api_key, &config.custom_headers)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_url_handles_common_base_urls() {
        assert_eq!(
            models_url("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url(" https://host/v1/ ").unwrap(),
            "https://host/v1/models"
        );
        // 误把完整对话接口地址贴进 Base URL 时也能用
        assert_eq!(
            models_url("https://host/v1/chat/completions").unwrap(),
            "https://host/v1/models"
        );
        assert_eq!(
            models_url("https://host/v1/models").unwrap(),
            "https://host/v1/models"
        );
        assert!(models_url("  ").is_err());
    }

    #[test]
    fn extract_models_accepts_vendor_shapes() {
        let openai = r#"{"object":"list","data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"},{"id":"gpt-4o"}]}"#;
        assert_eq!(extract_models(openai), ["gpt-4o", "gpt-4o-mini"]);

        let relay = r#"{"data":[{"name":"claude-sonnet-4"},{"model":"deepseek-chat"}]}"#;
        assert_eq!(extract_models(relay), ["claude-sonnet-4", "deepseek-chat"]);

        let gemini = r#"{"models":[{"name":"models/gemini-2.5-flash"}]}"#;
        assert_eq!(extract_models(gemini), ["models/gemini-2.5-flash"]);

        assert_eq!(extract_models(r#"["o1","gpt-4o"]"#), ["gpt-4o", "o1"]);
        assert!(extract_models(r#"{"data":[]}"#).is_empty());
        assert!(extract_models("not json").is_empty());
    }

    #[test]
    fn custom_headers_ignore_comments_and_malformed_lines() {
        assert_eq!(
            parse_custom_headers("# comment\nX-Api-Version: 2024-01-01\nbroken\n: empty"),
            [("X-Api-Version".to_string(), "2024-01-01".to_string())]
        );
    }
}
