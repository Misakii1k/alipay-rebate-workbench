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
