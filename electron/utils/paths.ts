import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 获取 userData 目录下的路径。
 * @param segments 路径片段
 * @returns 完整路径
 */
export function userDataPath(...segments: string[]): string {
  return path.join(app.getPath("userData"), ...segments);
}

/**
 * 确保 userData 目录存在。
 */
export async function ensureUserDataDir(): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
}
