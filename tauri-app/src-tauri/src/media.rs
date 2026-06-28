//! 媒体处理模块
//!
//! 对应原 `electron/utils/media.ts` + `electron/handlers/media.ts`。
//!
//! - 缩略图生成（用 `image` crate）
//! - 找目录下最新图片
//! - 图片预览（返回 base64 data URL）

use crate::security::validate_path_safety;
use base64::Engine;
use image::imageops::FilterType;
use image::ImageReader;
use std::path::{Path, PathBuf};

/// 支持的图片扩展名。
const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".webp", ".bmp"];

/// 判断路径是否为图片（按扩展名）。
pub fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .map(|ext| IMAGE_EXTS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// 根据 MIME 类型返回 data URL 前缀。
fn mime_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "image/png",
    }
}

/// 生成缩略图字节（PNG 编码）。
///
/// 参数：
/// - `path`: 图片路径
/// - `max_size`: 最大边长（保持宽高比缩放）
///
/// 返回 PNG 编码的字节数组，失败返回 None。
pub fn generate_thumbnail(path: &Path, max_size: u32) -> Option<Vec<u8>> {
    let reader = ImageReader::open(path).ok()?;
    let img = reader.decode().ok()?;
    let (w, h) = (img.width(), img.height());
    let max_dim = w.max(h);
    let scaled = if max_dim > max_size {
        let scale = max_size as f32 / max_dim as f32;
        let new_w = (w as f32 * scale).round().max(1.0) as u32;
        let new_h = (h as f32 * scale).round().max(1.0) as u32;
        img.resize_exact(new_w, new_h, FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = std::io::Cursor::new(Vec::new());
    scaled.write_to(&mut buf, image::ImageFormat::Png).ok()?;
    Some(buf.into_inner())
}

/// 找目录下最新的图片文件。
///
/// 递归遍历子目录，返回 mtime 最大的图片路径。
/// 若目录不存在或无图片，返回空字符串。
pub async fn latest_image_in_directory(dir: String) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Ok(String::new());
    }

    // 安全校验
    validate_path_safety(&dir, None)?;

    let dir_path = PathBuf::from(&dir);
    if !dir_path.exists() {
        return Ok(String::new());
    }

    let mut latest_path = String::new();
    let mut latest_mtime: std::time::SystemTime = std::time::UNIX_EPOCH;

    // 递归遍历（限制深度避免过深）
    walk_dir_for_images(&dir_path, &mut latest_path, &mut latest_mtime, 0, 5).await?;

    Ok(latest_path)
}

/// 递归遍历目录找最新图片。
fn walk_dir_for_images<'a>(
    dir: &'a Path,
    latest_path: &'a mut String,
    latest_mtime: &'a mut std::time::SystemTime,
    depth: usize,
    max_depth: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if depth > max_depth {
            return Ok(());
        }

        let entries = match tokio::fs::read_dir(dir).await {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };

        let mut entries = entries;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let file_type = match entry.file_type().await {
                Ok(t) => t,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                walk_dir_for_images(&path, latest_path, latest_mtime, depth + 1, max_depth).await?;
            } else if file_type.is_file() && is_image_file(&path) {
                let mtime = match tokio::fs::metadata(&path).await {
                    Ok(m) => match m.modified() {
                        Ok(t) => t,
                        Err(_) => continue,
                    },
                    Err(_) => continue,
                };

                if mtime > *latest_mtime {
                    *latest_mtime = mtime;
                    *latest_path = path.to_string_lossy().to_string();
                }
            }
        }
        Ok(())
    })
}

/// 生成图片预览的 data URL（base64 编码）。
///
/// 对应原 `imageToDataUrl`。
pub async fn image_to_data_url(path: &Path, max_side: u32) -> Option<String> {
    let thumbnail = generate_thumbnail(path, max_side)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&thumbnail);
    Some(format!("data:{};base64,{}", mime_type_for(path), b64))
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 找目录下最新图片（对应 `media:latestImage` IPC 通道）。
#[tauri::command]
pub async fn media_latest_image(dir: String) -> Result<String, String> {
    latest_image_in_directory(dir).await
}

/// 图片预览（对应 `media:imagePreview` IPC 通道）。
///
/// 返回 base64 编码的 data URL，最大边长 960px。
#[tauri::command]
pub async fn media_image_preview(file_path: String) -> Result<String, String> {
    if file_path.trim().is_empty() {
        return Ok(String::new());
    }

    // 安全校验
    validate_path_safety(&file_path, None)?;

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Ok(String::new());
    }

    if !is_image_file(&path) {
        return Ok(String::new());
    }

    let max_side: u32 = 960;
    match image_to_data_url(&path, max_side).await {
        Some(url) => Ok(url),
        None => Ok(String::new()),
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_image_file_jpg() {
        assert!(is_image_file(Path::new("photo.jpg")));
        assert!(is_image_file(Path::new("photo.JPG")));
        assert!(is_image_file(Path::new("photo.jpeg")));
    }

    #[test]
    fn test_is_image_file_png() {
        assert!(is_image_file(Path::new("image.png")));
        assert!(is_image_file(Path::new("image.PNG")));
    }

    #[test]
    fn test_is_image_file_non_image() {
        assert!(!is_image_file(Path::new("video.mp4")));
        assert!(!is_image_file(Path::new("doc.pdf")));
        assert!(!is_image_file(Path::new("noext")));
    }

    #[test]
    fn test_mime_type_for_jpg() {
        assert_eq!(mime_type_for(Path::new("a.jpg")), "image/jpeg");
        assert_eq!(mime_type_for(Path::new("a.JPEG")), "image/jpeg");
    }

    #[test]
    fn test_mime_type_for_png() {
        assert_eq!(mime_type_for(Path::new("a.png")), "image/png");
    }

    #[test]
    fn test_mime_type_for_unknown_defaults_to_png() {
        assert_eq!(mime_type_for(Path::new("a.unknown")), "image/png");
    }

    #[test]
    fn test_generate_thumbnail_nonexistent_returns_none() {
        let result = generate_thumbnail(Path::new(r"C:\nonexistent\image.jpg"), 100);
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_latest_image_in_directory_empty_dir() {
        let result = latest_image_in_directory("".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "");
    }

    #[tokio::test]
    async fn test_latest_image_in_directory_nonexistent() {
        let result = latest_image_in_directory(r"C:\nonexistent\dir".to_string()).await;
        // 应该返回 Ok("") 因为目录不存在
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_media_image_preview_empty_path() {
        let result = media_image_preview("".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "");
    }
}
