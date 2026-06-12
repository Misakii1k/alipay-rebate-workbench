import { parentPort, workerData } from "node:worker_threads";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

interface ThumbnailPayload {
  paths: string[];
  size: number;
  maxCount: number;
  cacheDir?: string;
  requestId?: string;
}

const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const requestId = typeof (workerData as ThumbnailPayload).requestId === "string" ? (workerData as ThumbnailPayload).requestId : undefined;

function postMessage(message: { ok: boolean; result?: Record<string, string>; error?: string; progress?: { phase: string; scanned?: number; currentDir?: string } }): void {
  parentPort?.postMessage(requestId ? { ...message, requestId } : message);
}

async function cachePath(cacheDir: string | undefined, filePath: string, size: number): Promise<string | undefined> {
  if (!cacheDir) return undefined;
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat) return undefined;
  const key = createHash("sha1").update(`${path.resolve(filePath)}|${stat.mtimeMs}|${stat.size}|${size}`).digest("hex");
  return path.join(cacheDir, `${key}.png`);
}

async function cleanupThumbnailCache(cacheDir: string | undefined): Promise<void> {
  if (!cacheDir) return;
  const now = Date.now();
  const entries = await fs.readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".png") continue;
    const filePath = path.join(cacheDir, entry.name);
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat) continue;
    if (now - stat.mtimeMs > MAX_CACHE_AGE_MS) {
      await fs.unlink(filePath).catch(() => undefined);
      continue;
    }
    files.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
  }

  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= MAX_CACHE_BYTES) return;
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    await fs.unlink(file.path).catch(() => undefined);
    total -= file.size;
    if (total <= MAX_CACHE_BYTES) break;
  }
}

async function toDataUrl(filePath: string, size: number, cacheDir?: string): Promise<string | undefined> {
  try {
    const cachedPath = await cachePath(cacheDir, filePath, size);
    if (cachedPath) {
      const cached = await fs.readFile(cachedPath).catch(() => undefined);
      if (cached) {
        const now = new Date();
        void fs.utimes(cachedPath, now, now).catch(() => undefined);
        return `data:image/png;base64,${cached.toString("base64")}`;
      }
    }

    const sharp = (await import("sharp")).default;
    const buffer = await sharp(filePath)
      .rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toBuffer();
    if (cachedPath) {
      await fs.mkdir(path.dirname(cachedPath), { recursive: true }).catch(() => undefined);
      await fs.writeFile(cachedPath, buffer).catch(() => undefined);
    }
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function main(): Promise<Record<string, string>> {
  const payload = workerData as ThumbnailPayload;
  void cleanupThumbnailCache(payload.cacheDir);
  const result: Record<string, string> = {};
  const limited = (payload.paths || []).slice(0, Math.max(1, payload.maxCount || 64));
  const size = Math.min(960, Math.max(64, Math.round(payload.size || 220)));

  for (let i = 0; i < limited.length; i += 1) {
    const filePath = limited[i];
    const dataUrl = await toDataUrl(filePath, size, payload.cacheDir);
    if (dataUrl) result[filePath] = dataUrl;
    if (i % 8 === 7) {
      postMessage({ ok: true, progress: { phase: "thumb", scanned: i + 1, currentDir: "" } });
    }
  }
  return result;
}

main()
  .then((result) => postMessage({ ok: true, result }))
  .catch((error) => postMessage({ ok: false, error: (error as Error).message }));
