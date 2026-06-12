import { app, dialog, nativeImage, type IpcMain, type BrowserWindow } from "electron";
import { existsSync, statSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppSettings, ReviewSearchResult, ReviewGenerationOptions, ReviewGenerationResult, ReviewChatPayload, ReviewChatResult } from "../../src/lib/shared";
import { getReviewApiProfile, normalizeSettings } from "../../src/lib/shared";
import { isPathInsideRoot, validateApiUrl, validatePathSafety } from "../utils/security";
import { assertAuthorizedRoot, isAuthorizedChildPath } from "../utils/capabilities";
import { normalizeMatchText } from "../utils/text";
import { truncatedErrorText } from "../utils/http";
import { resolveEverythingEsPath } from "../utils/everything";
import { imageToDataUrl, imageToDataUrlAsync } from "../utils/media";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";
import { runWorkerTask } from "../utils/worker";
import { loadSettings } from "../utils/settings";

// ============================================================================
// 类型定义
// ============================================================================

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
  mtimeMs: number;
}

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const REVIEW_INDEX_DISK_TTL = 1000 * 60 * 60 * 24 * 365;

// ============================================================================
// 全局变量
// ============================================================================

let mainWindow: BrowserWindow | null = null;
let reviewFileCache: {
  root: string;
  fileIndex: ReviewFileIndex[];
  folderIndex: ReviewFolderIndex[];
  cachedAt: number;
  indexedAt: number;
} | null = null;
const authorizedReviewRoots = new Set<string>();
let activeReviewScanController: AbortController | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

// ============================================================================
// 工具函数
// ============================================================================

function safeMtimeMs(filePath: string): number {
  try { return statSync(filePath).mtimeMs; } catch { return 0; }
}

// ============================================================================
// 文件索引
// ============================================================================

function buildFileIndexEntry(root: string, filePath: string): ReviewFileIndex {
  const relative = path.relative(root, filePath);
  const fileName = path.basename(filePath);
  let mtimeMs = 0;
  try { mtimeMs = statSync(filePath).mtimeMs; } catch {}
  return {
    path: filePath,
    name: fileName,
    relative,
    fileText: normalizeMatchText(fileName),
    pathText: normalizeMatchText(relative),
    folderNorm: normalizeMatchText(path.dirname(relative)),
    depth: relative.split(/[\\/]/).length - 1,
    mtimeMs
  };
}

function buildFolderIndexEntry(root: string, folderPath: string, childMap: Map<string, string[]>): ReviewFolderIndex {
  const relative = path.relative(root, folderPath);
  let mtimeMs = 0;
  try { mtimeMs = statSync(folderPath).mtimeMs; } catch {}
  return {
    path: folderPath,
    name: path.basename(folderPath),
    relative,
    nameText: normalizeMatchText(path.basename(folderPath)),
    pathText: normalizeMatchText(relative),
    depth: relative.split(/[\\/]/).length - 1,
    children: childMap.get(folderPath) ?? [],
    mtimeMs
  };
}

function buildReviewIndex(root: string, files: string[], folders: string[]): { fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[] } {
  const folderChildMap = new Map<string, string[]>();
  const fileIndex: ReviewFileIndex[] = files.map((filePath) => {
    const parent = path.dirname(filePath);
    const bucket = folderChildMap.get(parent);
    if (bucket) { if (bucket.length < 12) bucket.push(filePath); }
    else folderChildMap.set(parent, [filePath]);
    return buildFileIndexEntry(root, filePath);
  });
  const folderIndex: ReviewFolderIndex[] = folders.map((folderPath) => buildFolderIndexEntry(root, folderPath, folderChildMap));
  return { fileIndex, folderIndex };
}

function reviewIndexFilePath(root: string): string {
  const safe = Buffer.from(root).toString("base64").replace(/[/+=]/g, "_").slice(0, 64);
  return path.join(app.getPath("userData"), `review-index-${safe}.json`);
}

async function deleteReviewIndexFile(root: string): Promise<void> {
  try {
    const filePath = reviewIndexFilePath(root);
    if (existsSync(filePath)) await fs.unlink(filePath);
  } catch {}
}

async function saveReviewIndexFile(root: string, fileIndex: ReviewFileIndex[], folderIndex: ReviewFolderIndex[], indexedAt: number): Promise<void> {
  try {
    const filePath = reviewIndexFilePath(root);
    const payload = { root, savedAt: Date.now(), indexedAt, fileIndex, folderIndex };
    await fs.writeFile(filePath, JSON.stringify(payload), "utf-8");
  } catch (error) {
    appendLog("warn", "保存收评索引失败", { message: (error as Error).message }, userDataPath);
  }
}

async function loadReviewIndexFile(root: string): Promise<{ fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[]; indexedAt: number } | null> {
  try {
    const filePath = reviewIndexFilePath(root);
    if (!existsSync(filePath)) return null;
    const stats = await fs.stat(filePath);
    if (Date.now() - stats.mtimeMs > REVIEW_INDEX_DISK_TTL) return null;
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { root: string; indexedAt?: number; savedAt?: number; fileIndex?: ReviewFileIndex[]; folderIndex?: ReviewFolderIndex[] };
    if (parsed.root !== root) return null;
    return {
      fileIndex: parsed.fileIndex || [],
      folderIndex: parsed.folderIndex || [],
      indexedAt: parsed.indexedAt || parsed.savedAt || stats.mtimeMs
    };
  } catch {
    return null;
  }
}

// ============================================================================
// 文件遍历
// ============================================================================

async function walkMediaAndFoldersWithProgress(
  root: string,
  allowed: Set<string>,
  maxItems: number,
  onProgress?: (scanned: number, currentDir: string) => void
): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  let lastReport = Date.now();
  async function walk(dir: string) {
    if (files.length >= maxItems) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        folders.push(fullPath);
        await walk(fullPath);
      } else if (allowed.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
        if (files.length % 200 === 0) {
          const now = Date.now();
          if (onProgress && now - lastReport > 80) {
            onProgress(files.length, dir);
            lastReport = now;
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      if (files.length >= maxItems) break;
    }
  }
  if (root && existsSync(root)) await walk(root);
  if (onProgress) onProgress(files.length, "");
  return { files, folders };
}

async function walkMediaIncremental(
  root: string,
  allowed: Set<string>,
  maxItems: number,
  existingFileIndex: ReviewFileIndex[],
  indexedAt: number,
  onProgress?: (scanned: number, currentDir: string, phase: string) => void
): Promise<{ fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[]; added: number; reused: number; removed: number }> {
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
  let reused = 0;
  let added = 0;
  let lastReport = Date.now();

  async function walk(dir: string) {
    if (newFileIndex.length >= maxItems) return;
    visitedDirPaths.add(dir);

    let dirMtimeMs = 0;
    try { dirMtimeMs = statSync(dir).mtimeMs; } catch { return; }

    const existingFiles = existingByDir.get(dir);
    const canReuse = existingFiles !== undefined && dirMtimeMs <= indexedAt;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    if (canReuse && existingFiles) {
      const existingSet = new Set(existingFiles.map((e) => e.path));
      for (const entry of existingFiles) {
        if (newFileIndex.length >= maxItems) break;
        newFileIndex.push(entry);
        visitedFilePaths.add(entry.path);
      }
      reused += existingFiles.length;

      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name));
        } else if (allowed.has(path.extname(entry.name).toLowerCase())) {
          const fullPath = path.join(dir, entry.name);
          if (!existingSet.has(fullPath) && newFileIndex.length < maxItems) {
            newFileIndex.push(buildFileIndexEntry(root, fullPath));
            visitedFilePaths.add(fullPath);
            added++;
          }
        }
      }
    } else {
      const existingMap = new Map<string, ReviewFileIndex>();
      if (existingFiles) {
        for (const e of existingFiles) existingMap.set(e.path, e);
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (allowed.has(path.extname(entry.name).toLowerCase())) {
          if (newFileIndex.length >= maxItems) break;

          const prev = existingMap.get(fullPath);
          if (prev) {
            let currentMtime = 0;
            try { currentMtime = statSync(fullPath).mtimeMs; } catch {}
            if (currentMtime === prev.mtimeMs) {
              newFileIndex.push(prev);
              reused++;
            } else {
              newFileIndex.push(buildFileIndexEntry(root, fullPath));
              added++;
            }
          } else {
            newFileIndex.push(buildFileIndexEntry(root, fullPath));
            added++;
          }
          visitedFilePaths.add(fullPath);

          if (newFileIndex.length % 200 === 0) {
            const now = Date.now();
            if (onProgress && now - lastReport > 80) {
              onProgress(newFileIndex.length, dir, "walking");
              lastReport = now;
            }
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
      }
    }
  }

  if (root && existsSync(root)) await walk(root);

  let removed = 0;
  for (const entry of existingFileIndex) {
    if (!visitedFilePaths.has(entry.path)) removed++;
  }

  const folderChildMap = new Map<string, string[]>();
  for (const file of newFileIndex) {
    const parent = path.dirname(file.path);
    const bucket = folderChildMap.get(parent);
    if (bucket) { if (bucket.length < 12) bucket.push(file.path); }
    else folderChildMap.set(parent, [file.path]);
  }

  const newFolderIndex: ReviewFolderIndex[] = [];
  for (const dirPath of visitedDirPaths) {
    if (dirPath === root) continue;
    const relative = path.relative(root, dirPath);
    let mtimeMs = 0;
    try { mtimeMs = statSync(dirPath).mtimeMs; } catch {}
    newFolderIndex.push({
      path: dirPath,
      name: path.basename(dirPath),
      relative,
      nameText: normalizeMatchText(path.basename(dirPath)),
      pathText: normalizeMatchText(relative),
      depth: relative.split(/[\\/]/).length - 1,
      children: folderChildMap.get(dirPath) ?? [],
      mtimeMs
    });
  }

  if (onProgress) onProgress(newFileIndex.length, "", "indexed");

  return { fileIndex: newFileIndex, folderIndex: newFolderIndex, added, reused, removed };
}

// ============================================================================
// 主要功能
// ============================================================================

async function scanReviewAssets(root: string, query: string, settings?: AppSettings, event?: Electron.IpcMainInvokeEvent, requestId?: string): Promise<ReviewSearchResult[]> {
  if (!root || !existsSync(root)) throw new Error("请先选择收评助手根目录。");
  validatePathSafety(root);
  const savedSettings = normalizeSettings(settings ?? await loadSettings());
  if (path.resolve(root) !== path.resolve(savedSettings.reviewRootDir)) throw new Error("Review root does not match saved settings.");
  assertAuthorizedRoot("reviewRoot", root);
  authorizedReviewRoots.add(path.resolve(root));
  const esPath = resolveEverythingEsPath(savedSettings);
  activeReviewScanController?.abort();
  const controller = new AbortController();
  activeReviewScanController = controller;
  return runWorkerTask<{ action: "query"; root: string; query: string; settings?: AppSettings; userDataDir: string; esPath?: string }, ReviewSearchResult[]>(
    "reviewIndexWorker",
    { action: "query", root, query, settings: savedSettings, userDataDir: app.getPath("userData"), esPath },
    (progress) => event?.sender.send("review:scanProgress", progress),
    { requestId, timeoutMs: 180_000, signal: controller.signal }
  ).finally(() => {
    if (activeReviewScanController === controller) activeReviewScanController = null;
  });
}

function allowedReviewPath(p: string, root?: string): boolean {
  if (!p || !existsSync(p)) return false;
  if (root) return isAuthorizedChildPath("reviewRoot", p, root, imageExts);
  if (!root && ![...authorizedReviewRoots].some((allowedRoot) => isPathInsideRoot(p, allowedRoot))) return false;
  return imageExts.has(path.extname(p).toLowerCase());
}

async function loadReviewThumbnails(paths: string[], root?: string): Promise<Record<string, string>> {
  return loadReviewThumbnailBatch(paths, 280, root, 40);
}

async function loadReviewThumbnailBatch(paths: string[], size = 220, root?: string, maxCount = 64): Promise<Record<string, string>> {
  const valid = (paths || []).filter((p) => allowedReviewPath(p, root)).slice(0, maxCount);
  return runWorkerTask<{ paths: string[]; size: number; maxCount: number; cacheDir?: string }, Record<string, string>>(
    "thumbnailWorker",
    { paths: valid, size, maxCount, cacheDir: path.join(app.getPath("userData"), "thumb-cache") },
    undefined,
    { timeoutMs: 45_000 }
  );
}

async function loadReviewFolderChildren(root: string, folderPath: string, offset = 0, limit = 200): Promise<ReviewSearchResult[]> {
  if (!root || !existsSync(root)) throw new Error("请先选择收评助手根目录。");
  if (!folderPath || !existsSync(folderPath) || !statSync(folderPath).isDirectory()) throw new Error("文件夹不存在。");
  validatePathSafety(root);
  validatePathSafety(folderPath, [root]);
  const settings = normalizeSettings(await loadSettings());
  if (path.resolve(root) !== path.resolve(settings.reviewRootDir)) throw new Error("Review root does not match saved settings.");
  assertAuthorizedRoot("reviewRoot", root);
  if (!isPathInsideRoot(folderPath, root)) throw new Error("文件夹不在已授权的收评根目录内。");
  authorizedReviewRoots.add(path.resolve(root));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
  return runWorkerTask<{ action: "children"; root: string; folderPath: string; offset: number; limit: number; userDataDir: string }, ReviewSearchResult[]>(
    "reviewIndexWorker",
    { action: "children", root, folderPath, offset: safeOffset, limit: safeLimit, userDataDir: app.getPath("userData") },
    undefined,
    { timeoutMs: 60_000 }
  );
}

async function rebuildReviewIndex(root: string, event: Electron.IpcMainInvokeEvent): Promise<{ ok: boolean; total: number }> {
  if (!root || !existsSync(root)) return { ok: false, total: 0 };
  validatePathSafety(root);
  const settings = await loadSettings();
  if (path.resolve(root) !== path.resolve(settings.reviewRootDir)) return { ok: false, total: 0 };
  assertAuthorizedRoot("reviewRoot", root);
  authorizedReviewRoots.add(path.resolve(root));
  return runWorkerTask<{ action: "rebuild"; root: string; userDataDir: string }, { ok: boolean; total: number }>(
    "reviewIndexWorker",
    { action: "rebuild", root, userDataDir: app.getPath("userData") },
    (progress) => event.sender.send("review:scanProgress", progress),
    { timeoutMs: 300_000 }
  );
}

function parseImageDataUrl(value: string): { base64: string; mediaType: string } | null {
  const match = value.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mediaType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
    base64: match[2]
  };
}

async function loadImageBase64Entries(paths: string[], maxCount = 4, maxSide = 800, root?: string): Promise<Array<{ base64: string; mediaType: string }>> {
  const entries: Array<{ base64: string; mediaType: string }> = [];
  for (const p of paths.slice(0, maxCount)) {
    const dataUrlEntry = parseImageDataUrl(p);
    if (dataUrlEntry) {
      entries.push(dataUrlEntry);
      continue;
    }
    if (!allowedReviewPath(p, root)) continue;
    const dataUrl = await imageToDataUrlAsync(p, maxSide);
    if (!dataUrl) continue;
    const entry = parseImageDataUrl(dataUrl);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function generateReviewCopy(settings: AppSettings, options: ReviewGenerationOptions): Promise<ReviewGenerationResult> {
  const normalizedSettings = normalizeSettings(await loadSettings());
  const profile = getReviewApiProfile(normalizedSettings);
  if (!profile.apiBaseUrl || !profile.apiKey) throw new Error("请先在设置中填写 API Base URL 和 API Key。");
  validateApiUrl(profile.apiBaseUrl);
  const isAnthropic = profile.apiType === "anthropic";
  const targetLength = Math.min(100, Math.max(30, Math.round(Number(options.targetLength) || normalizedSettings.reviewTargetLength)));
  const thinkingMode = options.thinkingMode || normalizedSettings.reviewThinkingMode;
  const copyCount = Math.min(12, Math.max(3, Math.round(options.copyCount) || normalizedSettings.reviewCopyCount));

  const imageEntries = await loadImageBase64Entries(options.selectedPaths || [], 4, 800, normalizedSettings.reviewRootDir);
  const hasImages = imageEntries.length > 0;
  const modelId = hasImages ? (profile.visionModel || profile.textModel || normalizedSettings.textModel) : (profile.textModel || normalizedSettings.textModel);

  const allAngles = [
    "面料与体感（触感、透气性、柔软度、亲肤感）",
    "版型与身材修饰（是否显瘦、显高、合身度、宽松感）",
    "设计细节与风格（颜色搭配、图案、小设计、质感）",
    "场景体验（上班通勤、约会、户外活动、居家的实际感受）",
    "整体价值与搭配性（性价比、百搭程度、复购意愿）",
    "洗护与耐用性（洗后是否变形、褪色、起球等持久表现）"
  ];
  const openerStyles = [
    "直接描述收到的第一感受",
    "从一个具体穿着场景开始",
    "先说一个出乎意料的优点",
    "用对比手法（比预期好/跟之前买的不同）",
    "从朋友/同事的反馈切入",
    "先说整体印象再聚焦细节"
  ];

  const seed = options.batchSeed;
  const shuffled = [...allAngles].sort((_, __) => Math.sin(seed * 7 + allAngles.indexOf(_)) - 0.5);
  const pickedAngles = shuffled.slice(0, Math.min(Math.max(copyCount - 2, 2), 6));
  const opener = openerStyles[(seed - 1) % openerStyles.length];

  const systemPrompt = [
    "你是电商文案专家，擅长从商品特征中提炼卖点，用极简生动的语言写出真实买家好评。",
    hasImages ? "用户提供了商品参考图片，请仔细观察图片中的商品外观（颜色、款式、面料质感、设计细节等），结合图片特征生成更贴切的好评。" : "",
    "核心原则：",
    "- 每条评价必须从买家真实使用角度出发，像是真人写的而非AI",
    "- 自然融入一个具体穿着或使用场景（通勤、约会、周末、运动等）",
    "- 6条评价之间必须在句式结构、开场白、侧重点和收尾方式上明显不同",
    "- 杜绝千篇一律的模板感，禁止出现相似的开头或句式",
    `- 每条评价尽量接近 ${targetLength} 个中文字，允许自然浮动 20%，不要硬凑字数`,
    `- 思考深度：${thinkingMode === "on" ? "深度思考" : thinkingMode === "auto" ? "自动" : "关闭"}。先在内部规划角度差异，再只输出最终文案。`
  ].filter(Boolean).join("\n");

  const promptText = [
    `请生成 ${copyCount} 条中文买家好评文案。严格遵守以下要求：`,
    "",
    `商品/搜索词：${options.query}`,
    `商品补充描述：${options.productDescription || "无"}`,
    hasImages ? `参考图片数量：${imageEntries.length} 张（请结合图片中商品的实际外观特征）` : "",
    "",
    "【风格参数】",
    `专业程度（0口语化~5专业）：${options.professionalLevel}`,
    `买家视角真实感（0一般~5很强）：${options.buyerLevel}`,
    `语气夸张程度（0朴素~5夸张）：${options.exaggerationLevel}`,
    `场景化表达（0弱~5强）：${options.sceneLevel}`,
    `提到性价比：${options.mentionValue ? "是" : "否"}`,
    `目标字数：每条约 ${targetLength} 字`,
    `思考模式：${thinkingMode === "on" ? "开启" : thinkingMode === "auto" ? "自动" : "关闭"}`,
    "",
    "【本批次多样性要求】",
    `本次 ${copyCount} 条文案请分别从以下角度切入（每条选一个不同角度）：`,
    ...pickedAngles.map((a, i) => `  ${i + 1}. ${a}`),
    ...(copyCount > pickedAngles.length ? [`  ${pickedAngles.length + 1}-${copyCount}. 自由发挥，但不能与上面角度重复`] : []),
    `本次开场风格偏好：${opener}`,
    "",
    "【格式】不要编号，只返回 JSON：{\"copies\":[\"...\"]}"
  ].filter(Boolean).join("\n");

  const customPrompt = normalizedSettings.reviewCustomPrompt?.trim();
  const finalSystemPrompt = customPrompt ? `${systemPrompt}\n\n用户自定义要求：\n${customPrompt}` : systemPrompt;

  if (isAnthropic) {
    const baseUrl = profile.apiBaseUrl.replace(/\/$/, "");
    const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;

    const userContent: unknown[] = [];
    for (const img of imageEntries) {
      userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    userContent.push({ type: "text", text: promptText });

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 4096,
      temperature: 0.88,
      system: finalSystemPrompt,
      messages: [{ role: "user", content: userContent }]
    };
    if (thinkingMode === "on") body.thinking = { type: "enabled", budget_tokens: 4096 };
    else if (thinkingMode === "auto") body.thinking = { type: "enabled", budget_tokens: 2048 };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Anthropic AI 生成失败：${response.status} ${await truncatedErrorText(response)}`);
    const data = await response.json();
    const textBlock = (data?.content as Array<{ type: string; text?: string }>)?.find((b: { type: string }) => b.type === "text");
    const parsed = JSON.parse(textBlock?.text || "{}");
    return { copies: Array.isArray(parsed.copies) ? parsed.copies.map(String).slice(0, copyCount) : [] };
  } else {
    const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;

    const userContent: unknown[] = [];
    for (const img of imageEntries) {
      userContent.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
    }
    userContent.push({ type: "text", text: promptText });

    const requestBody: Record<string, unknown> = {
      model: modelId,
      temperature: 0.88,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: hasImages ? userContent : promptText }
      ]
    };
    if (thinkingMode === "on") requestBody.reasoning_effort = "high";
    else if (thinkingMode === "auto") requestBody.reasoning_effort = "medium";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) throw new Error(`AI 生成失败：${response.status} ${await truncatedErrorText(response)}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content || "{}");
    return { copies: Array.isArray(parsed.copies) ? parsed.copies.map(String).slice(0, copyCount) : [] };
  }
}

async function chatReviewCopy(settings: AppSettings, payload: ReviewChatPayload): Promise<ReviewChatResult> {
  const normalizedSettings = normalizeSettings(await loadSettings());
  const profile = getReviewApiProfile(normalizedSettings);
  if (!profile.apiBaseUrl || !profile.apiKey) throw new Error("请先在设置中填写 API Base URL 和 API Key。");
  validateApiUrl(profile.apiBaseUrl);
  const isAnthropic = profile.apiType === "anthropic";
  const targetLength = Math.min(100, Math.max(30, Math.round(Number(payload.targetLength) || normalizedSettings.reviewTargetLength)));
  const thinkingMode = payload.thinkingMode || normalizedSettings.reviewThinkingMode;
  const productDescription = payload.productDescription?.trim();
  const styleHints = [
    `专业程度：${payload.professionalLevel ?? normalizedSettings.reviewProfessionalLevel}`,
    `买家真实感：${payload.buyerLevel ?? normalizedSettings.reviewBuyerLevel}`,
    `夸张程度：${payload.exaggerationLevel ?? normalizedSettings.reviewExaggerationLevel}`,
    `场景化表达：${payload.sceneLevel ?? normalizedSettings.reviewSceneLevel}`,
    `提到性价比：${payload.mentionValue ?? normalizedSettings.reviewMentionValue ? "是" : "否"}`
  ].join("；");

  const chatImageCache = new Map<string, Array<{ base64: string; mediaType: string }>>();
  const loadChatImages = async (images?: string[]) => {
    const list = images || [];
    const key = JSON.stringify(list);
    const cached = chatImageCache.get(key);
    if (cached) return cached;
    const entries = await loadImageBase64Entries(list, 8, 960, normalizedSettings.reviewRootDir);
    chatImageCache.set(key, entries);
    return entries;
  };

  const imageEntries = await loadChatImages(payload.images);
  const historyImageEntries = await Promise.all((payload.messages || []).map((msg) => loadChatImages(msg.images)));
  const hasImages = imageEntries.length > 0 || historyImageEntries.some((entries) => entries.length > 0);
  const modelId = hasImages ? (profile.visionModel || profile.textModel || normalizedSettings.textModel) : (profile.textModel || normalizedSettings.textModel);

  const systemPrompt = [
    "你是电商文案专家，擅长写真实买家好评。你正在和用户进行对话，帮ta写出更满意的评价文案。",
    "核心原则：",
    "- 用自然的口语化表达，像是真人买家写的",
    "- 结合用户提供的商品信息和图片进行创作",
    `- 每条评价目标字数约 ${targetLength} 个中文字`,
    hasImages ? "- 用户可能提供了商品参考图片，仔细观察图片中的外观特征" : "",
    "- 回应用户的具体要求（如改短、加表情、调整风格等）",
    "- 如果用户没有明确要求，可以给出写好评价的建议",
    payload.query ? `当前商品/搜索词：${payload.query}` : "",
    productDescription ? `商品描述补充：${productDescription}` : "",
    `当前风格参数：${styleHints}`
  ].filter(Boolean).join("\n");

  const customPrompt = payload.customPrompt?.trim() || normalizedSettings.reviewCustomPrompt?.trim();
  const finalSystemPrompt = customPrompt ? `${systemPrompt}\n\n用户自定义要求：\n${customPrompt}` : systemPrompt;

  const historyMessages = (payload.messages || []).map((msg, index) => {
    if (msg.role === "assistant") return { role: "assistant", content: msg.content };
    if (msg.images && msg.images.length > 0) {
      const imgEntries = historyImageEntries[index] ?? [];
      if (isAnthropic) {
        const content: unknown[] = imgEntries.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }));
        content.push({ type: "text", text: msg.content });
        return { role: "user", content };
      } else {
        const content: unknown[] = imgEntries.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } }));
        content.push({ type: "text", text: msg.content });
        return { role: "user", content };
      }
    }
    return { role: "user", content: msg.content };
  });

  if (isAnthropic) {
    const baseUrl = profile.apiBaseUrl.replace(/\/$/, "");
    const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 2048,
      temperature: 0.88,
      system: finalSystemPrompt,
      messages: historyMessages
    };
    if (thinkingMode === "on") body.thinking = { type: "enabled", budget_tokens: 4096 };
    else if (thinkingMode === "auto") body.thinking = { type: "enabled", budget_tokens: 2048 };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Anthropic AI 对话失败：${response.status} ${await truncatedErrorText(response)}`);
    const data = await response.json();
    const textBlock = (data?.content as Array<{ type: string; text?: string }>)?.find((b: { type: string }) => b.type === "text");
    return { reply: textBlock?.text || "" };
  } else {
    const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;

    const apiMessages = [{ role: "system", content: finalSystemPrompt }, ...historyMessages];

    const requestBody: Record<string, unknown> = {
      model: modelId,
      temperature: 0.88,
      messages: apiMessages
    };
    if (thinkingMode === "on") requestBody.reasoning_effort = "high";
    else if (thinkingMode === "auto") requestBody.reasoning_effort = "medium";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) throw new Error(`AI 对话失败：${response.status} ${await truncatedErrorText(response)}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return { reply: content || "" };
  }
}

function startDragFiles(event: Electron.IpcMainInvokeEvent, paths: string[]): void {
  const validPaths = (paths || []).filter((p) => allowedReviewPath(p));
  if (validPaths.length === 0) return;
  let icon = nativeImage.createFromPath(validPaths[0]);
  if (icon.isEmpty()) {
    const fallbackPath = path.join(process.resourcesPath || app.getAppPath(), "build", "icon.png");
    if (existsSync(fallbackPath)) icon = nativeImage.createFromPath(fallbackPath);
  }
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 64, height: 64, quality: "good" });
  } else {
    icon = nativeImage.createEmpty();
  }
  try {
    event.sender.startDrag({ file: validPaths[0], files: validPaths, icon: icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(0)) : icon });
  } catch (error) {
    appendLog("warn", "startDrag 失败", { message: (error as Error).message, count: validPaths.length }, userDataPath);
  }
}

/**
 * 注册收评助手相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("review:scanAssets", async (event, root: string, query: string, _settings: AppSettings, requestId?: string) =>
    scanReviewAssets(root, query, await loadSettings(), event, requestId)
  );
  ipcMain.handle("review:loadThumbnails", (_event, paths: string[]) => loadReviewThumbnails(paths));
  ipcMain.handle("review:loadThumbnailBatch", (_event, paths: string[], size?: number, root?: string) => loadReviewThumbnailBatch(paths, size, root));
  ipcMain.handle("review:loadFolderChildren", (_event, root: string, folderPath: string, offset?: number, limit?: number) =>
    loadReviewFolderChildren(root, folderPath, offset, limit)
  );
  ipcMain.handle("review:rebuildIndex", (event, root: string) => rebuildReviewIndex(root, event));
  ipcMain.handle("review:generateCopy", (_event, settings: AppSettings, options: ReviewGenerationOptions) =>
    generateReviewCopy(settings, options)
  );
  ipcMain.handle("review:chat", (_event, settings: AppSettings, payload: ReviewChatPayload) =>
    chatReviewCopy(settings, payload)
  );
  ipcMain.handle("drag:startFiles", (event, paths: string[]) => startDragFiles(event, paths));
}
