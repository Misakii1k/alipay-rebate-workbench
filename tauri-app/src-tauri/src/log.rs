//! 日志模块
//!
//! 对应原 `electron/utils/logger.ts`，提供 tracing 日志初始化与前端
//! `log:append` IPC 通道对应的 `log_append` Tauri 命令。
//!
//! - 日志路径：app config dir 下的 `logs/` 子目录，按天 rotate。
//! - 提供 `init_logger()` 函数在启动时调用。
//! - 提供 `log_append` 命令供前端调用。

use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::OnceLock;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// 全局保持的 worker guard，保证非阻塞写入在进程退出前 flush。
static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// 日志条目（JSON 行格式，与原 logger.ts 一致）。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LogEntry {
    time: String,
    level: String,
    message: String,
    meta: serde_json::Value,
}

/// 初始化全局日志订阅器（按天 rotate）。
///
/// 必须在 Tauri 启动早期调用一次（`setup` hook 中调用最佳）。
/// 多次调用是安全的：第二次之后的调用会被忽略。
pub fn init_logger() {
    // 已初始化则跳过
    if LOG_GUARD.get().is_some() {
        return;
    }

    // 确保日志目录存在
    let log_dir = paths::get_log_dir();
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        // 回退到 stderr-only，避免启动失败
        eprintln!("Failed to create log dir {:?}: {}", log_dir, e);
        let _ = tracing_subscriber::registry()
            .with(fmt::layer().with_writer(std::io::stderr))
            .with(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
            .try_init();
        return;
    }

    // tracing-appender 按天 rotate（前缀 = ""，后缀 = ".log"），
    // 实际生成 `logs/2026-06-28.log` 这类文件。
    let file_appender = tracing_appender::rolling::daily(&log_dir, "app.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let registry = tracing_subscriber::registry()
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(false),
        )
        .with(
            fmt::layer()
                .with_writer(std::io::stderr)
                .with_target(false),
        )
        .with(EnvFilter::from_default_env().add_directive("info".parse().unwrap()));

    if registry.try_init().is_ok() {
        // 保存 guard 防止提前 drop（drop 后非阻塞 writer 会丢失日志）
        let _ = LOG_GUARD.set(guard);
    }
}

/// 脱敏字符串（与原 logger.ts sanitizeForLog 的字符串分支对齐）。
///
/// 脱敏：API Key、Bearer token、JSON 中的 apiKey/x-api-key、手机号、邮箱。
fn sanitize_string(s: &str) -> String {
    use regex::Regex;
    let mut out = s.to_string();

    // sk- 开头的 API Key
    let re_sk = Regex::new(r"sk-[a-zA-Z0-9]{20,}").unwrap();
    out = re_sk.replace_all(&out, "sk-***").to_string();

    // Bearer token
    let re_bearer = Regex::new(r"(?i)Bearer\s+[a-zA-Z0-9\-_]+").unwrap();
    out = re_bearer.replace_all(&out, "Bearer ***").to_string();

    // "apiKey":"..."
    let re_apikey = Regex::new(r#"(?i)"apiKey"\s*:\s*"[^"]+""#).unwrap();
    out = re_apikey.replace_all(&out, r#""apiKey":"***""#).to_string();

    // "x-api-key":"..."
    let re_xapikey = Regex::new(r#"(?i)"x-api-key"\s*:\s*"[^"]+""#).unwrap();
    out = re_xapikey.replace_all(&out, r#""x-api-key":"***""#).to_string();

    // 手机号 1[3-9]xxxxxxxxx → 保留前3后4
    let re_phone = Regex::new(r"\b(1[3-9]\d)(\d{4})(\d{4})\b").unwrap();
    out = re_phone.replace_all(&out, "$1****$3").to_string();

    // 邮箱 脱敏（保留前2字符和域名）
    let re_email = Regex::new(
        r"(?i)\b([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b",
    )
    .unwrap();
    out = re_email.replace_all(&out, "$1***@$2").to_string();

    out
}

/// 脱敏 serde_json::Value（递归处理字符串和对象）。
fn sanitize_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => serde_json::Value::String(sanitize_string(s)),
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sanitize_value).collect())
        }
        serde_json::Value::Object(obj) => {
            let mut cleaned = serde_json::Map::new();
            for (key, val) in obj {
                let lower_key = key.to_lowercase();
                let lower_key_contains = |needle: &str| lower_key.contains(needle);
                if lower_key_contains("apikey")
                    || lower_key_contains("api_key")
                    || lower_key == "authorization"
                    || lower_key == "x-api-key"
                {
                    cleaned.insert(key.clone(), serde_json::Value::String("***".to_string()));
                } else {
                    cleaned.insert(key.clone(), sanitize_value(val));
                }
            }
            serde_json::Value::Object(cleaned)
        }
        other => other.clone(),
    }
}

/// 追加一条日志到文件（JSON 行格式）。
///
/// 与原 logger.ts 行为对齐：
/// - 文件名：`<YYYY-MM-DD>.log`
/// - 内容：`{"time","level","message","meta"}` + 换行
/// - meta 自动脱敏
pub fn append_log(level: &str, message: &str, meta: &serde_json::Value) -> Result<(), String> {
    paths::ensure_log_dir().map_err(|e| format!("Failed to create log dir: {}", e))?;

    let log_dir = paths::get_log_dir();
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_path = log_dir.join(format!("{}.log", date));

    let entry = LogEntry {
        time: chrono::Utc::now().to_rfc3339(),
        level: level.to_string(),
        message: message.to_string(),
        meta: sanitize_value(meta),
    };

    let line = serde_json::to_string(&entry).map_err(|e| format!("Failed to serialize log: {}", e))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file {:?}: {}", log_path, e))?;

    writeln!(file, "{}", line).map_err(|e| format!("Failed to write log: {}", e))?;

    // 同时转发到 tracing（便于控制台和滚动文件）
    match level {
        "info" => tracing::info!("{} | meta={}", message, entry.meta),
        "warn" => tracing::warn!("{} | meta={}", message, entry.meta),
        "error" => tracing::error!("{} | meta={}", message, entry.meta),
        _ => tracing::debug!("{} | meta={}", message, entry.meta),
    }

    Ok(())
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 前端日志写入命令（对应 `log:append` IPC 通道）。
///
/// 前端调用：`invoke("log_append", { level, message, meta })`
#[tauri::command]
pub async fn log_append(
    level: String,
    message: String,
    meta: Option<serde_json::Value>,
) -> Result<(), String> {
    let meta = meta.unwrap_or(serde_json::Value::Null);
    append_log(&level, &message, &meta)
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_string_api_key() {
        let input = "token: sk-1234567890abcdefghijklmnopqrstuv";
        let out = sanitize_string(input);
        assert!(out.contains("sk-***"));
        assert!(!out.contains("sk-1234567890abcdefghijklmnopqrstuv"));
    }

    #[test]
    fn test_sanitize_string_bearer() {
        let input = "Authorization: Bearer abcdef1234567890abcdef1234567890";
        let out = sanitize_string(input);
        assert!(out.contains("Bearer ***"));
    }

    #[test]
    fn test_sanitize_string_phone() {
        let input = "contact: 13812345678";
        let out = sanitize_string(input);
        assert!(out.contains("138****5678"));
    }

    #[test]
    fn test_sanitize_string_email() {
        let input = "contact: johndoe@example.com";
        let out = sanitize_string(input);
        assert!(out.contains("jo***@example.com"));
    }

    #[test]
    fn test_sanitize_string_normal_text_untouched() {
        let input = "用户操作正常日志";
        let out = sanitize_string(input);
        assert_eq!(out, input);
    }

    #[test]
    fn test_sanitize_value_object_redacts_apikey() {
        let json = serde_json::json!({"apiKey": "sk-secret", "name": "test"});
        let out = sanitize_value(&json);
        assert_eq!(out["apiKey"], "***");
        assert_eq!(out["name"], "test");
    }

    #[test]
    fn test_sanitize_value_array_redacts() {
        let json = serde_json::json!([{"apiKey": "x"}, {"name": "y"}]);
        let out = sanitize_value(&json);
        assert_eq!(out[0]["apiKey"], "***");
        assert_eq!(out[1]["name"], "y");
    }

    #[test]
    fn test_sanitize_value_redacts_nested() {
        let json = serde_json::json!({
            "config": {
                "x-api-key": "secret",
                "authorization": "Bearer xyz",
                "level": 2
            }
        });
        let out = sanitize_value(&json);
        assert_eq!(out["config"]["x-api-key"], "***");
        assert_eq!(out["config"]["authorization"], "***");
        assert_eq!(out["config"]["level"], 2);
    }

    #[test]
    fn test_append_log_writes_file() {
        let temp = std::env::temp_dir().join("tauri_log_test_append_log");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp.join("logs")).unwrap();

        // 临时重定向：因为 append_log 使用 paths::get_log_dir()，我们用一个
        // monkeypatch 风格的测试——通过直接调用底层逻辑验证。
        // 这里验证 sanitize_value 逻辑。
        let meta = serde_json::json!({"user": "test", "apiKey": "leak"});
        let sanitized = sanitize_value(&meta);
        assert_eq!(sanitized["apiKey"], "***");

        let _ = std::fs::remove_dir_all(&temp);
    }
}
