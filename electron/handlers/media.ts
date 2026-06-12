import { type IpcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { authorizeDirectoryCapability, isAuthorizedMediaPath } from "../utils/capabilities";
import { isPathInsideRoot, validatePathSafety } from "../utils/security";
import { imageToDataUrl } from "../utils/media";
import { walkMedia } from "../utils/walk";

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const authorizedMediaRoots = new Set<string>();

export function authorizeMediaRoot(root: string): void {
  if (!root) return;
  validatePathSafety(root);
  authorizedMediaRoots.add(path.resolve(root));
  authorizeDirectoryCapability("mediaRoot", root);
}

async function latestImageInDirectory(dir: string): Promise<string> {
  validatePathSafety(dir);
  if (![...authorizedMediaRoots].some((root) => isPathInsideRoot(dir, root))) return "";
  const files = await walkMedia(dir, imageExts, 2000);
  let latest = "";
  let latestMtime = 0;
  for (const filePath of files) {
    const mtimeMs = await fs.stat(filePath).then((stat) => stat.mtimeMs).catch(() => 0);
    if (mtimeMs > latestMtime) {
      latest = filePath;
      latestMtime = mtimeMs;
    }
  }
  return latest;
}

function imagePreview(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (!imageExts.has(ext)) return "";
  validatePathSafety(filePath);
  const allowed = [...authorizedMediaRoots].some((root) => isPathInsideRoot(filePath, root)) || isAuthorizedMediaPath(filePath, imageExts);
  if (!allowed) return "";
  return imageToDataUrl(filePath, 960) ?? "";
}

/**
 * 注册媒体文件相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("media:latestImage", (_event, dir: string) => latestImageInDirectory(dir));
  ipcMain.handle("media:imagePreview", (_event, filePath: string) => imagePreview(filePath));
}
