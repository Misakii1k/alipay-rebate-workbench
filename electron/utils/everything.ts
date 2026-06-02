import { execFile } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import type { AppSettings } from "../../src/lib/shared";
import { sanitizeEverythingQuery } from "./security";

/**
 * 查找 Everything 的 es.exe 路径。
 */
export function resolveEverythingEsPath(settings: AppSettings): string {
  const candidates = [
    settings.everythingEsPath,
    path.join(process.resourcesPath, "bin", "es.exe"),
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Everything", "es.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Everything", "es.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Everything", "es.exe")
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || "";
}

/**
 * 使用 Everything (es.exe) 执行文件搜索。
 */
export function searchWithEverything(
  esPath: string,
  root: string,
  query: string,
  exts: Set<string>,
  maxResults = 500
): Promise<string[]> {
  return new Promise((resolve) => {
    const extList = [...exts].map((e) => e.replace(".", "")).join(";");
    const safeRoot = root ? path.resolve(root) : "";
    const args = ["-n", String(maxResults), ...(safeRoot ? ["-path", safeRoot] : []), `ext:${extList}`];
    if (query.trim()) {
      const clean = sanitizeEverythingQuery(query);
      if (clean) args.push(clean);
    }
    execFile(esPath, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) { resolve([]); return; }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve(lines.filter((line) => existsSync(line)));
    });
  });
}
