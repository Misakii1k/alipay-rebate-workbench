import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
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
  getReviewApiProfile,
  normalizeSettings
} from "../src/lib/shared";
import { analyzeTitleScore, containsThirdPartyBrand, generateTitleScore, previewTokenPool, sanitizeTitleKeyword } from "../src/lib/titleOptimizer";

let mainWindow: BrowserWindow | null = null;
let cpuThreads = Math.max(1, os.cpus().length);
let updateStatus: UpdateStatus = { state: "idle", detail: "尚未检查更新" };
let updaterListenersConfigured = false;
let titleKeywordCache: { filePath: string; mtimeMs: number; data: TitleKeywordData } | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const videoExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const audioExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);

interface VideoAcceleration {
  encoder: "libx264";
  label: string;
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
      resolve({
        available: code === 0,
        path: ffmpegPath,
        detail: code === 0 ? output.split(/\r?\n/)[0] || "FFmpeg 可用" : "FFmpeg 无法执行",
        acceleration: code === 0 ? `CPU 多线程：${cpuThreads} 线程` : undefined
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
  const extra = await collectTitleExtraKeywords(settings, data, payload.productName, payload.categoryName);
  return generateTitleScore(data, payload.productName, payload.categoryName, payload.variantCount, extra);
}

async function analyzeTitle(settings: AppSettings, payload: TitleAnalyzePayload) {
  const data = await loadTitleKeywordData(settings);
  const extra = await collectTitleExtraKeywords(settings, data, payload.productName, payload.categoryName);
  return analyzeTitleScore(data, payload, extra);
}

async function collectTitleExtraKeywords(settings: AppSettings, data: import("../src/lib/shared").TitleKeywordData, productName: string, categoryName?: string): Promise<string[]> {
  const normalized = normalizeSettings(settings);
  const extras: string[] = [];
  const manualRaw = (normalized.titleExtraKeywords || "").trim();
  if (manualRaw) {
    extras.push(...manualRaw.split(/[\s,，、;；]+/).map((w) => w.trim()).filter(Boolean));
  }
  if (!normalized.titleAiSelectionEnabled) return extras;
  if (!productName.trim()) return extras;
  try {
    const pool = previewTokenPool(data, productName, categoryName);
    if (pool.length === 0) return extras;
    const enhanced = await Promise.race([
      enhanceTitlePoolWithLLM(normalized, { productName, categoryName, pool }),
      new Promise<{ ok: false; selected: string[]; suggested: string[]; reason: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, selected: [], suggested: [], reason: "LLM 超时" }), 8000)
      )
    ]);
    if (enhanced.ok) {
      extras.push(...enhanced.selected, ...enhanced.suggested);
      appendLog("info", "AI 选词成功", { selected: enhanced.selected.length, suggested: enhanced.suggested.length });
    }
  } catch (error) {
    appendLog("warn", "AI 选词调用异常，降级为纯算法", { message: (error as Error).message });
  }
  return extras;
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
    const conversionCol = findColumnByHeader(headers, ["支付转化率"]);
    const clickRateCol = findColumnByHeader(headers, ["点击率"]);
    let count = 0;
    for (let rowIndex = 3; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const keyword = cleanKeywordCell(cellText(worksheet, rowIndex, keywordCol));
      if (!keyword) continue;
      const demand = demandCol ? parseNumberCell(worksheet.getRow(rowIndex).getCell(demandCol).value) : 0;
      const tmall = tmallCol ? parseNumberCell(worksheet.getRow(rowIndex).getCell(tmallCol).value) : 0;
      const popularity = popularityCol ? parseRangeNumber(cellText(worksheet, rowIndex, popularityCol)) : 0;
      const conversionRate = conversionCol ? parseRangePercent(cellText(worksheet, rowIndex, conversionCol)) : 0;
      const clickRate = clickRateCol ? parseNumberCell(worksheet.getRow(rowIndex).getCell(clickRateCol).value) : 0;
      const blueOceanScore = calcBlueOceanWeight(demand, tmall, popularity, conversionRate, rowIndex);
      addTitleKeyword(categoryMap, {
        keyword,
        category: categoryName,
        source: "blue-ocean",
        weight: blueOceanScore,
        blueOceanScore,
        metrics: { demandSupplyRatio: demand, tmallClickShare: tmall, popularity, conversionRate, clickRate }
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

function calcBlueOceanWeight(demand: number, tmall: number, popularity: number, conversionRate: number, rowIndex: number) {
  const demandScore = Math.min(70, Math.log10(Math.max(1, demand)) * 24);
  const competitionScore = tmall > 0 ? Math.max(0, 35 - tmall * 35) : 16;
  const popularityScore = Math.min(25, Math.log10(Math.max(1, popularity)) * 5);
  const conversionScore = Math.min(30, conversionRate * 1.5);
  const rankScore = Math.max(0, 22 - rowIndex / 10);
  return Math.round(70 + demandScore + competitionScore + popularityScore + conversionScore + rankScore);
}

function parseRangePercent(value: string): number {
  const match = value.match(/(\d+(?:\.\d+)?)%\s*~\s*(\d+(?:\.\d+)?)%/);
  if (match) return (Number(match[1]) + Number(match[2])) / 2;
  const single = value.match(/(\d+(?:\.\d+)?)%/);
  if (single) return Number(single[1]);
  return 0;
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
  const allExts = new Set([...videoExts, ...imageExts]);
  const esPath = resolveEverythingEsPath(settings);
  let files: string[];
  if (esPath) {
    const esResults = await searchWithEverything(esPath, root, `${productName} ${colorName}`.trim(), allExts, 2000);
    files = esResults.length > 0 ? esResults : await walkMedia(root, allExts, 8000);
  } else {
    files = await walkMedia(root, allExts, 8000);
  }
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

async function validateVideoInput(ffmpegPath: string, videoPath: string): Promise<{ hasVideo: boolean; hasAudio: boolean; detail: string }> {
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-i", videoPath]);
  const hasVideo = /Stream\s+#\d+:\d+.*Video/i.test(result.output);
  const hasAudio = /Stream\s+#\d+:\d+.*Audio/i.test(result.output);
  return { hasVideo, hasAudio, detail: result.output };
}

async function renderVideoTask(payload: VideoRenderPayload): Promise<VideoRenderResult> {
  const settings = normalizeSettings(payload.settings);
  const ffmpegPath = resolveFfmpegPath(settings);
  if (!ffmpegPath) throw new Error("未找到 FFmpeg，请在设置中指定 ffmpeg.exe 或放入程序 bin 目录。");
  if (!settings.videoOutputDir) throw new Error("请先选择输出文件夹。");
  await fs.mkdir(settings.videoOutputDir, { recursive: true });

  if (payload.task.template !== "video-slice") {
    const image = payload.task.imagePath || payload.task.imagePaths[0];
    if (!image || !existsSync(image)) throw new Error(`图片文件不存在：${image || "未选择"}`);
    if (!payload.task.videoPath || !existsSync(payload.task.videoPath)) throw new Error(`视频文件不存在：${payload.task.videoPath || "未选择"}`);
    const probe = await validateVideoInput(ffmpegPath, payload.task.videoPath);
    if (!probe.hasVideo) throw new Error("视频文件没有可解码的视频流，请检查文件是否损坏或格式不支持。");
  } else {
    const missing = payload.task.imagePaths.filter(Boolean).filter((p) => !existsSync(p));
    if (missing.length) throw new Error(`以下图片文件不存在：${missing.map((p) => path.basename(p)).join("、")}`);
  }

  const outputPath = await uniqueOutputPath(settings.videoOutputDir, payload.task.outputName || `${payload.task.productName}-${payload.task.colorName}`);
  const acceleration = cpuAcceleration();
  const duration = await estimateTaskDuration(ffmpegPath, payload.task);
  emitVideoProgress(payload.task.id, 8, "准备素材");
  const args = await (payload.task.template === "video-slice"
    ? buildVideoSliceArgs(payload, outputPath)
    : buildBosTemplateArgs(ffmpegPath, payload, outputPath));
  const result = await runFfmpeg(ffmpegPath, args, payload.task.id, `剪辑中（${acceleration.label}）`, duration);
  emitVideoProgress(payload.task.id, result.success ? 100 : 0, result.success ? "完成" : "失败");
  await appendLog(result.success ? "info" : "error", "视频剪辑任务完成", { outputPath, success: result.success, error: result.error });
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

async function buildBosTemplateArgs(ffmpegPath: string, payload: VideoRenderPayload, outputPath: string): Promise<string[]> {
  const image = payload.task.imagePath || payload.task.imagePaths[0];
  if (!image || !payload.task.videoPath) throw new Error("帛先生模板需要 1 张图片和 1 个视频。");
  const { width, height } = await probeImageSize(image);
  const w = width;
  const h = height;
  const probe = await validateVideoInput(ffmpegPath, payload.task.videoPath);
  return [
    "-y",
    "-hide_banner",
    "-loop",
    "1",
    "-t",
    "0.034",
    "-framerate",
    "30",
    "-i",
    image,
    "-i",
    payload.task.videoPath,
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p[intro];` +
      `[1:v]split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=min(iw\\,${w}):min(ih\\,${h}):(iw-min(iw\\,${w}))/2:(ih-min(ih\\,${h}))/2,boxblur=24:2[blur];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fit];` +
      `[blur][fit]overlay=(W-w)/2:(H-h)/2,format=yuv420p[main];` +
      `[intro][main]concat=n=2:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    ...(probe.hasAudio ? ["-map", "1:a", "-c:a", "aac", "-shortest"] : []),
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    ...encoderArgs(),
    outputPath
  ];
}

async function buildVideoSliceArgs(payload: VideoRenderPayload, outputPath: string) {
  const images = payload.task.imagePaths.filter(Boolean).slice(0, 5);
  if (images.length < 5) throw new Error("视频切片模板需要 5 张图片。");
  const { width, height } = await probeImageSize(images[0]);
  const fps = 30;
  const segmentDuration = 3;
  const musicPath = payload.task.musicPath || resolveMusicPresetPath(payload.task.musicPresetId || payload.settings.sliceMusicPresetId);
  const args = ["-y", "-hide_banner"];
  images.forEach((image) => args.push("-loop", "1", "-t", String(segmentDuration), "-framerate", String(fps), "-i", image));
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  const filters =
    images
      .map((_, index) => {
        const effect = index === 1 || index === 4 ? bounceFilter(width, height, segmentDuration) : swingFilter(width, height, index, segmentDuration);
        return `[${index}:v]${effect},fps=${fps},format=yuv420p[v${index}]`;
      })
      .join(";") + `;${images.map((_, index) => `[v${index}]`).join("")}concat=n=5:v=1:a=0[out]`;
  args.push("-filter_complex", filters, "-map", "[out]");
  if (musicPath) args.push("-map", `${images.length}:a:0`, "-c:a", "aac", "-shortest");
  args.push("-r", String(fps), "-pix_fmt", "yuv420p", ...encoderArgs(), outputPath);
  return args;
}

function resolveMusicPresetPath(id: string) {
  if (!id) return "";
  const candidate = path.join(process.resourcesPath, "assets", "music", `${id}.mp3`);
  if (existsSync(candidate)) return candidate;
  const devCandidate = path.join(app.getAppPath(), "assets", "music", `${id}.mp3`);
  return existsSync(devCandidate) ? devCandidate : "";
}

function swingFilter(width: number, height: number, index: number, duration: number) {
  const direction = index === 2 ? "1" : "-1";
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white,rotate='${direction}*0.06*cos(2*PI*t/2.2)*exp(-0.35*t)':ow=${width}:oh=${height}:c=white`;
}

function bounceFilter(width: number, height: number, duration: number) {
  const padW = Math.round(width * 1.15 / 2) * 2;
  const padH = Math.round(height * 1.15 / 2) * 2;
  return `scale=${padW}:${padH}:force_original_aspect_ratio=decrease,pad=${padW}:${padH}:(ow-iw)/2:(oh-ih)/2:white,scale='iw*(1+0.10*exp(-1.5*t)*cos(3.5*t))':'ih*(1+0.10*exp(-1.5*t)*cos(3.5*t))':eval=frame,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`;
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

function cpuAcceleration(): VideoAcceleration {
  return { encoder: "libx264", label: `CPU 多线程：${cpuThreads} 线程` };
}

function encoderArgs() {
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", String(cpuThreads)];
}

async function readFfmpegEncoders(ffmpegPath: string) {
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]);
  return result.output.toLowerCase();
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
  const argsLog = `[ffmpeg cmd] ${ffmpegPath} ${args.map((a) => /[\s"']/.test(a) ? `"${a}"` : a).join(" ")}\n`;
  return new Promise((resolve) => {
    let log = argsLog;
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
    child.on("exit", (code) => {
      const signedCode = code !== null && code > 0x7FFFFFFF ? code - 0x100000000 : code;
      resolve({ success: code === 0, log, error: code === 0 ? undefined : parseFfmpegError(log, signedCode) });
    });
  });
}

function parseFfmpegError(log: string, code: number | null): string {
  const lower = log.toLowerCase();
  const logLines = log.split(/\r?\n/).filter(Boolean);
  const errorLines = logLines.filter((line) => /error|invalid|fail|cannot|denied|not found/i.test(line)).slice(-3);
  const contextTail = errorLines.length ? errorLines.join("\n") : log.slice(-200).trim();

  if (/no such file|does not exist/i.test(log)) return "输入文件不存在，请检查素材路径是否正确。";
  if (/invalid data found when processing input/i.test(log)) return "素材文件格式损坏或不支持，请更换文件后重试。";
  if (/codec not found|encoder.*not found|unknown encoder/i.test(log)) return "缺少必要的编码器，请使用诊断修复检查 FFmpeg 安装。";
  if (/permission denied/i.test(log)) return "输出目录没有写入权限，请检查输出文件夹权限。";
  if (/out of memory|cannot allocate/i.test(lower)) return "内存不足，请关闭其他程序后重试。";
  if (/device or resource busy/i.test(lower)) return "输出文件被占用，请关闭使用该文件的程序。";
  if (/nothing was written into output file/i.test(log)) {
    if (/no audio/i.test(log) || !/Stream\s+#\d+:\d+.*Audio/i.test(log)) return "输出文件为空：视频没有音频轨道导致合成失败，程序已自动适配。如果仍然报错请使用诊断修复。";
    return `输出文件为空：可能是编码器与素材不兼容。\n${contextTail}`;
  }
  if (/invalid argument/i.test(log) && /encoder/i.test(log)) return `硬件编码器参数不兼容，尝试切换 CPU 编码。\n${contextTail}`;
  if (/invalid argument/i.test(log)) return `FFmpeg 参数错误（退出码 ${code}），请使用诊断修复排查。\n${contextTail}`;
  if (/error while opening encoder/i.test(log)) return `编码器初始化失败，可能是硬件加速不兼容。\n${contextTail}`;
  if (/conversion failed/i.test(log)) return `格式转换失败，素材可能不兼容。\n${contextTail}`;
  return `FFmpeg 退出码 ${code}：${contextTail || "无详细日志，请使用诊断修复功能排查。"}`;
}

async function estimateTaskDuration(ffmpegPath: string, task: VideoRenderPayload["task"]) {
  if (task.template === "video-slice") return 15;
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

  items.push({ label: "编码模式", passed: true, detail: `CPU 多线程：${cpuThreads} 线程` });

  const testResult = await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.1:r=30",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "视频编码测试", passed: testResult.success, detail: testResult.success ? "视频编码功能正常" : `测试失败：${testResult.error}` });
  if (!testResult.success) suggestions.push("FFmpeg 视频编码测试失败，可能文件损坏，建议重新下载。");

  const audioTestResult = await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1",
    "-c:a", "aac",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "音频编码测试", passed: audioTestResult.success, detail: audioTestResult.success ? "音频编码功能正常" : `测试失败：${audioTestResult.error}` });
  if (!audioTestResult.success) suggestions.push("FFmpeg 音频编码测试失败，AAC 编码器可能不可用。");

  const concatTest = await runFfmpeg(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=red:s=320x240:d=0.1:r=30",
    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=0.1:r=30",
    "-filter_complex", "[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[out]",
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "滤镜拼接测试", passed: concatTest.success, detail: concatTest.success ? "filter_complex + concat 正常" : `测试失败：${concatTest.error}` });
  if (!concatTest.success) suggestions.push("视频拼接滤镜测试失败，FFmpeg 可能版本过低或编译缺少 filter 支持。");

  const outputDir = settings.videoOutputDir;
  if (outputDir) {
    const writable = await testDirectoryWritable(outputDir);
    items.push({ label: "输出目录可写", passed: writable, detail: writable ? `可写：${outputDir}` : `无法写入：${outputDir}` });
    if (!writable) suggestions.push("输出目录没有写入权限，请在设置中更换输出文件夹。");
  }

  if (!suggestions.length) suggestions.push("FFmpeg 运行正常，所有检查项通过。");
  return { items, suggestions, ok: items.every((item) => item.passed) };
}

async function testDirectoryWritable(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const testFile = path.join(dir, `.write-test-${Date.now()}.tmp`);
    await fs.writeFile(testFile, "test", "utf-8");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

interface AutoFixResult {
  fixed: string[];
  failed: string[];
  settingsPatch: Partial<AppSettings> | null;
}

async function autoFixFfmpeg(settings: AppSettings): Promise<AutoFixResult> {
  const fixed: string[] = [];
  const failed: string[] = [];
  let settingsPatch: Partial<AppSettings> | null = null;

  const currentPath = resolveFfmpegPath(settings);
  if (!currentPath) {
    const found = await searchFfmpegOnSystem();
    if (found) {
      settingsPatch = { ffmpegPath: found };
      fixed.push(`在系统中找到了 FFmpeg：${found}`);
    } else {
      await shell.openExternal("https://www.gyan.dev/ffmpeg/builds/");
      failed.push("系统中未找到 FFmpeg，已打开下载页面。下载 release essentials 版本，解压后把 ffmpeg.exe 放入任意文件夹，再回来在设置中指定路径即可。");
    }
  } else {
    fixed.push(`FFmpeg 已可用：${currentPath}`);
  }

  if (settings.videoOutputDir) {
    try {
      await fs.mkdir(settings.videoOutputDir, { recursive: true });
      const writable = await testDirectoryWritable(settings.videoOutputDir);
      if (writable) {
        fixed.push("输出目录已就绪");
      } else {
        const fallback = path.join(os.homedir(), "Desktop", "视频输出");
        await fs.mkdir(fallback, { recursive: true });
        settingsPatch = { ...settingsPatch, videoOutputDir: fallback };
        fixed.push(`原输出目录无法写入，已切换到：${fallback}`);
      }
    } catch {
      const fallback = path.join(os.homedir(), "Desktop", "视频输出");
      try {
        await fs.mkdir(fallback, { recursive: true });
        settingsPatch = { ...settingsPatch, videoOutputDir: fallback };
        fixed.push(`已创建输出目录：${fallback}`);
      } catch {
        failed.push("无法创建输出目录");
      }
    }
  } else {
    const defaultDir = path.join(os.homedir(), "Desktop", "视频输出");
    try {
      await fs.mkdir(defaultDir, { recursive: true });
      settingsPatch = { ...settingsPatch, videoOutputDir: defaultDir };
      fixed.push(`已自动设置输出目录：${defaultDir}`);
    } catch {
      failed.push("无法创建默认输出目录");
    }
  }

  if (!settings.videoLibraryDir) {
    failed.push("视频库文件夹未设置，请在设置中手动选择你的素材文件夹。");
  }

  return { fixed, failed, settingsPatch };
}

async function searchFfmpegOnSystem(): Promise<string | null> {
  const candidates = [
    path.join(process.resourcesPath, "bin", "ffmpeg.exe"),
    path.join(app.getAppPath(), "bin", "ffmpeg.exe"),
    path.join(os.homedir(), "Desktop", "ffmpeg.exe"),
    path.join(os.homedir(), "Desktop", "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(os.homedir(), "Downloads", "ffmpeg.exe"),
    path.join(os.homedir(), "Downloads", "ffmpeg", "bin", "ffmpeg.exe"),
  ];
  const programDirs = [
    process.env["ProgramFiles"] || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env["LOCALAPPDATA"] || ""
  ].filter(Boolean);
  for (const dir of programDirs) {
    candidates.push(
      path.join(dir, "ffmpeg", "bin", "ffmpeg.exe"),
      path.join(dir, "ffmpeg", "ffmpeg.exe")
    );
  }
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("where", ["ffmpeg.exe"], { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout });
      });
    });
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {}

  try {
    const searchDirs = [
      os.homedir(),
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Downloads"),
      "D:\\",
      "E:\\"
    ];
    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;
      const result = await quickFindFfmpeg(dir, 3);
      if (result) return result;
    }
  } catch {}

  return null;
}

async function quickFindFfmpeg(root: string, maxDepth: number, currentDepth = 0): Promise<string | null> {
  if (currentDepth > maxDepth) return null;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.toLowerCase() === "ffmpeg.exe" && !entry.isDirectory()) {
        return path.join(root, entry.name);
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.toLowerCase();
      if (name === "node_modules" || name === ".git" || name === "windows" || name === "$recycle.bin") continue;
      if (name.includes("ffmpeg") || name === "bin" || name === "tools") {
        const found = await quickFindFfmpeg(path.join(root, entry.name), maxDepth, currentDepth + 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
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

interface ReviewFileIndex {
  path: string;
  name: string;
  relative: string;
  fileText: string;
  pathText: string;
  folderNorm: string;
  depth: number;
}

interface ReviewFolderIndex {
  path: string;
  name: string;
  relative: string;
  nameText: string;
  pathText: string;
  depth: number;
  children: string[];
}

let reviewFileCache: {
  root: string;
  fileIndex: ReviewFileIndex[];
  folderIndex: ReviewFolderIndex[];
  cachedAt: number;
} | null = null;
const REVIEW_CACHE_TTL = 300_000;

function buildReviewIndex(root: string, files: string[], folders: string[]): { fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[] } {
  const folderChildMap = new Map<string, string[]>();
  const fileIndex: ReviewFileIndex[] = files.map((filePath) => {
    const parent = path.dirname(filePath);
    const bucket = folderChildMap.get(parent);
    if (bucket) { if (bucket.length < 12) bucket.push(filePath); }
    else folderChildMap.set(parent, [filePath]);

    const relative = path.relative(root, filePath);
    const fileName = path.basename(filePath);
    return {
      path: filePath,
      name: fileName,
      relative,
      fileText: normalizeMatchText(fileName),
      pathText: normalizeMatchText(relative),
      folderNorm: normalizeMatchText(path.dirname(relative)),
      depth: relative.split(/[\\/]/).length - 1
    };
  });

  const folderIndex: ReviewFolderIndex[] = folders.map((folderPath) => {
    const relative = path.relative(root, folderPath);
    return {
      path: folderPath,
      name: path.basename(folderPath),
      relative,
      nameText: normalizeMatchText(path.basename(folderPath)),
      pathText: normalizeMatchText(relative),
      depth: relative.split(/[\\/]/).length - 1,
      children: folderChildMap.get(folderPath) ?? []
    };
  });

  return { fileIndex, folderIndex };
}

function resolveEverythingEsPath(settings: AppSettings): string {
  if (settings.everythingEsPath && existsSync(settings.everythingEsPath)) return settings.everythingEsPath;
  const builtinEs = path.join(process.resourcesPath, "bin", "es.exe");
  const devEs = path.join(app.getAppPath(), "bin", "es.exe");
  const candidates = [
    builtinEs,
    devEs,
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Everything", "es.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Everything", "es.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Everything", "es.exe")
  ];
  return candidates.find((p) => existsSync(p)) ?? "";
}

function searchWithEverything(esPath: string, root: string, query: string, exts: Set<string>, maxResults = 500): Promise<string[]> {
  return new Promise((resolve) => {
    const extList = [...exts].map((e) => e.replace(".", "")).join(";");
    const args = ["-n", String(maxResults), "-path", root, `ext:${extList}`];
    if (query.trim()) args.push(query.trim());
    execFile(esPath, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) { resolve([]); return; }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve(lines.filter((line) => existsSync(line)));
    });
  });
}

async function testEverythingConnection(settings: AppSettings): Promise<{ available: boolean; detail: string }> {
  const esPath = resolveEverythingEsPath(settings);
  if (!esPath) return { available: false, detail: "未找到 es.exe，请确认 Everything 已安装并在后台运行。" };
  try {
    const results = await searchWithEverything(esPath, "", "test", new Set([".txt"]), 1);
    return { available: true, detail: `Everything 已就绪，搜索可用。` };
  } catch {
    return { available: false, detail: "es.exe 已找到但执行失败，请确认 Everything 主程序正在后台运行。" };
  }
}

async function scanReviewAssets(root: string, query: string, settings?: AppSettings, event?: Electron.IpcMainInvokeEvent): Promise<ReviewSearchResult[]> {
  if (!root || !existsSync(root)) throw new Error("请先选择收评助手根目录。");

  const scoringEnabled = settings?.reviewScoringEnabled ?? true;
  const esPath = settings ? resolveEverythingEsPath(settings) : "";
  if (esPath && query.trim()) {
    const esResults = await searchWithEverything(esPath, root, query.trim(), imageExts, 500);
    if (esResults.length > 0) {
      const thumbPaths = esResults.slice(0, 60);
      const thumbMap = batchThumbnails(thumbPaths, 180);
      return esResults.map((filePath, index) => ({
        path: filePath,
        name: path.basename(filePath),
        kind: "image" as const,
        score: scoringEnabled ? Math.max(100 - index, 10) : 0,
        reason: "Everything",
        thumbnailDataUrl: thumbMap.get(filePath)
      }));
    }
  }

  const now = Date.now();
  if (!reviewFileCache || reviewFileCache.root !== root || now - reviewFileCache.cachedAt > REVIEW_CACHE_TTL) {
    const disk = await loadReviewIndexFile(root);
    if (disk) {
      reviewFileCache = { root, fileIndex: disk.fileIndex, folderIndex: disk.folderIndex, cachedAt: now };
      if (event) event.sender.send("review:scanProgress", { scanned: disk.fileIndex.length, currentDir: "", phase: "loaded-cache" });
    } else {
      if (event) event.sender.send("review:scanProgress", { scanned: 0, currentDir: root, phase: "start" });
      const { files, folders } = await walkMediaAndFoldersWithProgress(root, imageExts, 50000, (scanned, currentDir) => {
        if (event) event.sender.send("review:scanProgress", { scanned, currentDir, phase: "walking" });
      });
      const { fileIndex, folderIndex } = buildReviewIndex(root, files, folders);
      reviewFileCache = { root, fileIndex, folderIndex, cachedAt: now };
      void saveReviewIndexFile(root, fileIndex, folderIndex);
      if (event) event.sender.send("review:scanProgress", { scanned: files.length, currentDir: "", phase: "indexed" });
    }
  }
  const { fileIndex, folderIndex } = reviewFileCache;
  const terms = buildMatchTerms(query);
  if (event) event.sender.send("review:scanProgress", { scanned: fileIndex.length, currentDir: "", phase: "scoring" });

  if (!scoringEnabled) {
    const matchesImage = (item: ReviewFileIndex) => terms.length === 0 || terms.some((term) => item.fileText.includes(term) || item.folderNorm.includes(term) || item.pathText.includes(term));
    const matchesFolder = (item: ReviewFolderIndex) => terms.length === 0 || terms.some((term) => item.nameText.includes(term) || item.pathText.includes(term));
    const topImages = fileIndex
      .filter(matchesImage)
      .slice(0, 80)
      .map((item) => ({ path: item.path, name: item.name, kind: "image" as const, score: 0, reason: "未启用评分" }));
    const topFolders = folderIndex
      .filter((item) => item.children.length > 0 && matchesFolder(item))
      .slice(0, 30)
      .map((item) => ({
        path: item.path,
        name: item.name,
        kind: "folder" as const,
        score: 0,
        reason: "未启用评分",
        children: item.children.map((fp) => ({ path: fp, name: path.basename(fp), kind: "image" as const, score: 0, reason: "文件夹内图片" }))
      }));
    const merged: ReviewSearchResult[] = [...topImages, ...topFolders].slice(0, 120);
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

  const scoredImages = fileIndex.map((item) => {
    const candidate = scoreIndexedFile(item, terms);
    return { path: item.path, name: item.name, kind: "image" as const, score: candidate.score, reason: candidate.reason };
  });
  const topImages = scoredImages
    .filter((item) => item.score >= 28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  const scoredFolders = folderIndex.map((item) => {
    const folderScore = scoreIndexedFolder(item, terms);
    return {
      path: item.path,
      name: item.name,
      kind: "folder" as const,
      score: folderScore.score,
      reason: folderScore.reason,
      children: item.children.map((fp) => ({ path: fp, name: path.basename(fp), kind: "image" as const, score: 0, reason: "文件夹内图片" }))
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

function scoreIndexedFile(item: ReviewFileIndex, terms: string[]) {
  let score = 0;
  const reasons: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (item.fileText.includes(term)) { score += /\d/.test(term) ? 28 : 24; reasons.push(`文件名命中 ${term}`); }
    else if (item.folderNorm.includes(term)) { score += /\d/.test(term) ? 24 : 20; reasons.push(`文件夹命中 ${term}`); }
    else if (item.pathText.includes(term)) { score += 12; reasons.push(`路径命中 ${term}`); }
    else { const overlap = tokenOverlap(term, item.pathText); if (overlap > 0.45) score += Math.round(overlap * 16); }
  }
  score += Math.max(0, 10 - item.depth);
  score += 4;
  return { score, reason: reasons.slice(0, 3).join("；") || "路径文字相似" };
}

function scoreIndexedFolder(item: ReviewFolderIndex, terms: string[]) {
  let score = 0;
  const reasons: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (item.nameText.includes(term)) {
      score += /\d/.test(term) ? 32 : 26;
      reasons.push(`文件夹命中 ${term}`);
    } else if (item.pathText.includes(term)) {
      score += /\d/.test(term) ? 22 : 18;
      reasons.push(`路径命中 ${term}`);
    } else {
      const overlap = tokenOverlap(term, item.pathText);
      if (overlap > 0.45) score += Math.round(overlap * 14);
    }
  }
  score += Math.max(0, 12 - item.depth);
  return { score, reason: reasons.slice(0, 3).join("；") || "文件夹名称相似" };
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

async function loadReviewThumbnailBatch(paths: string[], size = 220): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const limited = paths.slice(0, 64);
  for (let i = 0; i < limited.length; i++) {
    const p = limited[i];
    if (!existsSync(p)) continue;
    const url = imageToDataUrl(p, size);
    if (url) result[p] = url;
    if (i % 6 === 5) await new Promise((resolve) => setImmediate(resolve));
  }
  return result;
}

async function rebuildReviewIndex(root: string, event: Electron.IpcMainInvokeEvent): Promise<{ ok: boolean; total: number }> {
  if (!root || !existsSync(root)) return { ok: false, total: 0 };
  reviewFileCache = null;
  await deleteReviewIndexFile(root);
  const startedAt = Date.now();
  const { files, folders } = await walkMediaAndFoldersWithProgress(root, imageExts, 50000, (scanned, currentDir) => {
    event.sender.send("review:scanProgress", { scanned, currentDir, phase: "walking" });
  });
  const { fileIndex, folderIndex } = buildReviewIndex(root, files, folders);
  reviewFileCache = { root, fileIndex, folderIndex, cachedAt: Date.now() };
  await saveReviewIndexFile(root, fileIndex, folderIndex);
  event.sender.send("review:scanProgress", { scanned: files.length, currentDir: "", phase: "done", elapsedMs: Date.now() - startedAt });
  return { ok: true, total: files.length };
}

function startDragFiles(event: Electron.IpcMainInvokeEvent, paths: string[]): void {
  const validPaths = (paths || []).filter((p) => p && existsSync(p));
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
    appendLog("warn", "startDrag 失败", { message: (error as Error).message, count: validPaths.length });
  }
}

async function deleteReviewIndexFile(root: string): Promise<void> {
  try {
    const filePath = reviewIndexFilePath(root);
    if (existsSync(filePath)) await fs.unlink(filePath);
  } catch {}
}

function reviewIndexFilePath(root: string): string {
  const safe = Buffer.from(root).toString("base64").replace(/[/+=]/g, "_").slice(0, 64);
  return path.join(app.getPath("userData"), `review-index-${safe}.json`);
}

async function saveReviewIndexFile(root: string, fileIndex: ReviewFileIndex[], folderIndex: ReviewFolderIndex[]): Promise<void> {
  try {
    const filePath = reviewIndexFilePath(root);
    const payload = { root, savedAt: Date.now(), fileIndex, folderIndex };
    await fs.writeFile(filePath, JSON.stringify(payload), "utf-8");
  } catch (error) {
    appendLog("warn", "保存收评索引失败", { message: (error as Error).message });
  }
}

async function loadReviewIndexFile(root: string): Promise<{ fileIndex: ReviewFileIndex[]; folderIndex: ReviewFolderIndex[] } | null> {
  try {
    const filePath = reviewIndexFilePath(root);
    if (!existsSync(filePath)) return null;
    const stats = await fs.stat(filePath);
    if (Date.now() - stats.mtimeMs > REVIEW_INDEX_DISK_TTL) return null;
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { root: string; fileIndex?: ReviewFileIndex[]; folderIndex?: ReviewFolderIndex[] };
    if (parsed.root !== root) return null;
    return { fileIndex: parsed.fileIndex || [], folderIndex: parsed.folderIndex || [] };
  } catch {
    return null;
  }
}

const REVIEW_INDEX_DISK_TTL = 1000 * 60 * 60 * 24 * 7;

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

async function enhanceTitlePoolWithLLM(
  settings: AppSettings,
  payload: { productName: string; categoryName?: string; pool: Array<{ text: string; weight: number; source: string }> }
): Promise<{ ok: boolean; selected: string[]; suggested: string[]; reason?: string }> {
  try {
    const normalized = normalizeSettings(settings);
    if (!normalized.titleAiSelectionEnabled) return { ok: false, selected: [], suggested: [], reason: "已关闭 AI 选词" };
    const profile = getReviewApiProfile(normalized);
    if (!profile.apiBaseUrl || !profile.apiKey) return { ok: false, selected: [], suggested: [], reason: "未配置 API" };
    const top = (payload.pool || []).slice(0, 30).map((t) => t.text).filter(Boolean);
    if (top.length === 0) return { ok: false, selected: [], suggested: [], reason: "候选词为空" };
    const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const userPrompt = [
      `你是淘宝男装关键词搜索专家。`,
      `商品："${payload.productName}"${payload.categoryName ? `，类目："${payload.categoryName}"` : ""}。`,
      `下面是从市场数据中提取的候选关键词，请：`,
      `1. 从中选出最贴合这件商品的 10-15 个（考虑材质、版型、季节匹配）`,
      `2. 额外推荐 3-5 个未列出但同样相关的高搜索量关键词（不超过 6 个汉字/12 字节）`,
      `严格只返回 JSON，不要任何解释：{"selected":["..."],"suggested":["..."]}`,
      ``,
      `候选词列表：${top.join("、")}`
    ].join("\n");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify({
        model: profile.textModel || "gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是淘宝男装关键词专家，严格返回 JSON。" },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("响应中未找到 JSON");
    const parsed = JSON.parse(match[0]) as { selected?: string[]; suggested?: string[] };
    const cleanList = (arr: unknown): string[] =>
      Array.isArray(arr)
        ? arr.map((x) => String(x || "").trim())
            .filter((x) => x.length > 0 && x.length <= 12 && !/[\d.,，。?？!！]/.test(x))
            .slice(0, 20)
        : [];
    return {
      ok: true,
      selected: cleanList(parsed.selected),
      suggested: cleanList(parsed.suggested)
    };
  } catch (error) {
    appendLog("warn", "LLM 选词失败，降级为纯算法", { message: (error as Error).message });
    return { ok: false, selected: [], suggested: [], reason: (error as Error).message };
  }
}


async function generateReviewCopy(settings: AppSettings, options: ReviewGenerationOptions): Promise<ReviewGenerationResult> {
  const normalizedSettings = normalizeSettings(settings);
  const profile = getReviewApiProfile(normalizedSettings);
  if (!profile.apiBaseUrl || !profile.apiKey) throw new Error("请先在设置中填写 API Base URL 和 API Key。");
  const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const targetLength = Math.min(300, Math.max(30, Math.round(Number(options.targetLength) || normalizedSettings.reviewTargetLength)));
  const thinkingMode = options.thinkingMode || normalizedSettings.reviewThinkingMode;
  const thinkingEffort = options.thinkingEffort || normalizedSettings.reviewThinkingEffort;

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
  const pickedAngles = shuffled.slice(0, 4);
  const opener = openerStyles[(seed - 1) % openerStyles.length];

  const systemPrompt = [
    "你是电商文案专家，擅长从商品特征中提炼卖点，用极简生动的语言写出真实买家好评。",
    "核心原则：",
    "- 每条评价必须从买家真实使用角度出发，像是真人写的而非AI",
    "- 自然融入一个具体穿着或使用场景（通勤、约会、周末、运动等）",
    "- 6条评价之间必须在句式结构、开场白、侧重点和收尾方式上明显不同",
    "- 杜绝千篇一律的模板感，禁止出现相似的开头或句式",
    `- 每条评价尽量接近 ${targetLength} 个中文字，允许自然浮动 20%，不要硬凑字数`,
    `- 思考模式：${thinkingMode}；思考程度：${thinkingEffort}。先在内部规划角度差异，再只输出最终文案。`
  ].join("\n");

  const prompt = [
    "请生成 6 条中文买家好评文案。严格遵守以下要求：",
    "",
    `商品/搜索词：${options.query}`,
    `商品补充描述：${options.productDescription || "无"}`,
    "",
    "【风格参数】",
    `Emoji 使用程度（0无~5多）：${options.emojiLevel}`,
    `专业程度（0口语化~5专业）：${options.professionalLevel}`,
    `买家视角真实感（0一般~5很强）：${options.buyerLevel}`,
    `语气夸张程度（0朴素~5夸张）：${options.exaggerationLevel}`,
    `场景化表达（0弱~5强）：${options.sceneLevel}`,
    `提到性价比：${options.mentionValue ? "是" : "否"}`,
    `目标字数：每条约 ${targetLength} 字`,
    `思考模式：${thinkingMode}，思考程度：${thinkingEffort}`,
    "",
    "【本批次多样性要求】",
    `本次 6 条文案请分别从以下角度切入（每条选一个不同角度）：`,
    ...pickedAngles.map((a, i) => `  ${i + 1}. ${a}`),
    `  5-6. 自由发挥，但不能与上面4个角度重复`,
    `本次开场风格偏好：${opener}`,
    "",
    "【格式】不要编号，只返回 JSON：{\"copies\":[\"...\"]}"
  ].join("\n");

  const customPrompt = normalizedSettings.reviewCustomPrompt?.trim();
  const finalSystemPrompt = customPrompt ? `${systemPrompt}\n\n用户自定义要求：\n${customPrompt}` : systemPrompt;
  const requestBody: Record<string, unknown> = {
    model: profile.textModel || settings.textModel,
    temperature: thinkingMode === "deep" ? 0.82 : thinkingMode === "fast" ? 0.75 : 0.92,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: finalSystemPrompt },
      { role: "user", content: prompt }
    ]
  };
  if (thinkingMode !== "off") requestBody.reasoning_effort = thinkingEffort;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) throw new Error(`AI 生成失败：${response.status} ${await response.text()}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content || "{}");
  return { copies: Array.isArray(parsed.copies) ? parsed.copies.map(String).slice(0, 8) : [] };
}

async function listAvailableModels(settings: AppSettings): Promise<{ id: string; name: string }[]> {
  const profile = getReviewApiProfile(normalizeSettings(settings));
  if (!profile.apiBaseUrl || !profile.apiKey) return [];
  const endpoint = `${profile.apiBaseUrl.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${profile.apiKey}` } });
    if (!response.ok) return [];
    const data = await response.json();
    const models = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return models.map((m: Record<string, unknown>) => ({ id: String(m.id || m.model || ""), name: String(m.id || m.model || "") })).filter((m: { id: string }) => m.id);
  } catch {
    return [];
  }
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
  ipcMain.handle("ffmpeg:autoFix", (_event, settings: AppSettings) => autoFixFfmpeg(normalizeSettings(settings)));
  ipcMain.handle("video:scanLibrary", (_event, settings: AppSettings, productName: string, colorName: string) => scanVideoLibrary(settings, productName, colorName));
  ipcMain.handle("video:renderTask", (_event, payload: VideoRenderPayload) => renderVideoTask(payload));
  ipcMain.handle("media:latestImage", (_event, dir: string) => latestImageInDirectory(dir));
  ipcMain.handle("media:imagePreview", (_event, filePath: string) => imageToDataUrl(filePath, 960) ?? "");
  ipcMain.handle("review:scanAssets", (event, root: string, query: string, settings?: AppSettings) => scanReviewAssets(root, query, settings ? normalizeSettings(settings) : undefined, event));
  ipcMain.handle("review:loadThumbnails", (_event, paths: string[]) => loadReviewThumbnails(paths));
  ipcMain.handle("review:loadThumbnailBatch", (_event, paths: string[], size?: number) => loadReviewThumbnailBatch(paths, size));
  ipcMain.handle("review:rebuildIndex", (event, root: string) => rebuildReviewIndex(root, event));
  ipcMain.handle("review:generateCopy", (_event, settings: AppSettings, options: ReviewGenerationOptions) => generateReviewCopy(settings, options));
  ipcMain.handle("drag:startFiles", (event, paths: string[]) => startDragFiles(event, paths));
  ipcMain.handle("title:enhancePool", (_event, settings: AppSettings, payload: { productName: string; categoryName?: string; pool: Array<{ text: string; weight: number; source: string }> }) => enhanceTitlePoolWithLLM(settings, payload));
  ipcMain.handle("ai:listModels", (_event, settings: AppSettings) => listAvailableModels(settings));
  ipcMain.handle("everything:test", (_event, settings: AppSettings) => testEverythingConnection(normalizeSettings(settings)));
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

  createWindow();
  const settings = await loadSettings();
  configureAutoUpdater(settings);
  setTimeout(() => void checkForUpdates(settings).catch((error) => appendLog("warn", "后台检查更新失败", { message: error.message })), 2500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  try {
    await saveVideoWorkbenchState(DEFAULT_VIDEO_WORKBENCH_STATE);
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
