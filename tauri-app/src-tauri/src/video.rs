//! 视频模块
//!
//! 对应原 `electron/handlers/video.ts`。
//!
//! - 视频库扫描：按产品名/颜色名匹配素材（图片/视频）
//! - FFmpeg 视频渲染：两个模板（bos-template、video-slice）
//! - 取消渲染：通过 task ID 终止正在运行的 FFmpeg 进程
//! - 渲染进度：通过 Tauri 事件 `video_render_progress` 推送进度
//!
//! 简化说明：
//! - 不使用 Worker 子线程（原版使用 worker_threads），改用 spawn_blocking
//! - 8.3 短路径转换复用 ffmpeg::get_short_path
//! - 临时别名（alias）机制简化：仅尝试短路径，不创建硬链接副本
//! - 进度事件通过 Tauri Emitter trait 发送

use crate::everything;
use crate::ffmpeg;
use crate::media;
use crate::security::{is_path_inside_root, validate_media_file_path, validate_path_safety};
use crate::types::{AppSettings, VideoCandidate, VideoRenderPayload, VideoRenderProgress, VideoRenderResult, VideoTask};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// 最大日志字节数（256KB）。
const MAX_FFMPEG_LOG_BYTES: usize = 256 * 1024;

/// FFmpeg 渲染超时时间（30 分钟）。
const MAX_FFMPEG_RENDER_MS: u64 = 30 * 60 * 1000;

/// 视频文件扩展名。
const VIDEO_EXTS: &[&str] = &[".mp4", ".mov", ".mkv", ".avi", ".webm"];

/// 图片文件扩展名。
const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".webp", ".bmp"];

/// 全局运行中的 FFmpeg 进程表（task_id → 子进程句柄）。
static RUNNING_PROCESSES: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

/// 已取消的任务集合。
static CANCELED_TASKS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

// ============================================================================
// 工具函数
// ============================================================================

/// 获取 CPU 线程数。
fn cpu_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}

/// 判断路径是否为视频文件。
fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .map(|ext| VIDEO_EXTS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// 判断路径是否为图片文件。
fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .map(|ext| IMAGE_EXTS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// 规范化匹配文本（小写、去分隔符）。
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

/// 构建匹配词列表。
fn build_match_terms(value: &str) -> Vec<String> {
    let normalized = normalize_match_text(value);
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut terms: Vec<String> = vec![normalized.clone()];

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

    let re = regex::Regex::new(r"[a-z]*\d+[a-z]*").unwrap();
    for cap in re.captures_iter(&normalized) {
        if let Some(m) = cap.get(0) {
            let term = m.as_str().to_string();
            if term.len() >= 2 && !terms.contains(&term) {
                terms.push(term);
            }
        }
    }

    terms.into_iter().filter(|t| t.len() >= 2).collect()
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

/// 评分单个候选文件。
fn score_media_candidate(root: &Path, file_path: &Path, terms: &[String]) -> VideoCandidate {
    let relative = file_path
        .strip_prefix(root)
        .unwrap_or(file_path);
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let path_text = normalize_match_text(&relative.to_string_lossy());
    let file_text = normalize_match_text(&file_name);
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

    let depth = relative.components().count().saturating_sub(1) as i64;
    score += (10 - depth).max(0);

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();
    if VIDEO_EXTS.contains(&ext.as_str()) {
        score += 8;
    }
    if IMAGE_EXTS.contains(&ext.as_str()) {
        score += 4;
    }

    VideoCandidate {
        path: file_path.to_string_lossy().to_string(),
        file_name: file_name.clone(),
        score: score as f64,
        reason: reasons.iter().take(3).cloned().collect::<Vec<_>>().join("；"),
        kind: if VIDEO_EXTS.contains(&ext.as_str()) {
            Some("video".to_string())
        } else {
            Some("image".to_string())
        },
        thumbnail_data_url: None,
        matched_path: Some(relative.to_string_lossy().to_string()),
    }
}

/// 递归扫描目录下的所有媒体文件（图片 + 视频）。
fn walk_for_media(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if results.len() >= 50_000 {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if results.len() >= 50_000 {
                break;
            }
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && (is_image_file(&path) || is_video_file(&path)) {
                results.push(path);
            }
        }
    }
    results
}

// ============================================================================
// 视频库扫描
// ============================================================================

/// 扫描视频库（对应原 `scanVideoLibrary`）。
///
/// 简化实现：
/// - 不使用 Worker 子线程
/// - 不发送扫描进度事件
pub fn scan_video_library(
    settings: &AppSettings,
    product_name: &str,
    color_name: &str,
    _speed_mode: bool,
) -> Result<Vec<VideoCandidate>, String> {
    let root = settings.video_library_dir.trim();
    if root.is_empty() {
        return Err("请先在设置中选择视频库文件夹。".to_string());
    }
    if !Path::new(root).exists() {
        return Err("视频库文件夹不存在。".to_string());
    }
    validate_path_safety(root, None)?;

    let root_path = PathBuf::from(root);
    let terms = build_match_terms(&format!("{} {}", product_name, color_name));

    // 优先使用 Everything 搜索
    let es_path = everything::resolve_everything_es_path(settings);
    let mut candidates: Vec<VideoCandidate> = if !es_path.is_empty() {
        let mut exts: HashSet<String> = IMAGE_EXTS.iter().chain(VIDEO_EXTS.iter()).map(|s| s.to_string()).collect();
        let _ = &mut exts; // 仅用于类型推断
        let exts_set: HashSet<String> = IMAGE_EXTS.iter().chain(VIDEO_EXTS.iter()).map(|s| s.to_string()).collect();
        let query = format!("{} {}", product_name, color_name);
        let found_paths = everything::search_with_everything(&es_path, root, &query, &exts_set, 500);
        found_paths
            .par_iter()
            .map(|p| score_media_candidate(&root_path, Path::new(p), &terms))
            .collect()
    } else {
        let all_files = walk_for_media(&root_path);
        all_files
            .par_iter()
            .map(|p| score_media_candidate(&root_path, p, &terms))
            .collect()
    };

    // 过滤零分项（如果有 query）
    if !terms.is_empty() {
        candidates.retain(|c| c.score > 0.0);
    }

    // 按分数降序排序
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(500);

    Ok(candidates)
}

// ============================================================================
// FFmpeg 渲染
// ============================================================================

/// 生成唯一输出路径（避免覆盖已有文件）。
fn unique_output_path(dir: &str, base_name: &str) -> Result<String, String> {
    let safe_name = if base_name.trim().is_empty() {
        format!("video-{}", &Uuid::new_v4().to_string()[..8])
    } else {
        base_name
            .chars()
            .map(|c| match c {
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                _ => c,
            })
            .collect::<String>()
    };

    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建输出目录：{}", e))?;

    let mut candidate = PathBuf::from(dir).join(format!("{}.mp4", safe_name));
    let mut index = 2;
    while candidate.exists() {
        candidate = PathBuf::from(dir).join(format!("{}-{}.mp4", safe_name, index));
        index += 1;
    }
    Ok(candidate.to_string_lossy().to_string())
}

/// 探测视频流信息。
struct VideoProbe {
    has_video: bool,
    has_audio: bool,
    duration: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
    detail: String,
}

/// 调用 `ffmpeg -i` 探测视频信息。
fn probe_video_input(ffmpeg_path: &str, video_path: &str) -> Result<VideoProbe, String> {
    let (code, output) = ffmpeg::run_process(ffmpeg_path, &["-hide_banner", "-i", video_path], 10_000);

    let has_video = regex::Regex::new(r"Stream\s+#\d+:\d+.*Video").unwrap().is_match(&output);
    let has_audio = regex::Regex::new(r"Stream\s+#\d+:\d+.*Audio").unwrap().is_match(&output);

    let duration = regex::Regex::new(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
        .unwrap()
        .captures(&output)
        .and_then(|c| {
            let h: f64 = c[1].parse().ok()?;
            let m: f64 = c[2].parse().ok()?;
            let s: f64 = c[3].parse().ok()?;
            Some(h * 3600.0 + m * 60.0 + s)
        });

    let video_line = output
        .lines()
        .find(|line| regex::Regex::new(r"Stream\s+#\d+:\d+.*Video").unwrap().is_match(line))
        .unwrap_or("");

    let size_match = regex::Regex::new(r"(\d{2,5})x(\d{2,5})")
        .unwrap()
        .captures(video_line);
    let (width, height) = size_match.and_then(|c| {
        let w: u32 = c[1].parse().ok()?;
        let h: u32 = c[2].parse().ok()?;
        Some((w, h))
    }).unzip();

    let fps = regex::Regex::new(r",\s*(\d+(?:\.\d+)?)\s*(?:fps|tbr)\b")
        .unwrap()
        .captures(video_line)
        .and_then(|c| c[1].parse().ok());

    Ok(VideoProbe {
        has_video,
        has_audio,
        duration,
        width,
        height,
        fps,
        detail: output,
    })
}

/// 解析 FFmpeg 错误日志，返回友好提示。
fn parse_ffmpeg_error(log: &str, code: i32) -> String {
    let lower = log.to_lowercase();
    let log_lines: Vec<&str> = log.lines().filter(|s| !s.is_empty()).collect();
    let error_lines: Vec<&&str> = log_lines
        .iter()
        .filter(|line| {
            let l = line.to_lowercase();
            l.contains("error") || l.contains("invalid") || l.contains("fail")
                || l.contains("cannot") || l.contains("denied") || l.contains("not found")
        })
        .take(3)
        .collect();
    let context_tail = if !error_lines.is_empty() {
        error_lines.iter().map(|s| s.to_string()).collect::<Vec<_>>().join("\n")
    } else {
        log.chars().rev().take(200).collect::<String>().chars().rev().collect()
    };

    if lower.contains("no such file") || lower.contains("does not exist") {
        return "输入文件不存在，请检查素材路径是否正确。如果路径包含中文，请将素材移到英文路径后重试。".to_string();
    }
    if lower.contains("invalid data found") {
        return "素材文件格式损坏或不支持，请更换文件后重试。".to_string();
    }
    if lower.contains("codec not found") || lower.contains("encoder") && lower.contains("not found") {
        return "缺少必要的编码器，请使用诊断修复检查 FFmpeg 安装。".to_string();
    }
    if lower.contains("permission denied") {
        return "输出目录没有写入权限，请检查输出文件夹权限。".to_string();
    }
    if lower.contains("out of memory") || lower.contains("cannot allocate") {
        return "内存不足，请关闭其他程序后重试。".to_string();
    }
    if lower.contains("device or resource busy") {
        return "输出文件被占用，请关闭使用该文件的程序。".to_string();
    }
    if lower.contains("nothing was written") {
        if lower.contains("no audio") || !regex::Regex::new(r"Stream\s+#\d+:\d+.*Audio").unwrap().is_match(log) {
            return "输出文件为空：视频没有音频轨道导致合成失败，程序已自动适配。如果仍然报错请使用诊断修复。".to_string();
        }
        return format!("输出文件为空：可能是编码器与素材不兼容。\n{}", context_tail);
    }
    if lower.contains("invalid argument") && lower.contains("encoder") {
        return format!("硬件编码器参数不兼容，尝试切换 CPU 编码。\n{}", context_tail);
    }
    if lower.contains("invalid argument") {
        return format!("FFmpeg 参数错误（退出码 {}），请使用诊断修复排查。\n{}", code, context_tail);
    }
    if lower.contains("error while opening encoder") {
        return format!("编码器初始化失败，可能是硬件加速不兼容。\n{}", context_tail);
    }
    if lower.contains("conversion failed") {
        return format!("格式转换失败，素材可能不兼容。\n{}", context_tail);
    }
    format!("FFmpeg 退出码 {}：{}", code, if context_tail.is_empty() { "无详细日志，请使用诊断修复功能排查。" } else { &context_tail })
}

/// 截断日志到最大字节数（保留尾部）。
fn append_limited_log(current: &str, chunk: &str) -> String {
    let next = format!("{}{}", current, chunk);
    if next.len() <= MAX_FFMPEG_LOG_BYTES {
        return next;
    }
    let start = next.len().saturating_sub(MAX_FFMPEG_LOG_BYTES);
    let safe_start = next.ceil_char_boundary(start);
    next[safe_start..].to_string()
}

/// 解析 FFmpeg 进度（time= 行）。
fn parse_progress_time(text: &str) -> Option<f64> {
    let re = regex::Regex::new(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)").unwrap();
    let caps = re.captures(text)?;
    let h: f64 = caps[1].parse().ok()?;
    let m: f64 = caps[2].parse().ok()?;
    let s: f64 = caps[3].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// 运行 FFmpeg 子进程并收集输出。
///
/// 参数：
/// - `ffmpeg_path`: FFmpeg 可执行文件路径
/// - `args`: 命令行参数
/// - `task_id`: 任务 ID（用于取消）
/// - `stage`: 进度阶段标签
/// - `duration`: 视频总时长（用于计算进度百分比）
/// - `app`: Tauri AppHandle（用于发送进度事件）
fn run_ffmpeg(
    ffmpeg_path: &str,
    args: &[String],
    task_id: &str,
    stage: &str,
    duration: Option<f64>,
    app: Option<&AppHandle>,
) -> VideoRenderResult {
    let args_log = format!(
        "[ffmpeg cmd] {} {}\n",
        ffmpeg_path,
        args.iter()
            .map(|a| {
                if a.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'') {
                    format!("\"{}\"", a)
                } else {
                    a.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    );

    let mut child = match Command::new(ffmpeg_path)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: args_log,
                error: Some(format!("无法启动 FFmpeg：{}", e)),
            };
        }
    };

    // 记录 PID
    let pid = child.id();
    {
        let mut guard = RUNNING_PROCESSES.lock().unwrap();
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(task_id.to_string(), pid);
    }

    let mut log = args_log;
    let mut last_percent: f64 = 15.0;
    let start_time = std::time::Instant::now();

    // 读取 stderr（FFmpeg 进度输出在 stderr）
    if let Some(mut stderr) = child.stderr.take() {
        use std::io::Read;
        let mut buf = [0u8; 4096];
        loop {
            match stderr.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    log = append_limited_log(&log, &chunk);

                    // 解析进度
                    if let Some(seconds) = parse_progress_time(&chunk) {
                        let percent = if let Some(d) = duration {
                            if d > 0.0 {
                                12.0 + (seconds / d) * 84.0
                            } else {
                                20.0 + seconds * 10.0
                            }
                        } else {
                            20.0 + seconds * 10.0
                        };
                        last_percent = last_percent.max(percent).min(96.0);

                        if let Some(app) = app {
                            let _ = app.emit(
                                "video_render_progress",
                                VideoRenderProgress {
                                    task_id: task_id.to_string(),
                                    percent: last_percent,
                                    stage: stage.to_string(),
                                    current_time: Some(seconds),
                                },
                            );
                        }
                    }
                }
                Err(_) => break,
            }

            // 检查超时
            if start_time.elapsed() > Duration::from_millis(MAX_FFMPEG_RENDER_MS) {
                let _ = child.kill();
                log = append_limited_log(&log, &format!("\nFFmpeg timed out after {}ms", MAX_FFMPEG_RENDER_MS));
                break;
            }
        }
    }

    // 读取 stdout
    if let Some(mut stdout) = child.stdout.take() {
        use std::io::Read;
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        if !buf.is_empty() {
            log = append_limited_log(&log, &buf);
        }
    }

    // 等待退出
    let exit_status = child.wait();
    let code = exit_status
        .ok()
        .and_then(|s| s.code())
        .unwrap_or(-1);

    // 清理 PID 记录
    {
        let mut guard = RUNNING_PROCESSES.lock().unwrap();
        if let Some(map) = guard.as_mut() {
            map.remove(task_id);
        }
    }

    // 检查是否被取消
    let was_canceled = {
        let mut guard = CANCELED_TASKS.lock().unwrap();
        if let Some(set) = guard.as_mut() {
            set.remove(task_id)
        } else {
            false
        }
    };
    if was_canceled {
        return VideoRenderResult {
            success: false,
            output_path: None,
            log,
            error: Some("Render canceled.".to_string()),
        };
    }

    let success = code == 0;
    VideoRenderResult {
        success,
        output_path: None,
        error: if success {
            None
        } else {
            Some(parse_ffmpeg_error(&log, code))
        },
        log,
    }
}

// ============================================================================
// FFmpeg 参数构建
// ============================================================================

/// 规范化为偶数维度。
fn normalize_even_dimension(value: Option<u32>, fallback: u32) -> u32 {
    match value {
        Some(v) if v > 1 => ((v + 1) / 2) * 2,
        _ => ((fallback + 1) / 2) * 2,
    }
}

/// 解析渲染尺寸。
fn resolve_render_dimensions(
    settings: &AppSettings,
    probe_width: Option<u32>,
    probe_height: Option<u32>,
    fallback_width: u32,
    fallback_height: u32,
) -> (u32, u32) {
    if settings.video_output_size == "portrait-1080" {
        return (1080, 1440);
    }
    if settings.video_output_size == "portrait-1440" {
        return (1440, 1920);
    }
    if let (Some(w), Some(h)) = (probe_width, probe_height) {
        return (normalize_even_dimension(Some(w), 1080), normalize_even_dimension(Some(h), 1440));
    }
    (normalize_even_dimension(None, fallback_width), normalize_even_dimension(None, fallback_height))
}

/// 解析渲染帧率。
fn resolve_render_fps(probe_fps: Option<f64>) -> f64 {
    match probe_fps {
        Some(fps) if fps > 0.0 => fps.min(60.0).max(15.0),
        _ => 30.0,
    }
}

/// 计算帧持续时间。
fn frame_duration_for_fps(fps: f64) -> String {
    format!("{:.6}", (1.0 / fps).max(0.01))
}

/// CPU 编码器参数。
fn encoder_args(quality_mode: &str) -> Vec<String> {
    let threads = cpu_threads().to_string();
    match quality_mode {
        "balanced" => vec_into_strings(&["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", &threads]),
        "high" => vec_into_strings(&["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-threads", &threads]),
        _ => vec_into_strings(&["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-threads", &threads]),
    }
}

/// 音频编码参数。
fn audio_encode_args() -> Vec<String> {
    vec_into_strings(&["-c:a", "aac", "-b:a", "192k"])
}

/// 颜色元数据参数。
fn color_metadata_args() -> Vec<String> {
    vec_into_strings(&["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"])
}

/// 把 &[&str] 转为 Vec<String>。
fn vec_into_strings(arr: &[&str]) -> Vec<String> {
    arr.iter().map(|s| s.to_string()).collect()
}

/// 构建帛先生模板参数（对应原 `buildBosTemplateArgs`）。
///
/// 模板：1 张图片 + 1 个视频，图片作为片头，视频作为主体（带背景模糊）。
fn build_bos_template_args(
    ffmpeg_path: &str,
    payload: &VideoRenderPayload,
    settings: &AppSettings,
    output_path: &str,
) -> Result<Vec<String>, String> {
    let task = &payload.task;
    let image = if !task.image_path.is_empty() {
        task.image_path.clone()
    } else {
        task.image_paths.first().cloned().unwrap_or_default()
    };
    if image.is_empty() {
        return Err("帛先生模板需要 1 张图片。".to_string());
    }
    if task.video_path.is_empty() {
        return Err("帛先生模板需要 1 个视频。".to_string());
    }

    let probe = probe_video_input(ffmpeg_path, &task.video_path)?;
    if !probe.has_video {
        return Err("视频文件没有可解码的视频流，请检查文件是否损坏或格式不支持。".to_string());
    }

    let (w, h) = resolve_render_dimensions(settings, probe.width, probe.height, 1080, 1440);
    let fps = resolve_render_fps(probe.fps);
    let frame_dur = frame_duration_for_fps(fps);
    let fps_str = format!("{:.3}", fps);

    let normalized_tail = format!("setsar=1,fps={},format=yuv420p", fps_str);

    let filter = format!(
        "[0:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=white,{tail}[intro];\
         [1:v]split=2[bg][fg];\
         [bg]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}:(iw-{w})/2:(ih-{h})/2,boxblur=24:2,{tail}[blur];\
         [fg]scale={w}:{h}:force_original_aspect_ratio=decrease,{tail}[fit];\
         [blur][fit]overlay=(W-w)/2:(H-h)/2:shortest=1,{tail}[main];\
         [intro][main]concat=n=2:v=1:a=0[outv]",
        w = w, h = h, tail = normalized_tail
    );

    let mut args: Vec<String> = vec_into_strings(&["-y", "-hide_banner", "-loop", "1", "-t", &frame_dur, "-framerate", &fps_str, "-i", &image, "-i", &task.video_path]);
    args.push("-filter_complex".to_string());
    args.push(filter);
    args.push("-map".to_string());
    args.push("[outv]".to_string());
    if probe.has_audio {
        args.extend(vec_into_strings(&["-map", "1:a"]));
        args.extend(audio_encode_args());
        args.push("-shortest".to_string());
    }
    args.extend(vec_into_strings(&["-r", &fps_str, "-pix_fmt", "yuv420p"]));
    args.extend(color_metadata_args());
    args.extend(encoder_args(&settings.video_quality_mode));
    args.push(output_path.to_string());

    Ok(args)
}

/// 构建视频切片模板参数（对应原 `buildVideoSliceArgs`）。
///
/// 模板：5 张图片，带过渡效果（hblur、zoomin、slide、grid）。
fn build_video_slice_args(
    payload: &VideoRenderPayload,
    settings: &AppSettings,
    output_path: &str,
) -> Result<Vec<String>, String> {
    let task = &payload.task;
    let images: Vec<String> = task.image_paths.iter().filter(|p| !p.is_empty()).take(5).cloned().collect();
    if images.len() < 5 {
        return Err("视频切片模板需要 5 张图片。".to_string());
    }

    let (width, height) = resolve_render_dimensions(settings, None, None, 1440, 1920);
    let half_w = width / 2;
    let half_h = height / 2;
    let fps = 30;
    let input_duration = "3.6";
    let stable_durations = ["2.9", "2.7", "2.7", "2.7", "2.77"];
    let transition_durations = ["0.3", "0.3", "0.3", "0.4"];

    let music_path = task.music_path.clone().unwrap_or_default();
    let music_path = if music_path.is_empty() {
        task.music_preset_id.clone().unwrap_or_default()
    } else {
        music_path
    };

    let mut args: Vec<String> = vec_into_strings(&["-y", "-hide_banner"]);
    for image in &images {
        args.extend(vec_into_strings(&["-loop", "1", "-t", input_duration, "-framerate", &fps.to_string(), "-i", image]));
    }
    if !music_path.is_empty() {
        args.extend(vec_into_strings(&["-stream_loop", "-1", "-i", &music_path]));
    }

    let mut filters: Vec<String> = Vec::new();
    for i in 0..5 {
        filters.push(format!(
            "[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps={fps},format=rgba[img{i}]",
            i = i, w = width, h = height, fps = fps
        ));
    }
    filters.push("[img0]split=2[i0s][i0t]".to_string());
    filters.push("[img1]split=3[i1t1][i1s][i1t2]".to_string());
    filters.push("[img2]split=3[i2t1][i2s][i2t2]".to_string());
    filters.push("[img3]split=3[i3t1][i3s][i3t2]".to_string());
    filters.push("[img4]split=2[i4s][i4t]".to_string());

    for i in 0..5 {
        filters.push(format!("[i{s}s]trim=duration={d},setpts=PTS-STARTPTS[seg{n}]",
            s = i, d = stable_durations[i], n = i + 1));
    }

    // 过渡 1→2 (hblur)
    filters.push(format!("[i0t]trim=duration={d},setpts=PTS-STARTPTS[t12a]", d = transition_durations[0]));
    filters.push(format!("[i1t1]trim=duration={d},setpts=PTS-STARTPTS[t12b]", d = transition_durations[0]));
    filters.push(format!("[t12a][t12b]xfade=transition=hblur:duration={d}:offset=0,eq=brightness=0.04:saturation=1.08[t12]", d = transition_durations[0]));

    // 过渡 2→3 (zoomin)
    filters.push(format!("[i1t2]trim=duration={d},setpts=PTS-STARTPTS[t23a]", d = transition_durations[1]));
    filters.push(format!("[i2t1]trim=duration={d},setpts=PTS-STARTPTS[t23b]", d = transition_durations[1]));
    filters.push(format!("[t23a][t23b]xfade=transition=zoomin:duration={d}:offset=0[t23]", d = transition_durations[1]));

    // 过渡 3→4 (slide)
    filters.push(format!("[i2t2]trim=duration={d},setpts=PTS-STARTPTS[slidebase0]", d = transition_durations[2]));
    filters.push("[slidebase0]boxblur=5:1[slidebase]".to_string());
    filters.push(format!("[i3t1]trim=duration={d},setpts=PTS-STARTPTS,boxblur=12:1[slidelayer]", d = transition_durations[2]));
    filters.push(format!(
        "[slidebase][slidelayer]overlay=x='main_w-(t/{d})*main_w':y=0:shortest=1:eval=frame[t34]",
        d = transition_durations[2]
    ));

    // 过渡 4→5 (grid)
    filters.push(format!("[i4t]trim=duration={d},setpts=PTS-STARTPTS[gridbg]", d = transition_durations[3]));
    filters.push(format!("[i3t2]trim=duration={d},setpts=PTS-STARTPTS,split=4[gridq1][gridq2][gridq3][gridq4]", d = transition_durations[3]));
    filters.push(format!("[gridq1]crop={hw}:{hh}:0:0,boxblur=4:1[g1]", hw = half_w, hh = half_h));
    filters.push(format!("[gridq2]crop={hw}:{hh}:{hw}:0,boxblur=4:1[g2]", hw = half_w, hh = half_h));
    filters.push(format!("[gridq3]crop={hw}:{hh}:0:{hh},boxblur=4:1[g3]", hw = half_w, hh = half_h));
    filters.push(format!("[gridq4]crop={hw}:{hh}:{hw}:{hh},boxblur=4:1[g4]", hw = half_w, hh = half_h));
    filters.push(format!(
        "[gridbg][g1]overlay=x='0-(t/{d})*{hw}':y='0-(t/{d})*{hh}':shortest=1:eval=frame[o1]",
        d = transition_durations[3], hw = half_w, hh = half_h
    ));
    filters.push(format!(
        "[o1][g2]overlay=x='{hw}+(t/{d})*{hw}':y='0-(t/{d})*{hh}':shortest=1:eval=frame[o2]",
        d = transition_durations[3], hw = half_w, hh = half_h
    ));
    filters.push(format!(
        "[o2][g3]overlay=x='0-(t/{d})*{hw}':y='{hh}+(t/{d})*{hh}':shortest=1:eval=frame[o3]",
        d = transition_durations[3], hw = half_w, hh = half_h
    ));
    filters.push(format!(
        "[o3][g4]overlay=x='{hw}+(t/{d})*{hw}':y='{hh}+(t/{d})*{hh}':shortest=1:eval=frame[t45]",
        d = transition_durations[3], hw = half_w, hh = half_h
    ));

    // 最终拼接
    filters.push("[seg1][t12][seg2][t23][seg3][t34][seg4][t45][seg5]concat=n=9:v=1:a=0,format=yuv420p[out]".to_string());

    args.push("-filter_complex".to_string());
    args.push(filters.join(";"));
    args.push("-map".to_string());
    args.push("[out]".to_string());

    if !music_path.is_empty() {
        args.extend(vec_into_strings(&["-map", &format!("{}:a:0", images.len())]));
        args.extend(audio_encode_args());
        args.push("-shortest".to_string());
    }

    args.extend(vec_into_strings(&["-r", &fps.to_string(), "-pix_fmt", "yuv420p"]));
    args.extend(color_metadata_args());
    args.extend(encoder_args(&settings.video_quality_mode));
    args.push(output_path.to_string());

    Ok(args)
}

// ============================================================================
// 渲染入口
// ============================================================================

/// 渲染视频任务（对应原 `renderVideoTask`）。
pub async fn render_video_task(
    payload: VideoRenderPayload,
    app: Option<&AppHandle>,
) -> VideoRenderResult {
    let settings = payload.settings.clone();
    let task = payload.task.clone();

    // 解析 FFmpeg 路径
    let ffmpeg_path = match ffmpeg::resolve_ffmpeg_path(&settings) {
        Some(p) => p,
        None => {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some("未找到 FFmpeg，请在设置中指定 ffmpeg.exe 或放入程序 bin 目录。".to_string()),
            };
        }
    };

    if settings.video_output_dir.trim().is_empty() {
        return VideoRenderResult {
            success: false,
            output_path: None,
            log: String::new(),
            error: Some("请先选择输出文件夹。".to_string()),
        };
    }

    // 确保输出目录存在
    if let Err(e) = std::fs::create_dir_all(&settings.video_output_dir) {
        return VideoRenderResult {
            success: false,
            output_path: None,
            log: String::new(),
            error: Some(format!("无法创建输出目录：{}", e)),
        };
    }

    if let Err(e) = validate_path_safety(&settings.video_output_dir, None) {
        return VideoRenderResult {
            success: false,
            output_path: None,
            log: String::new(),
            error: Some(e),
        };
    }

    // 验证输入素材
    if task.template != "video-slice" {
        let image = if !task.image_path.is_empty() {
            task.image_path.clone()
        } else {
            task.image_paths.first().cloned().unwrap_or_default()
        };
        if image.is_empty() || !Path::new(&image).exists() {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some(format!("图片文件不存在：{}", if image.is_empty() { "未选择" } else { &image })),
            };
        }
        if task.video_path.is_empty() || !Path::new(&task.video_path).exists() {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some(format!("视频文件不存在：{}", if task.video_path.is_empty() { "未选择" } else { &task.video_path })),
            };
        }
        if let Err(e) = validate_media_file_path(&image) {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some(e),
            };
        }
        if let Err(e) = validate_media_file_path(&task.video_path) {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some(e),
            };
        }
    } else {
        for image_path in task.image_paths.iter().filter(|p| !p.is_empty()) {
            if !Path::new(image_path).exists() {
                return VideoRenderResult {
                    success: false,
                    output_path: None,
                    log: String::new(),
                    error: Some(format!("图片文件不存在：{}", Path::new(image_path).file_name().and_then(|n| n.to_str()).unwrap_or(""))),
                };
            }
            if let Err(e) = validate_media_file_path(image_path) {
                return VideoRenderResult {
                    success: false,
                    output_path: None,
                    log: String::new(),
                    error: Some(e),
                };
            }
        }
    }

    // 生成输出路径
    let base_name = if !task.output_name.is_empty() {
        task.output_name.clone()
    } else {
        format!("{}-{}", task.product_name, task.color_name)
    };
    let output_path = match unique_output_path(&settings.video_output_dir, &base_name) {
        Ok(p) => p,
        Err(e) => {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some(e),
            };
        }
    };

    // 推送准备进度
    if let Some(app) = app {
        let _ = app.emit(
            "video_render_progress",
            VideoRenderProgress {
                task_id: task.id.clone(),
                percent: 8.0,
                stage: "准备素材".to_string(),
                current_time: None,
            },
        );
    }

    // 构建参数
    let args_result = if task.template == "video-slice" {
        build_video_slice_args(&payload, &settings, &output_path)
    } else {
        build_bos_template_args(&ffmpeg_path, &payload, &settings, &output_path)
    };

    let args = match args_result {
        Ok(a) => a,
        Err(e) => {
            return VideoRenderResult {
                success: false,
                output_path: None,
                log: String::new(),
                error: Some(e),
            };
        }
    };

    // 估算时长
    let duration = if task.template == "video-slice" {
        Some(15.07)
    } else if !task.video_path.is_empty() {
        probe_video_input(&ffmpeg_path, &task.video_path)
            .ok()
            .and_then(|p| p.duration)
    } else {
        None
    };

    // 执行 FFmpeg
    let stage_label = format!("剪辑中（CPU 多线程：{} 线程）", cpu_threads());
    let mut result = run_ffmpeg(&ffmpeg_path, &args, &task.id, &stage_label, duration, app);

    // 推送最终进度
    if let Some(app) = app {
        let _ = app.emit(
            "video_render_progress",
            VideoRenderProgress {
                task_id: task.id.clone(),
                percent: if result.success { 100.0 } else { 0.0 },
                stage: if result.success { "完成".to_string() } else { "失败".to_string() },
                current_time: None,
            },
        );
    }

    // 写日志
    let _ = crate::log::append_log(
        if result.success { "info" } else { "error" },
        "视频剪辑任务完成",
        &serde_json::json!({
            "outputPath": &output_path,
            "success": result.success,
            "error": &result.error,
        }),
    );

    result.output_path = Some(output_path);
    result
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 扫描视频库（对应 `video:scanLibrary` IPC 通道）。
#[tauri::command]
pub async fn video_scan_library(
    settings: AppSettings,
    product_name: String,
    color_name: String,
    speed_mode: Option<bool>,
    _request_id: Option<String>,
) -> Result<Vec<VideoCandidate>, String> {
    let speed_mode = speed_mode.unwrap_or(false);
    // 如果不是 speed_mode，加载缩略图
    let candidates = tokio::task::spawn_blocking(move || {
        scan_video_library(&settings, &product_name, &color_name, speed_mode)
    })
    .await
    .map_err(|e| format!("扫描任务失败：{}", e))??;

    // speed_mode 下直接返回
    if speed_mode {
        return Ok(candidates);
    }

    // 加载缩略图（前 40 张图片）
    let image_paths: Vec<String> = candidates
        .iter()
        .filter(|c| c.kind.as_deref() == Some("image"))
        .map(|c| c.path.clone())
        .take(40)
        .collect();

    if image_paths.is_empty() {
        return Ok(candidates);
    }

    let thumbnails = tokio::task::spawn_blocking(move || {
        crate::review::load_review_thumbnail_batch(&image_paths, 280, None, 40)
    })
    .await
    .map_err(|e| format!("加载缩略图失败：{}", e))?;

    let result: Vec<VideoCandidate> = candidates
        .into_iter()
        .map(|mut c| {
            if let Some(thumb) = thumbnails.get(&c.path) {
                c.thumbnail_data_url = Some(thumb.clone());
            }
            c
        })
        .collect();

    Ok(result)
}

/// 渲染视频任务（对应 `video:renderTask` IPC 通道）。
#[tauri::command]
pub async fn video_render_task(
    payload: VideoRenderPayload,
    app: AppHandle,
) -> Result<VideoRenderResult, String> {
    Ok(render_video_task(payload, Some(&app)).await)
}

/// 取消渲染（对应 `video:cancelRender` IPC 通道）。
#[tauri::command]
pub async fn video_cancel_render(task_id: String) -> Result<serde_json::Value, String> {
    if task_id.is_empty() {
        return Ok(serde_json::json!({ "canceled": false }));
    }

    let pid = {
        let mut guard = RUNNING_PROCESSES.lock().unwrap();
        guard.as_mut().and_then(|map| map.remove(&task_id))
    };

    if pid.is_none() {
        return Ok(serde_json::json!({ "canceled": false }));
    }

    // 标记为已取消
    {
        let mut guard = CANCELED_TASKS.lock().unwrap();
        let set = guard.get_or_insert_with(HashSet::new);
        set.insert(task_id.clone());
    }

    // 终止进程
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(&["/PID", &pid.unwrap().to_string(), "/F", "/T"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .arg("-9")
            .arg(pid.unwrap().to_string())
            .output();
    }

    Ok(serde_json::json!({ "canceled": true }))
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_video_file_mp4() {
        assert!(is_video_file(Path::new("video.mp4")));
        assert!(is_video_file(Path::new("video.MOV")));
    }

    #[test]
    fn test_is_video_file_non_video() {
        assert!(!is_video_file(Path::new("image.jpg")));
        assert!(!is_video_file(Path::new("doc.pdf")));
    }

    #[test]
    fn test_is_image_file_jpg() {
        assert!(is_image_file(Path::new("photo.jpg")));
        assert!(is_image_file(Path::new("photo.PNG")));
    }

    #[test]
    fn test_normalize_match_text() {
        assert_eq!(normalize_match_text("Hello World"), "helloworld");
        assert_eq!(normalize_match_text("foo-bar_baz"), "foobarbaz");
    }

    #[test]
    fn test_token_overlap_identical() {
        let result = token_overlap("abc", "abc");
        assert!((result - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_build_match_terms_simple() {
        let terms = build_match_terms("hello");
        assert!(!terms.is_empty());
    }

    #[test]
    fn test_build_match_terms_with_numbers() {
        let terms = build_match_terms("product 123");
        assert!(terms.iter().any(|t| t.contains("123")));
    }

    #[test]
    fn test_cpu_threads_at_least_one() {
        assert!(cpu_threads() >= 1);
    }

    #[test]
    fn test_normalize_even_dimension_even() {
        assert_eq!(normalize_even_dimension(Some(1080), 1440), 1080);
    }

    #[test]
    fn test_normalize_even_dimension_odd_rounds_up() {
        assert_eq!(normalize_even_dimension(Some(1081), 1440), 1082);
    }

    #[test]
    fn test_normalize_even_dimension_none() {
        // 1440 已是偶数，返回 1440
        assert_eq!(normalize_even_dimension(None, 1440), 1440);
    }

    #[test]
    fn test_resolve_render_dimensions_portrait_1080() {
        let mut settings = AppSettings::default();
        settings.video_output_size = "portrait-1080".to_string();
        let (w, h) = resolve_render_dimensions(&settings, None, None, 1080, 1440);
        assert_eq!(w, 1080);
        assert_eq!(h, 1440);
    }

    #[test]
    fn test_resolve_render_dimensions_portrait_1440() {
        let mut settings = AppSettings::default();
        settings.video_output_size = "portrait-1440".to_string();
        let (w, h) = resolve_render_dimensions(&settings, None, None, 1080, 1440);
        assert_eq!(w, 1440);
        assert_eq!(h, 1920);
    }

    #[test]
    fn test_resolve_render_fps_from_probe() {
        assert!((resolve_render_fps(Some(30.0)) - 30.0).abs() < 0.01);
        assert!((resolve_render_fps(Some(60.0)) - 60.0).abs() < 0.01);
    }

    #[test]
    fn test_resolve_render_fps_clamps() {
        assert!((resolve_render_fps(Some(120.0)) - 60.0).abs() < 0.01);
        assert!((resolve_render_fps(Some(5.0)) - 15.0).abs() < 0.01);
    }

    #[test]
    fn test_resolve_render_fps_default() {
        assert!((resolve_render_fps(None) - 30.0).abs() < 0.01);
    }

    #[test]
    fn test_frame_duration_for_fps_30() {
        let result = frame_duration_for_fps(30.0);
        assert!(result.starts_with("0.033"));
    }

    #[test]
    fn test_frame_duration_for_fps_60() {
        let result = frame_duration_for_fps(60.0);
        assert!(result.starts_with("0.016"));
    }

    #[test]
    fn test_encoder_args_preserve() {
        let args = encoder_args("preserve");
        assert!(args.contains(&"-preset".to_string()));
        assert!(args.contains(&"slow".to_string()));
    }

    #[test]
    fn test_encoder_args_balanced() {
        let args = encoder_args("balanced");
        assert!(args.contains(&"veryfast".to_string()));
    }

    #[test]
    fn test_encoder_args_high() {
        let args = encoder_args("high");
        assert!(args.contains(&"medium".to_string()));
    }

    #[test]
    fn test_audio_encode_args() {
        let args = audio_encode_args();
        assert!(args.contains(&"aac".to_string()));
        assert!(args.contains(&"192k".to_string()));
    }

    #[test]
    fn test_color_metadata_args() {
        let args = color_metadata_args();
        assert!(args.contains(&"bt709".to_string()));
    }

    #[test]
    fn test_append_limited_log_under_limit() {
        let result = append_limited_log("hello", " world");
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_append_limited_log_over_limit() {
        let initial = "a".repeat(MAX_FFMPEG_LOG_BYTES);
        let result = append_limited_log(&initial, "b");
        assert!(result.len() <= MAX_FFMPEG_LOG_BYTES + 1);
    }

    #[test]
    fn test_parse_progress_time_valid() {
        let result = parse_progress_time("frame= 123 fps= 30 time=00:00:05.50");
        assert!(result.is_some());
        assert!((result.unwrap() - 5.5).abs() < 0.01);
    }

    #[test]
    fn test_parse_progress_time_no_match() {
        let result = parse_progress_time("no time info here");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_ffmpeg_error_no_such_file() {
        let result = parse_ffmpeg_error("No such file or directory", 1);
        assert!(result.contains("不存在"));
    }

    #[test]
    fn test_parse_ffmpeg_error_permission_denied() {
        let result = parse_ffmpeg_error("Permission denied", 1);
        assert!(result.contains("权限"));
    }

    #[test]
    fn test_parse_ffmpeg_error_unknown() {
        let result = parse_ffmpeg_error("some unknown error", 1);
        assert!(result.contains("退出码 1"));
    }

    #[tokio::test]
    async fn test_video_scan_library_empty_root() {
        let settings = AppSettings::default();
        let result = scan_video_library(&settings, "test", "red", false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("视频库"));
    }

    #[tokio::test]
    async fn test_video_scan_library_nonexistent_root() {
        let mut settings = AppSettings::default();
        settings.video_library_dir = r"C:\nonexistent\dir".to_string();
        let result = scan_video_library(&settings, "test", "red", false);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_video_cancel_render_empty_task_id() {
        let result = video_cancel_render("".to_string()).await;
        assert!(result.is_ok());
        let v = result.unwrap();
        assert_eq!(v["canceled"], false);
    }

    #[tokio::test]
    async fn test_video_cancel_render_nonexistent_task() {
        let result = video_cancel_render("nonexistent-task-id".to_string()).await;
        assert!(result.is_ok());
        let v = result.unwrap();
        assert_eq!(v["canceled"], false);
    }

    #[tokio::test]
    async fn test_video_render_task_no_ffmpeg() {
        let mut settings = AppSettings::default();
        settings.ffmpeg_path = r"C:\nonexistent\ffmpeg.exe".to_string();
        settings.video_output_dir = String::new();
        let payload = VideoRenderPayload {
            task: VideoTask::default(),
            settings,
        };
        let result = render_video_task(payload, None).await;
        assert!(!result.success);
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn test_video_render_task_no_output_dir() {
        let mut settings = AppSettings::default();
        settings.ffmpeg_path = String::new();
        settings.video_output_dir = String::new();
        let payload = VideoRenderPayload {
            task: VideoTask::default(),
            settings,
        };
        let result = render_video_task(payload, None).await;
        assert!(!result.success);
    }

    #[test]
    fn test_score_media_candidate_no_terms() {
        let root = Path::new("C:\\root");
        let file = Path::new("C:\\root\\video.mp4");
        let result = score_media_candidate(root, file, &[]);
        assert!(result.kind == Some("video".to_string()));
        assert!(result.file_name.contains("video"));
    }

    #[test]
    fn test_score_media_candidate_with_match() {
        let root = Path::new("C:\\root");
        let file = Path::new("C:\\root\\red-dress-001.jpg");
        let terms = vec!["reddress001".to_string()];
        let result = score_media_candidate(root, file, &terms);
        assert!(result.score > 0.0);
    }

    #[test]
    fn test_walk_for_media_nonexistent_dir() {
        let result = walk_for_media(Path::new(r"C:\nonexistent\dir"));
        assert!(result.is_empty());
    }

    #[test]
    fn test_vec_into_strings() {
        let result = vec_into_strings(&["a", "b", "c"]);
        assert_eq!(result, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn test_unique_output_path_creates_dir() {
        let temp = std::env::temp_dir().join("tauri_video_test_unique_output");
        let _ = std::fs::remove_dir_all(&temp);
        let result = unique_output_path(temp.to_str().unwrap(), "test-video");
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.ends_with("test-video.mp4"));
        assert!(!Path::new(&path).exists()); // 不应已存在
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_unique_output_path_empty_name() {
        let temp = std::env::temp_dir().join("tauri_video_test_unique_output_empty");
        let _ = std::fs::remove_dir_all(&temp);
        let result = unique_output_path(temp.to_str().unwrap(), "");
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.ends_with(".mp4"));
        let _ = std::fs::remove_dir_all(&temp);
    }
}
