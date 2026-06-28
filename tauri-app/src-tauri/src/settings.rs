//! 设置持久化模块
//!
//! 对应原 `electron/utils/settings.ts` + `electron/handlers/settings.ts`。
//!
//! - 持久化路径：app config dir 下的 `settings.json`
//! - 敏感字段（apiKey / fixedTailAccount / fixedTailName）使用 AES-GCM 加密
//! - 主密钥派生自机器标识（DPAPI 不可用时的回退方案）
//!
//! 简化点（与原版差异）：
//! - 原版使用 Electron safeStorage（基于 Windows DPAPI），这里用 AES-GCM +
//!   固定主密钥派生（基于 bundle id + 用户名）作为跨平台方案。
//! - 不做 capabilities 授权校验（阶段 3b 再补充）。

use crate::log::append_log;
use crate::paths;
use crate::types::AppSettings;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use std::sync::Mutex;

use once_cell::sync::Lazy;

/// 敏感字段列表（根级）。
const SENSITIVE_ROOT_FIELDS: &[&str] = &["apiKey", "fixedTailAccount", "fixedTailName"];

/// 敏感字段列表（apiProfiles 内部）。
const SENSITIVE_PROFILE_FIELDS: &[&str] = &["apiKey"];

/// 加密字段的标记结构（与原版一致：`{ "__enc": "<base64>" }`）。
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct EncryptedField {
    #[serde(rename = "__enc")]
    enc: String,
}

/// 全局设置缓存。
static SETTINGS_CACHE: Lazy<Mutex<Option<AppSettings>>> = Lazy::new(|| Mutex::new(None));

// ============================================================================
// 主密钥派生
// ============================================================================

/// 派生 32 字节主密钥（AES-256）。
///
/// 简化方案：用 bundle id + 用户名 + 固定盐通过 SHA-256 派生。
/// 真正的安全存储应使用 Windows DPAPI / macOS Keychain / Linux Secret Service，
/// 阶段 3a 优先保证编译通过与接口稳定。
fn derive_master_key() -> [u8; 32] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    // 获取当前用户名（跨平台）
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();

    let mut hasher = DefaultHasher::new();
    "com.rebate.workbench".hash(&mut hasher);
    username.hash(&mut hasher);
    "ecommerce-ops-toolbox/v1".hash(&mut hasher);
    let seed = hasher.finish();

    // 用 seed 做简单扩展到 32 字节（非加密级安全，仅作机器绑定）
    let mut key = [0u8; 32];
    let mut state = seed;
    for byte in key.iter_mut() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        *byte = (state >> 32) as u8;
    }
    key
}

/// 构造 12 字节 nonce（固定值，因为同一台机器使用同一密钥）。
fn nonce() -> [u8; 12] {
    // 用 bundle id 前 12 字节做 nonce
    let mut nonce = [0u8; 12];
    let src = b"rebate.work";
    let len = src.len().min(12);
    nonce[..len].copy_from_slice(&src[..len]);
    nonce
}

// ============================================================================
// 加密/解密
// ============================================================================

/// 加密明文字符串为 `{ "__enc": "<base64>" }` JSON。
pub fn encrypt_field(plaintext: &str) -> Result<serde_json::Value, String> {
    if plaintext.is_empty() {
        return Err("plaintext is empty".to_string());
    }

    let key_bytes = derive_master_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce_bytes = nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("encrypt failed: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&ciphertext);
    let field = EncryptedField { enc: b64 };
    serde_json::to_value(field).map_err(|e| format!("serialize EncryptedField failed: {}", e))
}

/// 解密 `{ "__enc": "<base64>" }` 形式的字段为明文。
///
/// 兼容旧版明文（非加密对象）→ 直接返回字符串值。
pub fn decrypt_field(value: &serde_json::Value) -> String {
    // 检测是否为 EncryptedField
    if let Some(obj) = value.as_object() {
        if let Some(enc) = obj.get("__enc").and_then(|v| v.as_str()) {
            let key_bytes = derive_master_key();
            let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
            let cipher = Aes256Gcm::new(key);
            let nonce_bytes = nonce();
            let nonce = Nonce::from_slice(&nonce_bytes);

            match base64::engine::general_purpose::STANDARD.decode(enc) {
                Ok(ciphertext) => match cipher.decrypt(nonce, ciphertext.as_slice()) {
                    Ok(plaintext) => return String::from_utf8_lossy(&plaintext).to_string(),
                    Err(e) => {
                        let _ = append_log(
                            "warn",
                            &format!("解密敏感字段失败: {}", e),
                            &serde_json::json!({}),
                        );
                        return String::new();
                    }
                },
                Err(e) => {
                    let _ = append_log(
                        "warn",
                        &format!("base64 解码敏感字段失败: {}", e),
                        &serde_json::json!({}),
                    );
                    return String::new();
                }
            }
        }
    }

    // 旧版明文兼容
    value.as_str().unwrap_or("").to_string()
}

/// 判断字段是否为已加密形式（包含 `__enc` 字符串字段）。
pub fn is_encrypted_field(value: &serde_json::Value) -> bool {
    if let Some(obj) = value.as_object() {
        obj.contains_key("__enc")
    } else {
        false
    }
}

/// 加密 AppSettings 中所有敏感字段，返回 JSON Value（便于写入文件）。
pub fn encrypt_settings_fields(settings: &AppSettings) -> serde_json::Value {
    let mut raw = serde_json::to_value(settings).expect("AppSettings serialize failed");
    if let Some(obj) = raw.as_object_mut() {
        // 根级敏感字段
        for key in SENSITIVE_ROOT_FIELDS {
            if let Some(val) = obj.get(*key).and_then(|v| v.as_str()) {
                if !val.is_empty() {
                    if let Ok(encrypted) = encrypt_field(val) {
                        obj.insert((*key).to_string(), encrypted);
                    }
                }
            }
        }

        // apiProfiles 内部的敏感字段
        if let Some(profiles) = obj.get_mut("apiProfiles").and_then(|v| v.as_array_mut()) {
            for profile in profiles.iter_mut() {
                if let Some(p_obj) = profile.as_object_mut() {
                    for key in SENSITIVE_PROFILE_FIELDS {
                        if let Some(val) = p_obj.get(*key).and_then(|v| v.as_str()) {
                            if !val.is_empty() {
                                if let Ok(encrypted) = encrypt_field(val) {
                                    p_obj.insert((*key).to_string(), encrypted);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    raw
}

/// 解密 JSON Value 中所有敏感字段，返回明文 JSON。
pub fn decrypt_settings_fields(raw: &serde_json::Value) -> serde_json::Value {
    let mut out = raw.clone();
    if let Some(obj) = out.as_object_mut() {
        // 根级敏感字段
        let keys: Vec<String> = SENSITIVE_ROOT_FIELDS.iter().map(|s| s.to_string()).collect();
        for key in keys {
            if let Some(val) = obj.get(&key) {
                if is_encrypted_field(val) {
                    let plaintext = decrypt_field(val);
                    obj.insert(key, serde_json::Value::String(plaintext));
                }
            }
        }

        // apiProfiles
        if let Some(profiles) = obj.get_mut("apiProfiles").and_then(|v| v.as_array_mut()) {
            for profile in profiles.iter_mut() {
                if let Some(p_obj) = profile.as_object_mut() {
                    let keys: Vec<String> =
                        SENSITIVE_PROFILE_FIELDS.iter().map(|s| s.to_string()).collect();
                    for key in keys {
                        if let Some(val) = p_obj.get(&key) {
                            if is_encrypted_field(val) {
                                let plaintext = decrypt_field(val);
                                p_obj.insert(key, serde_json::Value::String(plaintext));
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

/// 检测原始 JSON 中是否存在未加密的敏感数据。
pub fn has_plaintext_secrets(raw: &serde_json::Value) -> bool {
    if let Some(obj) = raw.as_object() {
        // 根级 apiKey
        if let Some(val) = obj.get("apiKey").and_then(|v| v.as_str()) {
            if !val.is_empty() {
                return true;
            }
        }

        // apiProfiles
        if let Some(profiles) = obj.get("apiProfiles").and_then(|v| v.as_array()) {
            for profile in profiles {
                if let Some(p_obj) = profile.as_object() {
                    for key in SENSITIVE_PROFILE_FIELDS {
                        if let Some(val) = p_obj.get(*key) {
                            if !is_encrypted_field(val) {
                                if let Some(s) = val.as_str() {
                                    if !s.is_empty() {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

// ============================================================================
// 加载/保存
// ============================================================================

/// 加载设置（带缓存）。
pub async fn load_settings() -> Result<AppSettings, String> {
    // 先检查缓存
    {
        let cache = SETTINGS_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref cached) = *cache {
            return Ok(cached.clone());
        }
    }

    paths::ensure_app_config_dir().map_err(|e| e.to_string())?;
    let path = paths::get_settings_path();

    if !path.exists() {
        let default = AppSettings::default();
        *SETTINGS_CACHE.lock().map_err(|e| e.to_string())? = Some(default.clone());
        return Ok(default);
    }

    let raw_str = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read settings failed: {}", e))?;

    let raw: serde_json::Value = serde_json::from_str(&raw_str)
        .map_err(|e| format!("parse settings JSON failed: {}", e))?;

    // 解密敏感字段
    let decrypted = decrypt_settings_fields(&raw);

    let settings: AppSettings = serde_json::from_value(decrypted)
        .map_err(|e| format!("deserialize AppSettings failed: {}", e))?;

    // 如果检测到明文，回写加密版本
    if has_plaintext_secrets(&raw) {
        let _ = save_settings(settings.clone()).await;
    }

    *SETTINGS_CACHE.lock().map_err(|e| e.to_string())? = Some(settings.clone());
    Ok(settings)
}

/// 保存设置（自动加密敏感字段，更新缓存）。
pub async fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
    paths::ensure_app_config_dir().map_err(|e| e.to_string())?;

    let encrypted = encrypt_settings_fields(&settings);
    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("serialize settings failed: {}", e))?;

    let path = paths::get_settings_path();
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| format!("write settings failed: {}", e))?;

    *SETTINGS_CACHE.lock().map_err(|e| e.to_string())? = Some(settings.clone());
    Ok(settings)
}

/// 清空设置缓存（测试用）。
pub fn clear_settings_cache() {
    *SETTINGS_CACHE.lock().unwrap() = None;
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 加载设置命令（对应 `settings:load` IPC 通道）。
#[tauri::command]
pub async fn settings_load() -> Result<AppSettings, String> {
    load_settings().await
}

/// 保存设置命令（对应 `settings:save` IPC 通道）。
#[tauri::command]
pub async fn settings_save(settings: AppSettings) -> Result<AppSettings, String> {
    save_settings(settings).await
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = "sk-test-key-12345";
        let encrypted = encrypt_field(plaintext).unwrap();
        assert!(encrypted.is_object());
        assert!(encrypted["__enc"].is_string());

        let decrypted = decrypt_field(&encrypted);
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_empty_string_returns_err() {
        let result = encrypt_field("");
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_plaintext_compatibility() {
        // 旧版明文应直接返回字符串
        let plaintext = serde_json::Value::String("legacy-key".to_string());
        let decrypted = decrypt_field(&plaintext);
        assert_eq!(decrypted, "legacy-key");
    }

    #[test]
    fn test_is_encrypted_field_detection() {
        let encrypted = encrypt_field("secret").unwrap();
        assert!(is_encrypted_field(&encrypted));

        let plain = serde_json::Value::String("plain".to_string());
        assert!(!is_encrypted_field(&plain));

        assert!(!is_encrypted_field(&serde_json::Value::Null));
    }

    #[test]
    fn test_has_plaintext_secrets_detection() {
        // 含明文 apiKey
        let raw = serde_json::json!({
            "apiKey": "sk-leaked-key",
            "apiProfiles": []
        });
        assert!(has_plaintext_secrets(&raw));

        // apiKey 为空
        let raw = serde_json::json!({
            "apiKey": "",
            "apiProfiles": []
        });
        assert!(!has_plaintext_secrets(&raw));

        // apiKey 已加密
        let encrypted = encrypt_field("sk-secret").unwrap();
        let raw = serde_json::json!({
            "apiKey": encrypted,
            "apiProfiles": []
        });
        assert!(!has_plaintext_secrets(&raw));
    }

    #[test]
    fn test_encrypt_decrypt_settings_fields_roundtrip() {
        let mut settings = AppSettings::default();
        settings.api_key = "sk-secret-12345".to_string();
        settings.fixed_tail_account = "13812345678".to_string();
        settings.fixed_tail_name = "张三".to_string();

        let encrypted = encrypt_settings_fields(&settings);
        // apiKey 应被加密
        assert!(is_encrypted_field(&encrypted["apiKey"]));

        let decrypted = decrypt_settings_fields(&encrypted);
        assert_eq!(decrypted["apiKey"].as_str(), Some("sk-secret-12345"));
        assert_eq!(decrypted["fixedTailAccount"].as_str(), Some("13812345678"));
        assert_eq!(decrypted["fixedTailName"].as_str(), Some("张三"));
    }

    #[test]
    fn test_encrypt_decrypt_profile_api_key_roundtrip() {
        let mut settings = AppSettings::default();
        settings.api_profiles[0].api_key = "sk-profile-key".to_string();

        let encrypted = encrypt_settings_fields(&settings);
        assert!(is_encrypted_field(&encrypted["apiProfiles"][0]["apiKey"]));

        let decrypted = decrypt_settings_fields(&encrypted);
        assert_eq!(
            decrypted["apiProfiles"][0]["apiKey"].as_str(),
            Some("sk-profile-key")
        );
    }
}
