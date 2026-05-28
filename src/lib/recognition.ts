import { AppSettings, CloudReview, ModelConnectionStatus, RecognitionResult, getActiveApiProfile, normalizeSettings } from "./shared";
import { isValidAccount } from "./parsing";

const ACCOUNT_RE = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|1[3-9]\d{9})/i;
const NAME_HINT_RE = /(?:姓名|名字|收款人|实名|支付宝实名)[:：\s]*([\u4e00-\u9fa5]{2,6})/;
const CHINESE_NAME_RE = /[\u4e00-\u9fa5]{2,6}/g;

export function recognizeByRules(text: string): RecognitionResult | null {
  const account = text.match(ACCOUNT_RE)?.[1]?.trim() ?? "";
  if (!account || !isValidAccount(account)) return null;

  const withoutAccount = text.replace(account, " ");
  const hintedName = withoutAccount.match(NAME_HINT_RE)?.[1]?.trim();
  const candidates = [...withoutAccount.matchAll(CHINESE_NAME_RE)]
    .map((match) => match[0])
    .filter((value) => !["支付宝", "账号", "姓名", "收款人", "电话", "手机"].includes(value));
  const name = hintedName || candidates[0] || "";

  if (!name) return null;

  return {
    account,
    name,
    confidence: hintedName ? 0.92 : 0.78,
    reason: hintedName ? "本地规则识别到账号和姓名标签" : "本地规则识别到账号和中文姓名",
    source: "rules",
    rawText: text
  };
}

export function recognizePartialByRules(text: string): RecognitionResult | null {
  const account = text.match(ACCOUNT_RE)?.[1]?.trim() ?? "";
  const withoutAccount = account ? text.replace(account, " ") : text;
  const hintedName = withoutAccount.match(NAME_HINT_RE)?.[1]?.trim();
  const candidates = [...withoutAccount.matchAll(CHINESE_NAME_RE)]
    .map((match) => match[0])
    .filter((value) => !["支付宝", "账号", "姓名", "收款人", "电话", "手机"].includes(value));
  const name = hintedName || candidates[0] || "";
  if (!account && !name) return null;
  return {
    account: isValidAccount(account) ? account : "",
    name,
    confidence: account && name ? 0.72 : 0.55,
    reason: account && name ? "本地规则识别到账号和姓名" : "本地规则只识别到部分字段",
    source: "rules",
    rawText: text
  };
}

export const TEXT_RECOGNITION_PROMPT = `你是支付宝返款表录入助手。请只从用户提供的文本中提取收款方支付宝账号和收款方姓名。
规则：
1. 支付宝账号只能是中国大陆手机号或邮箱。
2. 姓名必须来自原文，不要猜测、不要补全。
3. 如果无法确定，字段返回空字符串，confidence 给低分。
4. 只返回 JSON，不要 Markdown，不要解释。
JSON 格式：
{"account":"支付宝账号","name":"收款方姓名","confidence":0.0,"reason":"简短说明"}`;

export const CLOUD_REVIEW_PROMPT = `你是支付宝返款表的云端复核助手。请根据原始文本和本地识别结果，判断本地识别的支付宝账号与收款方姓名是否可靠。
规则：
1. 账号只能是中国大陆手机号或邮箱。
2. 姓名必须来自原始文本，不要猜测。
3. 如果本地结果正确，valid 返回 true，并原样返回 account/name。
4. 如果本地结果可疑或错误，valid 返回 false，并在能确定时给出更可信的 account/name；无法确定则返回空字符串。
5. 只返回 JSON，不要 Markdown。
JSON 格式：
{"valid":true,"account":"支付宝账号","name":"收款方姓名","confidence":0.0,"reason":"简短说明"}`;

export const FEEDBACK_LEARNING_PROMPT = `你是支付宝返款表识别规则优化助手。用户最终没有采用云端复核结果，而是选择本地结果或自己填写。
请根据原始文本、本地结果、云端结果、最终采用结果，总结一条可复用的识别规则，用于下次提高准确率。
要求：
1. 只总结可复用规则，不要记住具体个人隐私信息。
2. 如果只是接口超时、并发限制、网络错误，不要生成规则，返回空 note。
3. 只返回 JSON，不要 Markdown。
JSON 格式：
{"note":"可追加到提示词中的简短规则","reason":"为什么这条规则有帮助"}`;

let inFlightRequests = 0;
const pendingRequests: Array<() => void> = [];

async function runWithModelLimit<T>(settings: AppSettings, task: () => Promise<T>): Promise<T> {
  const limit = Math.max(1, settings.modelConcurrency || 1);
  if (inFlightRequests >= limit) {
    await new Promise<void>((resolve) => pendingRequests.push(resolve));
  }
  inFlightRequests += 1;
  try {
    return await task();
  } finally {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
    pendingRequests.shift()?.();
  }
}

function shouldRetry(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function wait(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function callChatCompletions(
  settings: AppSettings,
  model: string,
  messages: unknown[]
): Promise<Record<string, unknown>> {
  const maxAttempts = Math.max(1, (settings.modelRetryCount || 0) + 1);

  return runWithModelLimit(settings, async () => {
    const activeProfile = getActiveApiProfile(settings);
    const fallbackProfiles = settings.apiProfiles.filter(
      (profile) => profile.id !== activeProfile.id && profile.apiBaseUrl && profile.apiKey
    );
    const profiles = [activeProfile, ...fallbackProfiles].filter((profile) => profile.apiBaseUrl && profile.apiKey);
    if (!profiles.length) {
      throw new Error("请先在设置中填写至少一个可用的 API Base URL 和 API Key。");
    }
    let lastError = "";

    for (const profile of profiles) {
      const profileSettings = normalizeSettings({ ...settings, activeApiProfileId: profile.id });
      const profileModel = model === settings.textModel ? profile.textModel : model === settings.visionModel ? profile.visionModel : model;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 45000);
        try {
          const endpoint = `${profileSettings.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${profileSettings.apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: profileModel,
              temperature: 0,
              response_format: { type: "json_object" },
              messages
            })
          });

          if (!response.ok) {
            const text = await response.text();
            lastError = `模型接口请求失败：${response.status} ${text}`;
            if (attempt < maxAttempts && shouldRetry(response.status)) {
              await wait(500 * 2 ** (attempt - 1));
              continue;
            }
            break;
          }

          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          if (!content) throw new Error("模型没有返回可解析内容。");
          return JSON.parse(content);
        } catch (error) {
          lastError = error instanceof Error ? error.message : "模型接口请求失败";
          if (attempt < maxAttempts) {
            await wait(500 * 2 ** (attempt - 1));
            continue;
          }
        } finally {
          window.clearTimeout(timeout);
        }
      }
    }
    throw new Error(lastError || "模型接口请求失败");
  });
}

function normalizeModelResult(value: Record<string, unknown>, source: RecognitionResult["source"]): RecognitionResult {
  const account = String(value.account ?? "").trim();
  const name = String(value.name ?? "").trim();
  return {
    account,
    name,
    confidence: Number(value.confidence ?? 0),
    reason: String(value.reason ?? "模型识别完成"),
    source,
    rawText: ""
  };
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "一致", "正确"].includes(normalized)) return true;
    if (["false", "no", "0", "不一致", "错误"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value === 1;
  return false;
}

export async function recognizeText(text: string, settings: AppSettings): Promise<RecognitionResult> {
  const rules = recognizeByRules(text);
  if (rules) return rules;

  if (!settings.aiEnabled) {
    const partial = recognizePartialByRules(text);
    if (partial) return partial;
    throw new Error("本地规则无法识别，且 AI 识别已关闭。");
  }

  const result = await callChatCompletions(settings, settings.textModel, [
    { role: "system", content: withLearningNotes(TEXT_RECOGNITION_PROMPT, settings) },
    { role: "user", content: text }
  ]);
  return { ...normalizeModelResult(result, "text-model"), rawText: text };
}

export async function reviewRecognitionCloud(
  rawText: string,
  localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">,
  settings: AppSettings
): Promise<CloudReview> {
  if (!settings.aiEnabled) {
    return { status: "error", reason: "AI 识别已关闭，无法进行云端增强校验。" };
  }

  const result = await callChatCompletions(settings, settings.textModel, [
    { role: "system", content: withLearningNotes(CLOUD_REVIEW_PROMPT, settings) },
    {
      role: "user",
      content: JSON.stringify(
        {
          rawText,
          localResult
        },
        null,
        2
      )
    }
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
}

export async function learnFromFinalChoice(
  payload: {
    rawText?: string;
    localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">;
    cloudReview?: CloudReview;
    finalChoice: { account: string; name: string; mode: "local" | "manual" };
  },
  settings: AppSettings
): Promise<{ note: string; reason: string }> {
  if (!settings.aiEnabled || !settings.enableLearningFeedback) return { note: "", reason: "学习反馈已关闭" };
  if (!payload.rawText?.trim()) return { note: "", reason: "没有原始文本，跳过学习" };
  const result = await callChatCompletions(settings, settings.textModel, [
    { role: "system", content: FEEDBACK_LEARNING_PROMPT },
    { role: "user", content: JSON.stringify(payload, null, 2) }
  ]);
  return {
    note: String(result.note ?? "").trim(),
    reason: String(result.reason ?? "").trim()
  };
}

export async function testModelConnection(settings: AppSettings): Promise<ModelConnectionStatus> {
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.textModel) {
    return { state: "failed", detail: "API Base URL、API Key 或文本模型名未填写完整。" };
  }

  try {
    const result = await callChatCompletions(settings, settings.textModel, [
      {
        role: "system",
        content: "你是连接测试助手。只返回 JSON：{\"ok\":true,\"message\":\"连接成功\"}"
      },
      { role: "user", content: "测试连接" }
    ]);
    const ok = Boolean(result.ok ?? true);
    return {
      state: ok ? "connected" : "failed",
      detail: String(result.message ?? (ok ? "大模型连接成功。" : "模型返回测试失败。"))
    };
  } catch (error) {
    return {
      state: "failed",
      detail: error instanceof Error ? error.message : "大模型连接测试失败。"
    };
  }
}

function withLearningNotes(prompt: string, settings: AppSettings) {
  const notes = settings.learningPromptNotes.trim();
  if (!notes) return prompt;
  return `${prompt}\n\n历史纠偏规则：\n${notes}`;
}
