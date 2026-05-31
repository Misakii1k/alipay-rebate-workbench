import path from "node:path";
import { existsSync } from "node:fs";

/**
 * 校验路径安全性，防止路径遍历攻击。
 * 拒绝访问系统目录、程序目录和其他敏感位置。
 * @param targetPath 待校验的路径
 * @param allowedRoots 可选的允许访问的根目录列表（如用户选择的工作目录）
 */
export function validatePathSafety(targetPath: string, allowedRoots?: string[]): void {
  if (!targetPath) {
    throw new Error("路径不能为空");
  }

  const resolved = path.resolve(targetPath);
  const normalized = path.normalize(resolved).toLowerCase();

  // 黑名单：禁止访问的系统目录
  const forbiddenPaths = [
    path.normalize("C:\\Windows").toLowerCase(),
    path.normalize("C:\\Program Files").toLowerCase(),
    path.normalize("C:\\Program Files (x86)").toLowerCase(),
    path.normalize("C:\\ProgramData").toLowerCase(),
    path.normalize(process.env.SystemRoot || "C:\\Windows").toLowerCase(),
    path.normalize(process.env.ProgramFiles || "C:\\Program Files").toLowerCase(),
    path.normalize(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)").toLowerCase()
  ];

  // 检查是否在黑名单中
  for (const forbidden of forbiddenPaths) {
    if (normalized === forbidden || normalized.startsWith(forbidden + path.sep)) {
      throw new Error(`安全错误：禁止访问系统目录 ${forbidden}`);
    }
  }

  // 如果提供了白名单，检查路径是否在允许的根目录下
  if (allowedRoots && allowedRoots.length > 0) {
    const isAllowed = allowedRoots.some((root) => {
      if (!root) return false;
      const normalizedRoot = path.normalize(path.resolve(root)).toLowerCase();
      return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep);
    });

    if (!isAllowed) {
      throw new Error("安全错误：路径不在允许访问的目录范围内");
    }
  }
}

/**
 * 校验媒体文件路径安全性，防止命令注入攻击。
 * 检查文件是否存在、路径中是否包含危险字符、文件名长度是否合理。
 * @param filePath 待校验的文件路径
 */
export function validateMediaFilePath(filePath: string): void {
  if (!filePath) {
    throw new Error("文件路径不能为空");
  }

  // 检查文件是否存在
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在：${filePath}`);
  }

  // 检查路径中是否包含危险字符（Windows 命令注入常用字符）
  const dangerousChars = /[&|^<>;"'`$(){}[\]!]/;
  if (dangerousChars.test(filePath)) {
    throw new Error(`安全错误：文件路径包含不安全字符，请重命名文件后重试。路径：${path.basename(filePath)}`);
  }

  // 检查文件名长度（防止超长路径攻击）
  const fileName = path.basename(filePath);
  if (fileName.length > 255) {
    throw new Error("文件名过长，请重命名后重试");
  }

  // 应用通用路径安全校验
  validatePathSafety(filePath);
}

/**
 * 校验 API Base URL 使用 HTTPS，非 HTTPS 时抛出错误。
 * 允许 localhost 和 127.0.0.1 使用 HTTP（用于本地开发）。
 * @param url API Base URL
 */
export function validateApiUrl(url: string): void {
  if (!url) return;
  if (!url.startsWith("https://") && !url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
    throw new Error("安全错误：API Base URL 必须使用 HTTPS 协议，以保护 API Key 不被窃取。本地测试可使用 localhost 或 127.0.0.1。");
  }
}

/**
 * 转义 Excel 单元格文本，防止公式注入攻击。
 * 如果文本以 =、+、-、@ 开头，则在前面添加单引号。
 * @param value 待转义的值
 * @returns 转义后的文本，如果为空则返回 null
 */
export function sanitizeCellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text === "") return null;
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

/**
 * 过滤 Everything 搜索查询，防止命令注入攻击。
 * 仅保留 Unicode 字母、数字、空格、下划线、连字符。
 * @param query 原始查询字符串
 * @returns 过滤后的查询字符串（最大 200 字符）
 */
export function sanitizeEverythingQuery(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ") // 仅保留 Unicode 字母/数字/空格/下划线/连字符
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // 限制长度，防止超长查询
}
