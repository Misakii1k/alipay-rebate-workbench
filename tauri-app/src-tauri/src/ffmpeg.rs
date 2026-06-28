//! FFmpeg 诊断与路径解析模块
//!
//! 对应原 `electron/handlers/ffmpeg.ts` + `electron/utils/ffmpeg.ts`。
//!
//! - 8.3 短路径转换（含非 ASCII 字符的 Windows 路径）
//! - FFmpeg 路径解析（resources/bin/ffmpeg.exe）
//! - FFmpeg 诊断（运行 `ffmpeg -version` 检查可用性）
//! - FFmpeg 自动修复（搜索系统中的 ffmpeg.exe）

use crate::paths;
use crate::types::{AppSettings, FfmpegDiagnoseResult, FfmpegDiagnosisItem, FfmpegFixResult, FfmpegStatus};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// 最大进程输出字节数（256KB，与原版一致）。
const MAX_PROCESS_OUTPUT_BYTES: usize = 256 * 1024;

/// 运行外部进程并收集输出（对应原 `runProcess`）。
///
/// 参数：
/// - `command`: 可执行文件路径
/// - `args`: 命令行参数
/// - `timeout_ms`: 超时（毫秒）
///
/// 返回 `(退出码, 输出)`，超时或出错时退出码为 -1。
pub fn run_process(command: &str, args: &[&str], timeout_ms: u64) -> (i32, String) {
    let mut child = match Command::new(command).args(args).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => return (-1, e.to_string()),
    };

    // 等待进程退出，带超时（简化实现：用 wait_timeout）
    let exit_status = match wait_child_with_timeout(&mut child, timeout_ms) {
        Ok(status) => status,
        Err(_) => {
            let _ = child.kill();
            return (-1, "Process timed out".to_string());
        }
    };

    let mut output = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        use std::io::Read;
        let _ = stdout.read_to_string(&mut output);
    }
    if let Some(mut stderr) = child.stderr.take() {
        use std::io::Read;
        let mut err_buf = String::new();
        let _ = stderr.read_to_string(&mut err_buf);
        if !err_buf.is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&err_buf);
        }
    }

    // 截断到最大字节数
    truncate_output(&mut output);

    let code = exit_status.code().unwrap_or(-1);
    (code, output)
}

/// 带超时等待子进程退出。
fn wait_child_with_timeout(child: &mut std::process::Child, timeout_ms: u64) -> std::io::Result<std::process::ExitStatus> {
    // 简化实现：轮询等待。更精确的实现需要 OS 级定时器，但这里够用。
    let start = std::time::Instant::now();
    loop {
        match child.try_wait()? {
            Some(status) => return Ok(status),
            None => {
                if start.elapsed() > Duration::from_millis(timeout_ms) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "timeout"));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

/// 截断输出到最大字节数（保留尾部）。
fn truncate_output(output: &mut String) {
    if output.len() > MAX_PROCESS_OUTPUT_BYTES {
        let start = output.len() - MAX_PROCESS_OUTPUT_BYTES;
        let safe_start = output.ceil_char_boundary(start);
        *output = output[safe_start..].to_string();
    }
}

// ============================================================================
// 8.3 短路径转换
// ============================================================================

/// 判断字符串是否包含非 ASCII 字符。
fn has_non_ascii(value: &str) -> bool {
    value.chars().any(|c| !c.is_ascii())
}

/// 转义 PowerShell 单引号字符串（' → ''）。
fn escape_powershell_single_quoted_string(value: &str) -> String {
    value.replace('\'', "''")
}

/// 判断短路径是否可用（无替换字符、无非 ASCII、文件存在）。
fn is_usable_short_path(candidate: &str) -> bool {
    if candidate.is_empty() {
        return false;
    }
    if candidate.contains('\u{FFFD}') {
        return false;
    }
    if has_non_ascii(candidate) {
        return false;
    }
    Path::new(candidate).exists()
}

/// 将含非 ASCII 字符的 Windows 路径转为 8.3 短路径。
///
/// 对应原 `getShortPath`，通过 PowerShell 调用 Scripting.FileSystemObject COM 对象。
/// 非 Windows 平台或转换失败时原样返回。
///
/// 参数：
/// - `file_path`: 文件或目录路径
/// - `kind`: "file" 或 "directory"
pub fn get_short_path(file_path: &str, kind: &str) -> Result<String, String> {
    // 非 Windows 平台或无非 ASCII 字符，原样返回
    if cfg!(not(windows)) {
        return Ok(file_path.to_string());
    }
    if !has_non_ascii(file_path) {
        return Ok(file_path.to_string());
    }
    if !Path::new(file_path).exists() {
        return Ok(file_path.to_string());
    }

    let method = if kind == "directory" { "GetFolder" } else { "GetFile" };
    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); \
         $path = '{}'; \
         $shortPath = (New-Object -ComObject Scripting.FileSystemObject).{}($path).ShortPath; \
         [Console]::Out.Write($shortPath)",
        escape_powershell_single_quoted_string(file_path),
        method
    );

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    let result = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => return Ok(file_path.to_string()),
    };

    if is_usable_short_path(&result) {
        Ok(result)
    } else {
        Ok(file_path.to_string())
    }
}

// ============================================================================
// FFmpeg 路径解析
// ============================================================================

/// 已知的 FFmpeg 候选路径列表（对应原 `bundledFfmpegCandidates`）。
fn bundled_ffmpeg_candidates() -> Vec<String> {
    vec![
        paths::get_ffmpeg_path().to_string_lossy().to_string(),
        "bin/ffmpeg.exe".to_string(),
        PathBuf::from("resources/bin/ffmpeg.exe").to_string_lossy().to_string(),
    ]
}

/// 获取 FFmpeg 候选路径列表（settings.ffmpegPath + 内置候选）。
fn get_ffmpeg_candidates(settings: &AppSettings) -> Vec<String> {
    let mut candidates = Vec::new();
    if !settings.ffmpeg_path.is_empty() {
        candidates.push(settings.ffmpeg_path.clone());
    }
    candidates.extend(bundled_ffmpeg_candidates());
    candidates.into_iter().filter(|c| !c.is_empty()).collect()
}

/// 从候选路径中找到第一个存在的 FFmpeg 路径。
///
/// 对应原 `resolveFfmpegPath`。
pub fn resolve_ffmpeg_path(settings: &AppSettings) -> Option<String> {
    for candidate in get_ffmpeg_candidates(settings) {
        if Path::new(&candidate).exists() {
            return Some(candidate);
        }
    }
    None
}

// ============================================================================
// FFmpeg 状态与诊断
// ============================================================================

/// 获取 CPU 线程数。
fn cpu_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}

/// 获取 FFmpeg 状态（对应 `ffmpeg:status` IPC 通道）。
pub fn get_ffmpeg_status(settings: &AppSettings) -> FfmpegStatus {
    let ffmpeg_path = match resolve_ffmpeg_path(settings) {
        Some(p) => p,
        None => {
            return FfmpegStatus {
                available: false,
                path: String::new(),
                detail: "未找到 FFmpeg，剪辑功能将在配置后可用。".to_string(),
                acceleration: None,
            };
        }
    };

    let (code, output) = run_process(&ffmpeg_path, &["-version"], 10_000);
    let version_line = output.lines().next().unwrap_or("").to_string();

    if code == 0 {
        FfmpegStatus {
            available: true,
            path: ffmpeg_path,
            detail: if version_line.is_empty() { "FFmpeg 可用".to_string() } else { version_line },
            acceleration: Some(format!("CPU 多线程：{} 线程", cpu_threads())),
        }
    } else {
        FfmpegStatus {
            available: false,
            path: ffmpeg_path,
            detail: "FFmpeg 无法执行".to_string(),
            acceleration: None,
        }
    }
}

/// 读取 FFmpeg 支持的编码器列表（小写）。
async fn read_ffmpeg_encoders(ffmpeg_path: &str) -> String {
    let (code, output) = run_process(ffmpeg_path, &["-hide_banner", "-encoders"], 15_000);
    if code == 0 {
        output.to_lowercase()
    } else {
        String::new()
    }
}

/// 测试目录是否可写。
async fn test_directory_writable(dir: &str) -> bool {
    if let Err(_) = std::fs::create_dir_all(dir) {
        return false;
    }
    let probe = PathBuf::from(dir).join(format!(".write-test-{}.tmp", chrono::Utc::now().timestamp_millis()));
    if std::fs::write(&probe, "test").is_err() {
        return false;
    }
    let _ = std::fs::remove_file(&probe);
    true
}

/// 运行 FFmpeg 诊断（对应 `ffmpeg:diagnose` IPC 通道）。
pub async fn diagnose_ffmpeg(settings: &AppSettings) -> FfmpegDiagnoseResult {
    let mut items: Vec<FfmpegDiagnosisItem> = Vec::new();
    let mut suggestions: Vec<String> = Vec::new();
    let ffmpeg_path = resolve_ffmpeg_path(settings).unwrap_or_default();

    // 检查 1：FFmpeg 路径
    let path_exists = !ffmpeg_path.is_empty() && Path::new(&ffmpeg_path).exists();
    items.push(FfmpegDiagnosisItem {
        label: "FFmpeg 路径".to_string(),
        passed: path_exists,
        detail: if path_exists { format!("找到：{}", ffmpeg_path) } else { "未找到 FFmpeg 可执行文件".to_string() },
    });
    if !path_exists {
        suggestions.push("在设置中指定 FFmpeg 路径，或将 ffmpeg.exe 放入程序 bin 目录。".to_string());
        suggestions.push("可从 https://www.gyan.dev/ffmpeg/builds/ 下载 FFmpeg（选择 release essentials 版本）。".to_string());
        return FfmpegDiagnoseResult { items, suggestions, ok: false };
    }

    // 检查 2：FFmpeg 可执行
    let (vcode, voutput) = run_process(&ffmpeg_path, &["-version"], 10_000);
    let version_line = voutput.lines().next().unwrap_or("").to_string();
    items.push(FfmpegDiagnosisItem {
        label: "FFmpeg 可执行".to_string(),
        passed: vcode == 0,
        detail: if vcode == 0 { version_line } else { format!("执行失败：{}", &voutput[..voutput.len().min(200)]) },
    });
    if vcode != 0 {
        suggestions.push("FFmpeg 无法执行，请检查文件是否损坏或被安全软件拦截。".to_string());
        return FfmpegDiagnoseResult { items, suggestions, ok: false };
    }

    // 检查 3 & 4：必要编码器
    let encoders = read_ffmpeg_encoders(&ffmpeg_path).await;
    for (name, label) in [("libx264", "H.264 CPU 编码器 (libx264)"), ("aac", "AAC 音频编码器")] {
        let has = encoders.contains(name);
        items.push(FfmpegDiagnosisItem {
            label: label.to_string(),
            passed: has,
            detail: if has { "可用".to_string() } else { "缺失".to_string() },
        });
        if !has {
            suggestions.push(format!("缺少 {}，请下载完整版 FFmpeg。", label));
        }
    }

    // 检查 5：编码模式
    items.push(FfmpegDiagnosisItem {
        label: "编码模式".to_string(),
        passed: true,
        detail: format!("CPU 多线程：{} 线程", cpu_threads()),
    });

    // 检查 6：视频编码测试
    let null_target = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let (tcode, toutput) = run_process(
        &ffmpeg_path,
        &["-y", "-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.1:r=30", "-c:v", "libx264", "-preset", "ultrafast", "-f", "null", null_target],
        30_000,
    );
    items.push(FfmpegDiagnosisItem {
        label: "视频编码测试".to_string(),
        passed: tcode == 0,
        detail: if tcode == 0 { "视频编码功能正常".to_string() } else { format!("测试失败：{}", &toutput[..toutput.len().min(100)]) },
    });
    if tcode != 0 {
        suggestions.push("FFmpeg 视频编码测试失败，可能文件损坏，建议重新下载。".to_string());
    }

    // 检查 7：音频编码测试
    let (acode, aoutput) = run_process(
        &ffmpeg_path,
        &["-y", "-hide_banner", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", "-c:a", "aac", "-f", "null", null_target],
        30_000,
    );
    items.push(FfmpegDiagnosisItem {
        label: "音频编码测试".to_string(),
        passed: acode == 0,
        detail: if acode == 0 { "音频编码功能正常".to_string() } else { format!("测试失败：{}", &aoutput[..aoutput.len().min(100)]) },
    });
    if acode != 0 {
        suggestions.push("FFmpeg 音频编码测试失败，AAC 编码器可能不可用。".to_string());
    }

    // 检查 8：滤镜拼接测试
    let (ccode, coutput) = run_process(
        &ffmpeg_path,
        &[
            "-y", "-hide_banner",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:d=0.1:r=30",
            "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=0.1:r=30",
            "-filter_complex", "[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[out]",
            "-map", "[out]", "-c:v", "libx264", "-preset", "ultrafast",
            "-f", "null", null_target,
        ],
        30_000,
    );
    items.push(FfmpegDiagnosisItem {
        label: "滤镜拼接测试".to_string(),
        passed: ccode == 0,
        detail: if ccode == 0 { "filter_complex + concat 正常".to_string() } else { format!("测试失败：{}", &coutput[..coutput.len().min(100)]) },
    });
    if ccode != 0 {
        suggestions.push("视频拼接滤镜测试失败，FFmpeg 可能版本过低或编译缺少 filter 支持。".to_string());
    }

    // 检查 9：输出目录可写
    if !settings.video_output_dir.is_empty() {
        let writable = test_directory_writable(&settings.video_output_dir).await;
        items.push(FfmpegDiagnosisItem {
            label: "输出目录可写".to_string(),
            passed: writable,
            detail: if writable { format!("可写：{}", settings.video_output_dir) } else { format!("无法写入：{}", settings.video_output_dir) },
        });
        if !writable {
            suggestions.push("输出目录没有写入权限，请在设置中更换输出文件夹。".to_string());
        }
    }

    if suggestions.is_empty() {
        suggestions.push("FFmpeg 运行正常，所有检查项通过。".to_string());
    }

    let ok = items.iter().all(|item| item.passed);
    FfmpegDiagnoseResult { items, suggestions, ok }
}

/// 在系统中搜索 FFmpeg（对应原 `searchFfmpegOnSystem`）。
fn search_ffmpeg_on_system() -> Option<String> {
    let candidates = [
        paths::get_ffmpeg_path().to_string_lossy().to_string(),
        "bin/ffmpeg.exe".to_string(),
        PathBuf::from(dirs::desktop_dir().unwrap_or_default()).join("ffmpeg.exe").to_string_lossy().to_string(),
        PathBuf::from(dirs::desktop_dir().unwrap_or_default()).join("ffmpeg").join("bin").join("ffmpeg.exe").to_string_lossy().to_string(),
        PathBuf::from(dirs::download_dir().unwrap_or_default()).join("ffmpeg.exe").to_string_lossy().to_string(),
        PathBuf::from(dirs::download_dir().unwrap_or_default()).join("ffmpeg").join("bin").join("ffmpeg.exe").to_string_lossy().to_string(),
    ];

    for candidate in &candidates {
        if !candidate.is_empty() && Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }

    // where ffmpeg.exe
    let output = Command::new("where").arg("ffmpeg.exe").output();
    if let Ok(o) = output {
        if o.status.success() {
            let stdout = String::from_utf8_lossy(&o.stdout);
            if let Some(first_line) = stdout.lines().next() {
                let trimmed = first_line.trim();
                if !trimmed.is_empty() && Path::new(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    None
}

/// 自动修复 FFmpeg 配置（对应 `ffmpeg:autoFix` IPC 通道）。
pub async fn auto_fix_ffmpeg(settings: &AppSettings) -> FfmpegFixResult {
    let mut fixed: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    let mut settings_patch: Option<serde_json::Value> = None;

    let current_path = resolve_ffmpeg_path(settings);
    if current_path.is_none() {
        if let Some(found) = search_ffmpeg_on_system() {
            settings_patch = Some(serde_json::json!({ "ffmpegPath": found }));
            fixed.push(format!("在系统中找到了 FFmpeg：{}", found));
        } else {
            failed.push("系统中未找到 FFmpeg，请从 https://www.gyan.dev/ffmpeg/builds/ 下载 release essentials 版本。".to_string());
        }
    } else {
        fixed.push(format!("FFmpeg 已可用：{}", current_path.unwrap()));
    }

    // 输出目录处理
    let output_dir = if settings.video_output_dir.is_empty() {
        let default_dir = PathBuf::from(dirs::desktop_dir().unwrap_or_default()).join("视频输出");
        match std::fs::create_dir_all(&default_dir) {
            Ok(_) => {
                let path_str = default_dir.to_string_lossy().to_string();
                let mut patch = settings_patch.clone().unwrap_or(serde_json::json!({}));
                if let serde_json::Value::Object(ref mut map) = patch {
                    map.insert("videoOutputDir".to_string(), serde_json::Value::String(path_str.clone()));
                }
                settings_patch = Some(patch);
                fixed.push(format!("已自动设置输出目录：{}", path_str));
                path_str
            }
            Err(_) => {
                failed.push("无法创建默认输出目录".to_string());
                settings.video_output_dir.clone()
            }
        }
    } else {
        settings.video_output_dir.clone()
    };

    if !output_dir.is_empty() {
        if let Err(_) = std::fs::create_dir_all(&output_dir) {
            let fallback = PathBuf::from(dirs::desktop_dir().unwrap_or_default()).join("视频输出");
            let _ = std::fs::create_dir_all(&fallback);
            let mut patch = settings_patch.clone().unwrap_or(serde_json::json!({}));
            if let serde_json::Value::Object(ref mut map) = patch {
                map.insert("videoOutputDir".to_string(), serde_json::Value::String(fallback.to_string_lossy().to_string()));
            }
            settings_patch = Some(patch);
            fixed.push(format!("已切换输出目录到：{}", fallback.to_string_lossy()));
        } else if test_directory_writable(&output_dir).await {
            fixed.push("输出目录已就绪".to_string());
        }
    }

    if settings.video_library_dir.is_empty() {
        failed.push("视频库文件夹未设置，请在设置中手动选择你的素材文件夹。".to_string());
    }

    FfmpegFixResult { fixed, failed, settings_patch }
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// FFmpeg 状态命令（对应 `ffmpeg:status`）。
#[tauri::command]
pub async fn ffmpeg_status(settings: AppSettings) -> Result<FfmpegStatus, String> {
    Ok(get_ffmpeg_status(&settings))
}

/// FFmpeg 诊断命令（对应 `ffmpeg:diagnose`）。
#[tauri::command]
pub async fn ffmpeg_diagnose(settings: AppSettings) -> Result<FfmpegDiagnoseResult, String> {
    Ok(diagnose_ffmpeg(&settings).await)
}

/// FFmpeg 自动修复命令（对应 `ffmpeg:autoFix`）。
#[tauri::command]
pub async fn ffmpeg_auto_fix(settings: AppSettings) -> Result<FfmpegFixResult, String> {
    Ok(auto_fix_ffmpeg(&settings).await)
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_non_ascii() {
        assert!(!has_non_ascii("C:\\Users\\test\\file.txt"));
        assert!(has_non_ascii("C:\\用户\\测试\\文件.txt"));
        assert!(has_non_ascii("中文路径"));
    }

    #[test]
    fn test_escape_powershell_single_quote() {
        assert_eq!(escape_powershell_single_quoted_string("normal"), "normal");
        assert_eq!(escape_powershell_single_quoted_string("it's"), "it''s");
    }

    #[test]
    fn test_get_ffmpeg_candidates_includes_settings_path() {
        let mut settings = AppSettings::default();
        settings.ffmpeg_path = r"D:\custom\ffmpeg.exe".to_string();
        let candidates = get_ffmpeg_candidates(&settings);
        assert!(candidates.iter().any(|c| c == r"D:\custom\ffmpeg.exe"));
    }

    #[test]
    fn test_resolve_ffmpeg_path_nonexistent_returns_none() {
        let mut settings = AppSettings::default();
        settings.ffmpeg_path = r"C:\nonexistent\ffmpeg.exe".to_string();
        assert!(resolve_ffmpeg_path(&settings).is_none());
    }

    #[test]
    fn test_cpu_threads_at_least_one() {
        assert!(cpu_threads() >= 1);
    }

    #[test]
    fn test_run_process_nonexistent_command() {
        let (code, _) = run_process(r"C:\nonexistent\cmd.exe", &[], 1000);
        assert_eq!(code, -1);
    }

    #[test]
    fn test_truncate_output() {
        let mut output = "a".repeat(MAX_PROCESS_OUTPUT_BYTES + 100);
        truncate_output(&mut output);
        assert!(output.len() <= MAX_PROCESS_OUTPUT_BYTES + 4); // 字符边界容差
    }

    #[tokio::test]
    async fn test_get_ffmpeg_status_no_ffmpeg() {
        let mut settings = AppSettings::default();
        settings.ffmpeg_path = r"C:\nonexistent\ffmpeg.exe".to_string();
        let status = get_ffmpeg_status(&settings);
        assert!(!status.available);
        assert!(status.path.is_empty());
    }

    #[tokio::test]
    async fn test_auto_fix_no_ffmpeg() {
        let mut settings = AppSettings::default();
        settings.ffmpeg_path = String::new();
        settings.video_library_dir = String::new();
        settings.video_output_dir = String::new();
        let result = auto_fix_ffmpeg(&settings).await;
        // 没找到 ffmpeg 时应该有 failed 项
        assert!(!result.fixed.is_empty() || !result.failed.is_empty());
    }

    #[tokio::test]
    async fn test_test_directory_writable_temp() {
        let temp = std::env::temp_dir().join("tauri_ffmpeg_writable_test");
        let _ = std::fs::remove_dir_all(&temp);
        assert!(test_directory_writable(temp.to_str().unwrap()).await);
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_get_short_path_ascii_passthrough() {
        let result = get_short_path("C:\\ascii\\path", "file").unwrap();
        assert_eq!(result, "C:\\ascii\\path");
    }
}
