//! 电商运营工具箱 Tauri 后端入口
//!
//! 阶段 3a：注册 11 个基础模块的命令到 invoke_handler。
//! 阶段 3b：追加业务模块命令（ffmpeg/ai/export/recognition/review/title/video）。

// 阶段 3a：基础模块
pub mod clipboard;
pub mod everything;
pub mod files;
pub mod log;
pub mod media;
pub mod paths;
pub mod security;
pub mod settings;
pub mod types;
pub mod update;
pub mod window;
pub mod workbench;

// 阶段 3b：业务模块
pub mod ai;
pub mod export;
pub mod ffmpeg;
pub mod recognition;
pub mod review;
pub mod title;
pub mod video;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 初始化日志系统（tracing + 文件 rotate）
            log::init_logger();
            tracing::info!("应用启动：电商运营工具箱 v{}", app.package_info().version);

            // 确保 app config 目录存在
            if let Err(e) = paths::ensure_app_config_dir() {
                tracing::warn!("创建应用配置目录失败: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 日志
            log::log_append,
            // 设置
            settings::settings_load,
            settings::settings_save,
            // 工作台状态
            workbench::workbench_load,
            workbench::workbench_save,
            // 视频工作台状态
            workbench::video_workbench_load,
            workbench::video_workbench_save,
            // 剪贴板
            clipboard::clipboard_read,
            clipboard::clipboard_write_text,
            // 文件对话框
            files::files_select,
            files::directory_select,
            files::files_save_dialog,
            // 窗口控制
            window::window_minimize,
            window::window_toggle_maximize,
            window::window_close,
            // Everything 搜索
            everything::everything_test,
            // 媒体
            media::media_latest_image,
            media::media_image_preview,
            // 更新
            update::update_check,
            update::update_download,
            update::update_install,
            // ===== 阶段 3b：业务模块命令 =====
            // FFmpeg 诊断与修复
            ffmpeg::ffmpeg_status,
            ffmpeg::ffmpeg_diagnose,
            ffmpeg::ffmpeg_auto_fix,
            // AI 模型连接与列表
            ai::ai_test_connection,
            ai::ai_list_models,
            // Excel 导出
            export::export_workbook,
            // 文本识别（本地规则 + AI 云端校验 + 学习反馈）
            recognition::recognition_recognize_text,
            recognition::recognition_cloud_review,
            recognition::recognition_learn_from_choice,
            // 收评资产扫描、缩略图、文案生成、对话
            review::review_scan_assets,
            review::review_load_thumbnails,
            review::review_load_thumbnail_batch,
            review::review_load_folder_children,
            review::review_rebuild_index,
            review::review_generate_copy,
            review::review_chat,
            review::drag_start_files,
            // 标题评分与 AI 标题生成
            title::title_analyze,
            title::title_generate,
            // 视频库扫描与 FFmpeg 渲染
            video::video_scan_library,
            video::video_render_task,
            video::video_cancel_render,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
