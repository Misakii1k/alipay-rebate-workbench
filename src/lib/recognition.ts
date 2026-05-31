import { ANTHROPIC_API_VERSION, AppSettings, CloudReview, ModelConnectionStatus, RecognitionResult, getActiveApiProfile, normalizeSettings } from "./shared";
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

## 提取规则
1. 支付宝账号只能是：中国大陆11位手机号（1[3-9]开头）或标准邮箱地址（含@和域名）。
2. 收款方姓名只能是 2-4 个中文字符的真人姓名，不要提取昵称、商品名、店铺名。
3. 如果无法确定，字段返回空字符串，confidence 给低分。
4. 文本中有多个候选时，优先提取最可能是收款信息的那组（通常紧挨着出现）。

## 常见陷阱
- 不要提取 QQ号、订单号、金额作为账号
- 不要提取"支付宝""收款人""备注"等标签词作为姓名
- 姓名含标点或空格时合并（如"张 三"→"张三"）

## 输出格式
只返回 JSON，不要 Markdown，不要代码块：
{"account":"支付宝账号","name":"收款方姓名","confidence":0.0,"reason":"简短说明"}`;

export const CLOUD_REVIEW_PROMPT = `你是支付宝返款表的云端复核助手。请根据原始文本和本地识别结果，判断本地识别的支付宝账号与收款方姓名是否可靠。

## 核心规则
1. 支付宝账号只能是：中国大陆11位手机号（1[3-9]xxxxxxxxx）或标准邮箱地址。
2. 收款方姓名只能是 2-4 个中文字符的真人姓名，不能是昵称、品牌名、商品名。
3. 账号和姓名必须同时出现在原始文本中，缺一不可猜测。

## 常见错误模式（必须纠正）
- 把 QQ号、订单号、金额数字误认为手机号 → 只取 1 开头的 11 位数字
- 把"支付宝"、"收款人"等标签词当姓名 → 过滤掉
- 把邮箱前缀中的字母数字当姓名 → 忽略
- 把商品名、店铺名当姓名（如"连衣裙"、"数码店"）→ 过滤掉
- 文本中有多个手机号/邮箱时 → 优先取与姓名相邻的那个
- 姓名被空格或符号断开（如"张 三"）→ 合并为"张三"

## 判断标准
- valid=true：账号和姓名都正确，且能从原始文本中明确对应
- valid=false：任一字段错误、可疑、或无法从原文确认
- confidence 范围：0.0（完全不确定）到 1.0（非常确定）
  - 0.9-1.0：原文清晰写了"支付宝xxx"或"姓名xxx"，直接匹配
  - 0.7-0.89：能从上下文推断，但表述不够直接
  - 0.5-0.69：有多个可能，取最可能的那个
  - 0.0-0.49：高度不确定，建议人工确认

## 输出格式
只返回 JSON，不要 Markdown，不要代码块：
{"valid":true,"account":"支付宝账号","name":"收款方姓名","confidence":0.0,"reason":"简短说明判断依据"}`;

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

/** 校验 API Base URL 使用 HTTPS，非 HTTPS（localhost 除外）时抛出错误 */
function assertHttpsUrl(url: string): void {
  if (!url) return;
  if (!url.startsWith("https://") && !url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
    throw new Error("安全错误：API Base URL 必须使用 HTTPS 协议，以保护 API Key 不被窃取。本地测试可使用 localhost 或 127.0.0.1。");
  }
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
      const isAnthropic = profile.apiType === "anthropic";

      // 校验 HTTPS
      try {
        assertHttpsUrl(profileSettings.apiBaseUrl);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "API URL 校验失败";
        continue; // 跳过此 profile，尝试下一个
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 45000);
        try {
          if (isAnthropic) {
            const baseUrl = profileSettings.apiBaseUrl.replace(/\/$/, "");
            const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
            const sysMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "system");
            const chatMessages = (messages as Array<{ role: string; content: string }>).filter((m) => m.role !== "system");
            const body: Record<string, unknown> = {
              model: profileModel,
              max_tokens: 4096,
              messages: chatMessages.map((m) => ({ role: m.role, content: m.content }))
            };
            if (sysMsg) body.system = sysMsg.content;

            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": profileSettings.apiKey,
                "anthropic-version": ANTHROPIC_API_VERSION
              },
              signal: controller.signal,
              body: JSON.stringify(body)
            });

            if (!response.ok) {
              const text = await response.text();
              lastError = `Anthropic API 请求失败：${response.status} ${text}`;
              if (attempt < maxAttempts && shouldRetry(response.status)) {
                await wait(500 * 2 ** (attempt - 1));
                continue;
              }
              break;
            }

            const data = await response.json();
            const textContent = data?.content?.[0]?.text;
            if (!textContent) throw new Error("Anthropic 没有返回可解析内容。");
            return JSON.parse(textContent);
          } else {
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
          }
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
