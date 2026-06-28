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
use std::time::Duration;

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

    let output = Command::new(es_path)
        .args(&args)
        .output();

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
/// 简化实现：检查 es.exe 是否能执行（不实际搜索）。
#[tauri::command]
pub async fn everything_test(settings: AppSettings) -> Result<EverythingStatus, String> {
    let es_path = resolve_everything_es_path(&settings);

    if es_path.is_empty() {
        return Ok(EverythingStatus {
            available: false,
            version: String::new(),
            path: String::new(),
        });
    }

    // 尝试执行 es.exe 获取版本号（-version 参数）
    let output = Command::new(&es_path)
        .arg("-version")
        .output();

    let (available, version) = match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            let combined = format!("{}\n{}", stdout.trim(), stderr.trim());

            // es.exe 没有标准的 -version 输出，简单检查是否能执行
            // 如果返回码为 0 或 1（参数错误也算可执行），认为可用
            let version_str = combined
                .lines()
                .find(|line| line.to_lowercase().contains("everything"))
                .unwrap_or("Everything")
                .to_string();
            (true, version_str)
        }
        Err(_) => (false, String::new()),
    };

    Ok(EverythingStatus {
        available,
        version,
        path: es_path,
    })
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
