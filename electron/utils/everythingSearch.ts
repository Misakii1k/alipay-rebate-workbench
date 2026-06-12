import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isPathInsideRoot, sanitizeEverythingQuery } from "./security";

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
      if (error) {
        resolve([]);
        return;
      }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve(lines.filter((line) => {
        if (!existsSync(line)) return false;
        if (!isPathInsideRoot(line, root)) return false;
        return exts.has(path.extname(line).toLowerCase());
      }));
    });
  });
}
