//! Everything (voidtools) 搜索集成模块
//!
//! 对应原 `electron/utils/everything.ts` + `electron/utils/everythingSearch.ts`
//! + `electron/handlers/everything.ts`。
//!
//! - 通过调用 es.exe 子进程执行搜索
//! - 命令 `everything_test` 检查 es.exe 是否可用
//! - 辅助函数 `search_with_everything` 供 review 模块（阶段 3b）调用

use crate::security::{is_path_inside_root, sanitize_everything_query};
use crate::types::{AppSettings, EverythingStatus};
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows：避免子进程弹出/闪烁控制台窗口。
/// es.exe 是控制台程序，Tauri 是纯 GUI 进程，调用时若不加该标志会闪黑窗。
/// spec「revert-to-classic-everything-search」明确要求保留 CREATE_NO_WINDOW。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
fn no_window(cmd: &mut Command) -> &mut Command {
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
fn no_window(cmd: &mut Command) -> &mut Command {
    cmd
}

/// 候选 es.exe 路径列表（已知安装位置）。
fn known_everything_candidates() -> Vec<String> {
    vec![
        // Tauri resources 目录
        "resources/bin/es.exe".to_string(),
        // 用户安装路径
        r"C:\Program Files\Everything\es.exe".to_string(),
        r"C:\Program Files (x86)\Everything\es.exe".to_string(),
        // PATH 中查找
        "es.exe".to_string(),
    ]
}

/// 解析 es.exe 路径：
/// 1. 优先使用 settings.everythingEsPath
/// 2. 回退到已知候选路径
pub fn resolve_everything_es_path(settings: &AppSettings) -> String {
    let mut candidates = Vec::new();
    if !settings.everything_es_path.is_empty() {
        candidates.push(settings.everything_es_path.clone());
    }
    candidates.extend(known_everything_candidates());

    for candidate in candidates {
        if candidate.is_empty() {
            continue;
        }
        // 如果是相对路径或纯文件名，跳过存在性检查（依赖 PATH）
        if Path::new(&candidate).is_absolute() {
            if Path::new(&candidate).exists() {
                return candidate;
            }
        } else {
            // 依赖 PATH 解析，直接返回（test 时会失败）
            return candidate;
        }
    }
    String::new()
}

/// 调用 es.exe 搜索文件。
///
/// 参数：
/// - `es_path`: es.exe 路径
/// - `root`: 搜索根目录（空字符串表示全盘）
/// - `query`: 搜索关键词（会自动消毒）
/// - `exts`: 文件扩展名集合（如 `{".jpg", ".png"}`）
/// - `max_results`: 最大返回数
pub fn search_with_everything(
    es_path: &str,
    root: &str,
    query: &str,
    exts: &std::collections::HashSet<String>,
    max_results: usize,
) -> Vec<String> {
    if es_path.is_empty() {
        return Vec::new();
    }

    // 构造扩展名参数：ext:jpg;png;webp
    let ext_list: Vec<String> = exts
        .iter()
        .map(|e| e.trim_start_matches('.').to_string())
        .collect();
    let ext_arg = ext_list.join(";");

    let mut args: Vec<String> = Vec::new();
    // -utf8：强制 es.exe 以 UTF-8 输出，否则中文 Windows 下默认按系统码页(GBK)输出，
    // 中文路径会被 from_utf8_lossy 解析成替换字符，随后因「路径不存在」被过滤掉，
    // 导致中文关键词搜索结果为空。这是中文搜索可用性的关键。
    args.push("-utf8".to_string());
    args.push("-n".to_string());
    args.push(max_results.to_string());
    if !root.is_empty() {
        args.push("-path".to_string());
        args.push(root.to_string());
    }
    if !ext_arg.is_empty() {
        args.push(format!("ext:{}", ext_arg));
    }

    // 添加消毒后的查询词
    if !query.trim().is_empty() {
        let clean = sanitize_everything_query(query);
        if !clean.is_empty() {
            args.push(clean);
        }
    }

    let mut command = Command::new(es_path);
    command.args(&args);
    no_window(&mut command);
    let output = command.output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|s| !s.is_empty()).collect();

    // 过滤：必须存在 + 在 root 下 + 扩展名匹配
    lines
        .into_iter()
        .filter(|line| {
            let path = line.trim();
            if path.is_empty() {
                return false;
            }
            if !Path::new(path).exists() {
                return false;
            }
            if !root.is_empty() && !is_path_inside_root(path, root) {
                return false;
            }
            let ext = Path::new(path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| format!(".{}", e.to_lowercase()))
                .unwrap_or_default();
            exts.contains(&ext)
        })
        .map(|s| s.to_string())
        .collect()
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 测试 Everything 是否可用（对应 `everything:test` IPC 通道）。
///
/// 对齐 electron 基线与 spec「revert-to-classic-everything-search」：
/// - 解析 es.exe 路径，找不到则返回友好提示。
/// - 用一个简单 test 查询执行 `search_with_everything`，能正常执行即视为可用。
/// - 不自动拉起 Everything 服务，不弹出任何窗口。
#[tauri::command]
pub async fn everything_test(settings: AppSettings) -> Result<EverythingStatus, String> {
    let es_path = resolve_everything_es_path(&settings);

    if es_path.is_empty() {
        return Ok(EverythingStatus {
            available: false,
            detail: "未找到 es.exe，请确认 Everything 已安装并在后台运行。".to_string(),
        });
    }

    // 在阻塞线程中执行一次轻量探测搜索（es.exe 是同步子进程）。
    let probe_path = es_path.clone();
    let executed = tokio::task::spawn_blocking(move || {
        run_es_probe(&probe_path)
    })
    .await
    .unwrap_or(false);

    if executed {
        Ok(EverythingStatus {
            available: true,
            detail: "Everything 已就绪，搜索可用。".to_string(),
        })
    } else {
        Ok(EverythingStatus {
            available: false,
            detail: "es.exe 已找到但执行失败，请确认 Everything 主程序正在后台运行。".to_string(),
        })
    }
}

/// 执行一次最小化的 es.exe 探测（`-utf8 -n 1 test`），能成功执行返回 true。
fn run_es_probe(es_path: &str) -> bool {
    let mut command = Command::new(es_path);
    command.args(["-utf8", "-n", "1", "test"]);
    no_window(&mut command);
    match command.output() {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_known_everything_candidates_not_empty() {
        let candidates = known_everything_candidates();
        assert!(!candidates.is_empty());
        // 应包含 Tauri resources 路径
        assert!(candidates.iter().any(|c| c.contains("resources")));
    }

    #[test]
    fn test_resolve_everything_es_path_empty_settings() {
        let settings = AppSettings::default();
        // 默认配置中 everythingEsPath 为空
        // 应该回退到候选路径
        let resolved = resolve_everything_es_path(&settings);
        // 在测试环境下 es.exe 可能存在于 resources/bin，返回完整路径或空
        assert!(resolved.is_empty() || resolved.ends_with("es.exe"));
    }

    #[test]
    fn test_resolve_everything_es_path_with_custom_path() {
        let mut settings = AppSettings::default();
        settings.everything_es_path = r"C:\nonexistent\es.exe".to_string();
        let resolved = resolve_everything_es_path(&settings);
        // 自定义路径不存在，应该回退到候选路径
        assert!(resolved.is_empty() || resolved.ends_with("es.exe"));
    }

    #[test]
    fn test_search_with_everything_empty_es_path() {
        let exts: HashSet<String> = [".jpg".to_string()].iter().cloned().collect();
        let result = search_with_everything("", "", "test", &exts, 10);
        assert!(result.is_empty());
    }

    #[test]
    fn test_search_with_everything_nonexistent_es_path() {
        let exts: HashSet<String> = [".jpg".to_string()].iter().cloned().collect();
        let result = search_with_everything(
            r"C:\nonexistent\es.exe",
            "",
            "test",
            &exts,
            10,
        );
        assert!(result.is_empty());
    }
}
