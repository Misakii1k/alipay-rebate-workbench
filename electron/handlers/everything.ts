import { type IpcMain } from "electron";
import type { AppSettings } from "../../src/lib/shared";
import { normalizeSettings } from "../../src/lib/shared";
import { resolveEverythingEsPath, searchWithEverything } from "../utils/everything";

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