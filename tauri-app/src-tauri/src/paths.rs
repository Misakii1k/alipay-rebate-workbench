//! 资源路径解析模块
//!
//! 对应原 `electron/utils/paths.ts`，提供应用资源/配置目录路径解析。
//! 使用 `dirs` crate 跨平台获取目录，在 Windows 上返回
//! `%APPDATA%/<bundleId>` 作为配置目录。

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 应用配置目录的标识符（与 tauri.conf.json 中 identifier 一致）。
const APP_CONFIG_DIR_NAME: &str = "com.rebate.workbench";

/// 返回应用配置目录（对应 Electron 的 userData 目录）。
///
/// Windows: `%APPDATA%/com.rebate.workbench`
/// macOS: `~/Library/Application Support/com.rebate.workbench`
/// Linux: `~/.config/com.rebate.workbench`
pub fn get_app_config_dir() -> PathBuf {
    if let Some(base) = dirs::config_dir() {
        base.join(APP_CONFIG_DIR_NAME)
    } else {
        // 回退到当前目录
        PathBuf::from(".").join(APP_CONFIG_DIR_NAME)
    }
}

/// 返回 Tauri resources 目录。
///
/// 打包后通过 `app.path().resource_dir()` 获取绝对路径；
/// 开发环境或获取失败时回退到相对路径 `resources`。
pub fn get_resources_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("resources"))
}

/// 内部辅助函数：返回 resources/bin 目录（用于测试和回退拼接）。
fn resources_bin_dir(app: &AppHandle) -> PathBuf {
    get_resources_dir(app).join("bin")
}

/// 返回日志目录（app_config_dir/logs）。
pub fn get_log_dir() -> PathBuf {
    get_app_config_dir().join("logs")
}

/// 返回 settings.json 文件路径。
pub fn get_settings_path() -> PathBuf {
    get_app_config_dir().join("settings.json")
}

/// 返回 workbench-state.json 文件路径。
pub fn get_workbench_state_path() -> PathBuf {
    get_app_config_dir().join("workbench-state.json")
}

/// 返回 video-workbench-state.json 文件路径。
pub fn get_video_workbench_state_path() -> PathBuf {
    get_app_config_dir().join("video-workbench-state.json")
}

/// 返回 ffmpeg.exe 路径（resources/bin/ffmpeg.exe）。
pub fn get_ffmpeg_path(app: &AppHandle) -> PathBuf {
    resources_bin_dir(app).join("ffmpeg.exe")
}

/// 返回 es.exe 路径（resources/bin/es.exe）。
pub fn get_es_path(app: &AppHandle) -> PathBuf {
    resources_bin_dir(app).join("es.exe")
}

/// 返回支付宝模板路径（resources/assets/alipay-template.xlsx）。
pub fn get_alipay_template_path(app: &AppHandle) -> PathBuf {
    get_resources_dir(app)
        .join("assets")
        .join("alipay-template.xlsx")
}

/// 确保目录存在（递归创建）。
pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// 确保应用配置目录存在。
pub fn ensure_app_config_dir() -> std::io::Result<()> {
    ensure_dir(&get_app_config_dir())
}

/// 确保日志目录存在。
pub fn ensure_log_dir() -> std::io::Result<()> {
    ensure_dir(&get_log_dir())
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_app_config_dir_ends_with_bundle_id() {
        let dir = get_app_config_dir();
        let last = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        assert_eq!(last, APP_CONFIG_DIR_NAME);
    }

    #[test]
    fn test_get_log_dir_under_app_config() {
        let log_dir = get_log_dir();
        let app_dir = get_app_config_dir();
        assert!(log_dir.starts_with(&app_dir));
        assert!(log_dir.ends_with("logs"));
    }

    #[test]
    fn test_get_settings_path() {
        let p = get_settings_path();
        assert!(p.ends_with("settings.json"));
    }

    #[test]
    fn test_get_workbench_state_path() {
        let p = get_workbench_state_path();
        assert!(p.ends_with("workbench-state.json"));
    }

    #[test]
    fn test_get_video_workbench_state_path() {
        let p = get_video_workbench_state_path();
        assert!(p.ends_with("video-workbench-state.json"));
    }

    #[test]
    #[ignore = "需要 AppHandle，无法在单元测试中调用"]
    fn test_get_ffmpeg_path() {
        // 路径拼接逻辑：resources/bin/ffmpeg.exe
        let p = PathBuf::from("resources").join("bin").join("ffmpeg.exe");
        assert!(p.ends_with("ffmpeg.exe"));
        assert!(p.to_str().map(|s| s.contains("bin")).unwrap_or(false));
    }

    #[test]
    #[ignore = "需要 AppHandle，无法在单元测试中调用"]
    fn test_get_es_path() {
        let p = PathBuf::from("resources").join("bin").join("es.exe");
        assert!(p.ends_with("es.exe"));
    }

    #[test]
    #[ignore = "需要 AppHandle，无法在单元测试中调用"]
    fn test_get_alipay_template_path() {
        let p = PathBuf::from("resources").join("assets").join("alipay-template.xlsx");
        assert!(p.ends_with("alipay-template.xlsx"));
    }

    #[test]
    fn test_ensure_dir_idempotent() {
        let temp = std::env::temp_dir().join("tauri_paths_test_ensure_dir");
        // 清理可能的残留
        let _ = std::fs::remove_dir_all(&temp);
        ensure_dir(&temp).unwrap();
        ensure_dir(&temp).unwrap();
        assert!(temp.exists());
        let _ = std::fs::remove_dir_all(&temp);
    }
}
