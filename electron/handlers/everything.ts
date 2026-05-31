import { type IpcMain } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import type { AppSettings } from "../../src/lib/shared";
import { normalizeSettings } from "../../src/lib/shared";
import { sanitizeEverythingQuery } from "../utils/security";

function resolveEverythingEsPath(settings: AppSettings): string {
  const candidates = [
    settings.everythingEsPath,
    "C:\\Program Files\\Everything\\es.exe",
    "C:\\Program Files (x86)\\Everything\\es.exe",
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Everything", "es.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Everything", "es.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function searchWithEverything(esPath: string, root: string, query: string, exts: Set<string>, maxResults = 500): Promise<string[]> {
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

async function testEverythingConnection(settings: AppSettings): Promise<{ available: boolean; detail: string }> {
  const esPath = resolveEverythingEsPath(settings);
  if (!esPath) return { available: false, detail: "未找到 es.exe，请确认 Everything 已安装并在后台运行。" };
  try {
    await searchWithEverything(esPath, "", "test", new Set([".txt"]), 1);
    return { available: true, detail: `Everything 已就绪，搜索可用。` };
  } catch {
    return { available: false, detail: "es.exe 已找到但执行失败，请确认 Everything 主程序正在后台运行。" };
  }
}

/**
 * 注册 Everything 搜索相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("everything:test", (_event, settings: AppSettings) => testEverythingConnection(normalizeSettings(settings)));
}
