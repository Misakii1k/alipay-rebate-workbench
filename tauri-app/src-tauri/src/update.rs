//! 自动更新模块
//!
//! 对应原 `electron/utils/updater.ts` + `electron/handlers/update.ts`。
//!
//! 包装 `tauri-plugin-updater`。原版 Electron 项目中自动更新实际是禁用的
//! （`updater.ts` 中所有方法返回 "暂未启用"），这里保持同样行为：
//! - `update_check` 返回 idle 状态
//! - `update_download` / `update_install` 抛错
//!
//! tauri-bridge.ts 中 `installUpdate` 优先使用前端 Tauri updater 插件，
//! 失败时回退到 invoke `update_install`，因此后端命令仍需存在。

use crate::types::{AppSettings, UpdateInfo, UpdateStatus};

/// 检查更新（对应 `update:check` IPC 通道）。
///
/// 简化实现：返回 idle 状态（与原版 updater.ts 一致）。
#[tauri::command]
pub async fn update_check(_settings: AppSettings) -> Result<UpdateStatus, String> {
    Ok(UpdateStatus::default())
}

/// 下载更新（对应 `update:download` IPC 通道）。
///
/// 简化实现：抛错（与原版 updater.ts 一致）。
#[tauri::command]
pub async fn update_download() -> Result<(), String> {
    Err("自动更新暂未启用。".to_string())
}

/// 安装更新（对应 `update:install` IPC 通道）。
///
/// 简化实现：抛错（与原版 updater.ts 一致）。
#[tauri::command]
pub async fn update_install() -> Result<(), String> {
    Err("自动更新暂未启用。".to_string())
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 检查更新信息（供其他模块调用）。
pub async fn check_for_updates(_settings: &AppSettings) -> UpdateStatus {
    UpdateStatus::default()
}

/// 获取默认 UpdateInfo（无更新）。
pub fn no_update_info() -> UpdateInfo {
    UpdateInfo {
        version: String::new(),
        available: false,
        notes: String::new(),
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_update_status_idle() {
        let s = UpdateStatus::default();
        assert_eq!(s.state, "idle");
        assert_eq!(s.detail, "自动更新暂未启用。");
    }

    #[test]
    fn test_no_update_info() {
        let info = no_update_info();
        assert!(!info.available);
        assert!(info.version.is_empty());
    }

    #[tokio::test]
    async fn test_check_for_updates_returns_idle() {
        let settings = AppSettings::default();
        let status = check_for_updates(&settings).await;
        assert_eq!(status.state, "idle");
    }
}
