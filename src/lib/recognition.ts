import { RecognitionResult } from "./shared";
import { isValidAccount } from "./parsing";

const ACCOUNT_RE = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|1[3-9]\d{9})/i;
const NAME_HINT_RE = /(?:姓名|名字|收款人|实名|支付宝实名)[:：\s]*([一-龥]{2,6})/;
const CHINESE_NAME_RE = /[一-龥]{2,6}/g;

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

export const FEEDBACK_LEARNING_PROMPT = `你是支付宝返款表识别规则优化助手。用户最终在本地结果、云端复核结果或手动填写结果中做出了选择。
请根据原始文本、本地结果、云端结果、最终采用结果，总结一条可复用的识别规则，用于下次提高准确率。
要求：
1. 只总结可复用规则，不要记住具体个人隐私信息。
2. 如果只是接口超时、并发限制、网络错误，不要生成规则，返回空 note。
3. 只返回 JSON，不要 Markdown。
JSON 格式：
{"note":"可追加到提示词中的简短规则","reason":"为什么这条规则有帮助"}`;

export function withLearningNotes(prompt: string, notes: string): string {
  const trimmed = (notes || "").trim();
  if (!trimmed) return prompt;
  return `${prompt}\n\n历史纠偏规则：\n${trimmed}`;
}
