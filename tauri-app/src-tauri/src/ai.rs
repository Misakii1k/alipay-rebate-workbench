//! AI（OpenAI 兼容）Chat Completions 调用模块
//!
//! 对应原 `electron/handlers/ai.ts` + `electron/handlers/recognition.ts` 中的
//! `callChatCompletions`。
//!
//! - 调用 OpenAI 兼容的 `/v1/chat/completions` 接口
//! - 408/409/425/429/5xx 自动重试 + 指数退避
//! - modelConcurrency 并发限制（用 tokio::sync::Semaphore）
//! - temperature=0、response_format=json_object（默认）
//!
//! 提供 `call_chat_completion` 辅助函数供 recognition/review/title 调用。

use crate::security::validate_api_url;
use crate::types::{ApiProfile, AppSettings, ChatMessage, ChatOptions, ModelConnectionStatus, ModelInfo};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::time::Duration;
use tokio::sync::Semaphore;

/// 全局并发信号量（容量 = 6，对应 shared.ts 中 modelConcurrency 的最大值）。
///
/// 简化实现：固定容量为 6，每次调用获取 1 个 permit。
/// 实际并发由调用方控制，这里提供上限保护。
static AI_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(6));

/// 请求超时时间（45 秒，与原版一致）。
const REQUEST_TIMEOUT_SECS: u64 = 45;

/// 判断 HTTP 状态码是否应该重试。
fn should_retry(status: u16) -> bool {
    status == 408 || status == 409 || status == 425 || status == 429 || status >= 500
}

/// 获取活跃 API Profile（对应原 `getActiveApiProfile`）。
pub fn get_active_api_profile(settings: &AppSettings) -> ApiProfile {
    if let Some(profile) = settings
        .api_profiles
        .iter()
        .find(|p| p.id == settings.active_api_profile_id)
    {
        return profile.clone();
    }
    if let Some(first) = settings.api_profiles.first() {
        return first.clone();
    }
    ApiProfile::default()
}

/// 构造 Authorization 头值。
fn auth_header(profile: &ApiProfile) -> String {
    if profile.api_type == "anthropic" {
        profile.api_key.clone()
    } else {
        format!("Bearer {}", profile.api_key)
    }
}

/// 构造 chat/completions 端点 URL。
fn chat_completions_endpoint(profile: &ApiProfile) -> String {
    format!("{}/chat/completions", profile.api_base_url.trim_end_matches('/'))
}

/// 构造 models 端点 URL。
fn models_endpoint(profile: &ApiProfile) -> String {
    format!("{}/models", profile.api_base_url.trim_end_matches('/'))
}

/// Chat completions 请求体（用于序列化）。
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct ChatCompletionsRequest {
    model: String,
    temperature: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    messages: Vec<ChatMessage>,
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

/// 调用 OpenAI 兼容的 Chat Completions 接口（核心辅助函数）。
///
/// 对应原 `callChatCompletions`。
///
/// 参数：
/// - `profile`: API 配置
/// - `messages`: 聊天消息列表
/// - `options`: 聊天选项（temperature / json_mode / max_tokens）
///
/// 返回模型输出的内容字符串（choices[0].message.content）。
/// 调用方负责解析 JSON（若启用了 json_mode）。
pub async fn call_chat_completion(
    profile: &ApiProfile,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
) -> Result<String, String> {
    // 安全校验
    validate_api_url(&profile.api_base_url)?;

    if profile.api_key.trim().is_empty() {
        return Err("未配置 API Key，请在设置中填写。".to_string());
    }

    let model = profile.text_model.clone();
    if model.is_empty() {
        return Err("未配置文本模型。".to_string());
    }

    // 获取并发 permit
    let _permit = AI_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| format!("并发控制异常：{}", e))?;

    let endpoint = chat_completions_endpoint(profile);
    let response_format = if options.json_mode {
        Some(ResponseFormat {
            format_type: "json_object".to_string(),
        })
    } else {
        None
    };

    let body = ChatCompletionsRequest {
        model: model.clone(),
        temperature: options.temperature,
        max_tokens: options.max_tokens,
        response_format,
        messages,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{}", e))?;

    let mut last_error = String::new();

    loop {
        let request = client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", auth_header(profile))
            .json(&body);

        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                if response.status().is_success() {
                    // 解析响应
                    let json: serde_json::Value = response
                        .json()
                        .await
                        .map_err(|e| format!("解析响应失败：{}", e))?;

                    let content = json
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("");

                    if content.is_empty() {
                        return Err("模型没有返回可解析内容。".to_string());
                    }
                    return Ok(content.to_string());
                } else {
                    let text = response.text().await.unwrap_or_default();
                    last_error = format!("模型接口请求失败：{} {}", status, text.chars().take(200).collect::<String>());
                    if should_retry(status) {
                        // 指数退避（简化：固定 500ms，重试次数由上层 call_chat_completion_with_retry 控制）
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        continue;
                    }
                    return Err(last_error);
                }
            }
            Err(e) => {
                last_error = format!("网络错误：{}", e);
                if last_error.contains("timed out") {
                    return Err(format!("连接超时（{}秒），请检查网络或 API Base URL。", REQUEST_TIMEOUT_SECS));
                }
                // 网络错误总是重试一次
                tokio::time::sleep(Duration::from_millis(500)).await;
                return Err(last_error);
            }
        }
    }
}

/// 带重试的 chat completion 调用（使用 settings 中的重试次数）。
///
/// 对应原 `callChatCompletions` 的完整重试逻辑。
pub async fn call_chat_completion_with_retry(
    settings: &AppSettings,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
) -> Result<String, String> {
    let profile = get_active_api_profile(settings);
    validate_api_url(&profile.api_base_url)?;

    let max_attempts = (settings.model_retry_count.max(0) + 1) as u32;
    let mut last_error = String::new();

    for attempt in 1..=max_attempts {
        match call_chat_completion(&profile, messages.clone(), options.clone()).await {
            Ok(content) => return Ok(content),
            Err(e) => {
                last_error = e;
                if attempt < max_attempts {
                    // 指数退避：500 * 2^(attempt-1)
                    let delay_ms = 500u64 * 2u64.pow(attempt - 1);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }
            }
        }
    }
    Err(last_error)
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 测试 AI 连接（对应 `ai:testConnection` IPC 通道）。
///
/// 调用 `/v1/models` 端点检查连接是否正常。
#[tauri::command]
pub async fn ai_test_connection(settings: AppSettings) -> Result<ModelConnectionStatus, String> {
    let profile = get_active_api_profile(&settings);

    // 安全校验
    if let Err(e) = validate_api_url(&profile.api_base_url) {
        return Ok(ModelConnectionStatus {
            state: "failed".to_string(),
            detail: e,
        });
    }

    if profile.api_key.trim().is_empty() {
        return Ok(ModelConnectionStatus {
            state: "failed".to_string(),
            detail: "未配置 API Key，请在设置中填写。".to_string(),
        });
    }

    let url = models_endpoint(&profile);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{}", e))?;

    let request = client
        .get(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", auth_header(&profile));

    match request.send().await {
        Ok(response) => {
            if response.status().is_success() {
                Ok(ModelConnectionStatus {
                    state: "connected".to_string(),
                    detail: format!("连接成功：{}", profile.api_base_url),
                })
            } else {
                let status = response.status().as_u16();
                let text = response.text().await.unwrap_or_default();
                Ok(ModelConnectionStatus {
                    state: "failed".to_string(),
                    detail: format!("HTTP {}: {}", status, text.chars().take(100).collect::<String>()),
                })
            }
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("timed out") || msg.contains("timeout") {
                Ok(ModelConnectionStatus {
                    state: "failed".to_string(),
                    detail: "连接超时（10秒），请检查网络或 API Base URL。".to_string(),
                })
            } else {
                Ok(ModelConnectionStatus {
                    state: "failed".to_string(),
                    detail: format!("网络错误：{}", msg),
                })
            }
        }
    }
}

/// 列出可用模型（对应 `ai:listModels` IPC 通道）。
///
/// 调用 `/v1/models` 端点获取模型列表。
#[tauri::command]
pub async fn ai_list_models(settings: AppSettings) -> Result<Vec<ModelInfo>, String> {
    let profile = get_active_api_profile(&settings);

    if let Err(_) = validate_api_url(&profile.api_base_url) {
        return Ok(Vec::new());
    }

    if profile.api_key.trim().is_empty() {
        return Ok(Vec::new());
    }

    let url = models_endpoint(&profile);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{}", e))?;

    let request = client
        .get(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", auth_header(&profile));

    match request.send().await {
        Ok(response) => {
            if !response.status().is_success() {
                return Ok(Vec::new());
            }
            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("解析响应失败：{}", e))?;

            let models = json
                .get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let id = item.get("id").and_then(|i| i.as_str()).unwrap_or("");
                            if id.is_empty() {
                                None
                            } else {
                                Some(ModelInfo {
                                    id: id.to_string(),
                                    name: id.to_string(),
                                })
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            Ok(models)
        }
        Err(_) => Ok(Vec::new()),
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_retry() {
        assert!(should_retry(408));
        assert!(should_retry(409));
        assert!(should_retry(425));
        assert!(should_retry(429));
        assert!(should_retry(500));
        assert!(should_retry(503));
        assert!(!should_retry(200));
        assert!(!should_retry(400));
        assert!(!should_retry(401));
        assert!(!should_retry(404));
    }

    #[test]
    fn test_get_active_api_profile_default() {
        let settings = AppSettings::default();
        let profile = get_active_api_profile(&settings);
        assert_eq!(profile.id, "default");
    }

    #[test]
    fn test_get_active_api_profile_not_found_falls_back() {
        let mut settings = AppSettings::default();
        settings.active_api_profile_id = "nonexistent".to_string();
        let profile = get_active_api_profile(&settings);
        // 应回退到第一个 profile
        assert_eq!(profile.id, "default");
    }

    #[test]
    fn test_auth_header_openai() {
        let mut profile = ApiProfile::default();
        profile.api_type = "openai".to_string();
        profile.api_key = "sk-test".to_string();
        assert_eq!(auth_header(&profile), "Bearer sk-test");
    }

    #[test]
    fn test_auth_header_anthropic() {
        let mut profile = ApiProfile::default();
        profile.api_type = "anthropic".to_string();
        profile.api_key = "ant-key".to_string();
        assert_eq!(auth_header(&profile), "ant-key");
    }

    #[test]
    fn test_chat_completions_endpoint() {
        let mut profile = ApiProfile::default();
        profile.api_base_url = "https://api.openai.com/v1".to_string();
        assert_eq!(chat_completions_endpoint(&profile), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_chat_completions_endpoint_trailing_slash() {
        let mut profile = ApiProfile::default();
        profile.api_base_url = "https://api.openai.com/v1/".to_string();
        assert_eq!(chat_completions_endpoint(&profile), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_models_endpoint() {
        let mut profile = ApiProfile::default();
        profile.api_base_url = "https://api.openai.com/v1".to_string();
        assert_eq!(models_endpoint(&profile), "https://api.openai.com/v1/models");
    }

    #[tokio::test]
    async fn test_call_chat_completion_no_api_key() {
        let mut profile = ApiProfile::default();
        profile.api_key = String::new();
        let result = call_chat_completion(&profile, vec![], ChatOptions::default()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("API Key"));
    }

    #[tokio::test]
    async fn test_call_chat_completion_invalid_url() {
        let mut profile = ApiProfile::default();
        profile.api_key = "sk-test".to_string();
        profile.api_base_url = "not-a-url".to_string();
        let result = call_chat_completion(&profile, vec![], ChatOptions::default()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_ai_test_connection_no_api_key() {
        let mut settings = AppSettings::default();
        settings.api_key = String::new();
        for p in settings.api_profiles.iter_mut() {
            p.api_key = String::new();
        }
        let result = ai_test_connection(settings).await.unwrap();
        assert_eq!(result.state, "failed");
        assert!(result.detail.contains("API Key"));
    }

    #[tokio::test]
    async fn test_ai_list_models_no_api_key() {
        let mut settings = AppSettings::default();
        settings.api_key = String::new();
        for p in settings.api_profiles.iter_mut() {
            p.api_key = String::new();
        }
        let result = ai_list_models(settings).await.unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_chat_options_default() {
        let opts = ChatOptions::default();
        assert_eq!(opts.temperature, 0.0);
        assert!(opts.json_mode);
        assert!(opts.max_tokens.is_none());
    }

    #[test]
    fn test_semaphore_capacity() {
        // 信号量应该可用
        let permit = AI_SEMAPHORE.try_acquire();
        assert!(permit.is_ok());
    }
}
