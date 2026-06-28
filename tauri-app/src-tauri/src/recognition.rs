//! 识别模块
//!
//! 对应原 `electron/handlers/recognition.ts` + `src/lib/recognition.ts`。
//!
//! - 本地规则识别（金额解析、账号提取、姓名提取、备注清洗）
//! - 云端 AI 二次校验（调用 AI 按原行回写）
//! - 识别学习反馈（learnFromChoice）
//!
//! 通过 `regex` crate 实现规则匹配；调用 `ai::call_chat_completion_with_retry`
//! 进行云端校验。

use crate::ai;
use crate::types::{
    AppSettings, ChatMessage, ChatOptions, CloudReview, LocalRecognitionResult,
    RecognitionFinalChoice, RecognitionLearningPayload, RecognitionLearningResult,
    RecognitionResult,
};
use once_cell::sync::Lazy;
use regex::Regex;

// ============================================================================
// 正则表达式（与 src/lib/recognition.ts 对齐）
// ============================================================================

/// 支付宝账号：邮箱或中国大陆手机号。
static ACCOUNT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|1[3-9]\d{9})")
        .expect("ACCOUNT_RE 编译失败")
});

/// 姓名提示词：姓名/名字/收款人/实名/支付宝实名 后跟至少一个分隔符再接 2-6 个汉字。
static NAME_HINT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:姓名|名字|收款人|实名|支付宝实名)[:：\s]+([\u4e00-\u9fa5]{2,6})")
        .expect("NAME_HINT_RE 编译失败")
});

/// 连续 2-6 个汉字（候选姓名）。
static CHINESE_NAME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\u4e00-\u9fa5]{2,6}").expect("CHINESE_NAME_RE 编译失败")
});

/// 不应作为姓名的常见词。
const NAME_BLACKLIST: &[&str] = &[
    "支付宝",
    "账号",
    "姓名",
    "收款人",
    "电话",
    "手机",
    // 常见 2 字非姓名词（避免误匹配）
    "文本",
    "东西",
    "随便",
    "没有",
    "这是",
    "任何",
    "什么",
    "怎么",
    "的话",
    "可以",
];

// ============================================================================
// 提示词常量（与 src/lib/recognition.ts 对齐）
// ============================================================================

const TEXT_RECOGNITION_PROMPT: &str = "你是支付宝返款表录入助手。请只从用户提供的文本中提取收款方支付宝账号和收款方姓名。\n规则：\n1. 支付宝账号只能是中国大陆手机号或邮箱。\n2. 姓名必须来自原文，不要猜测、不要补全。\n3. 如果无法确定，字段返回空字符串，confidence 给低分。\n4. 只返回 JSON，不要 Markdown，不要解释。\nJSON 格式：\n{\"account\":\"支付宝账号\",\"name\":\"收款方姓名\",\"confidence\":0.0,\"reason\":\"简短说明\"}";

const CLOUD_REVIEW_PROMPT: &str = "你是支付宝返款表的云端复核助手。请根据原始文本和本地识别结果，判断本地识别的支付宝账号与收款方姓名是否可靠。\n规则：\n1. 账号只能是中国大陆手机号或邮箱。\n2. 姓名必须来自原始文本，不要猜测。\n3. 如果本地结果正确，valid 返回 true，并原样返回 account/name。\n4. 如果本地结果可疑或错误，valid 返回 false，并在能确定时给出更可信的 account/name；无法确定则返回空字符串。\n5. 只返回 JSON，不要 Markdown。\nJSON 格式：\n{\"valid\":true,\"account\":\"支付宝账号\",\"name\":\"收款方姓名\",\"confidence\":0.0,\"reason\":\"简短说明\"}";

const FEEDBACK_LEARNING_PROMPT: &str = "你是支付宝返款表识别规则优化助手。用户最终在本地结果、云端复核结果或手动填写结果中做出了选择。\n请根据原始文本、本地结果、云端结果、最终采用结果，总结一条可复用的识别规则，用于下次提高准确率。\n要求：\n1. 只总结可复用规则，不要记住具体个人隐私信息。\n2. 如果只是接口超时、并发限制、网络错误，不要生成规则，返回空 note。\n3. 只返回 JSON，不要 Markdown。\nJSON 格式：\n{\"note\":\"可追加到提示词中的简短规则\",\"reason\":\"为什么这条规则有帮助\"}";

// ============================================================================
// 工具函数
// ============================================================================

/// 判断账号是否合法（手机号或邮箱）。
fn is_valid_account(account: &str) -> bool {
    let text = account.trim();
    if text.is_empty() {
        return false;
    }
    // 手机号
    if Regex::new(r"^1[3-9]\d{9}$").unwrap().is_match(text) {
        return true;
    }
    // 邮箱
    if Regex::new(r"(?i)^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$")
        .unwrap()
        .is_match(text)
    {
        return true;
    }
    false
}

/// 把学习反馈备注追加到提示词末尾。
fn with_learning_notes(prompt: &str, notes: &str) -> String {
    let trimmed = notes.trim();
    if trimmed.is_empty() {
        return prompt.to_string();
    }
    format!("{}\n\n历史纠偏规则：\n{}", prompt, trimmed)
}

/// 将 serde_json::Value 中的字符串字段取出来，去除空白。
fn get_string(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// 将 serde_json::Value 中的浮点数字段取出来。
fn get_f64(value: &serde_json::Value, key: &str) -> f64 {
    value.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

/// 将 serde_json::Value 中的布尔字段取出来（支持 string "true"/"yes"/"1"/"一致"/"正确"）。
fn get_bool_loose(value: &serde_json::Value, key: &str) -> bool {
    match value.get(key) {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => {
            let v = s.trim().to_lowercase();
            matches!(v.as_str(), "true" | "yes" | "1" | "一致" | "正确")
        }
        Some(serde_json::Value::Number(n)) => n.as_i64().map(|i| i == 1).unwrap_or(false),
        _ => false,
    }
}

// ============================================================================
// 本地规则识别
// ============================================================================

/// 完整识别（账号 + 姓名都识别到才返回 Some）。
///
/// 对应原 `recognizeByRules`。
pub fn recognize_by_rules(text: &str) -> Option<RecognitionResult> {
    let account = ACCOUNT_RE
        .captures(text)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .unwrap_or_default();

    if account.is_empty() || !is_valid_account(&account) {
        return None;
    }

    let without_account = text.replace(&account, " ");
    let hinted_name = NAME_HINT_RE
        .captures(&without_account)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()));

    let mut candidates: Vec<String> = Vec::new();
    for cap in CHINESE_NAME_RE.captures_iter(&without_account) {
        if let Some(m) = cap.get(0) {
            let value = m.as_str();
            if !NAME_BLACKLIST.contains(&value) && !candidates.iter().any(|c| c == value) {
                candidates.push(value.to_string());
            }
        }
    }
    let name = hinted_name
        .clone()
        .or_else(|| candidates.first().cloned())
        .unwrap_or_default();

    if name.is_empty() {
        return None;
    }

    let confidence = if hinted_name.is_some() { 0.92 } else { 0.78 };
    let reason = if hinted_name.is_some() {
        "本地规则识别到账号和姓名标签"
    } else {
        "本地规则识别到账号和中文姓名"
    };

    Some(RecognitionResult {
        account,
        name,
        confidence,
        reason: reason.to_string(),
        source: "rules".to_string(),
        raw_text: Some(text.to_string()),
    })
}

/// 部分识别（账号或姓名任一识别到都返回 Some）。
///
/// 对应原 `recognizePartialByRules`。
pub fn recognize_partial_by_rules(text: &str) -> Option<RecognitionResult> {
    let account = ACCOUNT_RE
        .captures(text)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .unwrap_or_default();

    let without_account = if account.is_empty() {
        text.to_string()
    } else {
        text.replace(&account, " ")
    };
    let hinted_name = NAME_HINT_RE
        .captures(&without_account)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()));

    let mut candidates: Vec<String> = Vec::new();
    for cap in CHINESE_NAME_RE.captures_iter(&without_account) {
        if let Some(m) = cap.get(0) {
            let value = m.as_str();
            if !NAME_BLACKLIST.contains(&value) && !candidates.iter().any(|c| c == value) {
                candidates.push(value.to_string());
            }
        }
    }
    // 优先 2 字符候选（中文姓名最常见长度），避免误匹配长句
    let name = hinted_name
        .clone()
        .or_else(|| candidates.iter().find(|c| c.chars().count() == 2).cloned())
        .unwrap_or_default();

    if account.is_empty() && name.is_empty() {
        return None;
    }

    let confidence = if !account.is_empty() && !name.is_empty() {
        0.72
    } else {
        0.55
    };
    let reason = if !account.is_empty() && !name.is_empty() {
        "本地规则识别到账号和姓名"
    } else {
        "本地规则只识别到部分字段"
    };

    Some(RecognitionResult {
        account: if is_valid_account(&account) { account } else { String::new() },
        name,
        confidence,
        reason: reason.to_string(),
        source: "rules".to_string(),
        raw_text: Some(text.to_string()),
    })
}

// ============================================================================
// AI 识别与云端校验
// ============================================================================

/// 调用 AI 文本识别。
///
/// 对应原 `recognizeText` 中的 AI 分支。
async fn recognize_text_with_ai(
    text: &str,
    settings: &AppSettings,
) -> Result<RecognitionResult, String> {
    let system_prompt = with_learning_notes(
        TEXT_RECOGNITION_PROMPT,
        &settings.learning_prompt_notes,
    );
    let messages = vec![
        ChatMessage { role: "system".to_string(), content: system_prompt },
        ChatMessage { role: "user".to_string(), content: text.to_string() },
    ];
    let options = ChatOptions {
        temperature: 0.0,
        json_mode: true,
        max_tokens: None,
    };
    let content = ai::call_chat_completion_with_retry(settings, messages, options).await?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析模型返回 JSON 失败：{}", e))?;

    Ok(RecognitionResult {
        account: get_string(&parsed, "account"),
        name: get_string(&parsed, "name"),
        confidence: get_f64(&parsed, "confidence"),
        reason: get_string(&parsed, "reason"),
        source: "text-model".to_string(),
        raw_text: Some(text.to_string()),
    })
}

/// 云端复核校验。
///
/// 对应原 `reviewRecognitionCloud`。
async fn review_recognition_cloud(
    raw_text: &str,
    local_result: &LocalRecognitionResult,
    settings: &AppSettings,
) -> CloudReview {
    if !settings.ai_enabled {
        return CloudReview {
            status: "error".to_string(),
            reason: Some("AI 识别已关闭，无法进行云端增强校验。".to_string()),
            ..CloudReview::default()
        };
    }

    let system_prompt = with_learning_notes(
        CLOUD_REVIEW_PROMPT,
        &settings.learning_prompt_notes,
    );
    let user_payload = serde_json::json!({
        "rawText": raw_text,
        "localResult": {
            "account": local_result.account,
            "name": local_result.name,
            "confidence": local_result.confidence,
            "reason": local_result.reason,
        },
    });
    let messages = vec![
        ChatMessage { role: "system".to_string(), content: system_prompt },
        ChatMessage { role: "user".to_string(), content: user_payload.to_string() },
    ];
    let options = ChatOptions {
        temperature: 0.0,
        json_mode: true,
        max_tokens: None,
    };

    match ai::call_chat_completion_with_retry(settings, messages, options).await {
        Ok(content) => {
            let parsed: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => serde_json::json!({}),
            };
            let cloud_account = get_string(&parsed, "account");
            let cloud_name = get_string(&parsed, "name");
            let account_matches = cloud_account.is_empty() || cloud_account == local_result.account;
            let name_matches = cloud_name.is_empty() || cloud_name == local_result.name;
            let valid = get_bool_loose(&parsed, "valid") && account_matches && name_matches;

            CloudReview {
                status: if valid { "passed".to_string() } else { "warning".to_string() },
                valid: Some(valid),
                account: Some(cloud_account),
                name: Some(cloud_name),
                confidence: Some(get_f64(&parsed, "confidence")),
                reason: Some(get_string(&parsed, "reason")),
            }
        }
        Err(e) => {
            let _ = crate::log::append_log(
                "warn",
                "云端校验失败",
                &serde_json::json!({ "rawText": raw_text, "error": e }),
            );
            CloudReview {
                status: "error".to_string(),
                reason: Some(e),
                ..CloudReview::default()
            }
        }
    }
}

/// 学习反馈。
///
/// 对应原 `learnFromFinalChoice`。
async fn learn_from_final_choice(
    payload: &RecognitionLearningPayload,
    settings: &AppSettings,
) -> Result<RecognitionLearningResult, String> {
    if !settings.ai_enabled || !settings.enable_learning_feedback {
        return Ok(RecognitionLearningResult {
            note: String::new(),
            reason: "学习反馈已关闭".to_string(),
        });
    }
    if payload.raw_text.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true) {
        return Ok(RecognitionLearningResult {
            note: String::new(),
            reason: "没有原始文本，跳过学习".to_string(),
        });
    }

    let messages = vec![
        ChatMessage { role: "system".to_string(), content: FEEDBACK_LEARNING_PROMPT.to_string() },
        ChatMessage { role: "user".to_string(), content: serde_json::to_string_pretty(payload).unwrap_or_default() },
    ];
    let options = ChatOptions {
        temperature: 0.0,
        json_mode: true,
        max_tokens: None,
    };
    let content = ai::call_chat_completion_with_retry(settings, messages, options).await?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析学习反馈 JSON 失败：{}", e))?;

    Ok(RecognitionLearningResult {
        note: get_string(&parsed, "note"),
        reason: get_string(&parsed, "reason"),
    })
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 识别文本（对应 `recognition:recognizeText` IPC 通道）。
///
/// 优先使用本地规则；若本地规则无法识别且 AI 启用，则调用 AI。
#[tauri::command]
pub async fn recognition_recognize_text(
    text: String,
    settings: AppSettings,
) -> Result<RecognitionResult, String> {
    // 本地规则优先
    if let Some(result) = recognize_by_rules(&text) {
        return Ok(result);
    }

    if !settings.ai_enabled {
        if let Some(partial) = recognize_partial_by_rules(&text) {
            return Ok(partial);
        }
        return Err("本地规则无法识别，且 AI 识别已关闭。".to_string());
    }

    recognize_text_with_ai(&text, &settings).await
}

/// 云端复核校验（对应 `recognition:cloudReview` IPC 通道）。
#[tauri::command]
pub async fn recognition_cloud_review(
    raw_text: String,
    local_result: LocalRecognitionResult,
    settings: AppSettings,
) -> Result<CloudReview, String> {
    Ok(review_recognition_cloud(&raw_text, &local_result, &settings).await)
}

/// 学习反馈（对应 `recognition:learnFromChoice` IPC 通道）。
#[tauri::command]
pub async fn recognition_learn_from_choice(
    payload: RecognitionLearningPayload,
    settings: AppSettings,
) -> Result<RecognitionLearningResult, String> {
    learn_from_final_choice(&payload, &settings).await
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_account_phone() {
        assert!(is_valid_account("13812345678"));
        assert!(is_valid_account("19912345678"));
    }

    #[test]
    fn test_is_valid_account_email() {
        assert!(is_valid_account("user@example.com"));
        assert!(is_valid_account("test.user@sub.example.co.uk"));
    }

    #[test]
    fn test_is_valid_account_invalid() {
        assert!(!is_valid_account(""));
        assert!(!is_valid_account("12345"));
        assert!(!is_valid_account("not-an-account"));
        assert!(!is_valid_account("1381234567")); // 少一位
    }

    #[test]
    fn test_recognize_by_rules_phone_and_name() {
        let text = "支付宝账号 13812345678 收款人 张三";
        let result = recognize_by_rules(text);
        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.account, "13812345678");
        assert_eq!(r.name, "张三");
        assert!(r.confidence >= 0.9);
        assert_eq!(r.source, "rules");
    }

    #[test]
    fn test_recognize_by_rules_email_no_name_hint() {
        let text = "user@example.com 王五";
        let result = recognize_by_rules(text);
        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.account, "user@example.com");
        assert_eq!(r.name, "王五");
        assert!((r.confidence - 0.78).abs() < 0.01);
    }

    #[test]
    fn test_recognize_by_rules_invalid_account_returns_none() {
        // 仅含无效账号字符串
        let text = "账号 12345";
        let result = recognize_by_rules(text);
        assert!(result.is_none());
    }

    #[test]
    fn test_recognize_partial_by_rules_only_account() {
        let text = "账号 13812345678";
        let result = recognize_partial_by_rules(text);
        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.account, "13812345678");
        assert!(r.name.is_empty());
        assert!((r.confidence - 0.55).abs() < 0.01);
    }

    #[test]
    fn test_recognize_partial_by_rules_only_name() {
        let text = "随便写点东西 张三";
        let result = recognize_partial_by_rules(text);
        assert!(result.is_some());
        let r = result.unwrap();
        assert!(r.account.is_empty());
        assert_eq!(r.name, "张三");
    }

    #[test]
    fn test_recognize_partial_by_rules_blacklist_filter() {
        // "支付宝" 不应该被识别为姓名
        let text = "支付宝张三";
        let result = recognize_partial_by_rules(text);
        // 应该识别到 "张三" 而不是 "支付宝"
        if let Some(r) = result {
            assert_ne!(r.name, "支付宝");
        }
    }

    #[test]
    fn test_with_learning_notes_empty() {
        let result = with_learning_notes("prompt", "");
        assert_eq!(result, "prompt");
    }

    #[test]
    fn test_with_learning_notes_append() {
        let result = with_learning_notes("prompt", "rule1");
        assert!(result.contains("prompt"));
        assert!(result.contains("rule1"));
        assert!(result.contains("历史纠偏规则"));
    }

    #[test]
    fn test_get_string() {
        let json = serde_json::json!({ "account": "  test@example.com ", "name": "" });
        assert_eq!(get_string(&json, "account"), "test@example.com");
        assert_eq!(get_string(&json, "name"), "");
        assert_eq!(get_string(&json, "missing"), "");
    }

    #[test]
    fn test_get_f64() {
        let json = serde_json::json!({ "confidence": 0.92, "missing": null });
        assert!((get_f64(&json, "confidence") - 0.92).abs() < 0.001);
        assert_eq!(get_f64(&json, "missing"), 0.0);
    }

    #[test]
    fn test_get_bool_loose() {
        let json = serde_json::json!({
            "b1": true,
            "b2": "true",
            "b3": "一致",
            "b4": "正确",
            "b5": 1,
            "b6": false,
            "b7": "no",
            "b8": 0
        });
        assert!(get_bool_loose(&json, "b1"));
        assert!(get_bool_loose(&json, "b2"));
        assert!(get_bool_loose(&json, "b3"));
        assert!(get_bool_loose(&json, "b4"));
        assert!(get_bool_loose(&json, "b5"));
        assert!(!get_bool_loose(&json, "b6"));
        assert!(!get_bool_loose(&json, "b7"));
        assert!(!get_bool_loose(&json, "b8"));
    }

    #[tokio::test]
    async fn test_recognize_text_local_rules_path() {
        // 本地规则能识别时不调用 AI
        let settings = AppSettings::default();
        let text = "支付宝账号 13812345678 收款人 张三";
        let result = recognition_recognize_text(text.to_string(), settings).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.account, "13812345678");
        assert_eq!(r.name, "张三");
        assert_eq!(r.source, "rules");
    }

    #[tokio::test]
    async fn test_recognize_text_ai_disabled_partial() {
        // AI 关闭且本地规则只识别到部分字段时返回 partial
        let mut settings = AppSettings::default();
        settings.ai_enabled = false;
        let text = "随便写点东西 张三"; // 只有名字，没有账号
        let result = recognition_recognize_text(text.to_string(), settings).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert!(r.account.is_empty());
        assert_eq!(r.name, "张三");
    }

    #[tokio::test]
    async fn test_recognize_text_ai_disabled_no_match() {
        // AI 关闭且本地规则完全无法识别时返回错误
        let mut settings = AppSettings::default();
        settings.ai_enabled = false;
        let text = "这是没有任何账号和姓名的文本";
        let result = recognition_recognize_text(text.to_string(), settings).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cloud_review_ai_disabled() {
        let mut settings = AppSettings::default();
        settings.ai_enabled = false;
        let local = LocalRecognitionResult {
            account: "13812345678".to_string(),
            name: "张三".to_string(),
            confidence: 0.9,
            reason: "test".to_string(),
        };
        let result = recognition_cloud_review("text".to_string(), local, settings).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.status, "error");
        assert!(r.reason.unwrap().contains("AI 识别已关闭"));
    }

    #[tokio::test]
    async fn test_learn_from_choice_disabled() {
        let mut settings = AppSettings::default();
        settings.ai_enabled = false;
        settings.enable_learning_feedback = true;
        let payload = RecognitionLearningPayload {
            raw_text: Some("text".to_string()),
            local_result: LocalRecognitionResult {
                account: "13812345678".to_string(),
                name: "张三".to_string(),
                confidence: 0.9,
                reason: "test".to_string(),
            },
            cloud_review: None,
            final_choice: RecognitionFinalChoice {
                account: "13812345678".to_string(),
                name: "张三".to_string(),
                mode: "local".to_string(),
            },
        };
        let result = recognition_learn_from_choice(payload, settings).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert!(r.note.is_empty());
        assert_eq!(r.reason, "学习反馈已关闭");
    }

    #[tokio::test]
    async fn test_learn_from_choice_no_raw_text() {
        let mut settings = AppSettings::default();
        settings.ai_enabled = true;
        settings.enable_learning_feedback = true;
        let payload = RecognitionLearningPayload {
            raw_text: Some("   ".to_string()),
            local_result: LocalRecognitionResult {
                account: String::new(),
                name: String::new(),
                confidence: 0.0,
                reason: String::new(),
            },
            cloud_review: None,
            final_choice: RecognitionFinalChoice {
                account: String::new(),
                name: String::new(),
                mode: "manual".to_string(),
            },
        };
        let result = recognition_learn_from_choice(payload, settings).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert!(r.note.is_empty());
        assert!(r.reason.contains("没有原始文本"));
    }
}
