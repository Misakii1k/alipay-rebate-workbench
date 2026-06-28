//! 标题优化模块（占位/代理层）
//!
//! 对应原 `electron/handlers/title.ts`（不存在）+ `src/lib/titleOptimizer.ts`。
//!
//! **重要说明**：标题优化的核心算法（词序搜索、覆盖感知填充、目标词桥接奖励）
//! 仍在前端 `titleOptimizer.ts` 中实现。本模块仅作为后端代理层，提供：
//! - 简单的标题评分（长度、关键词命中、第三方品牌检测）
//! - 可选的 AI 标题生成（调用 OpenAI 兼容接口）
//!
//! 简化点（与原前端 titleOptimizer.ts 的差异）：
//! - 不实现 GBK 字节长度计算（用 UTF-8 字节长度近似）
//! - 不实现词序局部搜索算法（由前端完成）
//! - 不读取 Excel 表格数据（由前端调用方提供文本）
//! - 不实现完整的关键词分类（季节、补充词、通用填充词等）

use crate::ai;
use crate::security::validate_api_url;
use crate::types::{
    AppSettings, TitleAnalyzeRequest, TitleAnalyzeResult, TitleCandidate, TitleGenerateRequest,
};
use crate::types::{ChatMessage, ChatOptions};
use once_cell::sync::Lazy;
use regex::Regex;

// ============================================================================
// 常量（与原 titleOptimizer.ts 对齐）
// ============================================================================

/// 标题前缀（"帛先生"）。
const TITLE_PREFIX: &str = "帛先生";

/// 标题正文目标 GBK 字节数（54，对应原版）。
/// 简化：用 UTF-8 字节长度近似。
const TITLE_BODY_TARGET_BYTES: usize = 54;

/// 标题总目标 GBK 字节数（60）。
const TITLE_TOTAL_TARGET_BYTES: usize = 60;

/// 第三方品牌黑名单（出现则扣分）。
const THIRD_PARTY_BRANDS: &[&str] = &[
    "海澜之家",
    "优衣库",
    "李维斯",
    "耐克",
    "阿迪达斯",
    "斐乐",
    "森马",
    "美特斯邦威",
    "太平鸟",
    "安踏",
    "李宁",
    "特步",
    "361",
    "班尼路",
    "龙牙",
    "美拉德",
    "增致",
    "官方旗舰店",
    "旗舰店",
    "专柜",
    "大牌",
    "品牌",
    "国际一线",
    "gxg",
    "fila",
    "nike",
    "adidas",
    "uniqlo",
    "levi",
];

/// 季节关键词。
const SEASONS: &[&str] = &[
    "春季", "夏季", "秋季", "冬季", "春秋", "四季", "早春", "初秋", "春夏", "秋冬",
];

/// 补充词。
const SUPPLEMENT_WORDS: &[&str] = &[
    "薄款", "垂感", "凉感", "2026新款", "运动", "宽松", "阔腿",
];

/// 通用填充词。
const GENERIC_FILLERS: &[&str] = &[
    "百搭", "通勤", "潮流", "高级感", "小个子", "不挑人", "舒适", "显瘦", "松紧腰", "大码",
    "商务", "休闲",
];

// ============================================================================
// 工具函数
// ============================================================================

/// 计算 UTF-8 字节长度（近似 GBK 字节长度）。
///
/// **简化说明**：原版使用 GBK 编码计算字节数（中文字符 2 字节）。
/// 这里使用 UTF-8 字节长度（中文字符 3 字节）作为近似。
/// 调用方应明确这一点，建议在前端做最终校验。
fn byte_length(text: &str) -> usize {
    text.len()
}

/// 规范化标题文本（去首尾空白、压缩多余空格）。
fn normalize_title_text(text: &str) -> String {
    let re_ws = Lazy::new(|| Regex::new(r"\s+").unwrap());
    re_ws.replace_all(text.trim(), " ").to_string()
}

/// 消毒关键词（去除特殊字符，限制长度）。
fn sanitize_title_keyword(keyword: &str) -> String {
    let re = Lazy::new(|| Regex::new(r"[^\w\u4e00-\u9fa5\s\-]").unwrap());
    let cleaned = re.replace_all(keyword, "").to_string();
    cleaned.trim().chars().take(40).collect()
}

/// 检测是否包含第三方品牌。
fn contains_third_party_brand(text: &str) -> bool {
    let lower = text.to_lowercase();
    for brand in THIRD_PARTY_BRANDS {
        if lower.contains(&brand.to_lowercase()) {
            return true;
        }
    }
    false
}

/// 检测是否包含季节关键词。
fn contains_season(text: &str) -> bool {
    SEASONS.iter().any(|s| text.contains(s))
}

/// 检测是否包含补充词。
fn contains_supplement(text: &str) -> bool {
    SUPPLEMENT_WORDS.iter().any(|s| text.contains(s))
}

/// 检测是否包含通用填充词。
fn contains_filler(text: &str) -> bool {
    GENERIC_FILLERS.iter().any(|s| text.contains(s))
}

// ============================================================================
// 评分逻辑
// ============================================================================

/// 评分单个标题候选。
///
/// 评分维度：
/// - 长度合规（接近目标字节数）
/// - 关键词覆盖（季节、补充词、填充词）
/// - 不包含第三方品牌
/// - 包含前缀
pub fn score_title_candidate(text: &str) -> f64 {
    let normalized = normalize_title_text(text);
    if normalized.is_empty() {
        return 0.0;
    }

    let mut score: f64 = 0.0;

    // 长度评分（满分 30）
    let body_bytes = byte_length(&normalized);
    let length_diff = (body_bytes as i64 - TITLE_BODY_TARGET_BYTES as i64).unsigned_abs() as f64;
    let length_score = (30.0 - length_diff).max(0.0);
    score += length_score;

    // 关键词覆盖（每个维度 15 分）
    if contains_season(&normalized) {
        score += 15.0;
    }
    if contains_supplement(&normalized) {
        score += 15.0;
    }
    if contains_filler(&normalized) {
        score += 10.0;
    }

    // 前缀（10 分）
    if normalized.starts_with(TITLE_PREFIX) {
        score += 10.0;
    }

    // 第三方品牌扣分（-30）
    if contains_third_party_brand(&normalized) {
        score -= 30.0;
    }

    score.max(0.0).min(100.0)
}

/// 分析标题并返回评分 + 建议。
pub fn analyze_title_score(text: &str) -> TitleAnalyzeResult {
    let normalized = normalize_title_text(text);
    let score = score_title_candidate(&normalized);
    let mut suggestions: Vec<String> = Vec::new();

    if normalized.is_empty() {
        suggestions.push("标题不能为空".to_string());
        return TitleAnalyzeResult { score: 0.0, suggestions };
    }

    // 长度建议
    let body_bytes = byte_length(&normalized);
    if body_bytes < TITLE_BODY_TARGET_BYTES - 10 {
        suggestions.push(format!(
            "标题字节数偏少（{}，建议接近 {}）",
            body_bytes, TITLE_BODY_TARGET_BYTES
        ));
    } else if body_bytes > TITLE_TOTAL_TARGET_BYTES {
        suggestions.push(format!(
            "标题字节数偏多（{}，建议不超过 {}）",
            body_bytes, TITLE_TOTAL_TARGET_BYTES
        ));
    }

    // 关键词建议
    if !contains_season(&normalized) {
        suggestions.push("建议添加季节关键词（如：夏季、春秋）".to_string());
    }
    if !contains_supplement(&normalized) {
        suggestions.push("建议添加补充词（如：薄款、凉感）".to_string());
    }
    if !contains_filler(&normalized) {
        suggestions.push("建议添加通用填充词（如：百搭、通勤）".to_string());
    }

    // 前缀建议
    if !normalized.starts_with(TITLE_PREFIX) {
        suggestions.push(format!("建议以「{}」作为前缀", TITLE_PREFIX));
    }

    // 第三方品牌警告
    if contains_third_party_brand(&normalized) {
        suggestions.push("⚠️ 检测到第三方品牌词，建议移除".to_string());
    }

    TitleAnalyzeResult { score, suggestions }
}

// ============================================================================
// AI 标题生成
// ============================================================================

/// AI 提示词常量。
const TITLE_GENERATE_PROMPT: &str = "你是电商标题优化专家，擅长为淘宝/天猫商品生成高点击率标题。\n要求：\n1. 标题以「帛先生」开头\n2. 包含季节、补充词、通用填充词等关键词\n3. 总长度控制在 30 个汉字以内\n4. 不包含第三方品牌词（如海澜之家、优衣库等）\n5. 只返回 JSON，不要 Markdown\nJSON 格式：\n{\"candidates\":[{\"title\":\"标题1\",\"score\":85.0,\"reason\":\"简短说明\"}]}";

/// 调用 AI 生成标题候选。
///
/// 简化实现：仅支持 OpenAI 兼容接口。
pub async fn generate_title_candidates(
    text: &str,
    settings: &AppSettings,
    count: u32,
) -> Result<Vec<TitleCandidate>, String> {
    if !settings.ai_enabled {
        return Err("AI 识别已关闭，无法生成标题。".to_string());
    }

    let profile = ai::get_active_api_profile(settings);
    validate_api_url(&profile.api_base_url)?;

    if profile.api_key.trim().is_empty() {
        return Err("未配置 API Key。".to_string());
    }

    let count = count.clamp(1, 10);
    let sanitized_text = sanitize_title_keyword(text);
    let user_prompt = format!(
        "请基于以下关键词生成 {} 个标题候选：\n{}\n\n每个候选包含 title（标题文本）、score（0-100 评分）、reason（简短说明）。",
        count, sanitized_text
    );

    let messages = vec![
        ChatMessage { role: "system".to_string(), content: TITLE_GENERATE_PROMPT.to_string() },
        ChatMessage { role: "user".to_string(), content: user_prompt },
    ];
    let options = ChatOptions {
        temperature: 0.7,
        json_mode: true,
        max_tokens: None,
    };

    let content = ai::call_chat_completion_with_retry(settings, messages, options).await?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析 AI 返回 JSON 失败：{}", e))?;

    let candidates = parsed
        .get("candidates")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .take(count as usize)
                .filter_map(|item| {
                    let title = item
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    if title.is_empty() {
                        return None;
                    }
                    let score = item
                        .get("score")
                        .and_then(|s| s.as_f64())
                        .unwrap_or_else(|| score_title_candidate(&title));
                    let reason = item
                        .get("reason")
                        .and_then(|r| r.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(TitleCandidate { title, score, reason })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(candidates)
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 标题分析（对应 `title:analyze` IPC 通道）。
#[tauri::command]
pub async fn title_analyze(request: TitleAnalyzeRequest) -> Result<TitleAnalyzeResult, String> {
    Ok(analyze_title_score(&request.text))
}

/// 标题生成（对应 `title:generate` IPC 通道）。
#[tauri::command]
pub async fn title_generate(
    request: TitleGenerateRequest,
) -> Result<Vec<TitleCandidate>, String> {
    let settings = match request.settings {
        Some(s) => s,
        None => AppSettings::default(),
    };
    let count = request.count.unwrap_or(5);
    generate_title_candidates(&request.text, &settings, count).await
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_byte_length_ascii() {
        assert_eq!(byte_length("hello"), 5);
    }

    #[test]
    fn test_byte_length_chinese() {
        // UTF-8 中每个汉字 3 字节
        assert_eq!(byte_length("帛先生"), 9);
    }

    #[test]
    fn test_normalize_title_text_compress_whitespace() {
        assert_eq!(normalize_title_text("  hello   world  "), "hello world");
    }

    #[test]
    fn test_normalize_title_text_empty() {
        assert_eq!(normalize_title_text("   "), "");
    }

    #[test]
    fn test_sanitize_title_keyword_removes_special() {
        let result = sanitize_title_keyword("hello@world#");
        assert!(!result.contains('@'));
        assert!(!result.contains('#'));
        assert!(result.contains("hello"));
        assert!(result.contains("world"));
    }

    #[test]
    fn test_sanitize_title_keyword_keeps_chinese() {
        let result = sanitize_title_keyword("帛先生-夏季");
        assert!(result.contains("帛先生"));
        assert!(result.contains("夏季"));
        assert!(result.contains("-"));
    }

    #[test]
    fn test_contains_third_party_brand_present() {
        assert!(contains_third_party_brand("海澜之家男裤"));
        assert!(contains_third_party_brand("UNIQLO裤子"));
        assert!(contains_third_party_brand("nike运动裤"));
    }

    #[test]
    fn test_contains_third_party_brand_absent() {
        assert!(!contains_third_party_brand("帛先生夏季薄款男裤"));
    }

    #[test]
    fn test_contains_season() {
        assert!(contains_season("夏季薄款男裤"));
        assert!(contains_season("春秋款"));
        assert!(!contains_season("帛先生男裤"));
    }

    #[test]
    fn test_contains_supplement() {
        assert!(contains_supplement("薄款凉感男裤"));
        assert!(!contains_supplement("帛先生男裤"));
    }

    #[test]
    fn test_contains_filler() {
        assert!(contains_filler("百搭通勤男裤"));
        assert!(!contains_filler("帛先生男裤"));
    }

    #[test]
    fn test_score_title_candidate_empty() {
        assert_eq!(score_title_candidate(""), 0.0);
        assert_eq!(score_title_candidate("   "), 0.0);
    }

    #[test]
    fn test_score_title_candidate_with_prefix() {
        let with_prefix = score_title_candidate("帛先生夏季薄款百搭男裤");
        let without_prefix = score_title_candidate("夏季薄款百搭男裤");
        assert!(with_prefix > without_prefix);
    }

    #[test]
    fn test_score_title_candidate_with_brand_penalty() {
        let without_brand = score_title_candidate("帛先生夏季薄款百搭男裤");
        let with_brand = score_title_candidate("帛先生海澜之家夏季薄款男裤");
        assert!(without_brand > with_brand);
    }

    #[test]
    fn test_score_title_candidate_in_range() {
        let score = score_title_candidate("帛先生夏季薄款百搭男裤");
        assert!(score >= 0.0 && score <= 100.0);
    }

    #[test]
    fn test_analyze_title_score_empty() {
        let result = analyze_title_score("");
        assert_eq!(result.score, 0.0);
        assert!(result.suggestions.iter().any(|s| s.contains("不能为空")));
    }

    #[test]
    fn test_analyze_title_score_good_title() {
        let result = analyze_title_score("帛先生夏季薄款百搭男裤");
        assert!(result.score > 50.0);
    }

    #[test]
    fn test_analyze_title_score_brand_warning() {
        let result = analyze_title_score("帛先生海澜之家男裤");
        assert!(result.suggestions.iter().any(|s| s.contains("第三方品牌")));
    }

    #[test]
    fn test_analyze_title_score_missing_prefix() {
        let result = analyze_title_score("夏季薄款百搭男裤");
        assert!(result.suggestions.iter().any(|s| s.contains("前缀")));
    }

    #[test]
    fn test_analyze_title_score_missing_keywords() {
        let result = analyze_title_score("帛先生男裤");
        assert!(result.suggestions.iter().any(|s| s.contains("季节")));
        assert!(result.suggestions.iter().any(|s| s.contains("补充词")));
    }

    #[tokio::test]
    async fn test_title_analyze_command() {
        let request = TitleAnalyzeRequest {
            text: "帛先生夏季薄款百搭男裤".to_string(),
            settings: None,
        };
        let result = title_analyze(request).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert!(r.score > 0.0);
    }

    #[tokio::test]
    async fn test_title_generate_ai_disabled() {
        let mut settings = AppSettings::default();
        settings.ai_enabled = false;
        let request = TitleGenerateRequest {
            text: "夏季 男裤".to_string(),
            settings: Some(settings),
            count: Some(3),
        };
        let result = title_generate(request).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("AI 识别已关闭"));
    }

    #[tokio::test]
    async fn test_title_generate_no_api_key() {
        let mut settings = AppSettings::default();
        settings.ai_enabled = true;
        settings.api_key = String::new();
        for p in settings.api_profiles.iter_mut() {
            p.api_key = String::new();
        }
        let request = TitleGenerateRequest {
            text: "夏季 男裤".to_string(),
            settings: Some(settings),
            count: Some(3),
        };
        let result = title_generate(request).await;
        assert!(result.is_err());
    }
}
