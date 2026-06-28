//! 窗口控制模块
//!
//! 对应原 `electron/handlers/window.ts`，提供窗口最小化、切换最大化、关闭命令。
//!
//! 注意：tauri-bridge.ts 中 `minimizeWindow` / `toggleMaximizeWindow` /
//! `closeWindow` 已直接走前端 `getCurrentWindow()` API，不再走 invoke。
//! 这里仍提供后端命令作为兜底，并保持与原 IPC 通道的对应关系。

use tauri::{AppHandle, Manager};

/// 最小化主窗口（对应 `window:minimize` IPC 通道）。
#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .minimize()
            .map_err(|e| format!("minimize failed: {}", e))?;
    }
    Ok(())
}

/// 切换最大化/还原（对应 `window:toggleMaximize` IPC 通道）。
#[tauri::command]
pub async fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window
            .is_maximized()
            .map_err(|e| format!("is_maximized failed: {}", e))?
        {
            window
                .unmaximize()
                .map_err(|e| format!("unmaximize failed: {}", e))?;
        } else {
            window
                .maximize()
                .map_err(|e| format!("maximize failed: {}", e))?;
        }
    }
    Ok(())
}

/// 关闭主窗口（对应 `window:close` IPC 通道）。
#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| format!("close failed: {}", e))?;
    }
    Ok(())
}
