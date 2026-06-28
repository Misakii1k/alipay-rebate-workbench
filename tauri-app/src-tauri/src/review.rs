//! 收评助手模块
//!
//! 对应原 `electron/handlers/review.ts`。
//!
//! - 资产扫描：在 reviewRootDir 下递归扫描图片，按 query 评分排序
//! - 缩略图加载：批量生成缩略图（base64 data URL）
//! - 文件夹子项加载：列出文件夹下的图片
//! - 索引重建：清空索引缓存并重新扫描
//! - AI 文案生成：调用 OpenAI/Anthropic 生成买家好评
//! - AI 对话：基于历史消息的收评助手对话
//!
//! 简化说明：原版使用 Worker 子线程执行扫描，这里在主线程异步遍历；
//! 原版磁盘索引缓存（review-index-*.json）这里也省略，每次扫描实时遍历。
//! 这两点差异在文档中明确标注。

use crate::ai;
use crate::everything;
use crate::media;
use crate::security::{is_path_inside_root, validate_path_safety};
use crate::types::{
    AppSettings, ReviewChatPayload, ReviewChatResult, ReviewGenerationOptions,
    ReviewGenerationResult, ReviewSearchResult,
};
use base64::Engine;
use rayon::prelude::*;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 收评助手扫描的图片扩展名。
const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".webp", ".bmp"];

/// 单次扫描最大文件数（与原版一致）。
const MAX_SCAN_ITEMS: usize = 50_000;

/// 单次返回最大结果数。
const MAX_RESULTS: usize = 500;

/// 单次缩略图加载最大数量。
const MAX_THUMBNAIL_BATCH: usize = 64;

// ============================================================================
// 工具函数
// ============================================================================

/// 判断路径扩展名是否为收评助手支持的图片。
fn is_review_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .map(|ext| IMAGE_EXTS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// 把字符串规范化为可比较的形式（小写、去空白和分隔符）。
fn normalize_match_text(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    let mut out = String::with_capacity(lower.len());
    for c in lower.chars() {
        match c {
            ' ' | '\t' | '\n' | '\r' | '_' | '-' | '.' | '(' | ')' | '（' | '）' | '[' | ']'
            | '【' | '】' | '·' | ',' | '，' => continue,
            _ => out.push(c),
        }
    }
    out
}

/// 计算两个字符串的字符集重叠率。
fn token_overlap(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let a_chars: HashSet<char> = a.chars().collect();
    let b_chars: HashSet<char> = b.chars().collect();
    if a_chars.is_empty() {
        return 0.0;
    }
    let hits = a_chars.intersection(&b_chars).count();
    hits as f64 / a_chars.len() as f64
}

/// 把查询词拆分为多个匹配词。
fn build_match_terms(value: &str) -> Vec<String> {
    let normalized = normalize_match_text(value);
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut terms: Vec<String> = vec![normalized.clone()];

    // 按空白/分隔符拆分
    let chunks: Vec<String> = value
        .to_lowercase()
        .split(|c: char| c.is_whitespace() || matches!(c, '_' | '-' | '—' | '–' | '(' | ')' | '（' | '）' | '[' | ']' | '【' | '】' | '.' | '·' | ',' | '，' | '。'))
        .map(normalize_match_text)
        .filter(|s| !s.is_empty())
        .collect();
    for chunk in chunks {
        if !terms.contains(&chunk) {
            terms.push(chunk);
        }
    }

    // 数字词
    let re = regex::Regex::new(r"[a-z]*\d+[a-z]*").unwrap();
    for cap in re.captures_iter(&normalized) {
        if let Some(m) = cap.get(0) {
            let term = m.as_str().to_string();
            if term.len() >= 2 && !terms.contains(&term) {
                terms.push(term);
            }
        }
    }

    // 保留长度 >= 2 的项
    terms.into_iter().filter(|t| t.len() >= 2).collect()
}

/// 评分单个候选文件。
fn score_candidate(root: &Path, file_path: &Path, terms: &[String]) -> ReviewSearchResult {
    let relative = file_path
        .strip_prefix(root)
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|_| PathBuf::from(file_path));
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let path_str = file_path.to_string_lossy().to_string();

    let file_text = normalize_match_text(&file_name);
    let path_text = normalize_match_text(&relative.to_string_lossy());
    let folder_text = relative
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let folder_norm = normalize_match_text(&folder_text);

    let mut score: i64 = 0;
    let mut reasons: Vec<String> = Vec::new();

    for term in terms {
        if term.is_empty() {
            continue;
        }
        if file_text.contains(term) {
            score += if term.chars().any(|c| c.is_ascii_digit()) { 28 } else { 24 };
            reasons.push(format!("文件名命中 {}", term));
        } else if folder_norm.contains(term) {
            score += if term.chars().any(|c| c.is_ascii_digit()) { 24 } else { 20 };
            reasons.push(format!("文件夹命中 {}", term));
        } else if path_text.contains(term) {
            score += 12;
            reasons.push(format!("路径命中 {}", term));
        } else {
            let overlap = token_overlap(term, &path_text);
            if overlap > 0.45 {
                score += (overlap * 16.0).round() as i64;
            }
        }
    }

    // 深度加分（越浅越好）
    let depth = relative
        .components()
        .count()
        .saturating_sub(1) as i64;
    score += (10 - depth).max(0);

    let result = ReviewSearchResult {
        path: path_str,
        name: file_name.clone(),
        kind: "image".to_string(),
        score: score as f64,
        reason: reasons.iter().take(3).cloned().collect::<Vec<_>>().join("；"),
        mtime_ms: std::fs::metadata(file_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0),
        thumbnail_data_url: None,
        child_count: None,
        cover_path: None,
        children_loaded: None,
        children: None,
    };
    result
}

/// 递归扫描目录下的所有图片。
fn walk_for_images(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if results.len() >= MAX_SCAN_ITEMS {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if results.len() >= MAX_SCAN_ITEMS {
                break;
            }
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && is_review_image(&path) {
                results.push(path);
            }
        }
    }
    results
}

// ============================================================================
// 主功能
// ============================================================================

/// 扫描收评素材库。
///
/// 对应原 `scanReviewAssets`。简化实现：
/// - 不使用 Worker 子线程（原版使用 worker_threads）
/// - 不使用磁盘索引缓存（原版缓存到 userData/review-index-*.json）
/// - 不发送扫描进度事件（前端可降级显示进度环）
pub fn scan_review_assets(
    root: &str,
    query: &str,
    settings: &AppSettings,
) -> Result<Vec<ReviewSearchResult>, String> {
    if root.trim().is_empty() {
        return Err("请先选择收评助手根目录。".to_string());
    }
    if !Path::new(root).exists() {
        return Err("请先选择收评助手根目录。".to_string());
    }
    validate_path_safety(root, None)?;

    // 验证 root 与 settings.reviewRootDir 一致
    let saved_root = settings.review_root_dir.trim();
    if !saved_root.is_empty() {
        let a = PathBuf::from(root).canonicalize().unwrap_or_default();
        let b = PathBuf::from(saved_root).canonicalize().unwrap_or_default();
        if a != b {
            return Err("Review root does not match saved settings.".to_string());
        }
    }

    let root_path = PathBuf::from(root);
    let terms = build_match_terms(query);

    // 优先用 Everything 搜索（如果可用）
    let es_path = everything::resolve_everything_es_path(settings);
    let mut candidates: Vec<ReviewSearchResult> = if !es_path.is_empty() {
        let exts: HashSet<String> = IMAGE_EXTS.iter().map(|e| e.to_string()).collect();
        let found_paths = everything::search_with_everything(&es_path, root, query, &exts, MAX_RESULTS);
        found_paths
            .par_iter()
            .map(|p| score_candidate(&root_path, Path::new(p), &terms))
            .collect()
    } else {
        // 退化方案：扫描整个目录树
        let all_files = walk_for_images(&root_path);
        all_files
            .par_iter()
            .map(|p| score_candidate(&root_path, p, &terms))
            .collect()
    };

    // 过滤零分项（如果有 query）；query 为空时全部保留
    if !terms.is_empty() {
        candidates.retain(|c| c.score > 0.0);
    }

    // 按分数降序、mtime 降序排序
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.mtime_ms
                    .partial_cmp(&a.mtime_ms)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    candidates.truncate(MAX_RESULTS);
    Ok(candidates)
}

/// 加载缩略图（默认尺寸 280）。
pub fn load_review_thumbnails(paths: &[String]) -> std::collections::HashMap<String, String> {
    load_review_thumbnail_batch(paths, 280, None, MAX_THUMBNAIL_BATCH)
}

/// 批量加载缩略图。
///
/// 参数：
/// - `paths`: 图片路径列表
/// - `size`: 最大边长
/// - `root`: 可选的根目录，用于安全校验
/// - `max_count`: 最大处理数量
pub fn load_review_thumbnail_batch(
    paths: &[String],
    size: usize,
    root: Option<&str>,
    max_count: usize,
) -> std::collections::HashMap<String, String> {
    let mut result = std::collections::HashMap::new();
    let size = if size == 0 { 220 } else { size };
    let max_count = if max_count == 0 { MAX_THUMBNAIL_BATCH } else { max_count };

    for path_str in paths.iter().take(max_count) {
        if path_str.is_empty() || !Path::new(path_str).exists() {
            continue;
        }
        // 安全校验
        if let Some(r) = root {
            if !r.is_empty() && !is_path_inside_root(path_str, r) {
                continue;
            }
        }
        if !is_review_image(Path::new(path_str)) {
            continue;
        }

        let path = Path::new(path_str);
        let thumbnail = match media::generate_thumbnail(path, size as u32) {
            Some(bytes) => bytes,
            None => continue,
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&thumbnail);
        let mime = if path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() == Some("jpg")
            || path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() == Some("jpeg")
        {
            "image/jpeg"
        } else {
            "image/png"
        };
        result.insert(path_str.clone(), format!("data:{};base64,{}", mime, b64));
    }
    result
}

/// 加载文件夹下的子项（图片）。
pub fn load_review_folder_children(
    root: &str,
    folder_path: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<ReviewSearchResult>, String> {
    if root.trim().is_empty() {
        return Err("请先选择收评助手根目录。".to_string());
    }
    if folder_path.trim().is_empty() || !Path::new(folder_path).exists() {
        return Err("文件夹不存在。".to_string());
    }
    validate_path_safety(root, None)?;
    validate_path_safety(folder_path, Some(&[root]))?;
    if !is_path_inside_root(folder_path, root) {
        return Err("文件夹不在已授权的收评根目录内。".to_string());
    }

    let root_path = PathBuf::from(root);
    let folder = PathBuf::from(folder_path);
    let offset = if offset == 0 { 0 } else { offset };
    let limit = if limit == 0 { 200 } else { limit.min(500) };

    let entries = std::fs::read_dir(&folder).map_err(|e| format!("读取目录失败：{}", e))?;
    let mut all_files: Vec<PathBuf> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if is_review_image(&path) {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // 按 mtime 降序排序
    all_files.sort_by(|a, b| {
        let ma = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let mb = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        mb.cmp(&ma)
    });

    let total = all_files.len();
    let end = (offset + limit).min(total);
    let files: Vec<PathBuf> = if offset < total {
        all_files[offset..end].to_vec()
    } else {
        Vec::new()
    };

    let results: Vec<ReviewSearchResult> = files
        .iter()
        .map(|p| {
            let relative = p.strip_prefix(&root_path).unwrap_or(p);
            let file_name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            ReviewSearchResult {
                path: p.to_string_lossy().to_string(),
                name: file_name,
                kind: "image".to_string(),
                score: 0.0,
                reason: String::new(),
                mtime_ms: std::fs::metadata(p)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64() * 1000.0),
                thumbnail_data_url: None,
                child_count: None,
                cover_path: None,
                children_loaded: None,
                children: None,
            }
        })
        .collect();

    Ok(results)
}

/// 重建索引（简化实现：直接返回 ok=true，因为不使用磁盘缓存）。
pub fn rebuild_review_index(root: &str) -> Result<(bool, usize), String> {
    if root.trim().is_empty() || !Path::new(root).exists() {
        return Ok((false, 0));
    }
    validate_path_safety(root, None)?;
    let root_path = PathBuf::from(root);
    let files = walk_for_images(&root_path);
    Ok((true, files.len()))
}

// ============================================================================
// AI 文案生成
// ============================================================================

/// 解析 data URL 为 (base64, media_type)。
fn parse_image_data_url(value: &str) -> Option<(String, String)> {
    let re = regex::Regex::new(r"^data:(image/[\w.+-]+);base64,(.+)$").ok()?;
    let cap = re.captures(value)?;
    let media_type = if &cap[1] == "image/jpg" {
        "image/jpeg".to_string()
    } else {
        cap[1].to_string()
    };
    Some((cap[2].to_string(), media_type))
}

/// 把图片路径转为 (base64, media_type)。
fn load_image_base64_entry(
    path: &str,
    max_side: u32,
    root: Option<&str>,
) -> Option<(String, String)> {
    // data URL 直接返回
    if let Some((b64, mime)) = parse_image_data_url(path) {
        return Some((b64, mime));
    }
    if path.is_empty() || !Path::new(path).exists() {
        return None;
    }
    if let Some(r) = root {
        if !r.is_empty() && !is_path_inside_root(path, r) {
            return None;
        }
    }
    if !is_review_image(Path::new(path)) {
        return None;
    }
    let thumbnail = media::generate_thumbnail(Path::new(path), max_side)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&thumbnail);
    // 缩略图统一用 PNG 编码
    Some((b64, "image/png".to_string()))
}

/// 加载图片列表的 base64（最多 maxCount 张）。
fn load_image_base64_entries(
    paths: &[String],
    max_count: usize,
    max_side: u32,
    root: Option<&str>,
) -> Vec<(String, String)> {
    paths
        .iter()
        .take(max_count)
        .filter_map(|p| load_image_base64_entry(p, max_side, root))
        .collect()
}

/// 获取收评助手的 API Profile（按 reviewApiProfileId 选择，否则回退到 active）。
fn get_review_api_profile(settings: &AppSettings) -> crate::types::ApiProfile {
    if !settings.review_api_profile_id.is_empty() {
        if let Some(p) = settings
            .api_profiles
            .iter()
            .find(|p| p.id == settings.review_api_profile_id)
        {
            return p.clone();
        }
    }
    ai::get_active_api_profile(settings)
}

/// AI 文案生成（对应原 `generateReviewCopy`）。
///
/// 简化实现：
/// - 仅支持 OpenAI 兼容接口（不支持 Anthropic 原生接口）
/// - 仅支持文本模式（图片以 image_url 形式附加）
/// - 不使用 reasoning_effort / thinking 字段
pub async fn generate_review_copy(
    settings: &AppSettings,
    options: &ReviewGenerationOptions,
) -> Result<ReviewGenerationResult, String> {
    let profile = get_review_api_profile(settings);
    if profile.api_base_url.is_empty() || profile.api_key.is_empty() {
        return Err("请先在设置中填写 API Base URL 和 API Key。".to_string());
    }
    crate::security::validate_api_url(&profile.api_base_url)?;

    let target_length = options.target_length.clamp(30, 100);
    let copy_count = options.copy_count.clamp(3, 12) as usize;

    let image_entries = load_image_base64_entries(
        &options.selected_paths,
        4,
        800,
        if settings.review_root_dir.is_empty() {
            None
        } else {
            Some(settings.review_root_dir.as_str())
        },
    );
    let has_images = !image_entries.is_empty();
    let model_id = if has_images {
        if profile.vision_model.is_empty() {
            profile.text_model.clone()
        } else {
            profile.vision_model.clone()
        }
    } else {
        profile.text_model.clone()
    };
    if model_id.is_empty() {
        return Err("未配置文本模型。".to_string());
    }

    let system_prompt = format!(
        "你是电商文案专家，擅长从商品特征中提炼卖点，用极简生动的语言写出真实买家好评。\n{}\n核心原则：\n- 每条评价必须从买家真实使用角度出发，像是真人写的而非AI\n- 自然融入一个具体穿着或使用场景（通勤、约会、周末、运动等）\n- 6条评价之间必须在句式结构、开场白、侧重点和收尾方式上明显不同\n- 杜绝千篇一律的模板感，禁止出现相似的开头或句式\n- 每条评价尽量接近 {} 个中文字，允许自然浮动 20%，不要硬凑字数",
        if has_images {
            "用户提供了商品参考图片，请仔细观察图片中的商品外观（颜色、款式、面料质感、设计细节等），结合图片特征生成更贴切的好评。"
        } else {
            ""
        },
        target_length
    );

    let prompt_text = format!(
        "请生成 {} 条中文买家好评文案。严格遵守以下要求：\n\n商品/搜索词：{}\n商品补充描述：{}\n{}\n\n【风格参数】\n专业程度（0口语化~5专业）：{}\n买家视角真实感（0一般~5很强）：{}\n语气夸张程度（0朴素~5夸张）：{}\n场景化表达（0弱~5强）：{}\n提到性价比：{}\n目标字数：每条约 {} 字\n\n【格式】不要编号，只返回 JSON：{{\"copies\":[\"...\"]}}",
        copy_count,
        options.query,
        if options.product_description.is_empty() { "无".to_string() } else { options.product_description.clone() },
        if has_images { format!("参考图片数量：{} 张（请结合图片中商品的实际外观特征）", image_entries.len()) } else { String::new() },
        options.professional_level,
        options.buyer_level,
        options.exaggeration_level,
        options.scene_level,
        if options.mention_value { "是" } else { "否" },
        target_length
    );

    let custom_prompt = settings.review_custom_prompt.trim();
    let final_system_prompt = if custom_prompt.is_empty() {
        system_prompt
    } else {
        format!("{}\n\n用户自定义要求：\n{}", system_prompt, custom_prompt)
    };

    // 调用 AI（直接构造 OpenAI 请求体，绕过 call_chat_completion 的限制以便支持图片）
    let endpoint = format!(
        "{}/chat/completions",
        profile.api_base_url.trim_end_matches('/')
    );
    let request_body = serde_json::json!({
        "model": model_id,
        "temperature": 0.88,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": final_system_prompt },
            {
                "role": "user",
                "content": if has_images {
                    let mut arr = Vec::new();
                    for (b64, mime) in &image_entries {
                        arr.push(serde_json::json!({
                            "type": "image_url",
                            "image_url": { "url": format!("data:{};base64,{}", mime, b64) }
                        }));
                    }
                    arr.push(serde_json::json!({ "type": "text", "text": prompt_text }));
                    serde_json::Value::Array(arr)
                } else {
                    serde_json::Value::String(prompt_text)
                }
            }
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{}", e))?;

    let auth = if profile.api_type == "anthropic" {
        profile.api_key.clone()
    } else {
        format!("Bearer {}", profile.api_key)
    };

    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", auth)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("AI 生成失败：{}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("AI 生成失败：{} {}", status, &text[..text.len().min(200)]));
    }

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

    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("解析模型返回 JSON 失败：{}", e))?;

    let copies = parsed
        .get("copies")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .take(copy_count)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(ReviewGenerationResult { copies })
}

/// AI 对话（对应原 `chatReviewCopy`）。
///
/// 简化实现：仅支持 OpenAI 兼容接口。
pub async fn chat_review_copy(
    settings: &AppSettings,
    payload: &ReviewChatPayload,
) -> Result<ReviewChatResult, String> {
    let profile = get_review_api_profile(settings);
    if profile.api_base_url.is_empty() || profile.api_key.is_empty() {
        return Err("请先在设置中填写 API Base URL 和 API Key。".to_string());
    }
    crate::security::validate_api_url(&profile.api_base_url)?;

    let target_length = payload.target_length.clamp(30, 100);
    let thinking_mode = if payload.thinking_mode.is_empty() {
        settings.review_thinking_mode.clone()
    } else {
        payload.thinking_mode.clone()
    };
    let product_description = payload.product_description.clone().unwrap_or_default();
    let style_hints = format!(
        "专业程度：{}；买家真实感：{}；夸张程度：{}；场景化表达：{}；提到性价比：{}",
        payload.professional_level.unwrap_or(settings.review_professional_level),
        payload.buyer_level.unwrap_or(settings.review_buyer_level),
        payload.exaggeration_level.unwrap_or(settings.review_exaggeration_level),
        payload.scene_level.unwrap_or(settings.review_scene_level),
        if payload.mention_value.unwrap_or(settings.review_mention_value) { "是" } else { "否" }
    );

    let root = if settings.review_root_dir.is_empty() {
        None
    } else {
        Some(settings.review_root_dir.as_str())
    };

    let image_entries = load_image_base64_entries(
        payload.images.as_deref().unwrap_or(&[]),
        8,
        960,
        root,
    );
    let current_has_images = !image_entries.is_empty();
    // 注：image_entries 仅用于判断是否使用 vision model（与原 electron 实现一致）

    // 加载历史消息中的图片
    let mut history_image_entries: Vec<Vec<(String, String)>> = Vec::new();
    for msg in &payload.messages {
        let imgs = msg.images.as_deref().unwrap_or(&[]);
        let entries = load_image_base64_entries(imgs, 8, 960, root);
        history_image_entries.push(entries);
    }
    let history_has_images = history_image_entries.iter().any(|e| !e.is_empty());
    let final_has_images = current_has_images || history_has_images;

    let model_id = if final_has_images {
        if profile.vision_model.is_empty() {
            profile.text_model.clone()
        } else {
            profile.vision_model.clone()
        }
    } else {
        profile.text_model.clone()
    };
    if model_id.is_empty() {
        return Err("未配置文本模型。".to_string());
    }

    let system_prompt = format!(
        "你是电商文案专家，擅长写真实买家好评。你正在和用户进行对话，帮ta写出更满意的评价文案。\n核心原则：\n- 用自然的口语化表达，像是真人买家写的\n- 结合用户提供的商品信息和图片进行创作\n- 每条评价目标字数约 {} 个中文字\n{}\n- 回应用户的具体要求（如改短、加表情、调整风格等）\n- 如果用户没有明确要求，可以给出写好评价的建议\n{}\n{}\n当前风格参数：{}",
        target_length,
        if final_has_images { "- 用户可能提供了商品参考图片，仔细观察图片中的外观特征" } else { "" },
        if !payload.query.is_empty() { format!("当前商品/搜索词：{}", payload.query) } else { String::new() },
        if !product_description.trim().is_empty() { format!("商品描述补充：{}", product_description.trim()) } else { String::new() },
        style_hints
    );

    let custom_prompt = payload.custom_prompt.clone().unwrap_or_default();
    let custom_prompt = if custom_prompt.trim().is_empty() {
        settings.review_custom_prompt.trim().to_string()
    } else {
        custom_prompt.trim().to_string()
    };
    let final_system_prompt = if custom_prompt.is_empty() {
        system_prompt
    } else {
        format!("{}\n\n用户自定义要求：\n{}", system_prompt, custom_prompt)
    };

    // 构造消息列表
    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": final_system_prompt
    })];

    for (i, msg) in payload.messages.iter().enumerate() {
        if msg.role == "assistant" {
            messages.push(serde_json::json!({ "role": "assistant", "content": msg.content }));
        } else {
            let imgs = &history_image_entries[i];
            if !imgs.is_empty() {
                let mut arr: Vec<serde_json::Value> = imgs
                    .iter()
                    .map(|(b64, mime)| {
                        serde_json::json!({
                            "type": "image_url",
                            "image_url": { "url": format!("data:{};base64,{}", mime, b64) }
                        })
                    })
                    .collect();
                arr.push(serde_json::json!({ "type": "text", "text": msg.content }));
                messages.push(serde_json::json!({ "role": "user", "content": arr }));
            } else {
                messages.push(serde_json::json!({ "role": "user", "content": msg.content }));
            }
        }
    }

    let request_body = serde_json::json!({
        "model": model_id,
        "temperature": 0.88,
        "messages": messages
    });

    let endpoint = format!(
        "{}/chat/completions",
        profile.api_base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{}", e))?;

    let auth = if profile.api_type == "anthropic" {
        profile.api_key.clone()
    } else {
        format!("Bearer {}", profile.api_key)
    };

    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", auth)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("AI 对话失败：{}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("AI 对话失败：{} {}", status, &text[..text.len().min(200)]));
    }

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

    Ok(ReviewChatResult {
        reply: content.to_string(),
    })
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 扫描收评素材（对应 `review:scanAssets` IPC 通道）。
#[tauri::command]
pub async fn review_scan_assets(
    root: String,
    query: String,
    settings: Option<AppSettings>,
    _request_id: Option<String>,
) -> Result<Vec<ReviewSearchResult>, String> {
    let settings = settings.unwrap_or_default();
    // 在阻塞线程中执行扫描
    tokio::task::spawn_blocking(move || scan_review_assets(&root, &query, &settings))
        .await
        .map_err(|e| format!("扫描任务失败：{}", e))?
}

/// 加载缩略图（对应 `review:loadThumbnails` IPC 通道）。
#[tauri::command]
pub async fn review_load_thumbnails(
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let result = tokio::task::spawn_blocking(move || load_review_thumbnails(&paths))
        .await
        .map_err(|e| format!("加载缩略图失败：{}", e))?;
    Ok(result)
}

/// 批量加载缩略图（对应 `review:loadThumbnailBatch` IPC 通道）。
#[tauri::command]
pub async fn review_load_thumbnail_batch(
    paths: Vec<String>,
    size: Option<usize>,
    root: Option<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let result = tokio::task::spawn_blocking(move || {
        load_review_thumbnail_batch(
            &paths,
            size.unwrap_or(220),
            root.as_deref(),
            MAX_THUMBNAIL_BATCH,
        )
    })
    .await
    .map_err(|e| format!("加载缩略图失败：{}", e))?;
    Ok(result)
}

/// 加载文件夹子项（对应 `review:loadFolderChildren` IPC 通道）。
#[tauri::command]
pub async fn review_load_folder_children(
    root: String,
    folder_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<ReviewSearchResult>, String> {
    let result = tokio::task::spawn_blocking(move || {
        load_review_folder_children(&root, &folder_path, offset.unwrap_or(0), limit.unwrap_or(200))
    })
    .await
    .map_err(|e| format!("加载子项失败：{}", e))?;
    result
}

/// 重建索引（对应 `review:rebuildIndex` IPC 通道）。
#[tauri::command]
pub async fn review_rebuild_index(
    root: String,
) -> Result<serde_json::Value, String> {
    let result = tokio::task::spawn_blocking(move || rebuild_review_index(&root))
        .await
        .map_err(|e| format!("重建索引失败：{}", e))?;
    let (ok, total) = result?;
    Ok(serde_json::json!({ "ok": ok, "total": total }))
}

/// 生成文案（对应 `review:generateCopy` IPC 通道）。
#[tauri::command]
pub async fn review_generate_copy(
    settings: AppSettings,
    options: ReviewGenerationOptions,
) -> Result<ReviewGenerationResult, String> {
    generate_review_copy(&settings, &options).await
}

/// 对话（对应 `review:chat` IPC 通道）。
#[tauri::command]
pub async fn review_chat(
    settings: AppSettings,
    payload: ReviewChatPayload,
) -> Result<ReviewChatResult, String> {
    chat_review_copy(&settings, &payload).await
}

/// 拖拽文件（对应 `drag:startFiles` IPC 通道）。
///
/// 简化实现：Tauri 没有等价于 Electron 的 `event.sender.startDrag` 的简单 API。
/// 这里仅返回成功，实际拖拽由前端处理（或使用 tauri-plugin-drag）。
#[tauri::command]
pub async fn drag_start_files(paths: Vec<String>) -> Result<(), String> {
    // 验证路径
    for p in &paths {
        if p.is_empty() {
            continue;
        }
        if !Path::new(p).exists() {
            continue;
        }
        // 安全校验：跳过系统目录
        let _ = validate_path_safety(p, None);
    }
    // 实际拖拽需要前端使用 tauri-plugin-drag 或类似插件实现
    Ok(())
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_review_image_jpg() {
        assert!(is_review_image(Path::new("photo.jpg")));
        assert!(is_review_image(Path::new("photo.JPG")));
        assert!(is_review_image(Path::new("photo.jpeg")));
    }

    #[test]
    fn test_is_review_image_png() {
        assert!(is_review_image(Path::new("image.png")));
        assert!(is_review_image(Path::new("image.webp")));
    }

    #[test]
    fn test_is_review_image_non_image() {
        assert!(!is_review_image(Path::new("video.mp4")));
        assert!(!is_review_image(Path::new("doc.pdf")));
    }

    #[test]
    fn test_normalize_match_text_basic() {
        let result = normalize_match_text("Hello World");
        assert_eq!(result, "helloworld");
    }

    #[test]
    fn test_normalize_match_text_with_separators() {
        let result = normalize_match_text("foo-bar_baz");
        assert_eq!(result, "foobarbaz");
    }

    #[test]
    fn test_token_overlap_identical() {
        let result = token_overlap("abc", "abc");
        assert!((result - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_token_overlap_no_overlap() {
        let result = token_overlap("abc", "xyz");
        assert!((result - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_token_overlap_partial() {
        let result = token_overlap("abc", "bcd");
        // a_chars = {a,b,c}, b_chars = {b,c,d}, intersection = {b,c}, 2/3
        assert!((result - 0.667).abs() < 0.01);
    }

    #[test]
    fn test_build_match_terms_simple() {
        let terms = build_match_terms("hello");
        assert!(!terms.is_empty());
        assert!(terms.contains(&"hello".to_string()));
    }

    #[test]
    fn test_build_match_terms_with_numbers() {
        let terms = build_match_terms("product 123");
        assert!(terms.iter().any(|t| t.contains("123")));
    }

    #[test]
    fn test_build_match_terms_empty() {
        let terms = build_match_terms("");
        assert!(terms.is_empty());
    }

    #[test]
    fn test_score_candidate_no_terms() {
        let root = Path::new("C:\\root");
        let file = Path::new("C:\\root\\photo.jpg");
        let result = score_candidate(root, file, &[]);
        assert_eq!(result.kind, "image");
        assert!(result.name.contains("photo"));
    }

    #[test]
    fn test_score_candidate_with_match() {
        let root = Path::new("C:\\root");
        let file = Path::new("C:\\root\\red-dress-001.jpg");
        let terms = vec!["reddress001".to_string()];
        let result = score_candidate(root, file, &terms);
        assert!(result.score > 0.0);
        assert!(!result.reason.is_empty());
    }

    #[test]
    fn test_parse_image_data_url() {
        let url = "data:image/png;base64,iVBORw0KGgo=";
        let result = parse_image_data_url(url);
        assert!(result.is_some());
        let (b64, mime) = result.unwrap();
        assert_eq!(b64, "iVBORw0KGgo=");
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn test_parse_image_data_url_jpg_to_jpeg() {
        let url = "data:image/jpg;base64,abc";
        let result = parse_image_data_url(url);
        assert!(result.is_some());
        let (_, mime) = result.unwrap();
        assert_eq!(mime, "image/jpeg");
    }

    #[test]
    fn test_parse_image_data_url_invalid() {
        assert!(parse_image_data_url("not-a-data-url").is_none());
        assert!(parse_image_data_url("data:text/plain;base64,abc").is_none());
    }

    #[tokio::test]
    async fn test_review_scan_assets_empty_root() {
        let settings = AppSettings::default();
        let result = scan_review_assets("", "test", &settings);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("请先选择"));
    }

    #[tokio::test]
    async fn test_review_scan_assets_nonexistent_root() {
        let settings = AppSettings::default();
        let result = scan_review_assets(r"C:\nonexistent\dir", "test", &settings);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_review_load_thumbnails_empty() {
        let result = review_load_thumbnails(vec![]).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_review_load_thumbnail_batch_empty() {
        let result = review_load_thumbnail_batch(vec![], None, None).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_review_load_folder_children_empty_root() {
        let result = review_load_folder_children("".to_string(), "".to_string(), None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_review_rebuild_index_nonexistent() {
        let result = review_rebuild_index(r"C:\nonexistent".to_string()).await;
        assert!(result.is_ok());
        let v = result.unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["total"], 0);
    }

    #[tokio::test]
    async fn test_review_generate_copy_no_api_key() {
        let mut settings = AppSettings::default();
        settings.api_key = String::new();
        for p in settings.api_profiles.iter_mut() {
            p.api_key = String::new();
        }
        let options = ReviewGenerationOptions {
            query: "test".to_string(),
            selected_paths: vec![],
            product_description: String::new(),
            target_length: 80,
            thinking_mode: "auto".to_string(),
            professional_level: 2,
            buyer_level: 4,
            exaggeration_level: 2,
            scene_level: 3,
            mention_value: true,
            copy_count: 6,
            batch_seed: 1,
        };
        let result = review_generate_copy(settings, options).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_review_chat_no_api_key() {
        let mut settings = AppSettings::default();
        settings.api_key = String::new();
        for p in settings.api_profiles.iter_mut() {
            p.api_key = String::new();
        }
        let payload = ReviewChatPayload {
            messages: vec![],
            query: "test".to_string(),
            images: None,
            product_description: None,
            target_length: 80,
            thinking_mode: "auto".to_string(),
            professional_level: None,
            buyer_level: None,
            exaggeration_level: None,
            scene_level: None,
            mention_value: None,
            custom_prompt: None,
        };
        let result = review_chat(settings, payload).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_drag_start_files_empty() {
        let result = drag_start_files(vec![]).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_walk_for_images_nonexistent_dir() {
        let result = walk_for_images(Path::new(r"C:\nonexistent\dir"));
        assert!(result.is_empty());
    }
}
