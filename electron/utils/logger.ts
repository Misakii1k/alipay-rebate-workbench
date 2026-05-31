import fs from "node:fs/promises";
import path from "node:path";

/**
 * 脱敏日志数据，防止敏感信息泄露。
 * 支持脱敏：API Key、手机号、邮箱、中文姓名、金额。
 * @param obj 待脱敏的对象
 * @returns 脱敏后的对象
 */
export function sanitizeForLog(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return obj
      .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***")
      .replace(/Bearer\s+[a-zA-Z0-9\-_]+/gi, "Bearer ***")
      .replace(/"apiKey"\s*:\s*"[^"]+"/gi, '"apiKey":"***"')
      .replace(/"x-api-key"\s*:\s*"[^"]+"/gi, '"x-api-key":"***"')
      // 脱敏手机号（保留前3后4位）
      .replace(/\b(1[3-9]\d)(\d{4})(\d{4})\b/g, "$1****$3")
      // 脱敏邮箱（保留前2字符和域名）
      .replace(/\b([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/gi, "$1***@$2")
      // 脱敏中文姓名（保留姓氏）
      .replace(/(?<="name"\s*:\s*")[一-龥]{2,4}(?=")/g, (match) => match[0] + "*".repeat(match.length - 1))
      // 脱敏金额（保留整数部分，小数部分替换为 **.** ）
      .replace(/(?<="amount"\s*:\s*")\d+(\.\d+)?(?=")/g, (match) => {
        const parts = match.split(".");
        return parts[0] + (parts[1] ? ".**" : "");
      });
  }
  if (Array.isArray(obj)) return obj.map(sanitizeForLog);
  if (typeof obj === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("apikey") || lowerKey.includes("api_key") || lowerKey === "authorization" || lowerKey === "x-api-key") {
        cleaned[key] = "***";
      } else if (lowerKey === "account" && typeof value === "string") {
        // 脱敏 account 字段（手机号或邮箱）
        if (/^1[3-9]\d{9}$/.test(value)) {
          cleaned[key] = value.slice(0, 3) + "****" + value.slice(-4);
        } else if (/@/.test(value)) {
          cleaned[key] = value.replace(/^([^@]{1,2})[^@]*@/, "$1***@");
        } else {
          cleaned[key] = "***";
        }
      } else if (lowerKey === "name" && typeof value === "string" && /[一-龥]/.test(value)) {
        // 脱敏中文姓名（保留姓氏）
        cleaned[key] = value[0] + "*".repeat(Math.max(0, value.length - 1));
      } else if ((lowerKey === "amount" || lowerKey.includes("price")) && typeof value === "string") {
        // 脱敏金额
        const parts = value.split(".");
        cleaned[key] = parts[0] + (parts[1] ? ".**" : "");
      } else {
        cleaned[key] = sanitizeForLog(value);
      }
    }
    return cleaned;
  }
  return obj;
}

/**
 * 追加日志到文件。
 * 日志文件按日期分割，存储在 userData/logs/ 目录下。
 * @param level 日志级别
 * @param message 日志消息
 * @param meta 可选的元数据（会自动脱敏）
 * @param userDataPath 获取 userData 路径的函数
 */
export async function appendLog(
  level: "info" | "warn" | "error",
  message: string,
  meta: unknown,
  userDataPath: (...segments: string[]) => string
): Promise<void> {
  const logDir = userDataPath("logs");
  await fs.mkdir(logDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, meta: sanitizeForLog(meta) }) + "\n";
  await fs.appendFile(path.join(logDir, `${date}.log`), line, "utf-8");
}
