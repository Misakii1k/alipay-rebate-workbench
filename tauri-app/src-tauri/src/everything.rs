//! Everything (voidtools) search integration.
//!
//! The bundled `es.exe` is a command-line client, not the Everything GUI. It
//! needs an already-running Everything service and writes output in the Windows
//! ANSI code page.

use crate::security::{is_path_inside_root, sanitize_everything_query};
use crate::types::{AppSettings, EverythingStatus};
use encoding_rs::GB18030;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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

fn known_everything_candidates() -> Vec<PathBuf> {
    let program_files = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let program_files_x86 = std::env::var_os("ProgramFiles(x86)")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

    let mut candidates = vec![
        program_files.join("Everything").join("es.exe"),
        program_files_x86.join("Everything").join("es.exe"),
    ];
    if let Some(local_app_data) = local_app_data {
        candidates.push(local_app_data.join("Everything").join("es.exe"));
    }
    candidates
}

/// Resolve a verified executable path. The Tauri resource path is used before
/// any machine-wide installation so development and packaged builds behave the
/// same way.
pub fn resolve_everything_es_path(app: &AppHandle, settings: &AppSettings) -> String {
    let mut candidates = Vec::new();
    if !settings.everything_es_path.trim().is_empty() {
        candidates.push(PathBuf::from(&settings.everything_es_path));
    }
    candidates.push(crate::paths::get_es_path(app));
    candidates.extend(known_everything_candidates());

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn build_es_args(root: &str, query: &str, exts: &HashSet<String>, max_results: usize) -> Vec<String> {
    let ext_list = exts
        .iter()
        .map(|extension| extension.trim_start_matches('.').to_string())
        .collect::<Vec<_>>();
    let mut args = vec!["-n".to_string(), max_results.to_string()];

    if !root.is_empty() {
        args.push("-path".to_string());
        args.push(root.to_string());
    }
    if !ext_list.is_empty() {
        args.push(format!("ext:{}", ext_list.join(";")));
    }
    if !query.trim().is_empty() {
        let query = sanitize_everything_query(query);
        if !query.is_empty() {
            args.push(query);
        }
    }
    args
}

fn decode_es_output(output: &[u8]) -> String {
    let (decoded, _, _) = GB18030.decode(output);
    decoded.into_owned()
}

/// Execute a filtered Everything search. `es.exe` 1.1.0.x does not support a
/// `-utf8` switch, so its output is decoded as GB18030 (a superset of GBK).
pub fn search_with_everything(
    es_path: &str,
    root: &str,
    query: &str,
    exts: &HashSet<String>,
    max_results: usize,
) -> Vec<String> {
    if es_path.is_empty() {
        return Vec::new();
    }

    let mut command = Command::new(es_path);
    command.args(build_es_args(root, query, exts, max_results));
    no_window(&mut command);
    let output = match command.output() {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };

    decode_es_output(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter(|path| Path::new(path).exists())
        .filter(|path| root.is_empty() || is_path_inside_root(path, root))
        .filter(|path| {
            let extension = Path::new(path)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| format!(".{}", extension.to_lowercase()))
                .unwrap_or_default();
            exts.contains(&extension)
        })
        .map(ToString::to_string)
        .collect()
}

#[tauri::command]
pub async fn everything_test(
    settings: AppSettings,
    app: AppHandle,
) -> Result<EverythingStatus, String> {
    let es_path = resolve_everything_es_path(&app, &settings);
    if es_path.is_empty() {
        return Ok(EverythingStatus {
            available: false,
            detail: "未找到 es.exe，请确认 Everything 已安装并在后台运行。".to_string(),
        });
    }

    let executed = tokio::task::spawn_blocking(move || run_es_probe(&es_path))
        .await
        .unwrap_or(false);
    Ok(if executed {
        EverythingStatus {
            available: true,
            detail: "Everything 已就绪，搜索可用。".to_string(),
        }
    } else {
        EverythingStatus {
            available: false,
            detail: "es.exe 已找到但执行失败，请确认 Everything 主程序正在后台运行。".to_string(),
        }
    })
}

fn run_es_probe(es_path: &str) -> bool {
    let mut command = Command::new(es_path);
    command.args(["-n", "1", "test"]);
    no_window(&mut command);
    command.output().is_ok_and(|output| output.status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_everything_candidates_are_es_executables() {
        let candidates = known_everything_candidates();
        assert!(!candidates.is_empty());
        assert!(candidates.iter().all(|path| path.ends_with("es.exe")));
    }

    #[test]
    fn test_build_es_args_uses_supported_switches() {
        let exts = HashSet::from([".jpg".to_string(), ".png".to_string()]);
        let args = build_es_args(r"C:\素材", "产品 01", &exts, 42);
        assert_eq!(
            &args[0..4],
            &["-n".to_string(), "42".to_string(), "-path".to_string(), r"C:\素材".to_string()]
        );
        assert!(!args.iter().any(|arg| arg == "-utf8"));
        assert!(args.iter().any(|arg| arg.starts_with("ext:")));
        assert_eq!(args.last(), Some(&"产品 01".to_string()));
    }

    #[test]
    fn test_decode_es_output_gb18030() {
        let (encoded, _, had_errors) = GB18030.encode(r"C:\素材\产品.jpg");
        assert!(!had_errors);
        assert_eq!(decode_es_output(&encoded), r"C:\素材\产品.jpg");
    }

    #[test]
    fn test_search_with_everything_empty_es_path() {
        let exts = HashSet::from([".jpg".to_string()]);
        assert!(search_with_everything("", "", "test", &exts, 10).is_empty());
    }

    #[test]
    fn test_search_with_everything_nonexistent_es_path() {
        let exts = HashSet::from([".jpg".to_string()]);
        assert!(search_with_everything(r"C:\nonexistent\es.exe", "", "test", &exts, 10).is_empty());
    }
}
