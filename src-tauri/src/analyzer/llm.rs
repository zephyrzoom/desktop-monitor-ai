use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use serde::Serialize;
use serde_json::{json, Value};

use crate::logger;
use crate::runtime::Runtime;

use super::CANCELLED;

const REQUEST_TIMEOUT_SECS: u64 = 300;
/// 模型列表只是配置页的一次探测，超时不宜拖住界面
const MODELS_TIMEOUT_SECS: u64 = 15;
/// 验证要真实跑一次对话，推理模型可能较慢，但也不该让用户无限等待
const VALIDATION_TIMEOUT_SECS: u64 = 45;
/// 验证请求的最小输出上限，只为了确认模型能正常应答
const VALIDATION_MAX_TOKENS: u32 = 16;

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

/// 对话接口地址。验证与真实分析必须走同一套拼接规则，
/// 否则会出现「验证通过、实际分析却 404」的假阳性。
fn chat_url(base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("未配置 Base URL".to_string());
    }
    Ok(format!("{base}/chat/completions"))
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

/// 模型可用性验证结果。验证失败属于「预期内的结果」，不用 Err 抛出，
/// 前端可直接渲染 message / httpStatus 等信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelValidation {
    pub ok: bool,
    pub message: String,
    pub latency_ms: u128,
    /// 服务端回显的实际模型名，中转服务可能把它映射成别的名字
    pub model: Option<String>,
    pub http_status: Option<u16>,
}

impl ModelValidation {
    fn failed(message: impl Into<String>, latency_ms: u128, http_status: Option<u16>) -> Self {
        Self {
            ok: false,
            message: message.into(),
            latency_ms,
            model: None,
            http_status,
        }
    }
}

/// 验证用的最小对话请求。o1 / o3 等推理模型只接受 max_completion_tokens，
/// 首次请求被拒时会自动换成该参数重试一次。
fn validation_body(model: &str, use_completion_tokens: bool) -> Value {
    if use_completion_tokens {
        json!({
            "model": model,
            "messages": [{ "role": "user", "content": "Hi" }],
            "stream": false,
            "max_completion_tokens": VALIDATION_MAX_TOKENS,
        })
    } else {
        json!({
            "model": model,
            "messages": [{ "role": "user", "content": "Hi" }],
            "stream": false,
            "max_tokens": VALIDATION_MAX_TOKENS,
        })
    }
}

fn needs_completion_tokens(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("max_completion_tokens")
        || (lower.contains("max_tokens")
            && (lower.contains("unsupported") || lower.contains("not supported")))
}

/// 从各家服务的错误响应里取人类可读的提示。
fn api_error_message(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    let message = match value.get("error") {
        Some(Value::Object(err)) => err.get("message").and_then(Value::as_str),
        Some(Value::String(err)) => Some(err.as_str()),
        _ => value.get("message").and_then(Value::as_str),
    }?;
    let message = message.trim();
    if message.is_empty() {
        None
    } else {
        Some(truncate(message, 160))
    }
}

fn network_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "请求超时，服务在限定时间内没有响应".to_string()
    } else if err.is_connect() {
        "无法连接接口地址，检查 Base URL 与网络".to_string()
    } else {
        format!("请求失败: {err}")
    }
}

fn http_failure_message(status: u16, text: &str) -> String {
    let prefix = match status {
        400 => "请求被拒绝（模型名或参数不被支持）",
        401 | 403 => "API Key 无效或没有权限",
        404 => "接口或模型不存在，检查 Base URL 与模型名",
        408 => "服务端请求超时",
        429 => "触发限流，请稍后再试",
        500..=599 => "服务端返回错误",
        _ => "接口返回错误",
    };
    let detail = api_error_message(text).unwrap_or_else(|| truncate(text.trim(), 160));
    if detail.is_empty() {
        format!("{prefix}（HTTP {status}）")
    } else {
        format!("{prefix}（HTTP {status}）：{detail}")
    }
}

/// 把一次 HTTP 响应整理成验证结果：200 且含非空 choices 才算真的能对话。
/// 不要求 content 非空——推理模型常把文本放在 reasoning_content 里。
fn validation_from_response(status: u16, text: &str, latency_ms: u128) -> ModelValidation {
    if !(200..300).contains(&status) {
        return ModelValidation::failed(
            http_failure_message(status, text),
            latency_ms,
            Some(status),
        );
    }

    let value: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let has_choices = value
        .get("choices")
        .and_then(Value::as_array)
        .is_some_and(|choices| !choices.is_empty());
    let served_model = value
        .get("model")
        .and_then(Value::as_str)
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());

    if !has_choices {
        return ModelValidation::failed(
            "接口返回 200，但不是标准的对话响应格式",
            latency_ms,
            Some(status),
        );
    }

    ModelValidation {
        ok: true,
        message: "模型可用，已成功完成一次对话请求".to_string(),
        latency_ms,
        model: served_model,
        http_status: Some(status),
    }
}

/// 用当前表单配置真实调用一次 /chat/completions，验证所选模型是否可用。
///
/// 不重试（重试会掩盖真实错误）、不读数据库，只做一次轻量请求；
/// 参数由设置页传入，因此不必先保存配置。
pub async fn validate_model(
    api_key: &str,
    base_url: &str,
    model: &str,
    custom_headers: &str,
) -> ModelValidation {
    let started = Instant::now();
    let elapsed = || started.elapsed().as_millis();

    if model.trim().is_empty() {
        return ModelValidation::failed("请先选择或填写模型", elapsed(), None);
    }
    let headers = match request_headers(api_key, custom_headers) {
        Ok(headers) => headers,
        Err(err) => return ModelValidation::failed(err, elapsed(), None),
    };
    let url = match chat_url(base_url) {
        Ok(url) => url,
        Err(err) => return ModelValidation::failed(err, elapsed(), None),
    };
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(VALIDATION_TIMEOUT_SECS))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return ModelValidation::failed(format!("创建请求失败: {err}"), elapsed(), None)
        }
    };

    let mut use_completion_tokens = false;
    loop {
        let result = client
            .post(&url)
            .headers(headers.clone())
            .json(&validation_body(model.trim(), use_completion_tokens))
            .send()
            .await;

        match result {
            Ok(response) => {
                let status = response.status().as_u16();
                let text = response.text().await.unwrap_or_default();
                // 推理模型对 max_tokens 报 400 时，换成 max_completion_tokens 再试一次
                if status == 400 && !use_completion_tokens && needs_completion_tokens(&text) {
                    logger::info("模型验证：改用 max_completion_tokens 重试");
                    use_completion_tokens = true;
                    continue;
                }
                let outcome = validation_from_response(status, &text, elapsed());
                if !outcome.ok {
                    logger::warn(format!("模型验证失败: {}", outcome.message));
                }
                return outcome;
            }
            Err(err) => {
                let message = network_error(&err);
                logger::warn(format!("模型验证失败: {message}"));
                return ModelValidation::failed(message, elapsed(), None);
            }
        }
    }
}

/// 调用 OpenAI 兼容的 /chat/completions 接口，带指数退避重试。
pub async fn chat(
    rt: &Runtime,
    content: Value,
    max_tokens: u32,
    label: &str,
) -> Result<String, String> {
    let config = rt.config.analysis();
    let url = chat_url(&config.base_url)?;
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
        if rt.is_cancelled() {
            return Err(CANCELLED.to_string());
        }

        // select! 让用户在等模型返回时也能立刻取消，不必等这一批跑完
        let request = async {
            let response = client
                .post(url.as_str())
                .headers(headers.clone())
                .json(&body)
                .send()
                .await?;
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            Ok::<_, reqwest::Error>((status, text))
        };

        let result = tokio::select! {
            _ = rt.wait_cancelled() => {
                logger::info(format!("[Cancel] {label} 已取消，中断当前请求"));
                return Err(CANCELLED.to_string());
            }
            res = request => res,
        };

        match result {
            Ok((status, text)) => {
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
            tokio::select! {
                _ = rt.wait_cancelled() => return Err(CANCELLED.to_string()),
                _ = tokio::time::sleep(delay) => {}
            }
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
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::thread;

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
        let openai =
            r#"{"object":"list","data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"},{"id":"gpt-4o"}]}"#;
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

    #[test]
    fn chat_url_matches_real_analysis_request() {
        assert_eq!(
            chat_url(" https://host/v1/ ").unwrap(),
            "https://host/v1/chat/completions"
        );
        assert!(chat_url("  ").is_err());
    }

    #[test]
    fn validation_body_switches_token_parameter() {
        let plain = validation_body("gpt-4o", false);
        assert_eq!(
            plain["max_tokens"].as_u64(),
            Some(VALIDATION_MAX_TOKENS as u64)
        );
        assert!(plain.get("max_completion_tokens").is_none());
        assert_eq!(plain["stream"].as_bool(), Some(false));
        assert_eq!(plain["model"].as_str(), Some("gpt-4o"));

        let reasoning = validation_body("o3-mini", true);
        assert_eq!(
            reasoning["max_completion_tokens"].as_u64(),
            Some(VALIDATION_MAX_TOKENS as u64)
        );
        assert!(reasoning.get("max_tokens").is_none());
    }

    #[test]
    fn needs_completion_tokens_only_for_token_errors() {
        assert!(needs_completion_tokens(
            r#"{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported. Use 'max_completion_tokens' instead."}}"#
        ));
        assert!(!needs_completion_tokens(
            r#"{"error":{"message":"The model `not-exist` does not exist"}}"#
        ));
    }

    #[test]
    fn api_error_message_handles_common_shapes() {
        assert_eq!(
            api_error_message(r#"{"error":{"message":"invalid api key"}}"#).as_deref(),
            Some("invalid api key")
        );
        assert_eq!(
            api_error_message(r#"{"error":"rate limited"}"#).as_deref(),
            Some("rate limited")
        );
        assert_eq!(api_error_message("plain text"), None);
    }

    #[test]
    fn http_failure_message_is_actionable() {
        let msg =
            http_failure_message(401, r#"{"error":{"message":"Incorrect API key provided"}}"#);
        assert!(msg.contains("API Key"));
        assert!(msg.contains("Incorrect API key provided"));
        assert!(http_failure_message(404, "").contains("HTTP 404"));
        assert!(http_failure_message(429, "").contains("限流"));
    }

    #[test]
    fn validation_response_requires_choices() {
        let ok = validation_from_response(
            200,
            r#"{"model":"gpt-4o-2024-08-06","choices":[{"message":{"content":null,"reasoning_content":"..."}}]}"#,
            123,
        );
        assert!(ok.ok);
        assert_eq!(ok.model.as_deref(), Some("gpt-4o-2024-08-06"));
        assert_eq!(ok.latency_ms, 123);

        let bad_shape = validation_from_response(200, r#"{"model":"x"}"#, 10);
        assert!(!bad_shape.ok);
        assert!(bad_shape.message.contains("不是标准"));

        let unauthorized = validation_from_response(403, r#"{"error":{"message":"nope"}}"#, 20);
        assert!(!unauthorized.ok);
        assert_eq!(unauthorized.http_status, Some(403));
    }

    /// 只读一次完整的 HTTP 请求（含 Content-Length 指定的 body），用于断言请求内容。
    fn read_http_request(stream: &mut TcpStream) -> String {
        let mut raw = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            raw.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&raw);
            if let Some(sep) = text.find("\r\n\r\n") {
                let length = text[..sep]
                    .lines()
                    .find_map(|line| {
                        let lower = line.to_ascii_lowercase();
                        lower
                            .strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if raw.len().saturating_sub(sep + 4) >= length {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&raw).to_string()
    }

    /// 本地 mock 服务：按序返回给定响应，并把每次收到的原始请求发回 channel。
    fn mock_server(responses: Vec<(u16, &'static str)>) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            for (status, body) in responses {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                            if Instant::now() >= deadline {
                                return;
                            }
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => return,
                    }
                };
                stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
                let _ = tx.send(read_http_request(&mut stream));

                let reason = if (200..300).contains(&status) {
                    "OK"
                } else {
                    "Error"
                };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        (format!("http://127.0.0.1:{port}/v1"), rx)
    }

    #[tokio::test]
    async fn validate_model_retries_with_completion_tokens() {
        let (base, rx) = mock_server(vec![
            (
                400,
                r#"{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported. Use 'max_completion_tokens' instead."}}"#,
            ),
            (
                200,
                r#"{"model":"o3-mini-2025-01-31","choices":[{"message":{"content":"Hi"}}]}"#,
            ),
        ]);

        let result = validate_model("test-key", &base, "o3-mini", "").await;
        assert!(result.ok, "验证应成功: {}", result.message);
        assert_eq!(result.model.as_deref(), Some("o3-mini-2025-01-31"));
        assert_eq!(result.http_status, Some(200));

        let first = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(first.contains("POST /v1/chat/completions"));
        assert!(first.contains("\"max_tokens\""));
        let second = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(second.contains("\"max_completion_tokens\""));
    }

    #[tokio::test]
    async fn validate_model_reports_auth_failure() {
        let (base, rx) = mock_server(vec![(
            401,
            r#"{"error":{"message":"Incorrect API key provided"}}"#,
        )]);

        let result = validate_model("bad-key", &base, "gpt-4o", "").await;
        assert!(!result.ok);
        assert_eq!(result.http_status, Some(401));
        assert!(result.message.contains("API Key"));
        assert!(result.message.contains("Incorrect API key provided"));

        let request = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(request.to_ascii_lowercase().contains("bearer bad-key"));
    }
}
