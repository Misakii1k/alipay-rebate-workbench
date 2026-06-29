//! 公共类型定义模块
//!
//! 对应前端 `src/lib/shared.ts` 中的类型定义。
//! 所有结构体使用 `#[serde(rename_all = "camelCase")]` 让 Rust snake_case
//! 字段与前端 camelCase 字段自动对齐。

use serde::{Deserialize, Serialize};

// ============================================================================
// API 配置相关
// ============================================================================

/// API 配置类型（openai / anthropic）。
pub type ApiType = String;

/// API 配置 Profile。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiProfile {
    pub id: String,
    pub name: String,
    pub api_type: ApiType,
    pub api_base_url: String,
    pub api_key: String,
    pub text_model: String,
    pub vision_model: String,
}

impl Default for ApiProfile {
    fn default() -> Self {
        Self {
            id: "default".to_string(),
            name: "默认配置".to_string(),
            api_type: "openai".to_string(),
            api_base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            text_model: "gpt-4.1-mini".to_string(),
            vision_model: "gpt-4.1-mini".to_string(),
        }
    }
}

// ============================================================================
// 应用设置
// ============================================================================

/// `video_encoder_mode` 的 serde 默认值（旧配置缺字段时回退 auto）。
fn default_video_encoder_mode() -> String {
    "auto".to_string()
}

/// 应用设置（对应前端 AppSettings）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub api_profiles: Vec<ApiProfile>,
    pub active_api_profile_id: String,
    pub api_base_url: String,
    pub api_key: String,
    pub text_model: String,
    pub vision_model: String,
    pub ai_enabled: bool,
    pub enhanced_cloud_validation: bool,
    pub auto_listen_clipboard: bool,
    pub auto_advance: bool,
    pub confirm_low_confidence: bool,
    pub strict_export_validation: bool,
    pub export_name_owner: String,
    pub fixed_tail_account: String,
    pub fixed_tail_name: String,
    pub model_concurrency: i32,
    pub model_retry_count: i32,
    pub enable_learning_feedback: bool,
    pub learning_prompt_notes: String,
    pub show_beginner_guide: bool,
    pub completed_tours: Vec<String>,
    pub toolbox_name: String,
    pub video_library_dir: String,
    pub video_output_dir: String,
    pub ffmpeg_path: String,
    pub video_speed_mode: bool,
    pub video_scan_mode: String,
    pub video_template: String,
    pub video_output_size: String,
    pub video_quality_mode: String,
    /// 视频编码器选择：auto(默认,GPU优先) / gpu(强制GPU) / cpu(强制CPU)
    /// 加 serde(default)：旧 settings.json 无此字段时回退默认，避免整份设置反序列化失败。
    #[serde(default = "default_video_encoder_mode")]
    pub video_encoder_mode: String,
    pub update_feed_url: String,
    pub review_root_dir: String,
    pub review_professional_level: i32,
    pub review_buyer_level: i32,
    pub review_exaggeration_level: i32,
    pub review_scene_level: i32,
    pub review_mention_value: bool,
    pub review_product_description: String,
    pub review_copy_count: i32,
    pub slice_music_preset_id: String,
    pub slice_custom_music_path: String,
    pub review_api_profile_id: String,
    pub review_custom_prompt: String,
    #[serde(default)]
    pub review_saved_copies: Option<Vec<String>>,
    #[serde(default)]
    pub review_favorite_queries: Option<Vec<String>>,
    pub review_generate_hotkey: String,
    pub review_workspace_mode: String,
    pub review_target_length: i32,
    pub review_thinking_mode: String,
    pub compare_auto_open_reminder_dialog: bool,
    pub compare_show_passed_rows_after_verify: bool,
    pub font_scale: String,
    pub performance_mode: String,
    #[serde(default)]
    pub last_seen_changelog_version: Option<String>,
    pub everything_es_path: String,
    pub sidebar_collapsed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_profiles: vec![ApiProfile::default()],
            active_api_profile_id: "default".to_string(),
            api_base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            text_model: "gpt-4.1-mini".to_string(),
            vision_model: "gpt-4.1-mini".to_string(),
            ai_enabled: true,
            enhanced_cloud_validation: false,
            auto_listen_clipboard: true,
            auto_advance: true,
            confirm_low_confidence: true,
            strict_export_validation: true,
            export_name_owner: String::new(),
            fixed_tail_account: String::new(),
            fixed_tail_name: String::new(),
            model_concurrency: 2,
            model_retry_count: 2,
            enable_learning_feedback: true,
            learning_prompt_notes: String::new(),
            show_beginner_guide: false,
            completed_tours: Vec::new(),
            toolbox_name: "电商运营工具箱".to_string(),
            video_library_dir: String::new(),
            video_output_dir: String::new(),
            ffmpeg_path: String::new(),
            video_speed_mode: false,
            video_scan_mode: "auto".to_string(),
            video_template: "bos-template".to_string(),
            video_output_size: "auto".to_string(),
            video_quality_mode: "preserve".to_string(),
            video_encoder_mode: "auto".to_string(),
            update_feed_url: String::new(),
            review_root_dir: String::new(),
            review_professional_level: 2,
            review_buyer_level: 4,
            review_exaggeration_level: 2,
            review_scene_level: 3,
            review_mention_value: true,
            review_product_description: String::new(),
            review_copy_count: 6,
            slice_music_preset_id: String::new(),
            slice_custom_music_path: String::new(),
            review_api_profile_id: String::new(),
            review_custom_prompt: String::new(),
            review_saved_copies: Some(Vec::new()),
            review_favorite_queries: Some(Vec::new()),
            review_generate_hotkey: "Ctrl+Enter".to_string(),
            review_workspace_mode: "mixed".to_string(),
            review_target_length: 80,
            review_thinking_mode: "auto".to_string(),
            compare_auto_open_reminder_dialog: true,
            compare_show_passed_rows_after_verify: true,
            font_scale: "normal".to_string(),
            performance_mode: "auto".to_string(),
            last_seen_changelog_version: Some(String::new()),
            everything_es_path: String::new(),
            sidebar_collapsed: false,
        }
    }
}

// ============================================================================
// 工作台状态
// ============================================================================

/// 返款行状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebateRow {
    pub id: String,
    pub amount: String,
    pub remark: String,
    pub account: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub raw_text: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub cloud_review: Option<CloudReview>,
}

impl Default for RebateRow {
    fn default() -> Self {
        Self {
            id: String::new(),
            amount: String::new(),
            remark: String::new(),
            account: String::new(),
            name: String::new(),
            status: "pending".to_string(),
            confidence: None,
            reason: None,
            raw_text: None,
            created_at: None,
            cloud_review: None,
        }
    }
}

/// 云端审核结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudReview {
    pub status: String,
    #[serde(default)]
    pub valid: Option<bool>,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub reason: Option<String>,
}

impl Default for CloudReview {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            valid: None,
            account: None,
            name: None,
            confidence: None,
            reason: None,
        }
    }
}

/// 支付宝工作台状态（对应前端 WorkbenchState）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchState {
    pub amount_input: String,
    pub remark_input: String,
    pub rows: Vec<RebateRow>,
    pub current_index: i32,
    #[serde(default)]
    pub saved_at: Option<String>,
}

// ============================================================================
// 视频工作台
// ============================================================================

/// 视频候选项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCandidate {
    pub path: String,
    pub file_name: String,
    pub score: f64,
    pub reason: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub thumbnail_data_url: Option<String>,
    #[serde(default)]
    pub matched_path: Option<String>,
}

impl Default for VideoCandidate {
    fn default() -> Self {
        Self {
            path: String::new(),
            file_name: String::new(),
            score: 0.0,
            reason: String::new(),
            kind: None,
            thumbnail_data_url: None,
            matched_path: None,
        }
    }
}

/// 视频任务。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTask {
    pub id: String,
    pub template: String,
    pub product_name: String,
    pub color_name: String,
    pub output_name: String,
    pub image_path: String,
    pub image_paths: Vec<String>,
    pub video_path: String,
    #[serde(default)]
    pub music_path: Option<String>,
    #[serde(default)]
    pub music_preset_id: Option<String>,
    pub candidates: Vec<VideoCandidate>,
    #[serde(default)]
    pub output_path: Option<String>,
    pub status: String,
    pub progress: f64,
    #[serde(default)]
    pub progress_stage: Option<String>,
    #[serde(default)]
    pub log: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

impl Default for VideoTask {
    fn default() -> Self {
        Self {
            id: String::new(),
            template: "bos-template".to_string(),
            product_name: String::new(),
            color_name: String::new(),
            output_name: String::new(),
            image_path: String::new(),
            image_paths: Vec::new(),
            video_path: String::new(),
            music_path: None,
            music_preset_id: None,
            candidates: Vec::new(),
            output_path: None,
            status: "draft".to_string(),
            progress: 0.0,
            progress_stage: None,
            log: None,
            error: None,
        }
    }
}

/// 视频工作台状态（对应前端 VideoWorkbenchState）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoWorkbenchState {
    pub tasks: Vec<VideoTask>,
    pub current_index: i32,
    #[serde(default)]
    pub saved_at: Option<String>,
}

// ============================================================================
// 剪贴板
// ============================================================================

/// 剪贴板快照（对应前端 ClipboardSnapshot）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSnapshot {
    pub kind: String, // "empty" | "text" | "image"
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub image_data_url: Option<String>,
    pub signature: String,
}

// ============================================================================
// 文件选择
// ============================================================================

/// 文件选择选项（对应前端 SelectFilesOptions）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectFilesOptions {
    pub kind: String, // "image" | "video" | "audio" | "ffmpeg"
    #[serde(default)]
    pub multi: Option<bool>,
}

/// 文件选择结果（对应前端 SelectPathResult）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectPathResult {
    pub canceled: bool,
    pub paths: Vec<String>,
}

/// 文件对话框过滤器。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

// ============================================================================
// Everything 搜索
// ============================================================================

/// Everything 状态（对齐 electron 基线：`{ available, detail }`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingStatus {
    pub available: bool,
    pub detail: String,
}

// ============================================================================
// 更新
// ============================================================================

/// 更新信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub available: bool,
    pub notes: String,
}

/// 更新状态（对应前端 UpdateStatus）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub state: String, // "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error"
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub mandatory: Option<bool>,
    #[serde(default)]
    pub percent: Option<f64>,
    pub detail: String,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            version: None,
            mandatory: None,
            percent: None,
            detail: "自动更新暂未启用。".to_string(),
        }
    }
}

// ============================================================================
// FFmpeg 状态
// ============================================================================

/// FFmpeg 状态（对应前端 FfmpegStatus）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub path: String,
    pub detail: String,
    #[serde(default)]
    pub acceleration: Option<String>,
}

impl Default for FfmpegStatus {
    fn default() -> Self {
        Self {
            available: false,
            path: String::new(),
            detail: String::new(),
            acceleration: None,
        }
    }
}

// ============================================================================
// AI 相关类型
// ============================================================================

/// 模型连接状态（对应前端 ModelConnectionStatus / AiTestResult）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionStatus {
    pub state: String, // "unknown" | "testing" | "connected" | "failed"
    pub detail: String,
}

impl Default for ModelConnectionStatus {
    fn default() -> Self {
        Self {
            state: "unknown".to_string(),
            detail: String::new(),
        }
    }
}

/// 模型信息（对应前端 `{ id, name }`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

/// 聊天消息（供 AI 调用辅助函数使用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 聊天选项（供 AI 调用辅助函数使用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOptions {
    pub temperature: f64,
    pub json_mode: bool,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            temperature: 0.0,
            json_mode: true,
            max_tokens: None,
        }
    }
}

// ============================================================================
// FFmpeg 诊断相关
// ============================================================================

/// FFmpeg 诊断单项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegDiagnosisItem {
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

/// FFmpeg 诊断结果（对应 `ffmpeg:diagnose`）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegDiagnoseResult {
    pub items: Vec<FfmpegDiagnosisItem>,
    pub suggestions: Vec<String>,
    pub ok: bool,
}

/// FFmpeg 自动修复结果（对应 `ffmpeg:autoFix`）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegFixResult {
    pub fixed: Vec<String>,
    pub failed: Vec<String>,
    /// 设置补丁（部分 AppSettings 字段），用 serde_json::Value 表示。
    #[serde(default)]
    pub settings_patch: Option<serde_json::Value>,
}

// ============================================================================
// 导出相关
// ============================================================================

/// 导出尾部行（对应 ExportPayload.tailRow）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportTailRow {
    pub account: String,
    pub name: String,
    pub amount: String,
    pub remark: String,
}

/// 导出负载（对应前端 ExportPayload）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPayload {
    pub rows: Vec<RebateRow>,
    pub default_file_name: String,
    #[serde(default)]
    pub tail_row: Option<ExportTailRow>,
}

/// 导出结果（对应前端 ExportResult）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub canceled: bool,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

// ============================================================================
// 识别相关
// ============================================================================

/// 识别结果（对应前端 RecognitionResult）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionResult {
    pub account: String,
    pub name: String,
    pub confidence: f64,
    pub reason: String,
    pub source: String, // "rules" | "text-model" | "vision-model" | "manual"
    #[serde(default)]
    pub raw_text: Option<String>,
}

impl Default for RecognitionResult {
    fn default() -> Self {
        Self {
            account: String::new(),
            name: String::new(),
            confidence: 0.0,
            reason: String::new(),
            source: "rules".to_string(),
            raw_text: None,
        }
    }
}

/// 本地识别结果子集（用于云端校验输入）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRecognitionResult {
    pub account: String,
    pub name: String,
    pub confidence: f64,
    pub reason: String,
}

/// 识别最终选择模式。
pub type RecognitionFinalChoiceMode = String; // "local" | "manual" | "cloud"

/// 识别最终选择。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionFinalChoice {
    pub account: String,
    pub name: String,
    pub mode: RecognitionFinalChoiceMode,
}

/// 识别学习反馈负载（对应前端 RecognitionLearningPayload）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionLearningPayload {
    #[serde(default)]
    pub raw_text: Option<String>,
    pub local_result: LocalRecognitionResult,
    #[serde(default)]
    pub cloud_review: Option<CloudReview>,
    pub final_choice: RecognitionFinalChoice,
}

/// 识别学习反馈结果（对应前端 RecognitionLearningResult）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionLearningResult {
    pub note: String,
    pub reason: String,
}

// ============================================================================
// 收评助手相关
// ============================================================================

/// 收评搜索结果（对应前端 ReviewSearchResult）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSearchResult {
    pub path: String,
    pub name: String,
    pub kind: String, // "image" | "folder"
    pub score: f64,
    pub reason: String,
    #[serde(default)]
    pub mtime_ms: Option<f64>,
    #[serde(default)]
    pub thumbnail_data_url: Option<String>,
    #[serde(default)]
    pub child_count: Option<u32>,
    #[serde(default)]
    pub cover_path: Option<String>,
    #[serde(default)]
    pub children_loaded: Option<bool>,
    #[serde(default)]
    pub children: Option<Vec<ReviewSearchResult>>,
}

impl Default for ReviewSearchResult {
    fn default() -> Self {
        Self {
            path: String::new(),
            name: String::new(),
            kind: "image".to_string(),
            score: 0.0,
            reason: String::new(),
            mtime_ms: None,
            thumbnail_data_url: None,
            child_count: None,
            cover_path: None,
            children_loaded: None,
            children: None,
        }
    }
}

/// 收评生成选项（对应前端 ReviewGenerationOptions）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGenerationOptions {
    pub query: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
    #[serde(default)]
    pub product_description: String,
    pub target_length: i32,
    pub thinking_mode: String,
    pub professional_level: i32,
    pub buyer_level: i32,
    pub exaggeration_level: i32,
    pub scene_level: i32,
    pub mention_value: bool,
    pub copy_count: i32,
    pub batch_seed: i32,
}

/// 收评生成结果（对应前端 ReviewGenerationResult）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGenerationResult {
    pub copies: Vec<String>,
}

/// 收评聊天消息（对应前端 ReviewChatMessage）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatMessage {
    pub role: String, // "user" | "assistant"
    pub content: String,
    #[serde(default)]
    pub images: Option<Vec<String>>,
}

/// 收评聊天负载（对应前端 ReviewChatPayload）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatPayload {
    pub messages: Vec<ReviewChatMessage>,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub images: Option<Vec<String>>,
    #[serde(default)]
    pub product_description: Option<String>,
    pub target_length: i32,
    pub thinking_mode: String,
    #[serde(default)]
    pub professional_level: Option<i32>,
    #[serde(default)]
    pub buyer_level: Option<i32>,
    #[serde(default)]
    pub exaggeration_level: Option<i32>,
    #[serde(default)]
    pub scene_level: Option<i32>,
    #[serde(default)]
    pub mention_value: Option<bool>,
    #[serde(default)]
    pub custom_prompt: Option<String>,
}

/// 收评聊天结果（对应前端 ReviewChatResult）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatResult {
    pub reply: String,
}

// ============================================================================
// 视频渲染相关
// ============================================================================

/// 视频渲染负载（对应前端 VideoRenderPayload）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRenderPayload {
    pub task: VideoTask,
    pub settings: AppSettings,
}

/// 视频渲染结果（对应前端 VideoRenderResult）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoRenderResult {
    pub success: bool,
    #[serde(default)]
    pub output_path: Option<String>,
    pub log: String,
    #[serde(default)]
    pub error: Option<String>,
}

/// 视频渲染进度（对应前端 VideoRenderProgress，用于事件 payload）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRenderProgress {
    pub task_id: String,
    pub percent: f64,
    pub stage: String,
    #[serde(default)]
    pub current_time: Option<f64>,
}

// ============================================================================
// 标题优化（占位类型）
// ============================================================================

/// 标题分析请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleAnalyzeRequest {
    pub text: String,
    #[serde(default)]
    pub settings: Option<AppSettings>,
}

/// 标题分析结果。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TitleAnalyzeResult {
    pub score: f64,
    pub suggestions: Vec<String>,
}

/// 标题生成请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleGenerateRequest {
    pub text: String,
    #[serde(default)]
    pub settings: Option<AppSettings>,
    #[serde(default)]
    pub count: Option<u32>,
}

/// 标题候选项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleCandidate {
    pub title: String,
    pub score: f64,
    pub reason: String,
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_settings_default() {
        let s = AppSettings::default();
        assert_eq!(s.api_profiles.len(), 1);
        assert_eq!(s.api_profiles[0].id, "default");
        assert!(s.ai_enabled);
        assert_eq!(s.model_concurrency, 2);
    }

    #[test]
    fn test_app_settings_serde_camel_case() {
        let s = AppSettings::default();
        let json = serde_json::to_string(&s).unwrap();
        // 应该输出 camelCase 字段名
        assert!(json.contains("apiProfiles"));
        assert!(json.contains("activeApiProfileId"));
        assert!(json.contains("aiEnabled"));
        assert!(!json.contains("api_profiles"));
    }

    #[test]
    fn test_app_settings_roundtrip() {
        let s = AppSettings::default();
        let json = serde_json::to_string(&s).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.api_profiles.len(), 1);
        assert_eq!(parsed.api_profiles[0].id, "default");
    }

    #[test]
    fn test_workbench_state_default() {
        let s = WorkbenchState::default();
        assert_eq!(s.current_index, 0);
        assert!(s.rows.is_empty());
    }

    #[test]
    fn test_video_workbench_state_default() {
        let s = VideoWorkbenchState::default();
        assert_eq!(s.current_index, 0);
        assert!(s.tasks.is_empty());
    }

    #[test]
    fn test_clipboard_snapshot_serde() {
        let snap = ClipboardSnapshot {
            kind: "text".to_string(),
            text: Some("hello".to_string()),
            image_data_url: None,
            signature: "text:hello".to_string(),
        };
        let json = serde_json::to_string(&snap).unwrap();
        assert!(json.contains("imageDataUrl"));
        let parsed: ClipboardSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.kind, "text");
        assert_eq!(parsed.text.as_deref(), Some("hello"));
    }

    #[test]
    fn test_app_settings_with_optional_fields() {
        // 测试缺少可选字段时仍能反序列化
        let json = r#"{
            "apiProfiles": [{"id":"a","name":"b","apiType":"openai","apiBaseUrl":"","apiKey":"","textModel":"","visionModel":""}],
            "activeApiProfileId": "a",
            "apiBaseUrl": "",
            "apiKey": "",
            "textModel": "",
            "visionModel": "",
            "aiEnabled": false,
            "enhancedCloudValidation": false,
            "autoListenClipboard": false,
            "autoAdvance": false,
            "confirmLowConfidence": false,
            "strictExportValidation": false,
            "exportNameOwner": "",
            "fixedTailAccount": "",
            "fixedTailName": "",
            "modelConcurrency": 1,
            "modelRetryCount": 0,
            "enableLearningFeedback": false,
            "learningPromptNotes": "",
            "showBeginnerGuide": false,
            "completedTours": [],
            "toolboxName": "",
            "videoLibraryDir": "",
            "videoOutputDir": "",
            "ffmpegPath": "",
            "videoSpeedMode": false,
            "videoScanMode": "auto",
            "videoTemplate": "bos-template",
            "videoOutputSize": "auto",
            "videoQualityMode": "preserve",
            "videoEncoderMode": "auto",
            "updateFeedUrl": "",
            "reviewRootDir": "",
            "reviewProfessionalLevel": 0,
            "reviewBuyerLevel": 0,
            "reviewExaggerationLevel": 0,
            "reviewSceneLevel": 0,
            "reviewMentionValue": false,
            "reviewProductDescription": "",
            "reviewCopyCount": 3,
            "sliceMusicPresetId": "",
            "sliceCustomMusicPath": "",
            "reviewApiProfileId": "",
            "reviewCustomPrompt": "",
            "reviewGenerateHotkey": "",
            "reviewWorkspaceMode": "mixed",
            "reviewTargetLength": 30,
            "reviewThinkingMode": "off",
            "compareAutoOpenReminderDialog": false,
            "compareShowPassedRowsAfterVerify": false,
            "fontScale": "normal",
            "performanceMode": "auto",
            "everythingEsPath": "",
            "sidebarCollapsed": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.api_profiles.len(), 1);
        assert_eq!(parsed.review_saved_copies, None);
    }
}
