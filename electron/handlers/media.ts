import { type IpcMain } from "electron";
import fs from "node:fs/promises";
import { nativeImage } from "electron";
import { validatePathSafety } from "../utils/security";
import { imageToDataUrl } from "../utils/media";

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

async function walkMedia(root: string, allowed: Set<string>, maxItems = 5000): Promise<string[]> {
  const results: string[] = [];
  const queue = [root];
  while (queue.length > 0 && results.length < maxItems) {
    const dir = queue.shift()!;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxItems) break;
        const fullPath = `${dir}\\${entry.name}`;
        if (entry.isDirectory()) queue.push(fullPath);
        else if (entry.isFile()) {
          const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
          if (allowed.has(ext)) results.push(fullPath);
        }
      }
    } catch {}
  }
  return results;
}

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
