# 淘宝男装标题关键词优化工具 - 技术规格书

> **版本**: 2.0 (完全重写)  
> **目标**: 给AI一次性正确实现的完整规格  
> **核心流程**: 导入Excel → 选择类目 → 输入标题 → 评分 + 优化建议

---

## 一、技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Electron | ^28 |
| 前端 | React + TypeScript | ^18 / ^5.4 |
| 构建 | Vite | ^5 |
| Excel解析 | SheetJS (xlsx) | ^0.18 |
| 样式 | TailwindCSS | ^3 |
| 打包 | electron-builder | ^24 |

---

## 二、Excel数据格式 (最关键部分)

### 文件名: `市场关键词帛先生.xlsx`

### Sheet1: "A天猫市场词分析表"
- **尺寸**: 1501行 × 89列
- **类目组数**: 9组，每组10列
- **类目组起始列** (1-indexed): 1, 11, 21, 31, 41, 51, 61, 71, 81
- **类目名称** (Row1各组第1列): 帛先生搜索词, 男装-大盘词, 休闲裤类目词, 卫裤类目词, 牛仔裤类目词, T恤类目词, 短裤类目词, 西裤类目词, 卫衣类目词

**每组10列结构** (以组起始列S为基准, 1-indexed):
| 偏移 | 内容 | 示例值 |
|------|------|--------|
| S+0 | 本周搜索词 | "帛先生 裤子" |
| S+1 | 本周搜索排名(整数) | 1 |
| S+2 | 空列 | NULL |
| S+3 | 上周搜索词 | "帛先生 裤子" |
| S+4 | 上周搜索排名 | 1 |
| S+5 | 空列 | NULL |
| S+6 | 关键词(=Col S+0的复制) | "帛先生 裤子" |
| S+7 | 同比增长(VLOOKUP公式) | 0 |
| S+8 | 百分比(公式) | 0.0 |
| S+9 | 空列 | NULL |

**行结构**:
- Row1: 类目名称 (仅在组第1列)
- Row2: 日期+列标题 (如 "2025/5/26搜索词", "搜索排名")
- Row3: 类型标签 (如 "本周", "本周搜索排名")
- Row4~Row1501: 数据行

**解析规则**: 取 `Col(S+0)` 作为keyword, `Col(S+1)` 作为rank

### Sheet2: "A市场关键词拆解"
- **尺寸**: 1000行 × 149列
- **类目组数**: 15组，每组10列
- **类目组起始列** (1-indexed): 1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141
- **类目名称** (Row1, 格式"关键词拆解--{name}"): 男裤, 裤子男, 裤子男款, 休闲裤男, 卫裤男, 运动裤男, 直筒裤男, 弯刀裤男, 牛仔裤男, 工装裤男, 冰丝裤男, 短裤男, 短袖男, 背心男, 卫衣男
- **列结构与Sheet1完全相同** (10列一组)
- **行结构**: Row1=类目名, Row2=日期标题, Row3=类型标签, Row4+=数据
- **解析规则**: 同Sheet1，类目名需从"关键词拆解--男裤"中提取"男裤"

### Sheet3: "A天猫关键词蓝海词"
- **尺寸**: 112行 × 134列
- **类目组数**: 15组，每组9列 (8数据列+1空分隔列)
- **类目组起始列** (1-indexed): 1, 10, 19, 28, 37, 46, 55, 64, 73, 82, 91, 100, 109, 118, 127
- **类目名称** (Row1): 男裤, 裤子男, 裤子男款, 休闲裤男, 卫裤男, 运动裤男, 直筒裤男, 弯刀裤男, 牛仔裤男, 工装裤男, 冰丝裤男, 短裤男, 短袖男, 背心男, 卫衣男

**每组9列结构** (以组起始列S为基准, 1-indexed):
| 偏移 | 列名 | 数据类型 | 示例 |
|------|------|----------|------|
| S+0 | 蓝海词 | string | "国际一线品牌男裤" |
| S+1 | 搜索人气 | string(范围) | "1200 ~ 2500" 或 "1万 ~ 2万" |
| S+2 | 点击率 | float | 0.55 |
| S+3 | 支付转化率 | string(百分比范围) | "7.5% ~ 10%" |
| S+4 | 支付买家数 | string/number | "10 ~ 50" 或 数字 |
| S+5 | 需求供给比 | float | 902.5 |
| S+6 | 天猫商品点击占比 | float | 0.5866 |
| S+7 | 产品是否匹配 | string/null | NULL |
| S+8 | 空列 | NULL | NULL |

**行结构**: Row1=类目名, Row2=列标题, Row3~Row112=数据

---

## 三、数据模型 (TypeScript Types)

```typescript
// src/core/types.ts

export interface KeywordEntry {
  keyword: string;   // 关键词文本
  rank: number;      // 搜索排名 (1=最好, 数字越小权重越高)
  weight: number;    // 计算权重 (0~100)
}

export interface BlueOceanEntry {
  keyword: string;
  searchPopularity: number;   // 搜索人气(范围中间值)
  clickRate: number;          // 点击率
  conversionRate: number;     // 转化率(范围中间值, 已除100)
  buyerCount: number;         // 买家数(范围中间值)
  supplyDemandRatio: number;  // 需求供给比
  tmallClickShare: number;    // 天猫点击占比
}

export interface CategoryData {
  name: string;
  source: 'market' | 'breakdown' | 'blueocean';
  keywords: KeywordEntry[];
  blueOceanWords?: BlueOceanEntry[];
}

export interface ParseResult {
  categories: CategoryData[];
  errors: string[];
}

export interface TitleScore {
  total: number;              // 总分 0-100
  keywordHits: KeywordHit[];  // 命中关键词列表
  bytesUsed: number;          // 已用GBK字节数
  bytesMax: number;           // 最大60
  suggestions: string[];      // 优化建议
}

export interface KeywordHit {
  keyword: string;
  weight: number;
  matchType: 'exact' | 'partial';
  coverage?: number; // partial时的覆盖率
}
```

---

## 四、Excel解析模块 (精确实现)

### 文件: `src/core/excel-parser.ts`

```typescript
import * as XLSX from 'xlsx';
import { KeywordEntry, BlueOceanEntry, CategoryData, ParseResult } from './types';

// ===== 主入口 =====
export function parseExcelFile(filePath: string): ParseResult {
  const workbook = XLSX.readFile(filePath, { cellFormula: false });
  const errors: string[] = [];
  let allCategories: CategoryData[] = [];

  // Sheet1: 市场词分析表 (9组, 10列/组)
  const ws1 = findSheet(workbook, '市场词分析');
  if (ws1) {
    allCategories.push(...parseRankSheet(ws1, 9, 10, 'market'));
  } else {
    errors.push('未找到包含"市场词分析"的工作表');
  }

  // Sheet2: 关键词拆解 (15组, 10列/组)
  const ws2 = findSheet(workbook, '关键词拆解');
  if (ws2) {
    allCategories.push(...parseRankSheet(ws2, 15, 10, 'breakdown'));
  } else {
    errors.push('未找到包含"关键词拆解"的工作表');
  }

  // Sheet3: 蓝海词 (15组, 9列/组)
  const ws3 = findSheet(workbook, '蓝海词');
  if (ws3) {
    const blueCategories = parseBlueOceanSheet(ws3, 15, 9);
    // 合并蓝海词到同名类目
    for (const bc of blueCategories) {
      const existing = allCategories.find(c => c.name === bc.name);
      if (existing) {
        existing.blueOceanWords = bc.blueOceanWords;
      } else {
        allCategories.push(bc);
      }
    }
  } else {
    errors.push('未找到包含"蓝海词"的工作表');
  }

  return { categories: allCategories, errors };
}

// ===== 查找工作表 =====
function findSheet(wb: XLSX.WorkBook, keyword: string): XLSX.WorkSheet | null {
  const name = wb.SheetNames.find(n => n.includes(keyword));
  return name ? wb.Sheets[name] : null;
}

// ===== Sheet1/Sheet2 解析: 排名型数据 =====
function parseRankSheet(
  ws: XLSX.WorkSheet,
  groupCount: number,
  groupWidth: number,
  source: 'market' | 'breakdown'
): CategoryData[] {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const results: CategoryData[] = [];

  for (let g = 0; g < groupCount; g++) {
    const startCol = g * groupWidth; // 0-indexed for SheetJS

    // 读取类目名 (Row 0, 0-indexed)
    let categoryName = cellStr(ws, 0, startCol);
    if (!categoryName) continue;

    // Sheet2格式: "关键词拆解--男裤" → 取"男裤"
    if (categoryName.includes('--')) {
      categoryName = categoryName.split('--').pop()!.trim();
    }

    // 解析数据行 (从Row3开始, 0-indexed)
    const keywords: KeywordEntry[] = [];
    for (let row = 3; row <= range.e.r; row++) {
      const keyword = cellStr(ws, row, startCol);      // 组内Col+0: 搜索词
      const rank = cellNum(ws, row, startCol + 1);     // 组内Col+1: 搜索排名

      if (!keyword || rank === null || rank <= 0) continue;

      keywords.push({ keyword: keyword.trim(), rank, weight: 0 });
    }

    // 去重(保留rank最小的)
    const deduped = deduplicateKeywords(keywords);

    // 按rank升序排序
    deduped.sort((a, b) => a.rank - b.rank);

    // 计算权重
    const maxRank = deduped.length > 0 ? deduped[deduped.length - 1].rank : 1;
    deduped.forEach(kw => {
      kw.weight = calculateWeight(kw.rank, maxRank);
    });

    if (deduped.length > 0) {
      results.push({ name: categoryName, source, keywords: deduped });
    }
  }

  return results;
}

// ===== Sheet3 解析: 蓝海词 =====
function parseBlueOceanSheet(
  ws: XLSX.WorkSheet,
  groupCount: number,
  groupWidth: number
): CategoryData[] {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const results: CategoryData[] = [];

  for (let g = 0; g < groupCount; g++) {
    const startCol = g * groupWidth; // 0-indexed

    const categoryName = cellStr(ws, 0, startCol);
    if (!categoryName) continue;

    const blueOceanWords: BlueOceanEntry[] = [];
    const keywords: KeywordEntry[] = [];

    // 数据从Row2开始 (0-indexed, 即Excel的Row3)
    for (let row = 2; row <= range.e.r; row++) {
      const keyword = cellStr(ws, row, startCol);
      if (!keyword) continue;

      const searchPop = cellStr(ws, row, startCol + 1);
      const clickRate = cellNum(ws, row, startCol + 2) || 0;
      const convRate = cellStr(ws, row, startCol + 3);
      const buyers = cellStr(ws, row, startCol + 4) ?? cellNum(ws, row, startCol + 4)?.toString() ?? '';
      const supplyDemand = cellNum(ws, row, startCol + 5) || 0;
      const tmallClick = cellNum(ws, row, startCol + 6) || 0;

      blueOceanWords.push({
        keyword,
        searchPopularity: parseRangeString(searchPop),
        clickRate,
        conversionRate: parsePercentRange(convRate),
        buyerCount: parseRangeString(buyers),
        supplyDemandRatio: supplyDemand,
        tmallClickShare: tmallClick,
      });

      // 蓝海词也作为关键词加入(高权重)
      keywords.push({
        keyword,
        rank: row - 1, // 用行号序作为rank
        weight: 80,    // 蓝海词统一高权重
      });
    }

    if (blueOceanWords.length > 0) {
      results.push({
        name: categoryName,
        source: 'blueocean',
        keywords,
        blueOceanWords,
      });
    }
  }

  return results;
}

// ===== 工具函数 =====

function cellStr(ws: XLSX.WorkSheet, row: number, col: number): string | null {
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[ref];
  if (!cell) return null;
  const val = cell.w ?? cell.v;
  if (val === undefined || val === null || val === '') return null;
  return String(val).trim();
}

function cellNum(ws: XLSX.WorkSheet, row: number, col: number): number | null {
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[ref];
  if (!cell) return null;
  if (typeof cell.v === 'number') return cell.v;
  if (typeof cell.v === 'string') {
    const n = parseFloat(cell.v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function deduplicateKeywords(keywords: KeywordEntry[]): KeywordEntry[] {
  const map = new Map<string, KeywordEntry>();
  for (const kw of keywords) {
    const existing = map.get(kw.keyword);
    if (!existing || kw.rank < existing.rank) {
      map.set(kw.keyword, kw);
    }
  }
  return [...map.values()];
}

// 权重公式: rank越小权重越高, 对数衰减
export function calculateWeight(rank: number, maxRank: number): number {
  if (rank <= 0 || maxRank <= 0) return 0;
  const w = 100 * (1 - Math.log(rank) / Math.log(maxRank + 1));
  return Math.max(0, Math.round(w * 100) / 100);
}

// 解析范围字符串: "1200 ~ 2500" → 1850, "1万 ~ 2万" → 15000
export function parseRangeString(str: string | null): number {
  if (!str) return 0;
  if (typeof str === 'number') return str as number;

  const normalize = (s: string): number => {
    s = s.trim();
    if (s.includes('万')) return parseFloat(s.replace('万', '')) * 10000;
    return parseFloat(s) || 0;
  };

  if (str.includes('~')) {
    const [lo, hi] = str.split('~');
    return (normalize(lo) + normalize(hi)) / 2;
  }
  return normalize(str);
}

// 解析百分比范围: "7.5% ~ 10%" → 0.0875
export function parsePercentRange(str: string | null): number {
  if (!str) return 0;
  if (typeof str === 'number') return str as number;

  const normalize = (s: string): number => {
    return (parseFloat(s.trim().replace('%', '')) || 0) / 100;
  };

  if (str.includes('~')) {
    const [lo, hi] = str.split('~');
    return (normalize(lo) + normalize(hi)) / 2;
  }
  return normalize(str);
}
```

---

## 五、评分算法模块

### 文件: `src/core/scoring.ts`

```typescript
import { CategoryData, KeywordEntry, KeywordHit, TitleScore } from './types';

const PREFIX = '帛先生';
const MAX_BYTES = 60;

// ===== GBK字节长度 =====
export function getGBKByteLength(str: string): number {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    bytes += str.charCodeAt(i) <= 0x7F ? 1 : 2;
  }
  return bytes;
}

// ===== 标题评分主函数 =====
export function scoreTitle(titleBody: string, category: CategoryData): TitleScore {
  const fullTitle = PREFIX + titleBody;
  const bytesUsed = getGBKByteLength(fullTitle);

  // 1. 关键词命中检测
  const keywordHits = detectKeywordHits(fullTitle, category.keywords);

  // 2. 计算各维度分数
  const keywordScore = calcKeywordScore(keywordHits, category.keywords);
  const byteScore = calcByteScore(bytesUsed, MAX_BYTES);
  const blueOceanScore = calcBlueOceanScore(fullTitle, category.blueOceanWords);

  // 3. 加权总分: 关键词60% + 字节利用20% + 蓝海词20%
  const total = Math.round(keywordScore * 0.6 + byteScore * 0.2 + blueOceanScore * 0.2);

  // 4. 生成优化建议
  const suggestions = generateSuggestions(fullTitle, category, keywordHits, bytesUsed);

  return { total, keywordHits, bytesUsed, bytesMax: MAX_BYTES, suggestions };
}

// ===== 关键词命中检测 =====
function detectKeywordHits(title: string, keywords: KeywordEntry[]): KeywordHit[] {
  const hits: KeywordHit[] = [];

  for (const kw of keywords) {
    // 精确匹配: 标题完整包含该关键词
    if (title.includes(kw.keyword)) {
      hits.push({ keyword: kw.keyword, weight: kw.weight, matchType: 'exact' });
      continue;
    }

    // 部分匹配: 关键词的连续子串出现在标题中
    const coverage = calcCoverage(title, kw.keyword);
    if (coverage >= 0.5) {
      hits.push({
        keyword: kw.keyword,
        weight: kw.weight * coverage,
        matchType: 'partial',
        coverage,
      });
    }
  }

  return hits;
}

// 计算标题对某个关键词的字符覆盖率
function calcCoverage(title: string, keyword: string): number {
  if (keyword.length <= 1) return title.includes(keyword) ? 1 : 0;

  // 找出keyword中被title覆盖的字符数(连续子串)
  const covered = new Set<number>();

  // 从长子串到短子串扫描
  for (let len = keyword.length - 1; len >= 2; len--) {
    for (let start = 0; start <= keyword.length - len; start++) {
      const sub = keyword.slice(start, start + len);
      if (title.includes(sub)) {
        for (let i = start; i < start + len; i++) covered.add(i);
      }
    }
  }

  return covered.size / keyword.length;
}

// ===== 关键词维度评分 =====
function calcKeywordScore(hits: KeywordHit[], allKeywords: KeywordEntry[]): number {
  if (allKeywords.length === 0) return 0;
  const hitWeightSum = hits.reduce((s, h) => s + h.weight, 0);
  // 基准: top10关键词权重之和
  const top10Sum = allKeywords.slice(0, 10).reduce((s, kw) => s + kw.weight, 0);
  return Math.min(100, (hitWeightSum / Math.max(top10Sum, 1)) * 100);
}

// ===== 字节利用评分 =====
function calcByteScore(used: number, max: number): number {
  if (used > max) return Math.max(0, 50 - (used - max) * 5);
  return (used / max) * 100;
}

// ===== 蓝海词评分 =====
function calcBlueOceanScore(
  title: string,
  blueOceanWords?: import('./types').BlueOceanEntry[]
): number {
  if (!blueOceanWords || blueOceanWords.length === 0) return 50; // 无蓝海词时给中间分
  const hits = blueOceanWords.filter(b => title.includes(b.keyword));
  return Math.min(100, hits.length * 50);
}

// ===== 优化建议生成 =====
function generateSuggestions(
  title: string,
  category: CategoryData,
  hits: KeywordHit[],
  bytesUsed: number
): string[] {
  const suggestions: string[] = [];
  const hitSet = new Set(hits.map(h => h.keyword));

  // 字节问题
  if (bytesUsed > MAX_BYTES) {
    suggestions.push(`标题超出${bytesUsed - MAX_BYTES}字节(当前${bytesUsed}/${MAX_BYTES})，需要缩短`);
  } else if (MAX_BYTES - bytesUsed >= 6) {
    suggestions.push(`还有${MAX_BYTES - bytesUsed}字节空间可用，建议添加更多关键词`);
  }

  // 推荐高权重未命中词
  const unused = category.keywords
    .filter(kw => !hitSet.has(kw.keyword) && kw.weight >= 50)
    .slice(0, 5);
  if (unused.length > 0) {
    suggestions.push(
      `推荐高排名关键词: ${unused.map(k => `「${k.keyword}」(权重${Math.round(k.weight)})`).join('、')}`
    );
  }

  // 推荐蓝海词
  if (category.blueOceanWords) {
    const unusedBlue = category.blueOceanWords
      .filter(b => !title.includes(b.keyword))
      .sort((a, b) => b.supplyDemandRatio - a.supplyDemandRatio)
      .slice(0, 3);
    if (unusedBlue.length > 0) {
      suggestions.push(
        `推荐蓝海词: ${unusedBlue.map(b => `「${b.keyword}」(供需比${Math.round(b.supplyDemandRatio)})`).join('、')}`
      );
    }
  }

  // 高频词根
  const roots = extractRoots(category.keywords.slice(0, 50));
  const unusedRoots = roots.filter(r => !title.includes(r)).slice(0, 5);
  if (unusedRoots.length > 0) {
    suggestions.push(`高频词根未使用: ${unusedRoots.join('、')}`);
  }

  return suggestions;
}

// 从top关键词提取高频2-3字词根
function extractRoots(keywords: KeywordEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const kw of keywords) {
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i <= kw.keyword.length - len; i++) {
        const root = kw.keyword.slice(i, i + len);
        if (/^[\d\s]+$/.test(root)) continue;
        counts.set(root, (counts.get(root) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r)
    .slice(0, 20);
}
```

---

## 六、项目目录结构

```
taobao-title-tool/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron主进程入口
│   │   └── preload.ts            # preload脚本(暴露IPC)
│   ├── renderer/
│   │   ├── index.html
│   │   ├── index.tsx             # React入口
│   │   ├── App.tsx               # 主组件
│   │   ├── index.css             # Tailwind入口
│   │   ├── hooks/
│   │   │   └── useAppState.ts    # 全局状态hook
│   │   └── components/
│   │       ├── FileImporter.tsx   # 文件导入按钮
│   │       ├── CategorySelector.tsx # 类目下拉
│   │       ├── TitleInput.tsx     # 标题输入+字节计数
│   │       ├── ScoreDisplay.tsx   # 评分展示
│   │       ├── Suggestions.tsx    # 优化建议
│   │       └── KeywordList.tsx    # 关键词参考列表
│   └── core/
│       ├── types.ts              # 所有TypeScript类型
│       ├── excel-parser.ts       # Excel解析(上述完整代码)
│       └── scoring.ts            # 评分算法(上述完整代码)
└── resources/
    └── icon.ico
```

---

## 七、Electron主进程

### `src/main/index.ts`
```typescript
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { parseExcelFile } from '../core/excel-parser';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // IPC: 选择文件
  ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // IPC: 解析Excel
  ipcMain.handle('parse-excel', async (_, filePath: string) => {
    try {
      return parseExcelFile(filePath);
    } catch (e: any) {
      return { categories: [], errors: [e.message] };
    }
  });
});

app.on('window-all-closed', () => app.quit());
```

### `src/main/preload.ts`
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  parseExcel: (filePath: string) => ipcRenderer.invoke('parse-excel', filePath),
});
```

---

## 八、React UI组件

### `src/renderer/App.tsx`
```typescript
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ParseResult, CategoryData, TitleScore } from '../core/types';
import { scoreTitle } from '../core/scoring';
import FileImporter from './components/FileImporter';
import CategorySelector from './components/CategorySelector';
import TitleInput from './components/TitleInput';
import ScoreDisplay from './components/ScoreDisplay';
import Suggestions from './components/Suggestions';
import KeywordList from './components/KeywordList';

export default function App() {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState('');
  const [titleBody, setTitleBody] = useState('');
  const [score, setScore] = useState<TitleScore | null>(null);

  const selectedCategory = useMemo(() => {
    if (!parseResult || !selectedCategoryName) return null;
    return parseResult.categories.find(c => c.name === selectedCategoryName) || null;
  }, [parseResult, selectedCategoryName]);

  // 实时评分 (debounce 300ms)
  useEffect(() => {
    if (!selectedCategory || !titleBody.trim()) {
      setScore(null);
      return;
    }
    const timer = setTimeout(() => {
      setScore(scoreTitle(titleBody, selectedCategory));
    }, 300);
    return () => clearTimeout(timer);
  }, [titleBody, selectedCategory]);

  const handleImport = useCallback(async () => {
    const filePath = await (window as any).electronAPI.selectFile();
    if (!filePath) return;
    const result = await (window as any).electronAPI.parseExcel(filePath);
    setParseResult(result);
    if (result.categories.length > 0) {
      setSelectedCategoryName(result.categories[0].name);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-6">淘宝男装标题关键词优化工具</h1>

      <FileImporter onImport={handleImport} hasData={!!parseResult} />

      {parseResult && (
        <>
          <CategorySelector
            categories={parseResult.categories}
            selected={selectedCategoryName}
            onSelect={setSelectedCategoryName}
          />

          <TitleInput value={titleBody} onChange={setTitleBody} score={score} />

          {score && <ScoreDisplay score={score} />}
          {score && <Suggestions suggestions={score.suggestions} />}
          {selectedCategory && <KeywordList category={selectedCategory} />}
        </>
      )}

      {parseResult?.errors && parseResult.errors.length > 0 && (
        <div className="mt-4 p-3 bg-red-900 rounded">
          {parseResult.errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}
    </div>
  );
}
```

### 各组件要点:

**FileImporter**: 一个按钮，点击调用`electronAPI.selectFile()` → `electronAPI.parseExcel()`

**CategorySelector**: `<select>` 下拉，显示所有category.name，选中时触发onSelect。显示当前类目关键词数量。

**TitleInput**: 输入框前显示固定"帛先生"前缀（不可编辑），输入框绑定titleBody。下方实时显示"已使用 X/60 字节"。

**ScoreDisplay**: 显示总分(带颜色编码)，列出所有命中的关键词及权重。

**Suggestions**: 列表展示suggestions数组。

**KeywordList**: 表格展示该类目Top30关键词(keyword, rank, weight)。

---

## 九、测试验证清单

### 解析正确性验证:
| # | 测试 | 预期结果 |
|---|------|----------|
| 1 | Sheet1第1组(帛先生搜索词)关键词数 | ~1497个 |
| 2 | Sheet1第1组第1个关键词 | "帛先生 裤子", rank=1 |
| 3 | Sheet1第2组(男装-大盘词)第1个关键词 | "裤子男", rank=1 |
| 4 | Sheet2第1组(男裤)第1个关键词 | "裤子男", rank=1 |
| 5 | Sheet3第1组(男裤)蓝海词数 | ~110个 |
| 6 | parseRangeString("1200 ~ 2500") | 1850 |
| 7 | parseRangeString("1万 ~ 2万") | 15000 |
| 8 | parseRangeString("5000 ~ 1万") | 7500 |
| 9 | parsePercentRange("7.5% ~ 10%") | 0.0875 |
| 10 | 总类目数 | 9(Sheet1) + 15(Sheet2) = 24 (蓝海词合并到Sheet2类目) |

### 算法正确性验证:
| # | 测试 | 预期结果 |
|---|------|----------|
| 11 | calculateWeight(1, 1500) | ≈100 |
| 12 | calculateWeight(1500, 1500) | ≈0 |
| 13 | getGBKByteLength("帛先生") | 6 |
| 14 | getGBKByteLength("帛先生abc") | 9 |
| 15 | getGBKByteLength("帛先生休闲裤男春季新款2026") | 计算确认<=60 |
| 16 | 标题"休闲裤男春季"对"休闲裤男"类目评分 | 应命中"休闲裤男"等词 |
| 17 | 空标题评分 | total应为低分(仅有byteScore) |
| 18 | 超60字节标题 | suggestions包含超字节警告 |

---

## 十、Sub-Agent执行计划

### 执行顺序图:
```
┌─────────────────┐
│  Agent 1:       │
│  Scaffold       │  → 创建项目骨架，所有配置文件，空组件
│  (先执行)       │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌─────────┐
│ Agent 2 │ │ Agent 3 │  → 可并行
│ Parser  │ │ Scoring │
└────┬────┘ └────┬────┘
     │           │
     └─────┬─────┘
           ▼
    ┌─────────────┐
    │  Agent 4:   │
    │  UI         │  → 实现所有React组件
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  Agent 5:   │
    │  Integration│  → 联调、修bug、验证
    └─────────────┘
```

### Agent 1: Scaffold (项目脚手架)
**Prompt指令**:
```
创建Electron+React+TypeScript+Vite+TailwindCSS项目，目录名taobao-title-tool。
要求:
- package.json含: electron, react, react-dom, xlsx, tailwindcss, vite, electron-builder, typescript等
- 配置vite用于electron renderer进程
- 配置tailwind (暗色主题)
- 主进程src/main/index.ts: 创建窗口+IPC handlers(select-file, parse-excel)
- preload.ts: 暴露electronAPI到渲染进程
- renderer入口: index.html + index.tsx + App.tsx(空壳)
- 创建空文件: src/core/types.ts, src/core/excel-parser.ts, src/core/scoring.ts
- npm run dev能启动空白Electron窗口
```

### Agent 2: DataParser (Excel解析)
**Prompt指令**:
```
实现src/core/excel-parser.ts和src/core/types.ts。
严格按照SPEC第四节的完整代码实现，不做任何简化。
关键要点:
- Sheet1: 9组 × 10列, 起始列0-indexed: 0,10,20,...,80
- Sheet2: 15组 × 10列, 起始列0-indexed: 0,10,20,...,140
- Sheet3: 15组 × 9列, 起始列0-indexed: 0,9,18,...,126
- 数据行从row index 3开始(Sheet1/2)或row index 2开始(Sheet3)
- Col+0=keyword, Col+1=rank (对Sheet1/2)
- 使用cellFormula:false选项读取workbook
- 范围字符串解析必须处理"万"单位
```

### Agent 3: Scoring (评分算法)
**Prompt指令**:
```
实现src/core/scoring.ts。
严格按照SPEC第五节的完整代码实现。
关键要点:
- PREFIX固定"帛先生"
- GBK字节: ASCII=1, 其他=2
- 命中检测: 先exact(title.includes(keyword)), 再partial(覆盖率>=50%)
- 总分 = 关键词60% + 字节利用20% + 蓝海词20%
- 建议包含: 字节提示、高权重未命中词、蓝海词推荐、高频词根
```

### Agent 4: UI (React组件)
**Prompt指令**:
```
实现src/renderer/下所有组件，严格按照SPEC第八节。
要求:
- App.tsx: 完整状态管理，debounce 300ms评分
- FileImporter: 按钮调用electronAPI
- CategorySelector: select下拉，显示关键词数
- TitleInput: 固定"帛先生"前缀 + 输入框 + 字节计数
- ScoreDisplay: 总分(>=80绿/60-79黄/<60红) + 命中列表
- Suggestions: 建议列表
- KeywordList: Top30关键词表格
- TailwindCSS暗色主题
- 注意: scoring模块在渲染进程中直接import使用（纯函数，无需IPC）
```

### Agent 5: Integration (联调)
**Prompt指令**:
```
联调整个项目:
1. 确保npm run dev能启动
2. 导入实际Excel文件验证解析结果
3. 按SPEC第九节测试清单逐项验证
4. 修复所有类型错误和运行时错误
5. 确保评分实时更新
6. 验证electron-builder打包配置
注意: scoring可以直接在renderer进程import，不需要走IPC
```

---

## 十一、常见陷阱提醒

1. **SheetJS的行列是0-indexed**: `encode_cell({r:0, c:0})` = "A1"
2. **Excel列号是1-indexed但SheetJS是0-indexed**: 文档说"Col1"指Excel界面第1列=SheetJS的c:0
3. **不要用sheet_to_json**: 水平多组布局无法用json方式解析，必须逐单元格读取
4. **公式单元格**: 用`cellFormula: false`或`data_only`模式，某些公式可能无法计算出值
5. **空行跳过**: 数据末尾可能有空行，keyword为null时continue
6. **中文空格**: 某些关键词含空格如"帛先生 裤子"，不要trim掉中间空格
7. **Electron的IPC序列化**: 传输的数据必须是JSON可序列化的(无函数、无循环引用)
8. **Vite + Electron**: 需要vite-plugin-electron或类似插件来协调dev server和electron
9. **preload必须编译为js**: preload脚本需要单独编译，不能直接用ts
