import { type IpcMain } from "electron";
import type { AppSettings, ModelConnectionStatus } from "../../src/lib/shared";
import { normalizeSettings, getActiveApiProfile } from "../../src/lib/shared";
import { validateApiUrl } from "../utils/security";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";

async function testModelConnectionInMain(settings: AppSettings): Promise<ModelConnectionStatus> {
  const normalized = normalizeSettings(settings);
  const profile = getActiveApiProfile(normalized);

  try {
    validateApiUrl(profile.apiBaseUrl);
  } catch (error) {
    return { state: "failed", detail: (error as Error).message };
  }

  if (!profile.apiKey.trim()) {
    return { state: "failed", detail: "未配置 API Key，请在设置中填写。" };
  }

  const url = `${profile.apiBaseUrl.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": profile.apiType === "openai" ? `Bearer ${profile.apiKey}` : profile.apiKey,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      return { state: "connected", detail: `连接成功：${profile.apiBaseUrl}` };
    } else {
      const errorText = await response.text().catch(() => "(无法读取响应)");
      return { state: "failed", detail: `HTTP ${response.status}: ${errorText.slice(0, 100)}` };
    }
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("aborted")) {
      return { state: "failed", detail: "连接超时（10秒），请检查网络或 API Base URL。" };
    }
    return { state: "failed", detail: `网络错误：${message}` };
  }
}

async function listAvailableModels(settings: AppSettings): Promise<{ id: string; name: string }[]> {
  const normalized = normalizeSettings(settings);
  const profile = getActiveApiProfile(normalized);

  try {
    validateApiUrl(profile.apiBaseUrl);
  } catch (error) {
    await appendLog("error", "列出模型失败：API URL 不安全", { error: (error as Error).message }, userDataPath);
    return [];
  }

  if (!profile.apiKey.trim()) {
    return [];
  }

  const url = `${profile.apiBaseUrl.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": profile.apiType === "openai" ? `Bearer ${profile.apiKey}` : profile.apiKey,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      await appendLog("warn", "列出模型失败", { status: response.status }, userDataPath);
      return [];
    }

    const data = await response.json() as { data?: Array<{ id: string }> };
    if (!Array.isArray(data.data)) return [];

    return data.data.map((model) => ({
      id: model.id,
      name: model.id
    }));
  } catch (error) {
    await appendLog("error", "列出模型失败", { error: (error as Error).message }, userDataPath);
    return [];
  }
}

/**
 * 注册 AI 连接测试相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("ai:testConnection", (_event, settings: AppSettings) => testModelConnectionInMain(settings));
  ipcMain.handle("ai:listModels", (_event, settings: AppSettings) => listAvailableModels(settings));
}
