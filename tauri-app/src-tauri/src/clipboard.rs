//! 剪贴板模块
//!
//! 对应原 `electron/handlers/clipboard.ts`，提供剪贴板读写命令。
//!
//! 注意：tauri-bridge.ts 中 `writeClipboardText` 已直接走前端 Tauri 插件，
//! 但 `readClipboard` 仍走 invoke。这里实现 `clipboard_read` 命令，并保留
//! `clipboard_write_text` 命令作为后端兜底。
//!
//! 简化点：
//! - 原版 `clipboard:read` 支持文本和图片，这里通过 Tauri clipboard-manager
//!   插件仅支持文本（图片需要 custom protocol，阶段 3b 再补）。
//! - 安全检查（API Key 模式阻断）保留。

use crate::types::ClipboardSnapshot;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// 剪贴板读取的最大字节数（10MB），超过会截断。
const MAX_CLIPBOARD_READ_SIZE: usize = 10 * 1024 * 1024;

/// 剪贴板写入的最大字节数（100KB），超过会拒绝。
const MAX_CLIPBOARD_WRITE_SIZE: usize = 100 * 1024;

/// 检测文本是否包含疑似 API Key（用于剪贴板写入阻断）。
fn contains_api_key_pattern(text: &str) -> bool {
    use regex::Regex;
    // sk- 开头的 OpenAI 风格 key
    let re_sk = Regex::new(r"sk-[a-zA-Z0-9]{20,}").unwrap();
    if re_sk.is_match(text) {
        return true;
    }
    // Bearer token
    let re_bearer = Regex::new(r"(?i)Bearer\s+[a-zA-Z0-9\-_]{20,}").unwrap();
    re_bearer.is_match(text)
}

/// 读取剪贴板快照（对应 `clipboard:read` IPC 通道）。
///
/// 简化实现：仅返回文本，没有图片支持。
#[tauri::command]
pub async fn clipboard_read(app: AppHandle) -> Result<ClipboardSnapshot, String> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("read clipboard failed: {}", e))?
        .trim()
        .to_string();

    if !text.is_empty() {
        // 限制读取大小
        let truncated = if text.len() > MAX_CLIPBOARD_READ_SIZE {
            text.chars().take(MAX_CLIPBOARD_READ_SIZE).collect::<String>()
        } else {
            text.clone()
        };

        // 安全截取前 40 字符作为签名预览（避免非 ASCII 字符串切片 panic）
        let preview: String = truncated.chars().take(40).collect();
        let sig = if truncated.chars().count() > 40 {
            format!("text:{}...", preview)
        } else {
            format!("text:{}", truncated)
        };

        Ok(ClipboardSnapshot {
            kind: "text".to_string(),
            text: Some(truncated),
            image_data_url: None,
            signature: sig,
        })
    } else {
        // 简化：图片支持暂未实现，返回空
        Ok(ClipboardSnapshot {
            kind: "empty".to_string(),
            text: None,
            image_data_url: None,
            signature: "empty".to_string(),
        })
    }
}

/// 写入文本到剪贴板（对应 `clipboard:writeText` IPC 通道）。
///
/// 注意：tauri-bridge.ts 已直接使用前端插件，此命令作为后端兜底。
#[tauri::command]
pub async fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), String> {
    if text.len() > MAX_CLIPBOARD_WRITE_SIZE {
        return Err(format!(
            "Clipboard write rejected: text too long ({} bytes)",
            text.len()
        ));
    }

    // 安全检查：检测疑似 API Key
    if contains_api_key_pattern(&text) {
        return Err(
            "安全警告：检测到剪贴板内容包含疑似 API Key 或敏感令牌，已阻止写入。".to_string(),
        );
    }

    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("write clipboard failed: {}", e))
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contains_api_key_pattern_openai_key() {
        assert!(contains_api_key_pattern("sk-1234567890abcdefghijklmnopqrstuv"));
    }

    #[test]
    fn test_contains_api_key_pattern_bearer_token() {
        assert!(contains_api_key_pattern("Bearer abcdef1234567890abcdef1234567890"));
        assert!(contains_api_key_pattern("bearer abcdef1234567890abcdef1234567890"));
    }

    #[test]
    fn test_contains_api_key_pattern_normal_text() {
        assert!(!contains_api_key_pattern("普通文本"));
        assert!(!contains_api_key_pattern("hello world"));
        assert!(!contains_api_key_pattern(""));
    }

    #[test]
    fn test_contains_api_key_pattern_short_sk() {
        // 短于 20 字符的 sk- 不应被匹配
        assert!(!contains_api_key_pattern("sk-short"));
    }
}
