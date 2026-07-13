use crate::media::image_to_data_url;
use crate::security::{validate_api_url, validate_path_safety};
use base64::Engine;
use chrono::Local;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProcessPayload {
    pub input_paths: Vec<String>,
    pub output_dir: Option<String>,
    pub target_width: u32,
    pub target_height: u32,
    pub mode: String,
    pub background_color: String,
    pub output_format: String,
    pub quality: u8,
    pub suffix: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProcessResult {
    pub input_path: String,
    pub output_path: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationPayload {
    pub provider: String,
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub size: String,
    pub count: u32,
    pub output_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationResult {
    pub id: String,
    pub output_path: Option<String>,
    pub preview_url: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn image_process_batch(payload: ImageProcessPayload) -> Result<Vec<ImageProcessResult>, String> {
    validate_process_payload(&payload)?;
    let mut results = Vec::with_capacity(payload.input_paths.len());

    for input_path in &payload.input_paths {
        results.push(match process_one_image(input_path, &payload).await {
            Ok(output_path) => ImageProcessResult {
                input_path: input_path.clone(),
                output_path: Some(output_path),
                status: "success".to_string(),
                error: None,
            },
            Err(error) => ImageProcessResult {
                input_path: input_path.clone(),
                output_path: None,
                status: "failed".to_string(),
                error: Some(error),
            },
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn image_generate(payload: ImageGenerationPayload) -> Result<Vec<ImageGenerationResult>, String> {
    validate_generation_payload(&payload)?;

    let response = reqwest::Client::new()
        .post(image_generation_endpoint(&payload.api_base_url))
        .bearer_auth(payload.api_key.trim())
        .json(&serde_json::json!({
            "model": payload.model,
            "prompt": payload.prompt,
            "n": payload.count.clamp(1, 10),
            "size": payload.size,
        }))
        .send()
        .await
        .map_err(|e| format!("生图接口请求失败: {}", e))?;

    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("生图接口返回内容无法解析: {}", e))?;

    if !status.is_success() {
        let message = value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(Value::as_str))
            .unwrap_or("生图接口返回失败");
        return Err(format!("{} ({})", message, status));
    }

    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "生图接口未返回 data 数组。".to_string())?;

    let mut results = Vec::with_capacity(data.len());
    for (index, item) in data.iter().enumerate() {
        results.push(match save_generated_item(item, &payload.output_dir, index).await {
            Ok((path, preview_url)) => ImageGenerationResult {
                id: Uuid::new_v4().to_string(),
                output_path: Some(path),
                preview_url,
                status: "success".to_string(),
                error: None,
            },
            Err(error) => ImageGenerationResult {
                id: Uuid::new_v4().to_string(),
                output_path: None,
                preview_url: None,
                status: "failed".to_string(),
                error: Some(error),
            },
        });
    }

    Ok(results)
}

fn validate_process_payload(payload: &ImageProcessPayload) -> Result<(), String> {
    if payload.input_paths.is_empty() {
        return Err("请先选择图片。".to_string());
    }
    if payload.input_paths.len() > 50 {
        return Err("单次最多处理 50 张图片。".to_string());
    }
    if payload.target_width == 0 || payload.target_height == 0 {
        return Err("目标宽高需要大于 0。".to_string());
    }
    if !matches!(payload.mode.as_str(), "center-crop" | "pad" | "crop-pad") {
        return Err("裁切模式不支持。".to_string());
    }
    if !matches!(payload.output_format.as_str(), "jpg" | "png" | "webp") {
        return Err("输出格式仅支持 jpg、png、webp。".to_string());
    }
    if let Some(output_dir) = payload.output_dir.as_deref() {
        if !output_dir.trim().is_empty() {
            validate_path_safety(output_dir, None)?;
        }
    }
    for path in &payload.input_paths {
        validate_path_safety(path, None)?;
        if !Path::new(path).exists() {
            return Err(format!("图片不存在: {}", path));
        }
    }
    Ok(())
}

fn validate_generation_payload(payload: &ImageGenerationPayload) -> Result<(), String> {
    let _provider = payload.provider.as_str();
    validate_api_url(payload.api_base_url.trim())?;
    validate_path_safety(payload.output_dir.trim(), None)?;
    if payload.api_key.trim().is_empty() {
        return Err("请填写 API Key。".to_string());
    }
    if payload.model.trim().is_empty() {
        return Err("请填写模型名。".to_string());
    }
    if payload.prompt.trim().is_empty() {
        return Err("请填写生图提示词。".to_string());
    }
    fs::create_dir_all(payload.output_dir.trim()).map_err(|e| format!("创建保存目录失败: {}", e))?;
    Ok(())
}

async fn process_one_image(input_path: &str, payload: &ImageProcessPayload) -> Result<String, String> {
    let input = PathBuf::from(input_path);
    let img = image::open(&input).map_err(|e| format!("读取图片失败: {}", e))?;
    let bg = parse_hex_color(&payload.background_color)?;

    let processed = match payload.mode.as_str() {
        "pad" => pad_to_size(&img, payload.target_width, payload.target_height, bg),
        "crop-pad" => {
            let cropped = center_crop_to_aspect(&img, payload.target_width, payload.target_height);
            pad_to_size(&cropped, payload.target_width, payload.target_height, bg)
        }
        _ => {
            let cropped = center_crop_to_aspect(&img, payload.target_width, payload.target_height);
            cropped.resize_exact(payload.target_width, payload.target_height, FilterType::Lanczos3)
        }
    };

    let output_path = build_output_path(&input, payload)?;
    write_image(&processed, &output_path, &payload.output_format, payload.quality)?;
    Ok(output_path.to_string_lossy().to_string())
}

fn center_crop_to_aspect(img: &DynamicImage, target_width: u32, target_height: u32) -> DynamicImage {
    let (width, height) = img.dimensions();
    let source_ratio = width as f64 / height as f64;
    let target_ratio = target_width as f64 / target_height as f64;
    let (crop_width, crop_height) = if source_ratio > target_ratio {
        ((height as f64 * target_ratio).round() as u32, height)
    } else {
        (width, (width as f64 / target_ratio).round() as u32)
    };
    let x = (width.saturating_sub(crop_width)) / 2;
    let y = (height.saturating_sub(crop_height)) / 2;
    img.crop_imm(x, y, crop_width.max(1), crop_height.max(1))
}

fn pad_to_size(img: &DynamicImage, target_width: u32, target_height: u32, bg: Rgba<u8>) -> DynamicImage {
    let (width, height) = img.dimensions();
    let scale = (target_width as f64 / width as f64).min(target_height as f64 / height as f64);
    let new_width = ((width as f64 * scale).round() as u32).clamp(1, target_width.max(1));
    let new_height = ((height as f64 * scale).round() as u32).clamp(1, target_height.max(1));
    let resized = img.resize_exact(new_width, new_height, FilterType::Lanczos3).to_rgba8();
    let mut canvas: RgbaImage = ImageBuffer::from_pixel(target_width, target_height, bg);
    let x = (target_width.saturating_sub(new_width)) / 2;
    let y = (target_height.saturating_sub(new_height)) / 2;
    image::imageops::overlay(&mut canvas, &resized, x.into(), y.into());
    DynamicImage::ImageRgba8(canvas)
}

fn parse_hex_color(value: &str) -> Result<Rgba<u8>, String> {
    let trimmed = value.trim().trim_start_matches('#');
    if trimmed.len() != 6 {
        return Err("扩边颜色需要是 #RRGGBB 格式。".to_string());
    }
    let r = u8::from_str_radix(&trimmed[0..2], 16).map_err(|_| "扩边颜色格式不正确。".to_string())?;
    let g = u8::from_str_radix(&trimmed[2..4], 16).map_err(|_| "扩边颜色格式不正确。".to_string())?;
    let b = u8::from_str_radix(&trimmed[4..6], 16).map_err(|_| "扩边颜色格式不正确。".to_string())?;
    Ok(Rgba([r, g, b, 255]))
}

fn build_output_path(input: &Path, payload: &ImageProcessPayload) -> Result<PathBuf, String> {
    let output_dir = payload
        .output_dir
        .as_deref()
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| input.parent().map(Path::to_path_buf))
        .ok_or_else(|| "无法确定输出目录。".to_string())?;

    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let suffix = if payload.suffix.trim().is_empty() { "_crop" } else { payload.suffix.trim() };
    let extension = if payload.output_format == "jpg" { "jpg" } else { payload.output_format.as_str() };
    unique_path(&output_dir, &format!("{}{}", stem, suffix), extension)
}

fn unique_path(dir: &Path, stem: &str, extension: &str) -> Result<PathBuf, String> {
    let mut candidate = dir.join(format!("{}.{}", stem, extension));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{}-{}.{}", stem, index, extension));
        index += 1;
        if index > 9999 {
            return Err("输出文件名冲突过多，请更换后缀或输出目录。".to_string());
        }
    }
    Ok(candidate)
}

fn write_image(img: &DynamicImage, path: &Path, format: &str, quality: u8) -> Result<(), String> {
    let quality = quality.clamp(1, 100);
    let mut file = fs::File::create(path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    match format {
        "png" => img.write_to(&mut file, ImageFormat::Png).map_err(|e| format!("写入 PNG 失败: {}", e)),
        "webp" => {
            let rgba = img.to_rgba8();
            WebPEncoder::new_lossless(&mut file)
                .encode(&rgba, rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
                .map_err(|e| format!("写入 WEBP 失败: {}", e))
        }
        _ => {
            let rgb = img.to_rgb8();
            let mut encoder = JpegEncoder::new_with_quality(&mut file, quality);
            encoder
                .encode(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("写入 JPG 失败: {}", e))
        }
    }
}

fn image_generation_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/images/generations") {
        trimmed.to_string()
    } else {
        format!("{}/images/generations", trimmed)
    }
}

async fn save_generated_item(item: &Value, output_dir: &str, index: usize) -> Result<(String, Option<String>), String> {
    let bytes = if let Some(b64) = item.get("b64_json").and_then(Value::as_str) {
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("解析 base64 图片失败: {}", e))?
    } else if let Some(url) = item.get("url").and_then(Value::as_str) {
        reqwest::get(url)
            .await
            .map_err(|e| format!("下载生成图片失败: {}", e))?
            .bytes()
            .await
            .map_err(|e| format!("读取生成图片失败: {}", e))?
            .to_vec()
    } else {
        return Err("生成结果缺少 b64_json 或 url。".to_string());
    };

    let image = image::load_from_memory(&bytes).map_err(|e| format!("生成图片格式无法识别: {}", e))?;
    let dir = PathBuf::from(output_dir);
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let path = unique_path(&dir, &format!("generated-{}-{}", timestamp, index + 1), "png")?;
    let mut cursor = Cursor::new(Vec::new());
    image.write_to(&mut cursor, ImageFormat::Png).map_err(|e| format!("转换生成图片失败: {}", e))?;
    fs::write(&path, cursor.into_inner()).map_err(|e| format!("保存生成图片失败: {}", e))?;
    let preview_url = image_to_data_url(&path, 960).await;
    Ok((path.to_string_lossy().to_string(), preview_url))
}
