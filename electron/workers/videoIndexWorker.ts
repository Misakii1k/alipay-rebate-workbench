import { existsSync, statSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import type { AppSettings, VideoCandidate } from "../../src/lib/shared";
import { normalizeMatchText } from "../utils/text";
import { searchWithEverything } from "../utils/everythingSearch";
import { isPathInsideRoot } from "../utils/security";
import { walkMedia } from "../utils/walk";

interface VideoIndexPayload {
  settings: AppSettings;
  productName: string;
  colorName: string;
  userDataDir: string;
  esPath?: string;
  requestId?: string;
}

interface VideoIndexEntry {
  path: string;
  mtimeMs: number;
}

interface VideoIndexCache {
  entries: VideoIndexEntry[];
  rootMtimeMs: number;
}

const videoExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const allExts = new Set([...videoExts, ...imageExts]);
const requestId = typeof (workerData as VideoIndexPayload).requestId === "string" ? (workerData as VideoIndexPayload).requestId : undefined;

function postEnvelope(message: { ok: boolean; result?: VideoCandidate[]; error?: string; progress?: { phase: string; scanned?: number; currentDir?: string } }): void {
  parentPort?.postMessage(requestId ? { ...message, requestId } : message);
}

function filterMediaInsideRoot(files: string[], root: string): string[] {
  return files.filter((filePath) => existsSync(filePath) && isPathInsideRoot(filePath, root) && allExts.has(path.extname(filePath).toLowerCase()));
}

function report(phase: string, scanned = 0, currentDir = ""): void {
  postEnvelope({ ok: true, progress: { phase, scanned, currentDir } });
}

function safeMtimeMs(filePath: string): number {
  try { return statSync(filePath).mtimeMs; } catch { return 0; }
}

function videoIndexFilePath(userDataDir: string, root: string): string {
  const safe = Buffer.from(root).toString("base64").replace(/[/+=]/g, "_").slice(0, 64);
  return path.join(userDataDir, `video-index-v1-${safe}.json`);
}

async function loadVideoIndex(userDataDir: string, root: string): Promise<VideoIndexCache | null> {
  try {
    const raw = await fs.readFile(videoIndexFilePath(userDataDir, root), "utf-8");
    const parsed = JSON.parse(raw) as { version?: number; root?: string; rootMtimeMs?: number; entries?: VideoIndexEntry[] };
    if (parsed.version !== 2 || parsed.root !== root || typeof parsed.rootMtimeMs !== "number" || !Array.isArray(parsed.entries)) return null;
    return { entries: parsed.entries, rootMtimeMs: parsed.rootMtimeMs };
  } catch {
    return null;
  }
}

async function saveVideoIndex(userDataDir: string, root: string, entries: VideoIndexEntry[], rootMtimeMs: number): Promise<void> {
  const payload = { version: 2, root, rootMtimeMs, savedAt: Date.now(), entries };
  await fs.writeFile(videoIndexFilePath(userDataDir, root), JSON.stringify(payload), "utf-8");
}

async function listMediaFiles(payload: VideoIndexPayload): Promise<string[]> {
  const root = payload.settings.videoLibraryDir;
  const esPath = payload.esPath || "";
  const query = `${payload.productName} ${payload.colorName}`.trim();
  if (esPath && query) {
    report("everything", 0, root);
    const results = filterMediaInsideRoot(await searchWithEverything(esPath, root, query, allExts, 2000), root);
    if (results.length > 0) return results;
  }

  const existing = await loadVideoIndex(payload.userDataDir, root);
  const rootMtimeMs = safeMtimeMs(root);
  if (existing && existing.rootMtimeMs === rootMtimeMs && existing.entries.length > 0) {
    const cached = existing.entries.filter((item) => existsSync(item.path));
    if (cached.length > 0) {
      report("loaded-cache", cached.length, "");
      return cached.map((item) => item.path);
    }
  }
  report("walking", 0, root);
  const files = await walkMedia(root, allExts, 8000);
  if (files.length === 0 && existing && existing.entries.length > 0) {
    return existing.entries.filter((item) => existsSync(item.path)).map((item) => item.path);
  }
  const entries = files.map((filePath) => ({ path: filePath, mtimeMs: safeMtimeMs(filePath) }));
  await saveVideoIndex(payload.userDataDir, root, entries, rootMtimeMs).catch(() => undefined);
  return entries.map((item) => item.path);
}

function buildMatchTerms(value: string): string[] {
  const normalized = normalizeMatchText(value);
  const chunks = value
    .toLowerCase()
    .split(/[\s_\-—–()（）[\]【】.·,，。]+/)
    .map(normalizeMatchText)
    .filter(Boolean);
  const numbers = normalized.match(/[a-z]*\d+[a-z]*/g) ?? [];
  return [...new Set([normalized, ...chunks, ...numbers].filter((term) => term.length >= 2))];
}

function tokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  let hits = 0;
  for (const char of new Set(a.split(""))) if (b.includes(char)) hits += 1;
  return hits / Math.max(1, new Set(a.split("")).size);
}

function scoreMediaCandidate(root: string, filePath: string, terms: string[]): VideoCandidate {
  const relative = path.relative(root, filePath);
  const fileName = path.basename(filePath);
  const fileText = normalizeMatchText(fileName);
  const pathText = normalizeMatchText(relative);
  const folderNorm = normalizeMatchText(path.dirname(relative));
  let score = 0;
  const reasons: string[] = [];

  for (const term of terms) {
    if (!term) continue;
    if (fileText.includes(term)) {
      score += /\d/.test(term) ? 28 : 24;
      reasons.push(`文件名命中 ${term}`);
    } else if (folderNorm.includes(term)) {
      score += /\d/.test(term) ? 24 : 20;
      reasons.push(`文件夹命中 ${term}`);
    } else if (pathText.includes(term)) {
      score += 12;
      reasons.push(`路径命中 ${term}`);
    } else {
      const overlap = tokenOverlap(term, pathText);
      if (overlap > 0.45) score += Math.round(overlap * 16);
    }
  }

  const depth = relative.split(/[\\/]/).length - 1;
  score += Math.max(0, 10 - depth);
  const ext = path.extname(filePath).toLowerCase();
  if (videoExts.has(ext)) score += 8;
  if (imageExts.has(ext)) score += 4;

  return {
    path: filePath,
    fileName,
    score,
    reason: reasons.slice(0, 3).join("；") || "路径文字相似",
    kind: videoExts.has(ext) ? "video" : "image",
    matchedPath: relative,
    thumbnailDataUrl: undefined
  };
}

async function main(): Promise<VideoCandidate[]> {
  const payload = workerData as VideoIndexPayload;
  const root = payload.settings.videoLibraryDir;
  if (!root || !existsSync(root)) throw new Error("请先在设置中选择视频库文件夹。");
  const files = await listMediaFiles(payload);
  const terms = buildMatchTerms(`${payload.productName} ${payload.colorName}`);
  const candidates = files
    .map((filePath) => scoreMediaCandidate(root, filePath, terms))
    .filter((item): item is VideoCandidate => Boolean(item && item.score >= 35))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
  report("done", candidates.length, "");
  return candidates;
}

main()
  .then((result) => postEnvelope({ ok: true, result }))
  .catch((error) => postEnvelope({ ok: false, error: (error as Error).message }));
