import { app, dialog, type IpcMain, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type ExcelJS from "exceljs";
import type { AppSettings, TitleKeywordData, TitleCategoryData, TitleKeywordEntry, TitleGeneratePayload, TitleAnalyzePayload, SelectPathResult } from "../../src/lib/shared";
import { normalizeSettings, getReviewApiProfile, DEFAULT_SETTINGS } from "../../src/lib/shared";
import { generateTitleScore, analyzeTitleScore, previewTokenPool, sanitizeTitleKeyword, containsThirdPartyBrand } from "../../src/lib/titleOptimizer";
import { validateApiUrl } from "../utils/security";
import { assertAuthorizedTitleExcel, authorizeFileCapability } from "../utils/capabilities";
import { truncatedErrorText } from "../utils/http";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";
import { runWorkerTask } from "../utils/worker";
import { loadSettings } from "../utils/settings";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

// ============================================================================
// 文件选择
// ============================================================================
async function selectTitleKeywordExcel(): Promise<SelectPathResult> {
  const dialogOptions = {
    title: "选择标题关键词 Excel",
    properties: ["openFile"],
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx", "xlsm"] }]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  for (const filePath of result.filePaths) authorizeFileCapability("titleExcel", filePath, new Set([".xlsx", ".xlsm"]));
  return { canceled: result.canceled, paths: result.filePaths };
}

// ============================================================================
// Excel 解析工具函数
// ============================================================================
function cellText(worksheet: ExcelJS.Worksheet, rowIndex: number, colIndex: number): string {
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

function parseNumberCell(value: ExcelJS.CellValue): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value && "result" in value && typeof value.result === "number") return value.result;
  return parseRangeNumber(String(value ?? ""));
}

function parseRangeNumber(value: string): number {
  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)(万)?/);
  if (!match) return 0;
  return Number(match[1]) * (match[2] ? 10000 : 1);
}

function parseRangePercent(value: string): number {
  const match = value.match(/(\d+(?:\.\d+)?)%\s*~\s*(\d+(?:\.\d+)?)%/);
  if (match) return (Number(match[1]) + Number(match[2])) / 2;
  const single = value.match(/(\d+(?:\.\d+)?)%/);
  if (single) return Number(single[1]);
  return 0;
}

function normalizeCategoryName(value: string): string {
  return value.replace(/^关键词拆解--/, "").replace(/\s+/g, "").trim();
}

function cleanKeywordCell(value: string): string {
  const keyword = sanitizeTitleKeyword(value);
  if (!keyword || keyword.length < 2 || /^\d+$/.test(keyword) || containsThirdPartyBrand(keyword)) return "";
  return keyword;
}

// ============================================================================
// Excel 表头解析
// ============================================================================
function findHeaderGroups(worksheet: ExcelJS.Worksheet, rowIndex: number): Array<{ name: string; start: number; end: number }> {
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

function readHeaderRows(worksheet: ExcelJS.Worksheet, start: number, end: number, rows: number[]): Map<number, string> {
  const map = new Map<number, string>();
  for (let col = start; col <= end; col += 1) {
    map.set(col, rows.map((row) => cellText(worksheet, row, col)).filter(Boolean).join(" "));
  }
  return map;
}

function findColumnByHeader(headers: Map<number, string>, keys: string[]): number | undefined {
  for (const [col, header] of headers) if (keys.some((key) => header.includes(key))) return col;
  return undefined;
}

function findRankColumn(headers: Map<number, string>, keywordCol: number, groupEnd: number): number | undefined {
  for (const [col, header] of headers) if (col > keywordCol && col <= groupEnd && /排名/.test(header)) return col;
  return undefined;
}

// ============================================================================
// 权重计算
// ============================================================================
function calcRankWeight(rank: number, rowIndex: number, source: "market" | "breakdown"): number {
  const fallbackRank = rank > 0 ? rank : Math.max(1, rowIndex - 3);
  const base = source === "breakdown" ? 118 : 100;
  return Math.max(18, Math.round(base - Math.log10(fallbackRank + 1) * 28));
}

function calcBlueOceanWeight(demand: number, tmall: number, popularity: number, conversionRate: number, rowIndex: number): number {
  const demandScore = Math.min(70, Math.log10(Math.max(1, demand)) * 24);
  const competitionScore = tmall > 0 ? Math.max(0, 35 - tmall * 35) : 16;
  const popularityScore = Math.min(25, Math.log10(Math.max(1, popularity)) * 5);
  const conversionScore = Math.min(30, conversionRate * 1.5);
  const rankScore = Math.max(0, 22 - rowIndex / 10);
  return Math.round(70 + demandScore + competitionScore + popularityScore + conversionScore + rankScore);
}

// ============================================================================
// 关键词管理
// ============================================================================
function addTitleKeyword(categoryMap: Map<string, TitleCategoryData>, entry: TitleKeywordEntry): void {
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

function dedupeTitleKeywordEntries(entries: TitleKeywordEntry[]): TitleKeywordEntry[] {
  const map = new Map<string, TitleKeywordEntry>();
  for (const entry of entries) {
    const key = `${entry.category}:${entry.source}:${entry.keyword}`;
    const existing = map.get(key);
    if (!existing || entry.weight > existing.weight) map.set(key, entry);
  }
  return [...map.values()];
}

// ============================================================================
// Excel 表格解析
// ============================================================================
function parseRankedKeywordSheet(
  worksheet: ExcelJS.Worksheet,
  source: "market" | "breakdown",
  categoryMap: Map<string, TitleCategoryData>,
  warnings: string[]
): void {
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

function parseBlueOceanSheet(worksheet: ExcelJS.Worksheet, categoryMap: Map<string, TitleCategoryData>, warnings: string[]): void {
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

// ============================================================================
// 主要功能
// ============================================================================
async function loadTitleKeywordData(settings: AppSettings): Promise<TitleKeywordData> {
  const filePath = normalizeSettings(settings).titleKeywordExcelPath || DEFAULT_SETTINGS.titleKeywordExcelPath;
  assertAuthorizedTitleExcel(filePath);
  return runWorkerTask<{ action: "load"; settings: AppSettings; cacheDir?: string }, TitleKeywordData>(
    "titleWorker",
    { action: "load", settings, cacheDir: path.join(app.getPath("userData"), "title-cache") },
    undefined,
    { timeoutMs: 120_000 }
  );
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
    validateApiUrl(profile.apiBaseUrl);
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
      const text = await truncatedErrorText(response);
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
    await appendLog("warn", "LLM 选词失败，降级为纯算法", { message: (error as Error).message }, userDataPath);
    return { ok: false, selected: [], suggested: [], reason: (error as Error).message };
  }
}

async function collectTitleExtraKeywords(settings: AppSettings, data: TitleKeywordData, productName: string, categoryName?: string): Promise<string[]> {
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
      await appendLog("info", "AI 选词成功", { selected: enhanced.selected.length, suggested: enhanced.suggested.length }, userDataPath);
    }
  } catch (error) {
    await appendLog("warn", "AI 选词调用异常，降级为纯算法", { message: (error as Error).message }, userDataPath);
  }
  return extras;
}

function splitTitleTargetKeywords(value: string): string[] {
  return String(value || "")
    .split(/[\s,，、;；\n\r]+/)
    .map((word) => sanitizeTitleKeyword(word))
    .filter((word) => word.length >= 2 && !containsThirdPartyBrand(word))
    .slice(0, 40);
}

async function generateTitleCandidates(settings: AppSettings, payload: TitleGeneratePayload) {
  if ((payload.strategy ?? "stacked-v2") === "stacked-v2") {
    return runWorkerTask<{ action: "generate"; settings: AppSettings; payload: TitleGeneratePayload; cacheDir?: string }, ReturnType<typeof generateTitleScore>>(
      "titleWorker",
      { action: "generate", settings, payload, cacheDir: path.join(app.getPath("userData"), "title-cache") },
      undefined,
      { timeoutMs: 120_000 }
    );
  }
  const data = await loadTitleKeywordData(settings);
  const strategy = payload.strategy ?? "stacked-v2";
  const normalized = normalizeSettings(settings);
  const targetKeywords = [...splitTitleTargetKeywords(normalized.titleExtraKeywords), ...(payload.targetKeywords ?? [])];
  const extra = strategy === "stacked-v2" ? targetKeywords : await collectTitleExtraKeywords(settings, data, payload.productName, payload.categoryName);
  return generateTitleScore(data, payload.productName, payload.categoryName, payload.variantCount, extra, strategy, targetKeywords);
}

async function analyzeTitle(settings: AppSettings, payload: TitleAnalyzePayload) {
  if ((payload.strategy ?? "stacked-v2") === "stacked-v2") {
    return runWorkerTask<{ action: "analyze"; settings: AppSettings; payload: TitleAnalyzePayload; cacheDir?: string }, ReturnType<typeof analyzeTitleScore>>(
      "titleWorker",
      { action: "analyze", settings, payload, cacheDir: path.join(app.getPath("userData"), "title-cache") },
      undefined,
      { timeoutMs: 120_000 }
    );
  }
  const data = await loadTitleKeywordData(settings);
  const strategy = payload.strategy ?? "stacked-v2";
  const normalized = normalizeSettings(settings);
  const targetKeywords = [...splitTitleTargetKeywords(normalized.titleExtraKeywords), ...(payload.targetKeywords ?? [])];
  const extra = strategy === "stacked-v2" ? targetKeywords : await collectTitleExtraKeywords(settings, data, payload.productName, payload.categoryName);
  return analyzeTitleScore(data, payload, extra, strategy, targetKeywords);
}

/**
 * 注册标题优化相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("title:selectExcel", () => selectTitleKeywordExcel());
  ipcMain.handle("title:loadKeywordData", async () => loadTitleKeywordData(await loadSettings()));
  ipcMain.handle("title:analyze", async (_event, _settings: AppSettings, payload: TitleAnalyzePayload) => analyzeTitle(await loadSettings(), payload));
  ipcMain.handle("title:generateCandidates", async (_event, _settings: AppSettings, payload: TitleGeneratePayload) => generateTitleCandidates(await loadSettings(), payload));
  ipcMain.handle("title:enhancePool", async (_event, _settings: AppSettings, payload: { productName: string; categoryName?: string; pool: Array<{ text: string; weight: number; source: string }> }) => enhanceTitlePoolWithLLM(await loadSettings(), payload));
}
