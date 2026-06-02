import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

/**
 * 遍历目录收集指定扩展名的文件。
 */
export async function walkMedia(
  root: string,
  allowed: Set<string>,
  maxItems = 5000
): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    if (results.length >= maxItems) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (allowed.has(path.extname(entry.name).toLowerCase())) results.push(fullPath);
      if (results.length >= maxItems) break;
    }
  }
  if (root && existsSync(root)) await walk(root);
  return results;
}
