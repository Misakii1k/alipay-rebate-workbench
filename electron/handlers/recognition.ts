import { type IpcMain } from "electron";
import type { AppSettings, CloudReview, RecognitionLearningPayload, RecognitionLearningResult, RecognitionResult } from "../../src/lib/shared";
import { normalizeSettings, getActiveApiProfile } from "../../src/lib/shared";
import { TEXT_RECOGNITION_PROMPT, CLOUD_REVIEW_PROMPT, FEEDBACK_LEARNING_PROMPT, recognizeByRules, recognizePartialByRules, withLearningNotes } from "../../src/lib/recognition";
import { validateApiUrl } from "../utils/security";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";

// ============================================================================
// AI API 调用
// ============================================================================
function shouldRetry(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChatCompletions(
  settings: AppSettings,
  messages: Array<{ role: string; content: string }>
): Promise<Record<string, unknown>> {
  const profile = getActiveApiProfile(settings);
  const model = profile.textModel;
  if (!model) throw new Error("未配置文本模型。");
  const maxAttempts = Math.max(1, (settings.modelRetryCount || 0) + 1);
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: profile.apiType === "openai" ? `Bearer ${profile.apiKey}` : profile.apiKey
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "(无法读取响应)");
        lastError = `模型接口请求失败：${response.status} ${text}`;
        if (attempt < maxAttempts && shouldRetry(response.status)) {
          await wait(500 * Math.pow(2, attempt - 1));
          continue;
        }
        break;
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("模型没有返回可解析内容。");
      return JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "模型接口请求失败";
      if (attempt < maxAttempts) {
        await wait(500 * Math.pow(2, attempt - 1));
        continue;
      }
    }
  }
  throw new Error(lastError || "模型接口请求失败");
}

// ============================================================================
// 类型辅助
// ============================================================================
function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "1", "一致", "正确"].includes(v)) return true;
    if (["false", "no", "0", "不一致", "错误"].includes(v)) return false;
  }
  if (typeof value === "number") return value === 1;
  return false;
}

// ============================================================================
// AI 识别
// ============================================================================
async function recognizeText(text: string, settings: AppSettings): Promise<RecognitionResult> {
  const normalized = normalizeSettings(settings);
  validateApiUrl(getActiveApiProfile(normalized).apiBaseUrl);

  const rules = recognizeByRules(text);
  if (rules) return rules;

  if (!normalized.aiEnabled) {
    const partial = recognizePartialByRules(text);
    if (partial) return partial;
    throw new Error("本地规则无法识别，且 AI 识别已关闭。");
  }

  const result = await callChatCompletions(normalized, [
    { role: "system", content: withLearningNotes(TEXT_RECOGNITION_PROMPT, normalized.learningPromptNotes) },
    { role: "user", content: text }
  ]);

  const account = String(result.account ?? "").trim();
  const name = String(result.name ?? "").trim();
  return {
    account,
    name,
    confidence: Number(result.confidence ?? 0),
    reason: String(result.reason ?? "模型识别完成"),
    source: "text-model",
    rawText: text
  };
}

// ============================================================================
// 云端校验
// ============================================================================
async function reviewRecognitionCloud(
  rawText: string,
  localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">,
  settings: AppSettings
): Promise<CloudReview> {
  const normalized = normalizeSettings(settings);
  validateApiUrl(getActiveApiProfile(normalized).apiBaseUrl);

  if (!normalized.aiEnabled) {
    return { status: "error", reason: "AI 识别已关闭，无法进行云端增强校验。" };
  }

  try {
    const result = await callChatCompletions(normalized, [
      { role: "system", content: withLearningNotes(CLOUD_REVIEW_PROMPT, normalized.learningPromptNotes) },
      { role: "user", content: JSON.stringify({ rawText, localResult }, null, 2) }
    ]);

    const cloudAccount = String(result.account ?? "").trim();
    const cloudName = String(result.name ?? "").trim();
    const accountMatches = !cloudAccount || cloudAccount === localResult.account;
    const nameMatches = !cloudName || cloudName === localResult.name;
    const valid = normalizeBoolean(result.valid) && accountMatches && nameMatches;

    return {
      status: valid ? "passed" : "warning",
      valid,
      account: cloudAccount,
      name: cloudName,
      confidence: Number(result.confidence ?? 0),
      reason: String(result.reason ?? "云端增强校验完成")
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "云端校验失败";
    await appendLog("warn", "云端校验失败", { rawText, error: reason }, userDataPath);
    return { status: "error", reason };
  }
}

// ============================================================================
// 学习反馈
// ============================================================================
async function learnFromFinalChoice(
  payload: RecognitionLearningPayload,
  settings: AppSettings
): Promise<RecognitionLearningResult> {
  const normalized = normalizeSettings(settings);
  if (!normalized.aiEnabled || !normalized.enableLearningFeedback) return { note: "", reason: "学习反馈已关闭" };
  if (!payload.rawText?.trim()) return { note: "", reason: "没有原始文本，跳过学习" };

  try {
    const result = await callChatCompletions(normalized, [
      { role: "system", content: FEEDBACK_LEARNING_PROMPT },
      { role: "user", content: JSON.stringify(payload, null, 2) }
    ]);
    return {
      note: String(result.note ?? "").trim(),
      reason: String(result.reason ?? "").trim()
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "学习反馈失败");
  }
}

// ============================================================================
// 注册 IPC
// ============================================================================
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("recognition:recognizeText", (_event, text: string, settings: AppSettings) =>
    recognizeText(text, settings)
  );
  ipcMain.handle("recognition:cloudReview", (_event, rawText: string, localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">, settings: AppSettings) =>
    reviewRecognitionCloud(rawText, localResult, settings)
  );
  ipcMain.handle("recognition:learnFromChoice", (_event, payload: RecognitionLearningPayload, settings: AppSettings) =>
    learnFromFinalChoice(payload, settings)
  );
}
