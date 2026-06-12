import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import type { AppSettings, SelectPathResult, TitleAnalyzePayload, TitleCategoryData, TitleGeneratePayload, TitleKeywordData, TitleKeywordEntry } from "../../src/lib/shared";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/lib/shared";
import { analyzeTitleScore, containsThirdPartyBrand, generateTitleScore, sanitizeTitleKeyword } from "../../src/lib/titleOptimizer";

interface TitlePayload {
  action: "load" | "analyze" | "generate";
  settings: AppSettings;
  payload?: TitleAnalyzePayload | TitleGeneratePayload;
  cacheDir?: string;
  requestId?: string;
}

type ExcelJSModule = typeof import("exceljs");
type ExcelWorkbook = InstanceType<ExcelJSModule["Workbook"]>;
type ExcelWorksheet = ExcelWorkbook["worksheets"][number];
type ExcelCellValue = ReturnType<ExcelWorksheet["getRow"]>["values"] extends Array<infer _T> ? unknown : unknown;

const PARSER_VERSION = 2;
let titleKeywordCache: { filePath: string; mtimeMs: number; size: number; parserVersion: number; data: TitleKeywordData } | null = null;
const requestId = typeof (workerData as TitlePayload).requestId === "string" ? (workerData as TitlePayload).requestId : undefined;

function postEnvelope(message: { ok: boolean; result?: unknown; error?: string }): void {
  parentPort?.postMessage(requestId ? { ...message, requestId } : message);
}

function cacheFilePath(cacheDir: string | undefined, filePath: string, mtimeMs: number, size: number): string | undefined {
  if (!cacheDir) return undefined;
  const safe = Buffer.from(`${filePath}|${mtimeMs}|${size}|${PARSER_VERSION}`).toString("base64").replace(/[/+=]/g, "_").slice(0, 120);
  return path.join(cacheDir, `title-keywords-v${PARSER_VERSION}-${safe}.json`);
}

function cellText(worksheet: ExcelWorksheet, rowIndex: number, colIndex: number): string {
  const value = worksheet.getRow(rowIndex).getCell(colIndex).value;
  if (value == null) return "";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item: { text: string }) => item.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result != null) return String(value.result);
    if ("formula" in value) return "";
  }
  return String(value).trim();
}

function parseRangeNumber(value: string): number {
  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)(万)?/);
  if (!match) return 0;
  return Number(match[1]) * (match[2] ? 10000 : 1);
}

function parseNumberCell(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value && "result" in value && typeof (value as { result?: unknown }).result === "number") return (value as { result: number }).result;
  return parseRangeNumber(String(value ?? ""));
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

function findHeaderGroups(worksheet: ExcelWorksheet, rowIndex: number): Array<{ name: string; start: number; end: number }> {
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

function readHeaderRows(worksheet: ExcelWorksheet, start: number, end: number, rows: number[]): Map<number, string> {
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

function addTitleKeyword(categoryMap: Map<string, TitleCategoryData>, entry: TitleKeywordEntry): void {
  if (!entry.keyword || containsThirdPartyBrand(entry.keyword)) return;
  const initialSource: TitleCategoryData["source"] = entry.source === "blue-ocean" ? "blue-ocean" : entry.source === "breakdown" ? "breakdown" : "market";
  const category: TitleCategoryData = categoryMap.get(entry.category) ?? {
    name: entry.category,
    source: initialSource,
    keywords: [],
    blueOceanWords: [],
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

function parseRankedKeywordSheet(worksheet: ExcelWorksheet, source: "market" | "breakdown", categoryMap: Map<string, TitleCategoryData>, warnings: string[]): void {
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
      addTitleKeyword(categoryMap, { keyword, category: categoryName, source, rank: rank > 0 ? rank : undefined, weight, trend: trend || undefined });
      count += 1;
    }
    if (!count) warnings.push(`${worksheet.name} / ${categoryName} 未解析到关键词`);
  }
}

function parseBlueOceanSheet(worksheet: ExcelWorksheet, categoryMap: Map<string, TitleCategoryData>, warnings: string[]): void {
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

async function loadTitleKeywordData(settings: AppSettings, cacheDir?: string): Promise<TitleKeywordData> {
  const normalized = normalizeSettings(settings);
  const filePath = normalized.titleKeywordExcelPath || DEFAULT_SETTINGS.titleKeywordExcelPath;
  if (!filePath || !existsSync(filePath)) throw new Error(`未找到标题关键词 Excel：${filePath || "未设置路径"}`);
  const stat = await fs.stat(filePath);
  if (titleKeywordCache && titleKeywordCache.filePath === filePath && titleKeywordCache.mtimeMs === stat.mtimeMs && titleKeywordCache.size === stat.size && titleKeywordCache.parserVersion === PARSER_VERSION) return titleKeywordCache.data;
  const diskCachePath = cacheFilePath(cacheDir, filePath, stat.mtimeMs, stat.size);
  if (diskCachePath) {
    const cached = await fs.readFile(diskCachePath, "utf-8")
      .then((raw) => JSON.parse(raw) as { filePath?: string; mtimeMs?: number; size?: number; parserVersion?: number; data?: TitleKeywordData })
      .catch(() => undefined);
    if (cached?.filePath === filePath && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.parserVersion === PARSER_VERSION && cached.data) {
      titleKeywordCache = { filePath, mtimeMs: stat.mtimeMs, size: stat.size, parserVersion: PARSER_VERSION, data: cached.data };
      return cached.data;
    }
  }

  const ExcelJS = (await import("exceljs")).default;
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
  titleKeywordCache = { filePath, mtimeMs: stat.mtimeMs, size: stat.size, parserVersion: PARSER_VERSION, data };
  if (diskCachePath) {
    await fs.mkdir(path.dirname(diskCachePath), { recursive: true }).catch(() => undefined);
    await fs.writeFile(diskCachePath, JSON.stringify({ filePath, mtimeMs: stat.mtimeMs, size: stat.size, parserVersion: PARSER_VERSION, savedAt: Date.now(), data }), "utf-8").catch(() => undefined);
  }
  return data;
}

function splitTitleTargetKeywords(value: string): string[] {
  return String(value || "")
    .split(/[\s,，、;；\n\r]+/)
    .map((word) => sanitizeTitleKeyword(word))
    .filter((word) => word.length >= 2 && !containsThirdPartyBrand(word))
    .slice(0, 40);
}

async function main(): Promise<unknown> {
  const payload = workerData as TitlePayload;
  const data = await loadTitleKeywordData(payload.settings, payload.cacheDir);
  if (payload.action === "load") return data;
  const normalized = normalizeSettings(payload.settings);
  const strategy = payload.payload?.strategy ?? "stacked-v2";
  const targetKeywords = [...splitTitleTargetKeywords(normalized.titleExtraKeywords), ...((payload.payload as TitleAnalyzePayload | TitleGeneratePayload | undefined)?.targetKeywords ?? [])];
  const extra = strategy === "stacked-v2" ? targetKeywords : [];
  if (payload.action === "generate") {
    const body = payload.payload as TitleGeneratePayload;
    return generateTitleScore(data, body.productName, body.categoryName, body.variantCount, extra, strategy, targetKeywords);
  }
  const body = payload.payload as TitleAnalyzePayload;
  return analyzeTitleScore(data, body, extra, strategy, targetKeywords);
}

main()
  .then((result) => postEnvelope({ ok: true, result }))
  .catch((error) => postEnvelope({ ok: false, error: (error as Error).message }));
