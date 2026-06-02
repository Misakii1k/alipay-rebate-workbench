import { type IpcMain } from "electron";
import fs from "node:fs/promises";
import { validatePathSafety } from "../utils/security";
import { imageToDataUrl } from "../utils/media";
import { walkMedia } from "../utils/walk";

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

async function latestImageInDirectory(dir: string): Promise<string> {
  validatePathSafety(dir);
  const files = await walkMedia(dir, imageExts, 2000);
  const withStats = await Promise.all(
    files.map(async (filePath) => ({ filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs }))
  );
  return withStats.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? "";
}

/**
 * 注册媒体文件相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("media:latestImage", (_event, dir: string) => latestImageInDirectory(dir));
  ipcMain.handle("media:imagePreview", (_event, filePath: string) => imageToDataUrl(filePath, 960) ?? "");
}