import { existsSync, statSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import type { AppSettings, ReviewSearchResult } from "../../src/lib/shared";
import { normalizeMatchText } from "../utils/text";
import { searchWithEverything } from "../utils/everythingSearch";
import { isPathInsideRoot } from "../utils/security";

interface ReviewFileIndex {
  path: string;
  name: string;
  relative: string;
  fileText: string;
  pathText: string;
  folderNorm: string;
  depth: number;
  mtimeMs: number;
}

interface ReviewFolderIndex {
  path: string;
  name: string;
  relative: string;
  nameText: string;
  pathText: string;
  depth: number;
  children: string[];
  childCount: number;
  coverPath?: string;
  mtimeMs: number;
}

interface ReviewIndexPayload {
  action: "query" | "rebuild" | "children";
  root: string;
  query?: string;
  folderPath?: string;
  offset?: number;
  limit?: number;
  settings?: AppSettings;
  userDataDir: string;
  esPath?: string;
  requestId?: string;
}

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const REVIEW_INDEX_DISK_TTL = 1000 * 60 * 60 * 24 * 365;
const requestId = typeof (workerData as ReviewIndexPayload).requestId === "string" ? (workerData as ReviewIndexPayload).requestId : undefined;

function postEnvelope(message: { ok: boolean; result?: ReviewSearchResult[] | { ok: boolean; total: number }; error?: string; progress?: { phase: string; scanned?: number; currentDir?: string; elapsedMs?: number } }): void {
  parentPort?.postMessage(requestId ? { ...message, requestId } : message);
}

function filterImagesInsideRoot(files: string[], root: string): string[] {
  return files.filter((filePath) => existsSync(filePath) && isPathInsideRoot(filePath, root) && imageExts.has(path.extname(filePath).toLowerCase()));
}

let reviewFileCache: {
  root: string;
  fileIndex: ReviewFileIndex[];
  folderIndex: ReviewFolderIndex[];
  indexedAt: number;
} | null = null;

function report(phase: string, scanned = 0, currentDir = "", elapsedMs?: number): void {
  postEnvelope({ ok: true, progress: { phase, scanned, currentDir, elapsedMs } });
}

function safeMtimeMs(filePath: string): number {
  try { return statSync(filePath).mtimeMs; } catch { return 0; }
}

function reviewIndexFilePath(userDataDir: string, root: string): string {
  const safe = Buffer.from(root).toString("base64").replace(/[/+=]/g, "_").slice(0, 64);
  return path.join(userDataDir, `review-index-v2-${safe}.json`);
}

function buildFileIndexEntry(root: string, filePath: string): ReviewFileIndex {
  const relative = path.relative(root, filePath);
  const fileName = path.basename(filePath);
  return {
    path: filePath,
    name: fileName,
    relative,
    fileText: normalizeMatchText(fileName),
    pathText: normalizeMatchText(relative),
    folderNorm: normalizeMatchText(path.dirname(relative)),
    depth: relative.split(/[\\/]/).length - 1,
    mtimeMs: safeMtimeMs(filePath)
  };
}

async function saveReviewIndexFile(userDataDir: string, root: string, fileIndex: ReviewFileIndex[], folderIndex: ReviewFolderIndex[], indexedAt: number): Promise<void> {
  const filePath = reviewIndexFilePath(userDataDir, root);
  const payload = { version: 3, root, savedAt: Date.now(), indexedAt, fileIndex, folderIndex };
  await fs.writeFile(filePath, JSON.stringify(payload), "utf-8");
}

async function loadReviewIndexFile(userDataDir: string, root: string): Promise<{ fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[]; indexedAt: number } | null> {
  try {
    const filePath = reviewIndexFilePath(userDataDir, root);
    if (!existsSync(filePath)) return null;
    const stats = await fs.stat(filePath);
    if (Date.now() - stats.mtimeMs > REVIEW_INDEX_DISK_TTL) return null;
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: number; root?: string; indexedAt?: number; savedAt?: number; fileIndex?: ReviewFileIndex[]; folderIndex?: ReviewFolderIndex[] };
    if (![2, 3].includes(parsed.version ?? 0) || parsed.root !== root) return null;
    return {
      fileIndex: parsed.fileIndex || [],
      folderIndex: parsed.folderIndex || [],
      indexedAt: parsed.indexedAt || parsed.savedAt || stats.mtimeMs
    };
  } catch {
    return null;
  }
}

async function walkMediaIncremental(
  root: string,
  maxItems: number,
  existingFileIndex: ReviewFileIndex[],
  indexedAt: number
): Promise<{ fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[]; added: number; removed: number }> {
  const existingByDir = new Map<string, ReviewFileIndex[]>();
  for (const entry of existingFileIndex) {
    const dir = path.dirname(entry.path);
    const bucket = existingByDir.get(dir);
    if (bucket) bucket.push(entry);
    else existingByDir.set(dir, [entry]);
  }

  const newFileIndex: ReviewFileIndex[] = [];
  const visitedFilePaths = new Set<string>();
  const visitedDirPaths = new Set<string>();
  let added = 0;
  let lastReport = Date.now();

  async function walk(dir: string): Promise<void> {
    if (newFileIndex.length >= maxItems) return;
    visitedDirPaths.add(dir);

    let dirMtimeMs = 0;
    try { dirMtimeMs = statSync(dir).mtimeMs; } catch { return; }

    const existingFiles = existingByDir.get(dir);
    const canReuse = existingFiles !== undefined && dirMtimeMs <= indexedAt;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (canReuse && existingFiles) {
      const existingSet = new Set(existingFiles.map((e) => e.path));
      for (const entry of existingFiles) {
        if (newFileIndex.length >= maxItems) break;
        newFileIndex.push(entry);
        visitedFilePaths.add(entry.path);
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(fullPath);
        else if (imageExts.has(path.extname(entry.name).toLowerCase()) && !existingSet.has(fullPath) && newFileIndex.length < maxItems) {
          newFileIndex.push(buildFileIndexEntry(root, fullPath));
          visitedFilePaths.add(fullPath);
          added++;
        }
      }
      return;
    }

    const existingMap = new Map<string, ReviewFileIndex>();
    if (existingFiles) {
      for (const item of existingFiles) existingMap.set(item.path, item);
    }

    for (const entry of entries) {
      if (newFileIndex.length >= maxItems) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (imageExts.has(path.extname(entry.name).toLowerCase())) {
        const prev = existingMap.get(fullPath);
        const currentMtime = safeMtimeMs(fullPath);
        if (prev && currentMtime === prev.mtimeMs) newFileIndex.push(prev);
        else {
          newFileIndex.push(buildFileIndexEntry(root, fullPath));
          added++;
        }
        visitedFilePaths.add(fullPath);
        if (newFileIndex.length % 200 === 0) {
          const now = Date.now();
          if (now - lastReport > 80) {
            report("walking", newFileIndex.length, dir);
            lastReport = now;
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
  }

  await walk(root);

  let removed = 0;
  for (const entry of existingFileIndex) {
    if (!visitedFilePaths.has(entry.path)) removed++;
  }

  const folderChildMap = new Map<string, { count: number; covers: string[] }>();
  for (const file of newFileIndex) {
    const parent = path.dirname(file.path);
    const bucket = folderChildMap.get(parent);
    if (bucket) {
      bucket.count += 1;
      if (bucket.covers.length < 1) bucket.covers.push(file.path);
    } else {
      folderChildMap.set(parent, { count: 1, covers: [file.path] });
    }
  }

  const folderIndex: ReviewFolderIndex[] = [];
  for (const dirPath of visitedDirPaths) {
    if (dirPath === root) continue;
    const relative = path.relative(root, dirPath);
    const children = folderChildMap.get(dirPath);
    folderIndex.push({
      path: dirPath,
      name: path.basename(dirPath),
      relative,
      nameText: normalizeMatchText(path.basename(dirPath)),
      pathText: normalizeMatchText(relative),
      depth: relative.split(/[\\/]/).length - 1,
      children: children?.covers ?? [],
      childCount: children?.count ?? 0,
      coverPath: children?.covers[0],
      mtimeMs: safeMtimeMs(dirPath)
    });
  }

  return { fileIndex: newFileIndex, folderIndex, added, removed };
}

async function ensureIndex(payload: ReviewIndexPayload): Promise<{ fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[]; indexedAt: number }> {
  const root = payload.root;
  const now = Date.now();
  if (reviewFileCache && reviewFileCache.root === root) return reviewFileCache;

  const disk = await loadReviewIndexFile(payload.userDataDir, root);
  const existing = disk?.fileIndex ?? [];
  if (existing.length > 0) report("loaded-cache", existing.length, "");
  else report("start", 0, root);

  const indexedAt = disk?.indexedAt ?? 0;
  const result = await walkMediaIncremental(root, 50000, existing, indexedAt);
  report("indexed", result.fileIndex.length, "");
  reviewFileCache = { root, fileIndex: result.fileIndex, folderIndex: result.folderIndex, indexedAt: now };
  void saveReviewIndexFile(payload.userDataDir, root, result.fileIndex, result.folderIndex, now);
  return reviewFileCache;
}

function queryIndex(root: string, query: string, fileIndex: ReviewFileIndex[], folderIndex: ReviewFolderIndex[]): ReviewSearchResult[] {
  const terms = query.trim().toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  const matchesImage = (item: ReviewFileIndex) => terms.length === 0 || terms.some((term) => item.fileText.includes(term) || item.folderNorm.includes(term) || item.pathText.includes(term));
  const matchesFolder = (item: ReviewFolderIndex) => (item.childCount ?? item.children.length) > 0 && (terms.length === 0 || terms.some((term) => item.nameText.includes(term) || item.pathText.includes(term)));

  const images: ReviewSearchResult[] = fileIndex
    .filter(matchesImage)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 120)
    .map((item) => ({ path: item.path, name: item.name, kind: "image", score: 0, reason: "图片命中", mtimeMs: item.mtimeMs }));

  const folders: ReviewSearchResult[] = folderIndex
    .filter(matchesFolder)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 40)
    .map((item) => ({
      path: item.path,
      name: item.name,
      kind: "folder",
      score: 0,
      reason: "文件夹命中",
      mtimeMs: item.mtimeMs,
      childCount: item.childCount ?? item.children.length,
      coverPath: item.coverPath ?? item.children[0],
      childrenLoaded: false
    }));

  return [...images, ...folders].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)).slice(0, 160);
}

async function loadFolderChildren(payload: ReviewIndexPayload): Promise<ReviewSearchResult[]> {
  if (!payload.root || !existsSync(payload.root)) throw new Error("请先选择收评助手根目录。");
  const folderPath = payload.folderPath || "";
  if (!folderPath || !existsSync(folderPath) || !isPathInsideRoot(folderPath, payload.root)) {
    throw new Error("文件夹不在已授权的收评根目录内。");
  }

  const offset = Math.max(0, payload.offset ?? 0);
  const limit = Math.max(1, Math.min(500, payload.limit ?? 200));
  const index = await ensureIndex(payload);
  return index.fileIndex
    .filter((item) => path.dirname(item.path) === folderPath)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(offset, offset + limit)
    .map((item) => ({
      path: item.path,
      name: item.name,
      kind: "image",
      score: 0,
      reason: "文件夹内图片",
      mtimeMs: item.mtimeMs
    }));
}

async function queryReviewAssets(payload: ReviewIndexPayload): Promise<ReviewSearchResult[]> {
  if (!payload.root || !existsSync(payload.root)) throw new Error("请先选择收评助手根目录。");
  const query = payload.query || "";
  const esPath = payload.esPath || "";

  if (esPath && query.trim()) {
    report("everything", 0, payload.root);
    const esResults = filterImagesInsideRoot(await searchWithEverything(esPath, payload.root, query.trim(), imageExts, 2000), payload.root);
    if (esResults.length > 0) {
      report("done", esResults.length, "");
      return esResults
        .map((fp) => ({ path: fp, name: path.basename(fp), kind: "image" as const, score: 0, reason: "", mtimeMs: safeMtimeMs(fp) }))
        .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
        .slice(0, 160);
    }
  }

  const index = await ensureIndex(payload);
  const results = queryIndex(payload.root, query, index.fileIndex, index.folderIndex);
  report("done", results.length, "");
  return results;
}

async function rebuildReviewIndex(payload: ReviewIndexPayload): Promise<{ ok: boolean; total: number }> {
  if (!payload.root || !existsSync(payload.root)) return { ok: false, total: 0 };
  const startedAt = Date.now();
  reviewFileCache = null;
  await fs.unlink(reviewIndexFilePath(payload.userDataDir, payload.root)).catch(() => undefined);
  const result = await walkMediaIncremental(payload.root, 50000, [], 0);
  const now = Date.now();
  reviewFileCache = { root: payload.root, fileIndex: result.fileIndex, folderIndex: result.folderIndex, indexedAt: now };
  await saveReviewIndexFile(payload.userDataDir, payload.root, result.fileIndex, result.folderIndex, now);
  report("done", result.fileIndex.length, "", Date.now() - startedAt);
  return { ok: true, total: result.fileIndex.length };
}

const payload = workerData as ReviewIndexPayload;
const task =
  payload.action === "rebuild" ? rebuildReviewIndex(payload) :
  payload.action === "children" ? loadFolderChildren(payload) :
  queryReviewAssets(payload);
task
  .then((result) => postEnvelope({ ok: true, result }))
  .catch((error) => postEnvelope({ ok: false, error: (error as Error).message }));
