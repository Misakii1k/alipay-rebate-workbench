//! 资源路径解析模块
//!
//! 对应原 `electron/utils/paths.ts`，提供应用资源/配置目录路径解析。
//! 使用 `dirs` crate 跨平台获取目录，在 Windows 上返回
//! `%APPDATA%/<bundleId>` 作为配置目录。

use std::path::{Path, PathBuf};

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
/// 注意：Tauri 在打包后会将 resources 映射到特定路径，运行时通过
/// `app.path().resource_dir()` 获取。这里返回开发环境的相对路径回退。
pub fn get_resources_dir() -> PathBuf {
    PathBuf::from("resources")
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
pub fn get_ffmpeg_path() -> PathBuf {
    get_resources_dir().join("bin").join("ffmpeg.exe")
}

/// 返回 es.exe 路径（resources/bin/es.exe）。
pub fn get_es_path() -> PathBuf {
    get_resources_dir().join("bin").join("es.exe")
}

/// 返回支付宝模板路径（resources/assets/alipay-template.xlsx）。
pub fn get_alipay_template_path() -> PathBuf {
    get_resources_dir()
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
    fn test_get_ffmpeg_path() {
        let p = get_ffmpeg_path();
        assert!(p.ends_with("bin") || p.to_str().map(|s| s.contains("bin")).unwrap_or(false));
    }

    #[test]
    fn test_get_es_path() {
        let p = get_es_path();
        assert!(p.ends_with("es.exe"));
    }

    #[test]
    fn test_get_alipay_template_path() {
        let p = get_alipay_template_path();
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
