//! 工作台状态持久化模块
//!
//! 对应原 `electron/utils/workbench.ts` + `electron/handlers/workbench.ts`。
//!
//! - 持久化路径：app config dir 下的 `workbench-state.json` 和 `video-workbench-state.json`
//! - 用 `serde_json` 序列化/反序列化

use crate::log::append_log;
use crate::paths;
use crate::types::{VideoWorkbenchState, WorkbenchState};

// ============================================================================
// 支付宝工作台状态
// ============================================================================

/// 加载支付宝工作台状态（对应 `workbench:load` IPC 通道）。
pub async fn load_workbench_state() -> Result<WorkbenchState, String> {
    paths::ensure_app_config_dir().map_err(|e| e.to_string())?;
    let path = paths::get_workbench_state_path();

    if !path.exists() {
        return Ok(WorkbenchState::default());
    }

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read workbench state failed: {}", e))?;

    let parsed: WorkbenchState = serde_json::from_str(&raw).unwrap_or_else(|e| {
        let _ = append_log(
            "error",
            &format!("读取支付宝工作台状态失败，已回退空状态: {}", e),
            &serde_json::json!({}),
        );
        WorkbenchState::default()
    });

    Ok(parsed)
}

/// 保存支付宝工作台状态（对应 `workbench:save` IPC 通道）。
pub async fn save_workbench_state(mut state: WorkbenchState) -> Result<WorkbenchState, String> {
    paths::ensure_app_config_dir().map_err(|e| e.to_string())?;

    // 写入 savedAt 时间戳
    state.saved_at = Some(chrono::Utc::now().to_rfc3339());

    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("serialize workbench state failed: {}", e))?;

    let path = paths::get_workbench_state_path();
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| format!("write workbench state failed: {}", e))?;

    Ok(state)
}

// ============================================================================
// 视频工作台状态
// ============================================================================

/// 加载视频工作台状态（对应 `videoWorkbench:load` IPC 通道）。
pub async fn load_video_workbench_state() -> Result<VideoWorkbenchState, String> {
    paths::ensure_app_config_dir().map_err(|e| e.to_string())?;
    let path = paths::get_video_workbench_state_path();

    if !path.exists() {
        return Ok(VideoWorkbenchState::default());
    }

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read video workbench state failed: {}", e))?;

    let parsed: VideoWorkbenchState = serde_json::from_str(&raw).unwrap_or_else(|e| {
        let _ = append_log(
            "error",
            &format!("读取视频工作台状态失败，已回退空状态: {}", e),
            &serde_json::json!({}),
        );
        VideoWorkbenchState::default()
    });

    Ok(parsed)
}

/// 保存视频工作台状态（对应 `videoWorkbench:save` IPC 通道）。
pub async fn save_video_workbench_state(
    mut state: VideoWorkbenchState,
) -> Result<VideoWorkbenchState, String> {
    paths::ensure_app_config_dir().map_err(|e| e.to_string())?;

    // 压缩状态：候选数限制 80，log 截断 16000 字符
    for task in state.tasks.iter_mut() {
        // 候选数限制 80
        if task.candidates.len() > 80 {
            task.candidates.truncate(80);
        }
        // 移除 thumbnailDataUrl（节省存储）
        for c in task.candidates.iter_mut() {
            c.thumbnail_data_url = None;
        }
        // log 截断到 16000 字符
        if let Some(log) = task.log.as_mut() {
            let len = log.chars().count();
            if len > 16000 {
                let truncated: String = log.chars().skip(len - 16000).collect();
                *log = truncated;
            }
        }
    }

    // 写入 savedAt 时间戳
    state.saved_at = Some(chrono::Utc::now().to_rfc3339());

    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("serialize video workbench state failed: {}", e))?;

    let path = paths::get_video_workbench_state_path();
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| format!("write video workbench state failed: {}", e))?;

    Ok(state)
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// Tauri 命令：加载支付宝工作台状态。
#[tauri::command]
pub async fn workbench_load() -> Result<WorkbenchState, String> {
    load_workbench_state().await
}

/// Tauri 命令：保存支付宝工作台状态。
#[tauri::command]
pub async fn workbench_save(state: WorkbenchState) -> Result<WorkbenchState, String> {
    save_workbench_state(state).await
}

/// Tauri 命令：加载视频工作台状态。
#[tauri::command]
pub async fn video_workbench_load() -> Result<VideoWorkbenchState, String> {
    load_video_workbench_state().await
}

/// Tauri 命令：保存视频工作台状态。
#[tauri::command]
pub async fn video_workbench_save(state: VideoWorkbenchState) -> Result<VideoWorkbenchState, String> {
    save_video_workbench_state(state).await
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{VideoCandidate, VideoTask};

    #[test]
    fn test_workbench_state_default() {
        let s = WorkbenchState::default();
        assert_eq!(s.current_index, 0);
        assert!(s.rows.is_empty());
        assert_eq!(s.amount_input, "");
    }

    #[test]
    fn test_video_workbench_state_default() {
        let s = VideoWorkbenchState::default();
        assert_eq!(s.current_index, 0);
        assert!(s.tasks.is_empty());
    }

    #[test]
    fn test_video_candidate_serialization() {
        let c = VideoCandidate {
            path: "test.mp4".to_string(),
            file_name: "test.mp4".to_string(),
            score: 0.95,
            reason: "matched".to_string(),
            kind: Some("video".to_string()),
            thumbnail_data_url: Some("data:image/png;base64,...".to_string()),
            matched_path: None,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("fileName"));
        assert!(json.contains("thumbnailDataUrl"));
        let parsed: VideoCandidate = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.path, "test.mp4");
        assert_eq!(parsed.score, 0.95);
    }

    #[test]
    fn test_video_task_default() {
        let t = VideoTask::default();
        assert_eq!(t.status, "draft");
        assert_eq!(t.progress, 0.0);
        assert!(t.candidates.is_empty());
    }
}
