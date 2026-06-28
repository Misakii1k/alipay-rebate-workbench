//! 文件对话框模块
//!
//! 对应原 `electron/handlers/files.ts`，包装 tauri-plugin-dialog。
//!
//! 注意：tauri-bridge.ts 中 `selectFiles` / `selectDirectory` 已直接使用
//! 前端 Tauri dialog 插件，不再走 invoke。这里仍提供后端命令作为兜底，
//! 并保持与原 IPC 通道的对应关系。

use crate::types::{FileDialogFilter, SelectPathResult};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// 文件选择对话框（对应 `files:select` IPC 通道）。
///
/// 简化实现：通过 tauri-plugin-dialog 弹出文件选择，单选模式。
#[tauri::command]
pub async fn files_select(
    app: AppHandle,
    filters: Option<Vec<FileDialogFilter>>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    let mut builder = app.dialog().file();

    // 应用过滤器（tauri-plugin-dialog 2.x 的 add_filter 消费 builder 并返回新 builder）
    if let Some(filters) = filters {
        for f in filters.iter() {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&f.name, &exts);
        }
    }

    builder.pick_file(move |path| {
        let result = path.and_then(|p| {
            let s = p.to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        });
        let _ = tx.send(result);
    });

    let result = rx.await.map_err(|e| format!("dialog channel failed: {}", e))?;
    Ok(result)
}

/// 目录选择对话框（对应 `directory:select` IPC 通道）。
#[tauri::command]
pub async fn directory_select(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog().file().pick_folder(move |path| {
        let result = path.and_then(|p| {
            let s = p.to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        });
        let _ = tx.send(result);
    });

    let result = rx.await.map_err(|e| format!("dialog channel failed: {}", e))?;
    Ok(result)
}

/// 保存文件对话框（供 export 模块使用，原版通过 saveDialog 实现）。
#[tauri::command]
pub async fn files_save_dialog(
    app: AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    let mut builder = app.dialog().file().add_filter("Excel", &["xlsx"]);

    if let Some(path) = default_path {
        builder = builder.set_file_name(&path);
    }

    builder.save_file(move |path| {
        let result = path.and_then(|p| {
            let s = p.to_string();
            if s.is_empty() { None } else { Some(s) }
        });
        let _ = tx.send(result);
    });

    let result = rx.await.map_err(|e| format!("dialog channel failed: {}", e))?;
    Ok(result)
}

/// 把 SelectPathResult 转换为前端期望的格式（取消时 canceled=true，paths 空）。
pub fn make_canceled_result() -> SelectPathResult {
    SelectPathResult {
        canceled: true,
        paths: Vec::new(),
    }
}

/// 把选中路径转换为成功的 SelectPathResult。
pub fn make_success_result(path: String) -> SelectPathResult {
    SelectPathResult {
        canceled: false,
        paths: vec![path],
    }
}
