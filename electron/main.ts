import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import ExcelJS from "exceljs";
import { autoUpdater } from "electron-updater";
import {
  AppSettings,
  ClipboardSnapshot,
  DEFAULT_FIXED_TAIL_ROW,
  DEFAULT_SETTINGS,
  DEFAULT_VIDEO_WORKBENCH_STATE,
  DEFAULT_WORKBENCH_STATE,
  ExportPayload,
  ExportResult,
  FfmpegStatus,
  LocalOcrStatus,
  ReviewGenerationOptions,
  ReviewGenerationResult,
  ReviewSearchResult,
  SelectFilesOptions,
  SelectPathResult,
  TitleAnalyzePayload,
  TitleCategoryData,
  TitleGeneratePayload,
  TitleKeywordData,
  TitleKeywordEntry,
  UpdateStatus,
  VideoCandidate,
  VideoRenderPayload,
  VideoRenderProgress,
  VideoRenderResult,
  VideoWorkbenchState,
  WorkbenchState,
  getActiveApiProfile,
  normalizeSettings
} from "../src/lib/shared";
import { analyzeTitleScore, containsThirdPartyBrand, generateTitleScore, sanitizeTitleKeyword } from "../src/lib/titleOptimizer";

let mainWindow: BrowserWindow | null = null;
let ocrStatus: LocalOcrStatus = { state: "not-installed", detail: "本地 OCR 尚未安装" };
let accelerationCache: VideoAcceleration | null = null;
let updateStatus: UpdateStatus = { state: "idle", detail: "尚未检查更新" };
let updaterListenersConfigured = false;
let titleKeywordCache: { filePath: string; mtimeMs: number; data: TitleKeywordData } | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const videoExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const audioExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);

interface VideoAcceleration {
  encoder: "h264_nvenc" | "h264_amf" | "h264_qsv" | "libx264";
  label: string;
  gpuNames: string[];
  dedicated: boolean;
}

function userDataPath(...segments: string[]) {
  return path.join(app.getPath("userData"), ...segments);
}

async function ensureUserDataDir() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
}

async function appendLog(level: "info" | "warn" | "error", message: string, meta?: unknown) {
  await ensureUserDataDir();
  const logDir = userDataPath("logs");
  await fs.mkdir(logDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, meta }) + "\n";
  await fs.appendFile(path.join(logDir, `${date}.log`), line, "utf-8");
}

async function loadSettings(): Promise<AppSettings> {
  await ensureUserDataDir();
  const filePath = userDataPath("settings.json");
  if (!existsSync(filePath)) return DEFAULT_SETTINGS;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const settings = normalizeSettings(JSON.parse(raw));
    await saveSettings(settings);
    return settings;
  } catch {
    await appendLog("error", "读取设置失败，已回退默认设置");
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  await ensureUserDataDir();
  const next = normalizeSettings(settings);
  await fs.writeFile(userDataPath("settings.json"), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

async function loadWorkbenchState(): Promise<WorkbenchState> {
  await ensureUserDataDir();
  const filePath = userDataPath("workbench-state.json");
  if (!existsSync(filePath)) return DEFAULT_WORKBENCH_STATE;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return { ...DEFAULT_WORKBENCH_STATE, ...JSON.parse(raw) };
  } catch {
    await appendLog("error", "读取支付宝工作台状态失败，已回退空状态");
    return DEFAULT_WORKBENCH_STATE;
  }
}

async function saveWorkbenchState(state: WorkbenchState): Promise<WorkbenchState> {
  await ensureUserDataDir();
  const next = { ...DEFAULT_WORKBENCH_STATE, ...state, savedAt: new Date().toISOString() };
  await fs.writeFile(userDataPath("workbench-state.json"), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

async function loadVideoWorkbenchState(): Promise<VideoWorkbenchState> {
  await ensureUserDataDir();
  const filePath = userDataPath("video-workbench-state.json");
  if (!existsSync(filePath)) return DEFAULT_VIDEO_WORKBENCH_STATE;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return { ...DEFAULT_VIDEO_WORKBENCH_STATE, ...JSON.parse(raw) };
  } catch {
    await appendLog("error", "读取视频工作台状态失败，已回退空状态");
    return DEFAULT_VIDEO_WORKBENCH_STATE;
  }
}

async function saveVideoWorkbenchState(state: VideoWorkbenchState): Promise<VideoWorkbenchState> {
  await ensureUserDataDir();
  const next = { ...DEFAULT_VIDEO_WORKBENCH_STATE, ...state, savedAt: new Date().toISOString() };
  await fs.writeFile(userDataPath("video-workbench-state.json"), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1160,
    minHeight: 760,
    autoHideMenuBar: true,
    frame: false,
    title: "电商运营工具箱",
    backgroundColor: "#080b0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.removeMenu();
  if (isDev) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else mainWindow.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
}

function getFfmpegCandidates(settings: AppSettings) {
  return [
    settings.ffmpegPath,
    path.join(process.resourcesPath, "bin", "ffmpeg.exe"),
    path.join(app.getAppPath(), "bin", "ffmpeg.exe"),
    path.join(__dirname, "../../bin/ffmpeg.exe")
  ].filter(Boolean);
}

function resolveFfmpegPath(settings: AppSettings) {
  return getFfmpegCandidates(settings).find((candidate) => existsSync(candidate));
}

async function getFfmpegStatus(settings: AppSettings): Promise<FfmpegStatus> {
  const ffmpegPath = resolveFfmpegPath(settings) ?? "";
  if (!ffmpegPath) return { available: false, path: "", detail: "未找到 FFmpeg，剪辑功能将在配置后可用。" };
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-version"], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.on("error", (error) => resolve({ available: false, path: ffmpegPath, detail: error.message }));
    child.on("exit", async (code) => {
      const acceleration = code === 0 ? await detectVideoAcceleration(ffmpegPath) : null;
      resolve({
        available: code === 0,
        path: ffmpegPath,
        detail: code === 0 ? output.split(/\r?\n/)[0] || "FFmpeg 可用" : "FFmpeg 无法执行",
        acceleration: acceleration?.label,
        gpuNames: acceleration?.gpuNames
      });
    });
  });
}

async function selectFiles(request: SelectFilesOptions): Promise<SelectPathResult> {
  const filters =
    request.kind === "image"
      ? [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }]
      : request.kind === "video"
        ? [{ name: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm"] }]
        : request.kind === "audio"
          ? [{ name: "音乐", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }]
          : [{ name: "FFmpeg", extensions: ["exe"] }];
  const title = request.kind === "image" ? "选择图片" : request.kind === "video" ? "选择视频" : request.kind === "audio" ? "选择音乐" : "选择 ffmpeg.exe";
  const dialogOptions = {
    title,
    properties: request.multi ? ["openFile", "multiSelections"] : ["openFile"],
    filters
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  return { canceled: result.canceled, paths: result.filePaths };
}

async function selectDirectory(title: string): Promise<SelectPathResult> {
  const dialogOptions = {
    title,
    properties: ["openDirectory", "createDirectory"]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  return { canceled: result.canceled, paths: result.filePaths };
}

async function selectTitleKeywordExcel(): Promise<SelectPathResult> {
  const dialogOptions = {
    title: "选择标题关键词 Excel",
    properties: ["openFile"],
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx", "xlsm"] }]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  return { canceled: result.canceled, paths: result.filePaths };
}

async function loadTitleKeywordData(settings: AppSettings): Promise<TitleKeywordData> {
  const normalized = normalizeSettings(settings);
  const filePath = normalized.titleKeywordExcelPath || DEFAULT_SETTINGS.titleKeywordExcelPath;
  if (!filePath || !existsSync(filePath)) throw new Error(`未找到标题关键词 Excel：${filePath || "未设置路径"}`);
  const stat = await fs.stat(filePath);
  if (titleKeywordCache && titleKeywordCache.filePath === filePath && titleKeywordCache.mtimeMs === stat.mtimeMs) {
    return titleKeywordCache.data;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const warnings: string[] = [];
  const categoryMap = new Map<string, TitleCategoryData>();

  for (const worksheet of workbook.worksheets) {
    if (/蓝海/.test(worksheet.name)) parseBlueOceanSheet(worksheet, categoryMap, warnings);
    else if (/关键词拆解|市场词|市场/.test(worksheet.name)) parseRankedKeywordSheet(worksheet, /拆解/.test(worksheet.name) ? "breakdown" : "market", categoryMap, warnings);
  }

  const categories = [...categoryMap.values()]
    .map((category) => {
      const keywords = dedupeTitleKeywordEntries(category.keywords).sort((a, b) => b.weight - a.weight);
      const blueOceanWords = dedupeTitleKeywordEntries(category.blueOceanWords).sort((a, b) => b.weight - a.weight);
      return {
        ...category,
        keywords,
        blueOceanWords,
        keywordCount: keywords.length + blueOceanWords.length,
        source: category.source === "blue-ocean" && keywords.length ? ("mixed" as const) : category.source
      };
    })
    .filter((category) => category.keywordCount > 0)
    .sort((a, b) => b.keywordCount - a.keywordCount);

  if (!categories.length) warnings.push("没有从 Excel 中解析到可用关键词，请检查表头结构。");
  const data: TitleKeywordData = {
    excelPath: filePath,
    loadedAt: new Date().toISOString(),
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    categories,
    totalKeywords: categories.reduce((sum, category) => sum + category.keywordCount, 0),
    warnings
  };
  titleKeywordCache = { filePath, mtimeMs: stat.mtimeMs, data };
  return data;
}

async function generateTitleCandidates(settings: AppSettings, payload: TitleGeneratePayload) {
  const data = await loadTitleKeywordData(settings);
  return generateTitleScore(data, payload.productName, payload.categoryName, payload.variantCount);
}

async function analyzeTitle(settings: AppSettings, payload: TitleAnalyzePayload) {
  const data = await loadTitleKeywordData(settings);
  return analyzeTitleScore(data, payload);
}

function parseRankedKeywordSheet(
  worksheet: ExcelJS.Worksheet,
  source: "market" | "breakdown",
  categoryMap: Map<string, TitleCategoryData>,
  warnings: string[]
) {
  const groups = findHeaderGroups(worksheet, 1);
  for (const group of groups) {
    const categoryName = normalizeCategoryName(group.name);
    if (!categoryName) continue;
    const headers = readHeaderRows(worksheet, group.start, group.end, [2, 3]);
    const keywordCol = findColumnByHeader(headers, ["关键词", "搜索词"]) ?? group.start;
    const rankCol = findRankColumn(headers, keywordCol, group.end) ?? Math.min(keywordCol + 1, group.end);
    let count = 0;
    for (let rowIndex = 4; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const keyword = cleanKeywordCell(cellText(worksheet, rowIndex, keywordCol));
      if (!keyword) continue;
      const rank = parseNumberCell(worksheet.getRow(rowIndex).getCell(rankCol).value);
      const trend = parseNumberCell(worksheet.getRow(rowIndex).getCell(Math.min(keywordCol + 1, group.end)).value);
      const weight = calcRankWeight(rank, rowIndex, source) + (trend > 0 ? Math.min(28, trend * 8) : 0);
      addTitleKeyword(categoryMap, {
        keyword,
        category: categoryName,
        source,
        rank: rank > 0 ? rank : undefined,
        weight,
        trend: trend || undefined
      });
      count += 1;
    }
    if (!count) warnings.push(`${worksheet.name} / ${categoryName} 未解析到关键词`);
  }
}

function parseBlueOceanSheet(worksheet: ExcelJS.Worksheet, categoryMap: Map<string, TitleCategoryData>, warnings: string[]) {
  const groups = findHeaderGroups(worksheet, 1);
  for (const group of groups) {
    const categoryName = normalizeCategoryName(group.name);
    if (!categoryName) continue;
    const headers = readHeaderRows(worksheet, group.start, group.end, [2]);
    const keywordCol = findColumnByHeader(headers, ["蓝海词"]) ?? group.start;
    const demandCol = findColumnByHeader(headers, ["需求供给比"]);
    const tmallCol = findColumnByHeader(headers, ["天猫商品点击占比"]);
    const popularityCol = findColumnByHeader(headers, ["搜索人气"]);
    let count = 0;
    for (let rowIndex = 3; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const keyword = cleanKeywordCell(cellText(worksheet, rowIndex, keywordCol));
      if (!keyword) continue;
      const demand = demandCol ? parseNumberCell(worksheet.getRow(rowIndex).getCell(demandCol).value) : 0;
      const tmall = tmallCol ? parseNumberCell(worksheet.getRow(rowIndex).getCell(tmallCol).value) : 0;
      const popularity = popularityCol ? parseRangeNumber(cellText(worksheet, rowIndex, popularityCol)) : 0;
      const blueOceanScore = calcBlueOceanWeight(demand, tmall, popularity, rowIndex);
      addTitleKeyword(categoryMap, {
        keyword,
        category: categoryName,
        source: "blue-ocean",
        weight: blueOceanScore,
        blueOceanScore,
        metrics: { demandSupplyRatio: demand, tmallClickShare: tmall, popularity }
      });
      count += 1;
    }
    if (!count) warnings.push(`${worksheet.name} / ${categoryName} 未解析到蓝海词`);
  }
}

function findHeaderGroups(worksheet: ExcelJS.Worksheet, rowIndex: number) {
  const groups: Array<{ name: string; start: number; end: number }> = [];
  let current: { name: string; start: number } | null = null;
  for (let col = 1; col <= worksheet.columnCount + 1; col += 1) {
    const name = col <= worksheet.columnCount ? cellText(worksheet, rowIndex, col).trim() : "";
    if (name) {
      if (current && name !== current.name) {
        groups.push({ ...current, end: col - 1 });
        current = { name, start: col };
      } else if (!current) current = { name, start: col };
    } else if (current) {
      groups.push({ ...current, end: col - 1 });
      current = null;
    }
  }
  return groups.filter((group) => group.end >= group.start && !/^合计|备注$/i.test(group.name));
}

function readHeaderRows(worksheet: ExcelJS.Worksheet, start: number, end: number, rows: number[]) {
  const map = new Map<number, string>();
  for (let col = start; col <= end; col += 1) {
    map.set(col, rows.map((row) => cellText(worksheet, row, col)).filter(Boolean).join(" "));
  }
  return map;
}

function findColumnByHeader(headers: Map<number, string>, keys: string[]) {
  for (const [col, header] of headers) if (keys.some((key) => header.includes(key))) return col;
  return undefined;
}

function findRankColumn(headers: Map<number, string>, keywordCol: number, groupEnd: number) {
  for (const [col, header] of headers) if (col > keywordCol && col <= groupEnd && /排名/.test(header)) return col;
  return undefined;
}

function addTitleKeyword(categoryMap: Map<string, TitleCategoryData>, entry: TitleKeywordEntry) {
  if (!entry.keyword || containsThirdPartyBrand(entry.keyword)) return;
  const initialSource: TitleCategoryData["source"] = entry.source === "blue-ocean" ? "blue-ocean" : entry.source === "breakdown" ? "breakdown" : "market";
  const category: TitleCategoryData = categoryMap.get(entry.category) ?? {
    name: entry.category,
    source: initialSource,
    keywords: [] as TitleKeywordEntry[],
    blueOceanWords: [] as TitleKeywordEntry[],
    keywordCount: 0
  };
  if (entry.source === "blue-ocean") category.blueOceanWords.push(entry);
  else category.keywords.push(entry);
  category.source = category.source === initialSource ? category.source : "mixed";
  category.keywordCount = category.keywords.length + category.blueOceanWords.length;
  categoryMap.set(entry.category, category);
}

function dedupeTitleKeywordEntries(entries: TitleKeywordEntry[]) {
  const map = new Map<string, TitleKeywordEntry>();
  for (const entry of entries) {
    const key = `${entry.category}:${entry.source}:${entry.keyword}`;
    const existing = map.get(key);
    if (!existing || entry.weight > existing.weight) map.set(key, entry);
  }
  return [...map.values()];
}

function normalizeCategoryName(value: string) {
  return value.replace(/^关键词拆解--/, "").replace(/\s+/g, "").trim();
}

function cleanKeywordCell(value: string) {
  const keyword = sanitizeTitleKeyword(value);
  if (!keyword || keyword.length < 2 || /^\d+$/.test(keyword) || containsThirdPartyBrand(keyword)) return "";
  return keyword;
}

function cellText(worksheet: ExcelJS.Worksheet, rowIndex: number, colIndex: number) {
  const value = worksheet.getRow(rowIndex).getCell(colIndex).value;
  if (value == null) return "";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result != null) return String(value.result);
    if ("formula" in value) return "";
  }
  return String(value).trim();
}

function parseNumberCell(value: ExcelJS.CellValue) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value && "result" in value && typeof value.result === "number") return value.result;
  return parseRangeNumber(String(value ?? ""));
}

function parseRangeNumber(value: string) {
  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)(万)?/);
  if (!match) return 0;
  return Number(match[1]) * (match[2] ? 10000 : 1);
}

function calcRankWeight(rank: number, rowIndex: number, source: "market" | "breakdown") {
  const fallbackRank = rank > 0 ? rank : Math.max(1, rowIndex - 3);
  const base = source === "breakdown" ? 118 : 100;
  return Math.max(18, Math.round(base - Math.log10(fallbackRank + 1) * 28));
}

function calcBlueOceanWeight(demand: number, tmall: number, popularity: number, rowIndex: number) {
  const demandScore = Math.min(70, Math.log10(Math.max(1, demand)) * 24);
  const competitionScore = tmall > 0 ? Math.max(0, 35 - tmall * 35) : 16;
  const popularityScore = Math.min(25, Math.log10(Math.max(1, popularity)) * 5);
  const rankScore = Math.max(0, 22 - rowIndex / 10);
  return Math.round(70 + demandScore + competitionScore + popularityScore + rankScore);
}

async function walkMedia(root: string, allowed: Set<string>, maxItems = 5000): Promise<string[]> {
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
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (allowed.has(path.extname(entry.name).toLowerCase())) results.push(fullPath);
      if (results.length >= maxItems) break;
    }
  }
  if (root && existsSync(root)) await walk(root);
  return results;
}

async function walkMediaAndFolders(root: string, allowed: Set<string>, maxItems = 10000): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  async function walk(dir: string) {
    if (files.length >= maxItems) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        folders.push(fullPath);
        await walk(fullPath);
      } else if (allowed.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
      if (files.length >= maxItems) break;
    }
  }
  if (root && existsSync(root)) await walk(root);
  return { files, folders };
}

async function scanVideoLibrary(settings: AppSettings, productName: string, colorName: string): Promise<VideoCandidate[]> {
  const root = settings.videoLibraryDir;
  if (!root || !existsSync(root)) throw new Error("请先在设置中选择视频库文件夹。");
  const files = await walkMedia(root, new Set([...videoExts, ...imageExts]), 8000);
  const terms = buildMatchTerms(`${productName} ${colorName}`);
  return files
    .map((filePath) => scoreMediaCandidate(root, filePath, terms))
    .filter((item): item is VideoCandidate => Boolean(item && item.score >= 35))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
}

function scoreMediaCandidate(root: string, filePath: string, terms: string[]): VideoCandidate {
  const relative = path.relative(root, filePath);
  const fileName = path.basename(filePath);
  const folderText = path.dirname(relative);
  const fileText = normalizeMatchText(fileName);
  const pathText = normalizeMatchText(relative);
  const folderNorm = normalizeMatchText(folderText);
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
    thumbnailDataUrl: imageExts.has(ext) ? imageToDataUrl(filePath, 280) : undefined
  };
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[\s_\-—–()（）[\]【】.·,，。]/g, "");
}

function buildMatchTerms(value: string) {
  const normalized = normalizeMatchText(value);
  const chunks = value
    .toLowerCase()
    .split(/[\s_\-—–()（）[\]【】.·,，。]+/)
    .map(normalizeMatchText)
    .filter(Boolean);
  const numbers = normalized.match(/[a-z]*\d+[a-z]*/g) ?? [];
  return [...new Set([normalized, ...chunks, ...numbers].filter((term) => term.length >= 2))];
}

function tokenOverlap(a: string, b: string) {
  if (!a || !b) return 0;
  let hits = 0;
  for (const char of new Set(a.split(""))) if (b.includes(char)) hits += 1;
  return hits / Math.max(1, new Set(a.split("")).size);
}

async function latestImageInDirectory(dir: string): Promise<string> {
  const files = await walkMedia(dir, imageExts, 2000);
  const withStats = await Promise.all(
    files.map(async (filePath) => ({ filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs }))
  );
  return withStats.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? "";
}

function imageToDataUrl(filePath: string, maxSide = 720) {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return undefined;
  const size = image.getSize();
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  const resized = scale < 1 ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }) : image;
  return resized.toDataURL();
}

async function renderVideoTask(payload: VideoRenderPayload): Promise<VideoRenderResult> {
  const settings = normalizeSettings(payload.settings);
  const ffmpegPath = resolveFfmpegPath(settings);
  if (!ffmpegPath) throw new Error("未找到 FFmpeg，请在设置中指定 ffmpeg.exe 或放入程序 bin 目录。");
  if (!settings.videoOutputDir) throw new Error("请先选择输出文件夹。");
  await fs.mkdir(settings.videoOutputDir, { recursive: true });
  const outputPath = await uniqueOutputPath(settings.videoOutputDir, payload.task.outputName || `${payload.task.productName}-${payload.task.colorName}`);
  const acceleration = await detectVideoAcceleration(ffmpegPath);
  const duration = await estimateTaskDuration(ffmpegPath, payload.task);
  emitVideoProgress(payload.task.id, 8, "准备素材");
  const result =
    payload.task.template === "video-slice"
      ? await renderWithFallback(ffmpegPath, acceleration, (active) => buildVideoSliceArgs(payload, outputPath, active), payload.task.id, duration)
      : await renderBosTemplate(ffmpegPath, payload, outputPath, acceleration, duration);
  emitVideoProgress(payload.task.id, result.success ? 100 : 0, result.success ? "完成" : "失败");
  await appendLog(result.success ? "info" : "error", "视频剪辑任务完成", { outputPath, success: result.success, error: result.error, acceleration: acceleration.label });
  return { ...result, outputPath };
}

async function uniqueOutputPath(dir: string, baseName: string) {
  const safeName = (baseName || `video-${randomUUID().slice(0, 8)}`).replace(/[\\/:*?"<>|]/g, "_");
  let candidate = path.join(dir, `${safeName}.mp4`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${safeName}-${index}.mp4`);
    index += 1;
  }
  return candidate;
}

async function renderBosTemplate(ffmpegPath: string, payload: VideoRenderPayload, outputPath: string, acceleration: VideoAcceleration, duration?: number): Promise<VideoRenderResult> {
  const image = payload.task.imagePath || payload.task.imagePaths[0];
  if (!image || !payload.task.videoPath) throw new Error("帛先生模板需要 1 张图片和 1 个视频。");
  const { width, height } = await probeImageSize(image);
  const args = [
    "-y",
    "-hide_banner",
    "-loop",
    "1",
    "-t",
    "0.04",
    "-i",
    image,
    "-i",
    payload.task.videoPath,
    "-filter_complex",
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p[intro];` +
      `[1:v]split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,boxblur=24:2[blur];` +
      `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fit];[blur][fit]overlay=(W-w)/2:(H-h)/2,format=yuv420p[main];` +
      `[intro][main]concat=n=2:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    "-map",
    "1:a?",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    ...encoderArgs(acceleration),
    "-c:a",
    "aac",
    "-shortest",
    outputPath
  ];
  return runFfmpeg(ffmpegPath, args, payload.task.id, "合成视频", duration);
}

async function buildVideoSliceArgs(payload: VideoRenderPayload, outputPath: string, acceleration: VideoAcceleration) {
  const images = payload.task.imagePaths.filter(Boolean).slice(0, 5);
  if (images.length < 5) throw new Error("视频切片模板需要 5 张图片。");
  const { width, height } = await probeImageSize(images[0]);
  const fps = 30;
  const segmentDuration = 1.2;
  const musicPath = payload.task.musicPath || resolveMusicPresetPath(payload.task.musicPresetId || payload.settings.sliceMusicPresetId);
  const args = ["-y", "-hide_banner"];
  images.forEach((image) => args.push("-loop", "1", "-t", String(segmentDuration), "-i", image));
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  const filters =
    images
      .map((_, index) => {
        const effect = index === 1 || index === 4 ? bounceFilter(width, height) : swingFilter(width, height, index);
        return `[${index}:v]${effect},fps=${fps},format=yuv420p[v${index}]`;
      })
      .join(";") + `;${images.map((_, index) => `[v${index}]`).join("")}concat=n=5:v=1:a=0[out]`;
  args.push("-filter_complex", filters, "-map", "[out]");
  if (musicPath) args.push("-map", `${images.length}:a:0`, "-c:a", "aac", "-shortest");
  args.push("-r", String(fps), "-pix_fmt", "yuv420p", ...encoderArgs(acceleration), outputPath);
  return args;
}

function resolveMusicPresetPath(id: string) {
  if (!id) return "";
  const candidate = path.join(process.resourcesPath, "assets", "music", `${id}.mp3`);
  if (existsSync(candidate)) return candidate;
  const devCandidate = path.join(app.getAppPath(), "assets", "music", `${id}.mp3`);
  return existsSync(devCandidate) ? devCandidate : "";
}

function swingFilter(width: number, height: number, index: number) {
  const direction = index === 2 ? "-1" : "1";
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white,rotate='${direction}*0.06*sin(2*PI*t/1.2)':ow=${width}:oh=${height}:c=white`;
}

function bounceFilter(width: number, height: number) {
  const padW = Math.round(width * 1.15 / 2) * 2;
  const padH = Math.round(height * 1.15 / 2) * 2;
  return `scale=${padW}:${padH}:force_original_aspect_ratio=decrease,pad=${padW}:${padH}:(ow-iw)/2:(oh-ih)/2:white,scale='iw*(1+0.10*exp(-4*t)*sin(18*t))':'ih*(1+0.10*exp(-4*t)*sin(18*t))',crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`;
}

async function probeImageSize(imagePath: string) {
  const image = nativeImage.createFromPath(imagePath);
  const size = image.getSize();
  if (!size.width || !size.height) return { width: 1080, height: 1440 };
  const maxSide = 1440;
  const ratio = Math.min(1, maxSide / Math.max(size.width, size.height));
  const width = Math.max(2, Math.round((size.width * ratio) / 2) * 2);
  const height = Math.max(2, Math.round((size.height * ratio) / 2) * 2);
  return { width, height };
}

async function renderWithFallback(
  ffmpegPath: string,
  acceleration: VideoAcceleration,
  build: (acceleration: VideoAcceleration) => Promise<string[] | VideoRenderResult>,
  taskId: string,
  duration?: number
): Promise<VideoRenderResult> {
  const primary = await build(acceleration);
  const primaryResult = Array.isArray(primary) ? await runFfmpeg(ffmpegPath, primary, taskId, "剪辑中", duration) : primary;
  if (primaryResult.success || acceleration.encoder === "libx264") return primaryResult;
  const cpu = cpuAcceleration();
  const fallback = await build(cpu);
  const fallbackResult = Array.isArray(fallback) ? await runFfmpeg(ffmpegPath, fallback, taskId, "CPU 重试", duration) : fallback;
  return {
    ...fallbackResult,
    log: `${primaryResult.log}\n硬件加速失败，已回退 CPU：${primaryResult.error ?? ""}\n${fallbackResult.log}`,
    error: fallbackResult.error
  };
}

async function detectVideoAcceleration(ffmpegPath: string): Promise<VideoAcceleration> {
  if (accelerationCache) return accelerationCache;
  const [gpuNames, encoders] = await Promise.all([detectGpuNames(), readFfmpegEncoders(ffmpegPath)]);
  const names = gpuNames.join(" ").toLowerCase();
  const hasEncoder = (encoder: string) => encoders.includes(encoder);
  if (/(nvidia|geforce|rtx|gtx|quadro)/i.test(names) && hasEncoder("h264_nvenc")) accelerationCache = { encoder: "h264_nvenc", label: "独显加速：NVIDIA NVENC", gpuNames, dedicated: true };
  else if (/(amd|radeon|rx\s?\d)/i.test(names) && hasEncoder("h264_amf")) accelerationCache = { encoder: "h264_amf", label: "独显加速：AMD AMF", gpuNames, dedicated: true };
  else if (/(intel.*arc|arc.*intel)/i.test(names) && hasEncoder("h264_qsv")) accelerationCache = { encoder: "h264_qsv", label: "独显加速：Intel Quick Sync", gpuNames, dedicated: true };
  else accelerationCache = cpuAcceleration(gpuNames);
  return accelerationCache;
}

function cpuAcceleration(gpuNames: string[] = []): VideoAcceleration {
  return { encoder: "libx264", label: `CPU 多线程：${Math.max(1, os.cpus().length)} 线程`, gpuNames, dedicated: false };
}

function encoderArgs(acceleration: VideoAcceleration) {
  if (acceleration.encoder === "h264_nvenc") return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "21"];
  if (acceleration.encoder === "h264_amf") return ["-c:v", "h264_amf", "-quality", "speed", "-qp_i", "21", "-qp_p", "23"];
  if (acceleration.encoder === "h264_qsv") return ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23"];
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", String(Math.max(1, os.cpus().length))];
}

async function readFfmpegEncoders(ffmpegPath: string) {
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]);
  return result.output.toLowerCase();
}

async function detectGpuNames() {
  const result = await runProcess("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"]);
  return result.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function runProcess(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, { windowsHide: true });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", (error) => resolve({ code: -1, output: error.message }));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

function emitVideoProgress(taskId: string, percent: number, stage: string, currentTime?: number) {
  const payload: VideoRenderProgress = { taskId, percent: Math.max(0, Math.min(100, Math.round(percent))), stage, currentTime };
  mainWindow?.webContents.send("video:renderProgress", payload);
}

function runFfmpeg(ffmpegPath: string, args: string[], taskId?: string, stage = "剪辑中", duration?: number): Promise<VideoRenderResult> {
  return new Promise((resolve) => {
    let log = "";
    let lastPercent = 15;
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    child.stdout.on("data", (chunk) => (log += String(chunk)));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      log += text;
      const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match && taskId) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const percentByDuration = duration && duration > 0 ? Math.round(12 + (seconds / duration) * 84) : Math.round(20 + seconds * 10);
        lastPercent = Math.min(96, Math.max(lastPercent + 1, percentByDuration));
        emitVideoProgress(taskId, lastPercent, stage, seconds);
      }
    });
    child.on("error", (error) => resolve({ success: false, log, error: error.message }));
    child.on("exit", (code) => resolve({ success: code === 0, log, error: code === 0 ? undefined : parseFfmpegError(log, code) }));
  });
}

function parseFfmpegError(log: string, code: number | null): string {
  const lower = log.toLowerCase();
  if (/no such file|does not exist/i.test(log)) return "输入文件不存在，请检查素材路径是否正确。";
  if (/invalid data found|invalid argument/i.test(log)) return "素材文件格式损坏或不支持，请更换文件后重试。";
  if (/codec not found|encoder.*not found|unknown encoder/i.test(log)) return "缺少必要的编码器，请使用诊断修复检查 FFmpeg 安装。";
  if (/crop/i.test(lower) && /invalid|error/i.test(lower)) return "图片尺寸问题导致裁剪失败，请更换图片后重试。";
  if (/permission denied/i.test(log)) return "输出目录没有写入权限，请检查输出文件夹权限。";
  if (/out of memory|cannot allocate/i.test(lower)) return "内存不足，请关闭其他程序后重试。";
  if (/device or resource busy/i.test(lower)) return "输出文件被占用，请关闭使用该文件的程序。";
  return `FFmpeg 退出码 ${code}，请使用诊断修复功能排查。`;
}

async function estimateTaskDuration(ffmpegPath: string, task: VideoRenderPayload["task"]) {
  if (task.template === "video-slice") return 6;
  if (!task.videoPath) return undefined;
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-i", task.videoPath]);
  const match = result.output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

interface FfmpegDiagnosisItem { label: string; passed: boolean; detail: string }
interface FfmpegDiagnosisResult { items: FfmpegDiagnosisItem[]; suggestions: string[]; ok: boolean }

async function diagnoseFfmpeg(settings: AppSettings): Promise<FfmpegDiagnosisResult> {
  const items: FfmpegDiagnosisItem[] = [];
  const suggestions: string[] = [];
  const ffmpegPath = resolveFfmpegPath(settings) ?? "";

  items.push({
    label: "FFmpeg 路径",
    passed: Boolean(ffmpegPath && existsSync(ffmpegPath)),
    detail: ffmpegPath ? `找到：${ffmpegPath}` : "未找到 FFmpeg 可执行文件"
  });
  if (!ffmpegPath) {
    suggestions.push("在设置中指定 FFmpeg 路径，或将 ffmpeg.exe 放入程序 bin 目录。");
    suggestions.push("可从 https://www.gyan.dev/ffmpeg/builds/ 下载 FFmpeg（选择 release essentials 版本）。");
    return { items, suggestions, ok: false };
  }

  const version = await runProcess(ffmpegPath, ["-version"]);
  const versionLine = version.output.split(/\r?\n/)[0] || "";
  items.push({ label: "FFmpeg 可执行", passed: version.code === 0, detail: version.code === 0 ? versionLine : `执行失败：${version.output.slice(0, 200)}` });
  if (version.code !== 0) {
    suggestions.push("FFmpeg 无法执行，请检查文件是否损坏或被安全软件拦截。");
    return { items, suggestions, ok: false };
  }

  const encoders = await readFfmpegEncoders(ffmpegPath);
  const requiredEncoders = [
    { name: "libx264", label: "H.264 CPU 编码器 (libx264)" },
    { name: "aac", label: "AAC 音频编码器" }
  ];
  for (const enc of requiredEncoders) {
    const has = encoders.includes(enc.name);
    items.push({ label: enc.label, passed: has, detail: has ? "可用" : "缺失" });
    if (!has) suggestions.push(`缺少 ${enc.label}，请下载完整版 FFmpeg。`);
  }

  const acceleration = await detectVideoAcceleration(ffmpegPath);
  items.push({ label: "硬件加速", passed: acceleration.dedicated, detail: acceleration.label });
  if (!acceleration.dedicated) suggestions.push("未检测到独显硬件加速，将使用 CPU 编码（速度较慢但功能正常）。");

  const testResult = await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.1:r=30",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "编码测试", passed: testResult.success, detail: testResult.success ? "编码功能正常" : `测试失败：${testResult.error}` });
  if (!testResult.success) suggestions.push("FFmpeg 编码测试失败，可能文件损坏，建议重新下载。");

  if (!suggestions.length) suggestions.push("FFmpeg 运行正常，所有检查项通过。");
  return { items, suggestions, ok: items.every((item) => item.passed) };
}

function imageSignature(image: Electron.NativeImage) {
  if (image.isEmpty()) return "";
  const size = image.getSize();
  return `${size.width}x${size.height}:${image.toPNG().byteLength}`;
}

async function exportWorkbook(payload: ExportPayload): Promise<ExportResult> {
  const dialogOptions = {
    title: "导出支付宝返款表",
    defaultPath: path.join(app.getPath("desktop"), payload.defaultFileName),
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
  } satisfies Electron.SaveDialogOptions;
  const saveResult = mainWindow ? await dialog.showSaveDialog(mainWindow, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

  const workbook = new ExcelJS.Workbook();
  const templateCandidates = [path.join(app.getAppPath(), "assets", "alipay-template.xlsx"), path.join(process.resourcesPath, "assets", "alipay-template.xlsx")];
  const templatePath = templateCandidates.find((candidate) => existsSync(candidate));
  if (!templatePath) throw new Error("未找到支付宝 Excel 模板文件。");
  await workbook.xlsx.readFile(templatePath);
  const worksheet = workbook.worksheets[0];
  const startRow = 3;
  const rows = [
    ...payload.rows.map((row) => ({ account: row.account, name: row.name, amount: row.amount, remark: row.remark })),
    payload.tailRow ?? DEFAULT_FIXED_TAIL_ROW
  ];

  for (let index = 0; index < rows.length; index += 1) {
    const targetRow = worksheet.getRow(startRow + index);
    const sourceRow = worksheet.getRow(index < 22 ? startRow + index : 25);
    [1, 2, 3, 4, 5].forEach((col) => (targetRow.getCell(col).style = { ...sourceRow.getCell(col).style }));
    targetRow.getCell(1).value = index + 1;
    targetRow.getCell(2).value = rows[index].account;
    targetRow.getCell(3).value = rows[index].name;
    targetRow.getCell(4).value = rows[index].amount === "" ? null : Number(rows[index].amount);
    targetRow.getCell(5).value = rows[index].remark || null;
    targetRow.commit();
  }

  for (let rowIndex = startRow + rows.length; rowIndex <= 200; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    [1, 2, 3, 4, 5].forEach((col) => (row.getCell(col).value = null));
    row.commit();
  }

  await workbook.xlsx.writeFile(saveResult.filePath);
  return { canceled: false, filePath: saveResult.filePath };
}

let reviewFileCache: { root: string; files: string[]; folders: string[]; cachedAt: number } | null = null;
const REVIEW_CACHE_TTL = 60_000;

async function scanReviewAssets(root: string, query: string): Promise<ReviewSearchResult[]> {
  if (!root || !existsSync(root)) throw new Error("请先选择收评助手根目录。");

  const now = Date.now();
  if (!reviewFileCache || reviewFileCache.root !== root || now - reviewFileCache.cachedAt > REVIEW_CACHE_TTL) {
    const { files, folders } = await walkMediaAndFolders(root, imageExts, 10000);
    reviewFileCache = { root, files, folders, cachedAt: now };
  }
  const { files, folders } = reviewFileCache;
  const terms = buildMatchTerms(query);

  const scoredImages = files.map((filePath) => {
    const relative = path.relative(root, filePath);
    const candidate = scorePathOnly(relative, filePath, terms);
    return { path: filePath, name: path.basename(filePath), kind: "image" as const, score: candidate.score, reason: candidate.reason };
  });
  const topImages = scoredImages
    .filter((item) => item.score >= 28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  const scoredFolders = folders.map((folderPath) => {
    const folderScore = scorePathCandidate(root, folderPath, terms);
    const childPaths = files.filter((fp) => fp.startsWith(folderPath + path.sep)).slice(0, 12);
    return {
      path: folderPath,
      name: path.basename(folderPath),
      kind: "folder" as const,
      score: folderScore.score,
      reason: folderScore.reason,
      children: childPaths.map((fp) => ({ path: fp, name: path.basename(fp), kind: "image" as const, score: 0, reason: "文件夹内图片" }))
    };
  });
  const topFolders = scoredFolders
    .filter((item) => item.score >= 38 && item.children.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  const merged: ReviewSearchResult[] = [...topImages, ...topFolders]
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);

  const thumbPaths = new Set<string>();
  for (const item of merged.slice(0, 60)) {
    if (item.kind === "image") thumbPaths.add(item.path);
    else if (item.children) item.children.slice(0, 4).forEach((c) => thumbPaths.add(c.path));
  }
  const thumbMap = batchThumbnails([...thumbPaths], 180);
  for (const item of merged) {
    if (item.kind === "image") item.thumbnailDataUrl = thumbMap.get(item.path);
    else if (item.children) {
      for (const child of item.children) child.thumbnailDataUrl = thumbMap.get(child.path);
      item.thumbnailDataUrl = item.children[0]?.thumbnailDataUrl;
    }
  }
  return merged;
}

function scorePathOnly(relative: string, filePath: string, terms: string[]) {
  const fileName = path.basename(filePath);
  const fileText = normalizeMatchText(fileName);
  const pathText = normalizeMatchText(relative);
  const folderNorm = normalizeMatchText(path.dirname(relative));
  let score = 0;
  const reasons: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (fileText.includes(term)) { score += /\d/.test(term) ? 28 : 24; reasons.push(`文件名命中 ${term}`); }
    else if (folderNorm.includes(term)) { score += /\d/.test(term) ? 24 : 20; reasons.push(`文件夹命中 ${term}`); }
    else if (pathText.includes(term)) { score += 12; reasons.push(`路径命中 ${term}`); }
    else { const overlap = tokenOverlap(term, pathText); if (overlap > 0.45) score += Math.round(overlap * 16); }
  }
  const depth = relative.split(/[\\/]/).length - 1;
  score += Math.max(0, 10 - depth);
  score += 4;
  return { score, reason: reasons.slice(0, 3).join("；") || "路径文字相似" };
}

function batchThumbnails(paths: string[], maxSide: number): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const p of paths) map.set(p, imageToDataUrl(p, maxSide));
  return map;
}

async function loadReviewThumbnails(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const p of paths.slice(0, 40)) {
    const url = imageToDataUrl(p, 280);
    if (url) result[p] = url;
  }
  return result;
}

function scorePathCandidate(root: string, targetPath: string, terms: string[]) {
  const relative = path.relative(root, targetPath);
  const nameText = normalizeMatchText(path.basename(targetPath));
  const pathText = normalizeMatchText(relative);
  let score = 0;
  const reasons: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (nameText.includes(term)) {
      score += /\d/.test(term) ? 32 : 26;
      reasons.push(`文件夹命中 ${term}`);
    } else if (pathText.includes(term)) {
      score += /\d/.test(term) ? 22 : 18;
      reasons.push(`路径命中 ${term}`);
    } else {
      const overlap = tokenOverlap(term, pathText);
      if (overlap > 0.45) score += Math.round(overlap * 14);
    }
  }
  const depth = relative.split(/[\\/]/).length - 1;
  score += Math.max(0, 12 - depth);
  return { score, reason: reasons.slice(0, 3).join("；") || "文件夹名称相似" };
}

async function generateReviewCopy(settings: AppSettings, options: ReviewGenerationOptions): Promise<ReviewGenerationResult> {
  const profile = getActiveApiProfile(normalizeSettings(settings));
  if (!profile.apiBaseUrl || !profile.apiKey) throw new Error("请先在设置中填写 API Base URL 和 API Key。");
  const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt = [
    "你是电商收评助手，请生成 6 条中文买家好评文案。",
    "要求：不要编号；每条 25-70 字；自然、不重复；只返回 JSON：{\"copies\":[\"...\"]}。",
    `商品/搜索词：${options.query}`,
    `商品补充描述：${options.productDescription || "无"}`,
    `Emoji 程度 0-5：${options.emojiLevel}`,
    `专业程度 0-5：${options.professionalLevel}`,
    `买家视角 0-5：${options.buyerLevel}`,
    `语气夸张 0-5：${options.exaggerationLevel}`,
    `场景化表达 0-5：${options.sceneLevel}`,
    `是否提到性价比：${options.mentionValue ? "是" : "否"}`,
    `参考图片数量：${options.selectedPaths.length}`,
    `换一批随机种子：${options.batchSeed}`
  ].join("\n");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` },
    body: JSON.stringify({
      model: profile.textModel || settings.textModel,
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你擅长写真实、多样、不机械的中文电商好评。" },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) throw new Error(`AI 生成失败：${response.status} ${await response.text()}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content || "{}");
  return { copies: Array.isArray(parsed.copies) ? parsed.copies.map(String).slice(0, 8) : [] };
}

async function installLocalOcr(): Promise<LocalOcrStatus> {
  if (ocrStatus.state === "installing") return ocrStatus;
  ocrStatus = { state: "installing", detail: "正在准备本地 OCR 环境" };
  const installDir = userDataPath("local-ocr");
  await fs.mkdir(installDir, { recursive: true });
  await fs.writeFile(path.join(installDir, "README.txt"), "本目录用于后续接入真实本地 OCR 服务。\n", "utf-8");
  ocrStatus = { state: "ready", detail: "本地 OCR 安装入口已就绪，真实识别引擎待接入。" };
  return ocrStatus;
}

function configureAutoUpdater(settings: AppSettings) {
  autoUpdater.autoDownload = false;
  if (settings.updateFeedUrl.trim()) {
    autoUpdater.setFeedURL({ provider: "generic", url: settings.updateFeedUrl.trim() });
  }
  if (updaterListenersConfigured) return;
  updaterListenersConfigured = true;
  autoUpdater.on("checking-for-update", () => {
    updateStatus = { state: "checking", detail: "正在检查更新" };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("update-available", (info) => {
    const notes = String((info as { releaseNotes?: unknown }).releaseNotes ?? "");
    updateStatus = { state: "available", version: info.version, mandatory: /force|mandatory|强制/i.test(notes), detail: `发现新版本 ${info.version}` };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("update-not-available", () => {
    updateStatus = { state: "not-available", detail: "当前已是最新版本" };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("download-progress", (progress) => {
    updateStatus = { ...updateStatus, state: "downloading", percent: progress.percent, detail: `正在下载更新 ${Math.round(progress.percent)}%` };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateStatus = { ...updateStatus, state: "downloaded", version: info.version, detail: "更新已下载，重启后安装" };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("error", (error) => {
    updateStatus = { state: "error", detail: error.message };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
}

async function checkForUpdates(settings: AppSettings): Promise<UpdateStatus> {
  if (isDev) return { state: "idle", detail: "开发模式不检查更新" };
  if (!settings.updateFeedUrl.trim()) return { state: "idle", detail: "未配置更新源" };
  configureAutoUpdater(settings);
  await autoUpdater.checkForUpdates();
  return updateStatus;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("settings:load", loadSettings);
  ipcMain.handle("settings:save", (_event, settings: AppSettings) => saveSettings(settings));
  ipcMain.handle("workbench:load", loadWorkbenchState);
  ipcMain.handle("workbench:save", (_event, state: WorkbenchState) => saveWorkbenchState(state));
  ipcMain.handle("videoWorkbench:load", loadVideoWorkbenchState);
  ipcMain.handle("videoWorkbench:save", (_event, state: VideoWorkbenchState) => saveVideoWorkbenchState(state));
  ipcMain.handle("log:append", (_event, level: "info" | "warn" | "error", message: string, meta?: unknown) => appendLog(level, message, meta));
  ipcMain.handle("files:select", (_event, options: SelectFilesOptions) => selectFiles(options));
  ipcMain.handle("directory:select", (_event, title: string) => selectDirectory(title));
  ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("window:toggleMaximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("title:selectExcel", () => selectTitleKeywordExcel());
  ipcMain.handle("title:loadKeywordData", (_event, settings: AppSettings) => loadTitleKeywordData(settings));
  ipcMain.handle("title:analyze", (_event, settings: AppSettings, payload: TitleAnalyzePayload) => analyzeTitle(settings, payload));
  ipcMain.handle("title:generateCandidates", (_event, settings: AppSettings, payload: TitleGeneratePayload) => generateTitleCandidates(settings, payload));
  ipcMain.handle("ffmpeg:status", (_event, settings: AppSettings) => getFfmpegStatus(settings));
  ipcMain.handle("ffmpeg:diagnose", (_event, settings: AppSettings) => diagnoseFfmpeg(settings));
  ipcMain.handle("video:scanLibrary", (_event, settings: AppSettings, productName: string, colorName: string) => scanVideoLibrary(settings, productName, colorName));
  ipcMain.handle("video:renderTask", (_event, payload: VideoRenderPayload) => renderVideoTask(payload));
  ipcMain.handle("media:latestImage", (_event, dir: string) => latestImageInDirectory(dir));
  ipcMain.handle("media:imagePreview", (_event, filePath: string) => imageToDataUrl(filePath, 960) ?? "");
  ipcMain.handle("review:scanAssets", (_event, root: string, query: string) => scanReviewAssets(root, query));
  ipcMain.handle("review:loadThumbnails", (_event, paths: string[]) => loadReviewThumbnails(paths));
  ipcMain.handle("review:generateCopy", (_event, settings: AppSettings, options: ReviewGenerationOptions) => generateReviewCopy(settings, options));
  ipcMain.handle("update:check", (_event, settings: AppSettings) => checkForUpdates(settings));
  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall(false, true));
  ipcMain.handle("clipboard:read", (): ClipboardSnapshot => {
    const text = clipboard.readText().trim();
    if (text) return { kind: "text", text, signature: `text:${text}` };
    const image = clipboard.readImage();
    if (!image.isEmpty()) return { kind: "image", imageDataUrl: image.toDataURL(), signature: `image:${imageSignature(image)}` };
    return { kind: "empty", signature: "empty" };
  });
  ipcMain.handle("clipboard:writeText", (_event, text: string) => clipboard.writeText(text));
  ipcMain.handle("export:workbook", (_event, payload: ExportPayload) => exportWorkbook(payload));
  ipcMain.handle("ocr:status", () => ocrStatus);
  ipcMain.handle("ocr:install", () => installLocalOcr());
  ipcMain.handle("ocr:localRecognize", async (_event, imageDataUrl: string) => {
    const image = nativeImage.createFromDataURL(imageDataUrl);
    if (image.isEmpty()) throw new Error("图片为空，无法进行本地 OCR。");
    throw new Error("本地 OCR 服务尚未绑定真实识别引擎，请先使用云端 OCR。");
  });

  createWindow();
  const settings = await loadSettings();
  configureAutoUpdater(settings);
  setTimeout(() => void checkForUpdates(settings).catch((error) => appendLog("warn", "后台检查更新失败", { message: error.message })), 2500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
