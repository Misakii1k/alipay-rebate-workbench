import { safeStorage } from "electron";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AppSettings } from "../../src/lib/shared";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/lib/shared";
import {
  authorizeSettingsCapabilities,
  isAuthorizedExactCapability,
  isAuthorizedFfmpegPath,
  isAuthorizedEverythingPath,
  isAuthorizedRoot,
  assertAuthorizedTitleExcel
} from "./capabilities";
import { appendLog } from "./logger";
import { userDataPath, ensureUserDataDir } from "./paths";

// ============================================================================
// 常量与类型
// ============================================================================
export const SENSITIVE_PROFILE_FIELDS = ["apiKey"] as const;
export const SENSITIVE_ROOT_FIELDS = ["apiKey", "fixedTailAccount", "fixedTailName"] as const;

export interface EncryptedField {
  __enc: string;
}

let settingsCache: AppSettings | null = null;

// ============================================================================
// 加密/解密函数
// ============================================================================
export function isEncryptedField(value: unknown): value is EncryptedField {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).__enc === "string";
}

export function encryptField(plaintext: string): EncryptedField {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统加密服务不可用，无法安全存储敏感数据。请确保 Windows 用户账户已登录且系统加密功能正常。");
  }
  const buf = safeStorage.encryptString(plaintext);
  return { __enc: buf.toString("base64") };
}

export function decryptField(field: unknown): string {
  if (isEncryptedField(field)) {
    if (!safeStorage.isEncryptionAvailable()) {
      void appendLog("warn", "系统加密服务不可用，无法解密敏感字段", { fieldPreview: field.__enc.slice(0, 20) }, userDataPath);
      return "";
    }
    try {
      return safeStorage.decryptString(Buffer.from(field.__enc, "base64"));
    } catch (error) {
      void appendLog("error", "解密敏感字段失败", { error: (error as Error).message }, userDataPath);
      return "";
    }
  }
  // 旧版明文数据（兼容性处理）
  const plaintext = String(field ?? "");
  if (plaintext.length > 0) {
    void appendLog("warn", "检测到未加密的敏感字段，建议重新保存设置以加密", {}, userDataPath);
  }
  return plaintext;
}

export function hasPlaintextSecrets(raw: Record<string, unknown>): boolean {
  const rootApiKey = raw.apiKey;
  if (typeof rootApiKey === "string" && rootApiKey.length > 0) return true;
  const profiles = Array.isArray(raw.apiProfiles) ? raw.apiProfiles : [];
  for (const profile of profiles) {
    if (typeof profile === "object" && profile !== null) {
      for (const key of SENSITIVE_PROFILE_FIELDS) {
        const val = (profile as Record<string, unknown>)[key];
        if (typeof val === "string" && val.length > 0 && !isEncryptedField(val)) return true;
      }
    }
  }
  return false;
}

export function encryptSettingsFields(settings: AppSettings): Record<string, unknown> {
  const raw = { ...settings } as Record<string, unknown>;
  if (Array.isArray(raw.apiProfiles)) {
    raw.apiProfiles = raw.apiProfiles.map((p: Record<string, unknown>) => {
      const encrypted = { ...p };
      for (const key of SENSITIVE_PROFILE_FIELDS) {
        const val = p[key];
        if (typeof val === "string" && val.length > 0) {
          encrypted[key] = encryptField(val);
        }
      }
      return encrypted;
    });
  }
  for (const key of SENSITIVE_ROOT_FIELDS) {
    const val = raw[key];
    if (typeof val === "string" && val.length > 0) {
      raw[key] = encryptField(val);
    }
  }
  return raw;
}

export function decryptSettingsFields(raw: Record<string, unknown>): Record<string, unknown> {
  const decrypted = { ...raw };
  if (Array.isArray(decrypted.apiProfiles)) {
    decrypted.apiProfiles = decrypted.apiProfiles.map((p: Record<string, unknown>) => {
      const result = { ...p };
      for (const key of SENSITIVE_PROFILE_FIELDS) {
        result[key] = decryptField(p[key]);
      }
      return result;
    });
  }
  for (const key of SENSITIVE_ROOT_FIELDS) {
    decrypted[key] = decryptField(decrypted[key]);
  }
  return decrypted;
}

function sanitizeCapabilityFields(settings: AppSettings): AppSettings {
  const next = normalizeSettings(settings);
  return normalizeSettings({
    ...next,
    reviewRootDir: next.reviewRootDir && isAuthorizedRoot("reviewRoot", next.reviewRootDir) ? next.reviewRootDir : "",
    videoLibraryDir: next.videoLibraryDir && isAuthorizedRoot("videoLibrary", next.videoLibraryDir) ? next.videoLibraryDir : "",
    videoOutputDir: next.videoOutputDir && isAuthorizedRoot("videoOutput", next.videoOutputDir) ? next.videoOutputDir : "",
    titleKeywordExcelPath: (() => {
      if (!next.titleKeywordExcelPath || !isAuthorizedExactCapability("titleExcel", next.titleKeywordExcelPath)) return "";
      try {
        assertAuthorizedTitleExcel(next.titleKeywordExcelPath);
        return next.titleKeywordExcelPath;
      } catch {
        return "";
      }
    })(),
    ffmpegPath: next.ffmpegPath && isAuthorizedFfmpegPath(next.ffmpegPath) ? next.ffmpegPath : "",
    everythingEsPath: next.everythingEsPath && isAuthorizedEverythingPath(next.everythingEsPath) ? next.everythingEsPath : ""
  });
}

// ============================================================================
// 设置加载/保存
// ============================================================================
export async function loadSettings(): Promise<AppSettings> {
  if (settingsCache) return settingsCache;
  await ensureUserDataDir();
  const filePath = userDataPath("settings.json");
  if (!existsSync(filePath)) {
    settingsCache = DEFAULT_SETTINGS;
    authorizeSettingsCapabilities(settingsCache, "load");
    return settingsCache;
  }
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    // 解密敏感字段（兼容旧版明文数据）
    const decrypted = decryptSettingsFields(parsed);
    const settings = normalizeSettings(decrypted);
    authorizeSettingsCapabilities(settings, "load");
    // 迁移：如果是旧版明文，回写加密版本
    if (hasPlaintextSecrets(parsed)) {
      await saveSettings(settings);
    }
    settingsCache = settings;
    return settings;
  } catch {
    await appendLog("error", "读取设置失败，已回退默认设置", undefined, userDataPath);
    settingsCache = DEFAULT_SETTINGS;
    return settingsCache;
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  await ensureUserDataDir();
  authorizeSettingsCapabilities(settings, "save");
  const next = sanitizeCapabilityFields(settings);

  // 检查是否有敏感数据需要保存
  const hasSensitiveData = next.apiKey.trim().length > 0 ||
    next.apiProfiles.some((p) => p.apiKey.trim().length > 0) ||
    next.fixedTailAccount.trim().length > 0 ||
    next.fixedTailName.trim().length > 0;

  // 如果有敏感数据但加密不可用，拒绝保存并给出明确提示
  if (hasSensitiveData && !safeStorage.isEncryptionAvailable()) {
    await appendLog("error", "系统加密服务不可用，拒绝保存包含敏感数据的设置", undefined, userDataPath);
    throw new Error(
      "安全错误：系统加密服务不可用，无法安全存储 API Key 和敏感信息。\n\n" +
      "可能原因：\n" +
      "1. Windows 用户账户未登录或使用本地账户\n" +
      "2. 系统加密功能被禁用\n" +
      "3. 运行在虚拟机或特殊环境中\n\n" +
      "建议：请使用 Microsoft 账户登录 Windows，或联系系统管理员启用数据保护 API (DPAPI)。"
    );
  }

  // 加密敏感字段后写入磁盘
  const encrypted = encryptSettingsFields(next);
  await fs.writeFile(userDataPath("settings.json"), JSON.stringify(encrypted, null, 2), "utf-8");
  settingsCache = next;
  return next;
}

export function clearSettingsCache(): void {
  settingsCache = null;
}
