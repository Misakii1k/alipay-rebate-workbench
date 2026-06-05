import type {
  TitleAnalyzePayload,
  TitleAnalysisResult,
  TitleCandidate,
  TitleCandidateMode,
  TitleGenerationStrategy,
  TitleGenerationDiagnostics,
  TitleKeywordData,
  TitleKeywordEntry,
  TitleKeywordHit,
  TitleProductProfile,
  TitleRecommendation,
  TitleRuleCheck,
  TitleScoreBreakdown,
  TitleScoreResult,
  SubstringHit
} from "./shared";

export const TITLE_PREFIX = "帛先生";
export const TITLE_BODY_TARGET_BYTES = 54;
export const TITLE_TOTAL_TARGET_BYTES = 60;

const THIRD_PARTY_BRANDS = [
  "海澜之家",
  "优衣库",
  "李维斯",
  "耐克",
  "阿迪达斯",
  "斐乐",
  "森马",
  "美特斯邦威",
  "太平鸟",
  "安踏",
  "李宁",
  "特步",
  "361",
  "班尼路",
  "龙牙",
  "美拉德",
  "增致",
  "官方旗舰店",
  "旗舰店",
  "专柜",
  "大牌",
  "品牌",
  "国际一线",
  "gxg",
  "fila",
  "nike",
  "adidas",
  "uniqlo",
  "levi"
];

const SEASONS = ["春季", "夏季", "秋季", "冬季", "春秋", "四季", "早春", "初秋", "春夏", "秋冬"];
const SEASON_CHARS = ["春", "夏", "秋", "冬"];
const SUPPLEMENT_WORDS = ["薄款", "垂感", "凉感", "2026新款", "运动", "宽松", "阔腿"];
const GENERIC_FILLERS = ["百搭", "通勤", "潮流", "高级感", "小个子", "不挑人", "舒适", "显瘦", "松紧腰", "大码", "商务", "休闲"];
const SHORT_FILLERS = ["透气", "百搭", "男", "款", "新款", "春夏", "潮牌", "冰丝", "尼龙", "中裤", "加长"];
const TEMPLATE_PHRASES = [
  "裤子男款",
  "男士裤子",
  "男裤",
  "直筒裤",
  "休闲裤",
  "运动裤",
  "阔腿裤",
  "五分裤",
  "短裤",
  "卫裤",
  "冰丝凉感",
  "棉麻亚麻",
  "夏季薄款",
  "薄款凉感"
];

// These are style/order priors distilled from proven titles. They guide ordering
// and seed selection, while the final title still comes from current Excel data.
const EXAMPLE_STYLE_BLUEPRINTS = [
  ["夏季", "薄款", "凉感", "棉麻", "短裤", "亚麻", "裤子男款", "2026新款", "直筒", "休闲", "运动裤"],
  ["夏季", "薄款", "亚麻", "裤子男款", "2026新款", "凉感", "休闲裤", "直筒裤", "棉麻", "阔腿裤"],
  ["亚麻", "短裤", "男款", "夏季", "薄款", "裤子", "棉麻", "透气", "凉感", "直筒", "休闲", "五分", "运动裤"],
  ["冰丝", "凉感", "裤子男款", "直筒裤", "休闲裤", "垂感", "运动", "卫裤"],
  ["速干", "直筒裤", "男款", "夏季", "薄款", "阔腿裤", "2026新款", "休闲裤", "裤子", "冰丝", "运动裤"],
  ["薄款", "裤子男款", "2026新款", "夏季", "直筒裤", "休闲裤", "卫裤", "阔腿", "弯刀", "香蕉裤"]
];

const MODE_LABEL: Record<TitleCandidateMode, string> = {
  traffic: "流量型",
  precise: "精准型",
  category: "类目大词",
  "blue-ocean": "蓝海型",
  legacy: "旧版对照"
};

const BEAM_WIDTH = 34;
const BEAM_TOKEN_LIMIT = 40;
const DP_WIDTH_PER_BYTE = 10;
const DP_ADDITION_LIMIT = 84;
const TOTAL_POOL_LIMIT = 150;

type TokenSource = "rule" | "excel" | "blue-ocean" | "supplement" | "product" | "filler";

interface TokenOption {
  text: string;
  weight: number;
  source: TokenSource;
  required?: boolean;
}

interface WorkingCandidate {
  mode: TitleCandidateMode;
  tokens: string[];
  body: string;
  score: number;
}

interface TokenPoolResult {
  rawSize: number;
  options: TokenOption[];
}

interface GenerationContext {
  data: TitleKeywordData;
  product: TitleProductProfile;
  selectedCategory?: string;
  requestedCategory?: string;
  scoreEntries: TitleKeywordEntry[];
  keywordIndex: Map<string, TitleKeywordEntry>;
  tokenValueCache: Map<string, number>;
  scoreCache: Map<string, number>;
  overlapRoots?: Map<string, number>;
  exactFitCount: number;
  diagnostics: TitleGenerationDiagnostics;
}

interface BeamState {
  tokens: string[];
  score: number;
  bytes: number;
}

interface DpState {
  tokens: string[];
  value: number;
  key: string;
}

const byteLengthCache = new Map<string, number>();
const normalizeCache = new Map<string, string>();
const sanitizeCache = new Map<string, string>();

export function getGBKByteLength(value: string): number {
  const cached = byteLengthCache.get(value);
  if (cached !== undefined) return cached;
  let bytes = 0;
  for (const char of value) bytes += char.charCodeAt(0) <= 0x7f ? 1 : 2;
  remember(byteLengthCache, value, bytes);
  return bytes;
}

export function normalizeTitleText(value: string): string {
  const raw = String(value ?? "");
  const cached = normalizeCache.get(raw);
  if (cached !== undefined) return cached;
  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）[\]【】,，.。:：;；、/\\_\-—|"'“”‘’\r\n\t]/g, "");
  remember(normalizeCache, raw, normalized);
  return normalized;
}

export function sanitizeTitleKeyword(value: string): string {
  const raw = String(value ?? "");
  const cached = sanitizeCache.get(raw);
  if (cached !== undefined) return cached;
  const sanitized = raw
    .replace(/\s+/g, "")
    .replace(/[()（）[\]【】,，.。:：;；、/\\_\-—|"'“”‘’\r\n\t]/g, "")
    .trim();
  remember(sanitizeCache, raw, sanitized);
  return sanitized;
}

export function containsThirdPartyBrand(value: string): boolean {
  const normalized = normalizeTitleText(value);
  return THIRD_PARTY_BRANDS.some((brand) => normalized.includes(normalizeTitleText(brand)));
}

export function parseTitleProduct(productName: string): TitleProductProfile {
  const normalizedName = normalizeTitleText(productName);
  const season = SEASONS.find((item) => normalizedName.includes(item))
    ?? SEASON_CHARS.find((ch) => normalizedName.includes(ch))
    ?? "";
  const model = normalizedName.match(/[a-z]*\d+[a-z]*/i)?.[0] ?? "";
  const series = normalizedName.includes("彩棉")
    ? model
      ? `彩棉${model}`
      : "彩棉"
    : normalizedName.includes("百叶")
      ? model
        ? `百叶${model}`
        : "百叶"
      : model;
  const materials = ["棉麻", "亚麻", "纯棉", "彩棉", "冰丝", "天丝", "速干", "尼龙", "牛仔", "灯芯绒"].filter((item) => normalizedName.includes(item));
  const features = [
    ...new Set(
      [...SUPPLEMENT_WORDS, "束脚", "松紧腰", "小脚", "阔腿", "直筒", "五分", "弯刀", "香蕉", "透气", "加长"].filter((item) => normalizedName.includes(item))
    )
  ];
  const category = /短裤|五分裤|中裤/.test(normalizedName)
    ? "shorts"
    : /长裤|卫裤|休闲裤|直筒裤|运动裤|阔腿裤|弯刀裤|香蕉裤|西裤/.test(normalizedName)
      ? "long-pants"
      : /裤/.test(normalizedName)
        ? "pants"
        : /短袖|t恤|背心|卫衣|衬衫/.test(normalizedName)
          ? "top"
          : "unknown";
  return {
    originalName: productName,
    normalizedName,
    season,
    series,
    model,
    materials,
    category,
    features
  };
}

export function generateTitleScore(
  data: TitleKeywordData,
  productName: string,
  categoryName?: string,
  variantCount = 3,
  extraKeywords?: string[],
  strategy: TitleGenerationStrategy = "legacy",
  targetKeywords?: string[]
): TitleScoreResult {
  if (strategy === "stacked-v2") {
    return generateStackedTitleScore(data, productName, categoryName, variantCount, extraKeywords, targetKeywords);
  }
  const startedAt = Date.now();
  const product = parseTitleProduct(productName);
  const diagnostics: TitleGenerationDiagnostics = { poolSize: 0, recalledSize: 0, generatedCount: 0, elapsedMs: 0, exactFitCount: 0 };
  const blockingRules = evaluateTitleRules("", product).filter((rule) => rule.required && !rule.passed && rule.key === "season");
  if (!productName.trim()) {
    return { ok: false, message: "请先输入商品名。", product, candidates: [], warnings: data.warnings, diagnostics };
  }
  if (blockingRules.length > 0) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    return { ok: false, message: "商品名里缺少季节，请补充春季、夏季、秋季、冬季或春秋后再生成。", product, candidates: [], warnings: data.warnings, diagnostics };
  }

  const category = selectCategory(data, product, categoryName);
  const context = createGenerationContext(data, product, category?.name, categoryName, diagnostics);
  const poolResult = buildTokenPool(context, extraKeywords);
  diagnostics.poolSize = poolResult.rawSize;
  diagnostics.recalledSize = poolResult.options.length;

  const rawCandidates = generateWorkingCandidates(poolResult.options, context);
  const finals = rawCandidates
    .map((candidate, index) => toTitleCandidate(candidate, product, data, category?.name, index, context))
    .filter((candidate): candidate is TitleCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  const unique = dedupeCandidates(finals).slice(0, Math.max(variantCount, 3));
  diagnostics.generatedCount = unique.length;
  diagnostics.exactFitCount = context.exactFitCount;
  diagnostics.elapsedMs = Date.now() - startedAt;

  return {
    ok: unique.length > 0,
    message: unique.length ? "已生成优化标题候选。" : "硬规则词较多，未能拼出合格标题。",
    product,
    selectedCategory: category?.name,
    candidates: unique,
    warnings: [
      ...data.warnings,
      ...(unique.length ? [] : ["请减少商品名里的冲突属性，或补充更明确的品类/季节后重试。"])
    ],
    diagnostics
  };
}

export function analyzeTitleScore(
  data: TitleKeywordData,
  payload: TitleAnalyzePayload,
  extraKeywords?: string[],
  strategy: TitleGenerationStrategy = payload.strategy ?? "legacy",
  targetKeywords?: string[]
): TitleAnalysisResult {
  const startedAt = Date.now();
  const title = normalizeSubmittedTitle(payload.title);
  const product = parseTitleProduct(payload.productName || title);
  const diagnostics: TitleGenerationDiagnostics = { poolSize: 0, recalledSize: 0, generatedCount: 0, elapsedMs: 0, exactFitCount: 0 };
  if (!title) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    return {
      ok: false,
      message: "请先粘贴需要分析的完整标题。",
      product,
      selectedCategory: undefined,
      title: "",
      body: "",
      bodyBytes: 0,
      totalBytes: 0,
      score: 0,
      grade: "blocked",
      candidate: null,
      recommendations: [{ type: "missing-element" as const, message: "缺少标题", detail: "无法进行字节、规则和关键词命中分析", estimatedGain: 0 }],
      substringHits: [],
      suggestedTitles: [],
      warnings: data.warnings,
      diagnostics
    };
  }

  const category = selectCategory(data, product, payload.categoryName);
  const context = createGenerationContext(data, product, category?.name, payload.categoryName, diagnostics);
  const poolResult = buildTokenPool(context, extraKeywords);
  diagnostics.poolSize = poolResult.rawSize;
  diagnostics.recalledSize = poolResult.options.length;

  const body = stripPrefix(title);
  const ruleChecks = evaluateTitleRules(title, product);
  const keywordHits = detectKeywordHits(title, data, context.scoreEntries);
  const substringHits = scanSubstringHits(title, context.keywordIndex);
  const { score, breakdown } = scoreAnalyzedTitle(title, product, ruleChecks, keywordHits, context);
  const grade = titleGrade(score, ruleChecks);
  const recommendations = buildAnalysisRecommendations(title, product, ruleChecks, keywordHits, category?.name, context);
  const endingAdvice = buildEndingAdvice(title, product);

  const uniqueSuggested = strategy === "stacked-v2"
    ? generateStackedTitleScore(data, payload.productName || title, payload.categoryName, 5, extraKeywords, targetKeywords ?? payload.targetKeywords).candidates.filter((c) => c.title !== title).slice(0, 5)
    : dedupeCandidates(
        generateWorkingCandidates(poolResult.options, context)
          .map((c, i) => toTitleCandidate(c, product, data, category?.name, i, context))
          .filter((c): c is TitleCandidate => c !== null)
          .filter((c) => c.title !== title)
          .sort((a, b) => b.score - a.score)
      ).slice(0, 5);

  diagnostics.generatedCount = 1 + uniqueSuggested.length;
  diagnostics.elapsedMs = Date.now() - startedAt;

  const candidate: TitleCandidate = {
    id: `analysis-${Math.abs(hashText(title))}`,
    mode: "precise",
    label: "标题分析",
    title,
    body,
    bodyBytes: getGBKByteLength(body),
    totalBytes: getGBKByteLength(title),
    score,
    tokens: extractAnalysisTokens(title, product, keywordHits),
    ruleChecks,
    keywordHits: keywordHits.slice(0, 24),
    substringHits: substringHits.slice(0, 30),
    recommendations,
    suggestions: recommendations.map((r) => r.message)
  };

  return {
    ok: true,
    message: grade === "blocked" ? "标题存在硬规则问题，不建议直接使用。" : "标题分析完成。",
    product,
    selectedCategory: category?.name,
    title,
    body,
    bodyBytes: candidate.bodyBytes,
    totalBytes: candidate.totalBytes,
    score,
    scoreBreakdown: breakdown,
    grade,
    candidate,
    recommendations,
    substringHits: substringHits.slice(0, 30),
    suggestedTitles: uniqueSuggested,
    endingAdvice,
    warnings: data.warnings,
    diagnostics
  };
}

export function scoreTitleCandidate(title: string, data: TitleKeywordData, product: TitleProductProfile, context?: GenerationContext): number {
  const cacheKey = title;
  const cached = context?.scoreCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const entries = context?.scoreEntries ?? collectScoreEntries(data, product, undefined, undefined);
  const hits = detectKeywordHits(title, data, entries);
  const ruleChecks = evaluateTitleRules(title, product);
  const ruleScore = ruleChecks.every((rule) => !rule.required || rule.passed) ? 150 : -400;
  const idx = context?.keywordIndex ?? buildKeywordIndex(data);
  const subHits = scanSubstringHits(title, idx);
  const stackingValue = subHits.reduce((sum, h) => sum + h.value, 0);
  const hitScore = hits.slice(0, 30).reduce((sum, hit) => sum + hit.weight * (hit.matchType === "exact" ? 1 : hit.matchType === "ordered" ? 0.5 : 0.2), 0);
  const readabilityScore = scoreReadability(title);
  const bodyBytesNow = getGBKByteLength(stripPrefix(title));
  const byteScore = bodyBytesNow === TITLE_BODY_TARGET_BYTES
    ? 200
    : bodyBytesNow > TITLE_BODY_TARGET_BYTES
      ? Math.max(-400, 160 - (bodyBytesNow - TITLE_BODY_TARGET_BYTES) * 50)
      : Math.max(-200, 160 - (TITLE_BODY_TARGET_BYTES - bodyBytesNow) * 30);
  const endingScore = titleEndingScore(title, product);
  const score = Math.round(ruleScore + stackingValue * 2 + hitScore + readabilityScore + byteScore + endingScore);
  context?.scoreCache.set(cacheKey, score);
  return score;
}

function createGenerationContext(
  data: TitleKeywordData,
  product: TitleProductProfile,
  selectedCategory: string | undefined,
  requestedCategory: string | undefined,
  diagnostics: TitleGenerationDiagnostics
): GenerationContext {
  const scoreEntries = collectScoreEntries(data, product, selectedCategory, requestedCategory);
  return {
    data,
    product,
    selectedCategory,
    requestedCategory,
    scoreEntries,
    keywordIndex: buildKeywordIndex(data),
    tokenValueCache: new Map(),
    scoreCache: new Map(),
    exactFitCount: 0,
    diagnostics
  };
}

function selectCategory(data: TitleKeywordData, product: TitleProductProfile, categoryName?: string) {
  if (categoryName) {
    const direct = data.categories.find((item) => item.name === categoryName);
    if (direct) return direct;
  }
  const categoryHints = categoryHintsForProduct(product);
  return [...data.categories]
    .map((category) => {
      const name = normalizeTitleText(category.name);
      const nameScore = categoryHints.reduce((sum, hint) => sum + (name.includes(normalizeTitleText(hint)) ? 60 : 0), 0);
      const keywordScore = category.keywords.slice(0, 90).reduce((sum, entry) => sum + (keywordFitsProduct(entry.keyword, product) ? entry.weight : 0), 0);
      return { category, score: nameScore + keywordScore };
    })
    .sort((a, b) => b.score - a.score)[0]?.category;
}

function categoryHintsForProduct(product: TitleProductProfile) {
  if (product.category === "shorts") return ["短裤", "五分裤", "裤子男", "男裤"];
  if (product.category === "long-pants") return ["休闲裤", "卫裤", "直筒裤", "运动裤", "裤子男", "男裤", "西裤"];
  if (product.category === "pants") return ["裤子男", "男裤", "休闲裤"];
  if (product.category === "top") return ["男装", "短袖", "卫衣", "背心"];
  return ["帛先生", "男装", "裤子男", "男裤"];
}

function collectScoreEntries(data: TitleKeywordData, product: TitleProductProfile, selectedCategory?: string, requestedCategory?: string): TitleKeywordEntry[] {
  const categories = selectRelevantCategories(data, product, selectedCategory, requestedCategory);
  const entries = categories.flatMap((category) => [...category.keywords.slice(0, 180), ...category.blueOceanWords.slice(0, 90)]);
  const fitted = data.categories
    .flatMap((category) => [...category.keywords.slice(0, 45), ...category.blueOceanWords.slice(0, 30)])
    .filter((entry) => keywordFitsProduct(entry.keyword, product));
  return dedupeTitleEntries([...entries, ...fitted])
    .sort((a, b) => entryRelevanceScore(b, product, selectedCategory) - entryRelevanceScore(a, product, selectedCategory))
    .slice(0, 720);
}

function selectRelevantCategories(data: TitleKeywordData, product: TitleProductProfile, selectedCategory?: string, requestedCategory?: string) {
  const hints = categoryHintsForProduct(product).map(normalizeTitleText);
  return [...data.categories]
    .map((category) => {
      const name = normalizeTitleText(category.name);
      const direct = category.name === selectedCategory || category.name === requestedCategory ? 500 : 0;
      const hintScore = hints.reduce((sum, hint) => sum + (name.includes(hint) ? 120 : 0), 0);
      const fitScore = category.keywords.slice(0, 60).reduce((sum, entry) => sum + (keywordFitsProduct(entry.keyword, product) ? 8 : 0), 0);
      return { category, score: direct + hintScore + fitScore };
    })
    .sort((a, b) => b.score - a.score || b.category.keywordCount - a.category.keywordCount)
    .slice(0, 6)
    .map((item) => item.category);
}

function buildTokenPool(context: GenerationContext, extraKeywords?: string[]): TokenPoolResult {
  const { product, selectedCategory, requestedCategory } = context;
  const options: TokenOption[] = [];
  const push = (text: string, weight: number, source: TokenSource, required = false) => {
    const cleaned = sanitizeTitleKeyword(text);
    if (!isUsableToken(cleaned, required)) return;
    options.push({ text: cleaned, weight, source, required });
  };

  const required = lockedWordsForProduct(product);
  const priority = priorityWordsForProduct(product);
  for (const word of required) push(word, 500, "rule", true);
  for (const word of priority) push(word, 260, "rule");
  if (product.series) push(product.series, 185, "product");
  if (product.model) push(product.model, 155, "product");
  for (const material of product.materials) push(material, 180, "product");
  for (const feature of product.features) push(feature, 135, "product");
  for (const phrase of TEMPLATE_PHRASES) push(phrase, templatePhraseWeight(phrase, product), "supplement");

  const categorized = context.scoreEntries
    .map((entry) => ({ entry, score: entryRelevanceScore(entry, product, selectedCategory) }))
    .filter(({ entry, score }) => score >= 35 || entry.category === selectedCategory || entry.category === requestedCategory)
    .sort((a, b) => b.score - a.score);

  let marketCount = 0;
  let breakdownCount = 0;
  let blueCount = 0;
  for (const { entry, score } of categorized) {
    if (entry.source === "blue-ocean") {
      if (blueCount >= 42) continue;
      push(entry.keyword, score + 24, "blue-ocean");
      blueCount += 1;
    } else if (entry.source === "breakdown") {
      if (breakdownCount >= 48) continue;
      push(entry.keyword, score + 12, "excel");
      breakdownCount += 1;
    } else {
      if (marketCount >= 54) continue;
      push(entry.keyword, score, "excel");
      marketCount += 1;
    }
  }
  for (const word of SUPPLEMENT_WORDS) push(word, 95 + productFitBonus(word, product), "supplement");
  for (const word of GENERIC_FILLERS) push(word, 55 + productFitBonus(word, product), "filler");
  for (const word of SHORT_FILLERS) push(word, 48 + productFitBonus(word, product), "filler");

  const extras = (extraKeywords ?? [])
    .map((word) => sanitizeTitleKeyword(word))
    .filter((word) => word.length >= 2 && word.length <= 8 && !containsThirdPartyBrand(word));
  for (const word of extras) push(word, 240 + productFitBonus(word, product), "supplement");

  const weighted = dedupeTokens(options)
    .map((token) => ({ ...token, weight: token.weight + productFitBonus(token.text, product) + byteEfficiencyBonus(token.text) }))
    .sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)) || b.weight - a.weight);

  return {
    rawSize: weighted.length,
    options: compressTokenPool(weighted, context)
  };
}

export function previewTokenPool(data: TitleKeywordData, productName: string, categoryName?: string): Array<{ text: string; weight: number; source: string }> {
  if (!productName.trim()) return [];
  const product = parseTitleProduct(productName);
  const category = selectCategory(data, product, categoryName);
  const diagnostics: TitleGenerationDiagnostics = { poolSize: 0, recalledSize: 0, generatedCount: 0, elapsedMs: 0, exactFitCount: 0 };
  const context = createGenerationContext(data, product, category?.name, categoryName, diagnostics);
  const poolResult = buildTokenPool(context);
  return poolResult.options.map((token) => ({ text: token.text, weight: Math.round(token.weight), source: token.source }));
}

function compressTokenPool(tokens: TokenOption[], context: GenerationContext) {
  const required = tokens.filter((token) => token.required);
  const bucketLimits: Record<TokenSource, number> = {
    rule: 22,
    product: 18,
    excel: 62,
    "blue-ocean": 36,
    supplement: 24,
    filler: 22
  };
  const selected: TokenOption[] = [];
  const countBySource = new Map<TokenSource, number>();

  const tryAdd = (token: TokenOption) => {
    const sourceCount = countBySource.get(token.source) ?? 0;
    if (!token.required && sourceCount >= bucketLimits[token.source]) return;
    if (!token.required && selected.some((item) => areNearDuplicateTokens(item.text, token.text))) return;
    selected.push(token);
    countBySource.set(token.source, sourceCount + 1);
  };

  for (const token of required) tryAdd(token);
  for (const token of tokens.filter((token) => !token.required)) tryAdd(token);

  const hard = selected.filter((token) => token.required);
  const rest = selected
    .filter((token) => !token.required)
    .sort((a, b) => tokenValue(b.text, context) - tokenValue(a.text, context));
  return [...hard, ...rest].slice(0, Math.max(hard.length, TOTAL_POOL_LIMIT));
}

function generateWorkingCandidates(pool: TokenOption[], context: GenerationContext): WorkingCandidate[] {
  const seeds = createSeedOrders(context.product, pool);
  const candidates: WorkingCandidate[] = [];
  for (const seed of seeds) {
    const modePool = modeOrderedPool(seed.mode, pool, context);
    const beamStates = runSmallBeam(seed.tokens, seed.mode, modePool, context);
    for (const state of beamStates) {
      const fitted = fitTokensToTarget(state.tokens, pool, context);
      if (!fitted) continue;
      candidates.push({
        mode: seed.mode,
        tokens: fitted.tokens,
        body: fitted.body,
        score: scoreTitleCandidate(TITLE_PREFIX + fitted.body, context.data, context.product, context)
      });
    }
  }
  return dedupeWorkingCandidates(candidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, 42);
}

function createSeedOrders(product: TitleProductProfile, pool: TokenOption[]) {
  const required = requiredWordsForProduct(product);
  const priority = priorityWordsForProduct(product);
  const exampleSeeds = EXAMPLE_STYLE_BLUEPRINTS.map((blueprint) => blueprint.filter((token) => tokenAppliesToProduct(token, product)));
  const poolTexts = pool.map((token) => token.text);
  const topTraffic = pool.filter((token) => token.source === "excel").slice(0, 18).map((token) => token.text);
  const topPrecise = pool.filter((token) => token.source === "product" || token.source === "rule" || tokenAppliesToProduct(token.text, product)).slice(0, 18).map((token) => token.text);
  const topBlue = pool.filter((token) => token.source === "blue-ocean").slice(0, 18).map((token) => token.text);
  const base = [
    product.season,
    product.category === "shorts" ? "短裤" : "",
    product.normalizedName.includes("棉麻") || product.normalizedName.includes("彩棉") ? "棉麻" : "",
    product.normalizedName.includes("棉麻") || product.normalizedName.includes("彩棉") ? "亚麻" : "",
    product.normalizedName.includes("彩棉") ? "纯棉" : "",
    product.normalizedName.includes("百叶317") ? "速干" : "",
    product.category === "long-pants" || product.category === "pants" ? "裤子男款" : "",
    product.category === "shorts" ? "裤子男款" : "",
    product.season && product.season.includes("夏") ? "薄款" : "",
    product.season && product.season.includes("夏") ? "凉感" : "",
    "直筒裤",
    product.category === "long-pants" ? "休闲裤" : "",
    product.category === "long-pants" ? "卫裤" : ""
  ].filter(Boolean);

  return [
    { mode: "traffic" as const, tokens: [...base, ...exampleSeeds[0], ...topTraffic, ...poolTexts.slice(0, 16)] },
    { mode: "traffic" as const, tokens: [...required, ...priority, ...exampleSeeds[1], ...topTraffic] },
    { mode: "precise" as const, tokens: [...required, ...priority, ...exampleSeeds[2], ...topPrecise] },
    { mode: "precise" as const, tokens: [...base, ...product.features, ...topPrecise] },
    { mode: "blue-ocean" as const, tokens: [...required, ...priority, ...exampleSeeds[4], ...topBlue, ...topTraffic.slice(0, 10)] },
    { mode: "blue-ocean" as const, tokens: [...base, ...exampleSeeds[5], ...topBlue] }
  ];
}

function modeOrderedPool(mode: TitleCandidateMode, pool: TokenOption[], context: GenerationContext) {
  return [...pool]
    .filter((token) => !token.required)
    .sort((a, b) => {
      const modeBoostA = modeTokenBoost(a, mode, context.product);
      const modeBoostB = modeTokenBoost(b, mode, context.product);
      return modeBoostB - modeBoostA || tokenValue(b.text, context) - tokenValue(a.text, context);
    })
    .slice(0, BEAM_TOKEN_LIMIT);
}

function runSmallBeam(seedTokens: string[], mode: TitleCandidateMode, modePool: TokenOption[], context: GenerationContext): BeamState[] {
  const required = lockedWordsForProduct(context.product);
  const startTokens = normalizeTokenList([...required, ...seedTokens], context.product);
  const trimmed = trimTokensToBudget(startTokens, required, context);
  let states: BeamState[] = [makeBeamState(trimmed, mode, context)].filter((state): state is BeamState => Boolean(state));

  for (const option of modePool) {
    const nextStates = [...states];
    for (const state of states) {
      if (state.tokens.some((token) => token.includes(option.text) || option.text.includes(token))) continue;
      const tokens = normalizeTokenList([...state.tokens, option.text], context.product);
      if (!requiredCovered(tokens.join(""), required)) continue;
      const next = makeBeamState(tokens, mode, context);
      if (next) nextStates.push(next);
    }
    states = dedupeBeamStates(nextStates)
      .sort((a, b) => b.score - a.score)
      .slice(0, BEAM_WIDTH);
  }

  return states
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function makeBeamState(tokens: string[], mode: TitleCandidateMode, context: GenerationContext): BeamState | null {
  const body = tokens.join("");
  const bytes = getGBKByteLength(body);
  if (bytes > TITLE_BODY_TARGET_BYTES) return null;
  return {
    tokens,
    bytes,
    score: estimateSkeletonScore(tokens, mode, context)
  };
}

function estimateSkeletonScore(tokens: string[], mode: TitleCandidateMode, context: GenerationContext) {
  const body = tokens.join("");
  const bytes = getGBKByteLength(body);
  const value = tokens.reduce((sum, token) => sum + tokenValue(token, context), 0);
  const modeBonus = mode === "blue-ocean" && tokens.some((token) => tokenSource(token, context) === "blue-ocean") ? 120 : 0;
  const byteBonus = Math.max(0, 80 - Math.abs(TITLE_BODY_TARGET_BYTES - bytes) * 3);
  return value + modeBonus + byteBonus + scoreReadability(TITLE_PREFIX + body);
}

function fitTokensToTarget(seedTokens: string[], pool: TokenOption[], context: GenerationContext): { tokens: string[]; body: string } | null {
  const required = lockedWordsForProduct(context.product);
  let tokens = normalizeTokenList([...required, ...seedTokens], context.product).filter((token) => token && !containsThirdPartyBrand(token));
  tokens = trimTokensToBudget(tokens, required, context);
  const body = tokens.join("");
  if (getGBKByteLength(body) > TITLE_BODY_TARGET_BYTES || !requiredCovered(body, required)) return null;

  const exact = fillToExactBytes(tokens, required, pool, context);
  if (!exact) return null;
  const ruleChecks = evaluateTitleRules(TITLE_PREFIX + exact.body, context.product);
  if (ruleChecks.some((rule) => rule.required && !rule.passed)) return null;
  context.exactFitCount += 1;
  return exact;
}

function fillToExactBytes(tokens: string[], required: string[], pool: TokenOption[], context: GenerationContext): { tokens: string[]; body: string } | null {
  const baseTokens = normalizeTokenList(tokens, context.product);
  const baseBody = baseTokens.join("");
  const baseBytes = getGBKByteLength(baseBody);
  if (baseBytes >= TITLE_BODY_TARGET_BYTES - 4 && baseBytes <= TITLE_BODY_TARGET_BYTES) return { tokens: baseTokens, body: baseBody };
  if (baseBytes > TITLE_BODY_TARGET_BYTES) return null;

  const additions = buildExactFillAdditions(baseTokens, pool, context)
    .filter((text) => getGBKByteLength(text) <= TITLE_BODY_TARGET_BYTES - baseBytes)
    .slice(0, DP_ADDITION_LIMIT);
  const dp = new Map<number, DpState[]>();
  dp.set(baseBytes, [{ tokens: baseTokens, value: baseTokens.reduce((sum, token) => sum + tokenValue(token, context), 0), key: tokenKey(baseTokens) }]);

  for (const addition of additions) {
    const additionBytes = getGBKByteLength(addition);
    const additionValue = tokenValue(addition, context);
    const snapshot = [...dp.entries()];
    for (const [bytes, states] of snapshot) {
      const nextBytes = bytes + additionBytes;
      if (nextBytes > TITLE_BODY_TARGET_BYTES) continue;
      for (const state of states) {
        if (state.tokens.some((token) => token.includes(addition) || addition.includes(token))) continue;
        const nextTokens = normalizeTokenList([...state.tokens, addition], context.product);
        const body = nextTokens.join("");
        if (getGBKByteLength(body) !== nextBytes) continue;
        if (!requiredCovered(body, required)) continue;
        insertDpState(dp, nextBytes, { tokens: nextTokens, value: state.value + additionValue, key: tokenKey(nextTokens) });
      }
    }
  }

  const minAcceptable = TITLE_BODY_TARGET_BYTES - 4;
  let bestResult: { tokens: string[]; body: string; score: number } | null = null;
  for (let targetBytes = TITLE_BODY_TARGET_BYTES; targetBytes >= minAcceptable; targetBytes -= 2) {
    const states = dp.get(targetBytes) ?? [];
    for (const state of states) {
      const s = scoreTitleCandidate(TITLE_PREFIX + state.tokens.join(""), context.data, context.product, context);
      if (!bestResult || s > bestResult.score) bestResult = { tokens: state.tokens, body: state.tokens.join(""), score: s };
    }
  }
  if (!bestResult) return null;
  return { tokens: bestResult.tokens, body: bestResult.body };
}

function buildExactFillAdditions(baseTokens: string[], pool: TokenOption[], context: GenerationContext) {
  const baseBody = baseTokens.join("");
  const modelPatchWords = context.product.model ? [`${context.product.model}款`, `${context.product.model}系列`] : [];
  const additionWords = [
    ...modelPatchWords,
    ...pool.map((token) => token.text),
    ...SUPPLEMENT_WORDS,
    ...GENERIC_FILLERS,
    ...SHORT_FILLERS,
    ...TEMPLATE_PHRASES
  ];
  return dedupeTextTokens(additionWords)
    .filter((text) => isUsableToken(text, false) && !baseBody.includes(text) && !containsThirdPartyBrand(text))
    .filter((text) => !baseTokens.some((token) => token.includes(text) || text.includes(token)))
    .sort((a, b) => tokenValue(b, context) - tokenValue(a, context));
}

function insertDpState(dp: Map<number, DpState[]>, bytes: number, state: DpState) {
  const current = dp.get(bytes) ?? [];
  if (current.some((item) => item.key === state.key)) return;
  current.push(state);
  current.sort((a, b) => b.value - a.value);
  dp.set(bytes, current.slice(0, DP_WIDTH_PER_BYTE));
}

function trimTokensToBudget(tokens: string[], required: string[], context: GenerationContext) {
  let next = normalizeTokenList(tokens, context.product);
  while (getGBKByteLength(next.join("")) > TITLE_BODY_TARGET_BYTES) {
    const removable = next
      .map((token, index) => ({ token, index, value: tokenValue(token, context) }))
      .filter((item) => {
        const bodyWithout = next.filter((_, index) => index !== item.index).join("");
        return requiredCovered(bodyWithout, required);
      })
      .sort((a, b) => a.value - b.value || getGBKByteLength(b.token) - getGBKByteLength(a.token))[0];
    if (!removable) break;
    next.splice(removable.index, 1);
  }
  return normalizeTokenList(next, context.product);
}

function normalizeTokenList(tokens: string[], product: TitleProductProfile) {
  const ordered = compactOverlappingTokens(dedupeTextTokens(tokens)).sort((a, b) => tokenOrderPriority(a, product) - tokenOrderPriority(b, product) || b.length - a.length);
  return movePreferredEndingToken(ordered, product);
}

function compactOverlappingTokens(tokens: string[]) {
  const compacted: string[] = [];
  for (const raw of tokens) {
    const token = sanitizeTitleKeyword(raw);
    if (!token) continue;
    if (compacted.some((item) => item.includes(token))) continue;
    const containedIndex = compacted.findIndex((item) => token.includes(item));
    if (containedIndex >= 0) compacted.splice(containedIndex, 1, token);
    else compacted.push(token);
  }
  return compacted;
}

function toTitleCandidate(
  candidate: WorkingCandidate,
  product: TitleProductProfile,
  data: TitleKeywordData,
  selectedCategory: string | undefined,
  index: number,
  context: GenerationContext
): TitleCandidate | null {
  const body = candidate.body;
  const title = TITLE_PREFIX + body;
  const bodyBytes = getGBKByteLength(body);
  const totalBytes = getGBKByteLength(title);
  if (bodyBytes > TITLE_BODY_TARGET_BYTES || bodyBytes < TITLE_BODY_TARGET_BYTES - 4) return null;
  const ruleChecks = evaluateTitleRules(title, product);
  if (ruleChecks.some((rule) => rule.required && !rule.passed)) return null;
  const keywordHits = detectKeywordHits(title, data, context.scoreEntries);
  const subHits = scanSubstringHits(title, context.keywordIndex);
  const suggestions = buildSuggestions(body, product, keywordHits, selectedCategory);
  return {
    id: `${candidate.mode}-${index}-${Math.abs(hashText(title))}`,
    mode: candidate.mode,
    label: MODE_LABEL[candidate.mode],
    title,
    body,
    bodyBytes,
    totalBytes,
    score: scoreTitleCandidate(title, data, product, context),
    tokens: candidate.tokens,
    ruleChecks,
    keywordHits: keywordHits.slice(0, 24),
    substringHits: subHits.slice(0, 30),
    recommendations: [],
    suggestions
  };
}

type StackedTermSource = TitleKeywordEntry["source"] | "manual" | "derived" | "rule";

interface StackedTermOption {
  text: string;
  weight: number;
  source: StackedTermSource;
  parent?: string;
  rank?: number;
  category?: string;
  priority?: number;
}

interface StackedDraft {
  mode: TitleCandidateMode;
  tokens: StackedTermOption[];
}

const NATURAL_TERM_DICTIONARY = [
  "天丝莱赛尔",
  "莱赛尔",
  "裤子男款",
  "男士裤子",
  "休闲裤",
  "直筒裤",
  "运动裤",
  "牛仔裤",
  "工装裤",
  "五分裤",
  "短裤男",
  "男裤",
  "男款",
  "男士",
  "裤子",
  "卫裤",
  "短裤",
  "长裤",
  "西裤",
  "夏季薄款",
  "夏薄款",
  "春夏薄款",
  "春秋薄款",
  "2026新款",
  "夏季",
  "春季",
  "秋季",
  "冬季",
  "春秋",
  "春夏",
  "秋冬",
  "棉麻",
  "亚麻",
  "纯棉",
  "彩棉",
  "冰丝",
  "速干",
  "尼龙",
  "天丝",
  "薄款",
  "凉感",
  "垂感",
  "透气",
  "宽松",
  "阔腿",
  "束脚",
  "弯刀",
  "香蕉",
  "新款",
  "高级感",
  "潮牌",
  "青少年",
  "爸爸",
  "中老年"
].sort((a, b) => b.length - a.length);

const MATERIAL_TERMS = ["天丝莱赛尔", "莱赛尔", "棉麻", "亚麻", "纯棉", "彩棉", "冰丝", "速干", "尼龙", "天丝"];
const STYLE_CONTEXT_TERMS = ["高级感", "潮牌", "青少年", "初中生", "高中", "学生", "爸爸", "中老年", "老年", "轻奢", "痞帅", "商务", "干活", "跑步专用", "跑步"];
const PROTECTED_DUPLICATE_TERMS = [
  "天丝莱赛尔",
  "裤子男款",
  "男士裤子",
  "休闲裤",
  "直筒裤",
  "运动裤",
  "五分裤",
  "短裤男",
  "男裤",
  "男款",
  "男士",
  "裤子",
  "夏季",
  "春季",
  "秋季",
  "冬季",
  "春秋",
  "春夏",
  "秋冬",
  "棉麻",
  "亚麻",
  "纯棉",
  "彩棉",
  "冰丝",
  "速干",
  "薄款",
  "凉感",
  "新款",
  "2026新款"
].sort((a, b) => b.length - a.length);

function generateStackedTitleScore(
  data: TitleKeywordData,
  productName: string,
  categoryName?: string,
  variantCount = 5,
  extraKeywords?: string[],
  targetKeywords?: string[]
): TitleScoreResult {
  const startedAt = Date.now();
  const product = parseTitleProduct(productName);
  const diagnostics: TitleGenerationDiagnostics = { poolSize: 0, recalledSize: 0, generatedCount: 0, elapsedMs: 0, exactFitCount: 0, strictRejectedCount: 0, legacyCandidateCount: 0 };
  if (!productName.trim()) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    return { ok: false, message: "请先输入商品名。", product, candidates: [], warnings: data.warnings, diagnostics };
  }

  const category = selectCategory(data, product, categoryName);
  const context = createGenerationContext(data, product, category?.name, categoryName, diagnostics);
  const targets = parseStackedTargets([...(targetKeywords ?? []), ...(extraKeywords ?? [])], product);
  const pool = buildStackedTermPool(context, targets);
  diagnostics.poolSize = context.scoreEntries.length;
  diagnostics.recalledSize = pool.length;

  const drafts = buildStackedDrafts(pool, targets, product);
  const strictCandidates: TitleCandidate[] = [];
  for (const draft of drafts) {
    const fitted = fitStackedDraftToExact(draft, pool, targets, product);
    if (!fitted) {
      diagnostics.strictRejectedCount = (diagnostics.strictRejectedCount ?? 0) + 1;
      continue;
    }
    const candidate = toStackedCandidate(fitted, product, data, category?.name, strictCandidates.length, context, targets);
    if (!candidate) {
      diagnostics.strictRejectedCount = (diagnostics.strictRejectedCount ?? 0) + 1;
      continue;
    }
    strictCandidates.push(candidate);
  }

  const unique = dedupeCandidates(strictCandidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(variantCount, 4));

  const legacy = generateTitleScore(data, productName, categoryName, 1, extraKeywords, "legacy").candidates[0];
  if (legacy) {
    diagnostics.legacyCandidateCount = 1;
    const legacyStrict = validateStackedHardRules(legacy.title, legacy.tokens, product).length === 0;
    if (legacyStrict && !unique.some((candidate) => candidate.title === legacy.title)) {
      unique.push({
        ...legacy,
        id: `legacy-${legacy.id}`,
        mode: "legacy",
        label: MODE_LABEL.legacy,
        strategy: "legacy",
        strictPass: true,
        suggestions: [...legacy.suggestions, "旧版算法生成，已通过实验版硬规则过滤。"]
      });
    }
  }

  diagnostics.generatedCount = unique.length;
  diagnostics.exactFitCount = unique.filter((candidate) => candidate.totalBytes === TITLE_TOTAL_TARGET_BYTES).length;
  diagnostics.elapsedMs = Date.now() - startedAt;

  return {
    ok: unique.length > 0,
    message: unique.length ? "已生成叠词实验版候选，所有展示标题均通过硬规则。" : "实验版未拼出合格 60 字节标题，请减少冲突目标词或补充更明确的商品属性。",
    product,
    selectedCategory: category?.name,
    candidates: unique,
    warnings: [
      ...data.warnings,
      ...(legacy && !unique.some((candidate) => candidate.mode === "legacy") ? ["旧版对照未通过实验版硬规则，已按要求隐藏。"] : []),
      ...(unique.length ? [] : ["硬规则：帛先生开头、整条 60 字节、裤子类必须含裤子、不得重复核心词、不得出现冲突季节/材质/品牌词。"])
    ],
    diagnostics
  };
}

function parseStackedTargets(values: string[], product: TitleProductProfile): string[] {
  const rawParts = values
    .flatMap((value) => String(value ?? "").split(/[\s,，、;；\n\r]+/))
    .map(sanitizeTitleKeyword)
    .filter((word) => word.length >= 2 && !containsThirdPartyBrand(word));
  const result: string[] = [];
  const add = (word: string) => {
    const cleaned = sanitizeTitleKeyword(word);
    if (cleaned.length >= 2 && !containsThirdPartyBrand(cleaned)) result.push(cleaned);
  };

  for (const part of rawParts) {
    add(part);
    for (const term of extractNaturalTerms(part)) add(term);
  }

  if (!result.length) {
    if (product.series) add(product.series);
    if (product.season) add(product.season);
    for (const material of product.materials) add(material);
    for (const feature of product.features) add(feature);
  }

  if (product.category === "long-pants") {
    add("休闲裤");
    add("直筒裤");
    add("卫裤");
    add("运动裤");
  } else if (product.category === "shorts") {
    add("短裤男");
    add("五分裤");
    add("直筒裤");
  }
  if (product.category === "pants" || product.category === "long-pants" || product.category === "shorts") add("裤子");

  return dedupeTextTokens(result).slice(0, 28);
}

function extractNaturalTerms(value: string): string[] {
  const text = sanitizeTitleKeyword(value);
  const terms: Array<{ term: string; index: number }> = [];
  const add = (term: string) => {
    const index = text.indexOf(term);
    if (index >= 0) terms.push({ term, index });
  };
  for (const term of NATURAL_TERM_DICTIONARY) add(term);
  if (/男士.*裤子/.test(text)) terms.push({ term: "男士裤子", index: text.indexOf("男士") });
  if (/裤子.*男款/.test(text)) terms.push({ term: "裤子男款", index: text.indexOf("裤子") });
  if (/夏.*薄款/.test(text) && !text.includes("夏季薄款")) terms.push({ term: "夏季薄款", index: Math.max(0, text.indexOf("夏")) });
  return dedupeTextTokens(
    terms
      .sort((a, b) => a.index - b.index || b.term.length - a.term.length)
      .map((item) => item.term)
  );
}

function buildStackedTermPool(context: GenerationContext, targets: string[]): StackedTermOption[] {
  const options: StackedTermOption[] = [];
  const targetText = targets.join("");
  const push = (option: StackedTermOption) => {
    const text = sanitizeTitleKeyword(option.text);
    if (!text || getGBKByteLength(text) > TITLE_BODY_TARGET_BYTES || containsThirdPartyBrand(text)) return;
    if (!isStackedTermTruthful(text, context.product, targetText)) return;
    options.push({ ...option, text });
  };

  targets.forEach((target, index) => push({ text: target, weight: 1200 - index * 35, source: "manual", priority: Math.max(0, 80 - index) }));
  for (const word of requiredWordsForProduct(context.product)) push({ text: word, weight: 900, source: "rule", priority: 70 });
  for (const word of priorityWordsForProduct(context.product)) push({ text: word, weight: 720, source: "rule", priority: 55 });

  for (const entry of context.scoreEntries.slice(0, 520)) {
    const keyword = sanitizeTitleKeyword(entry.keyword);
    if (!keyword || !isStackedEntryAllowed(entry, context.product, targetText, context.selectedCategory)) continue;
    const baseWeight = entryRelevanceScore(entry, context.product, context.selectedCategory) + stackedRankBonus(entry.rank);
    if (getGBKByteLength(keyword) <= 28) {
      push({ text: keyword, weight: baseWeight, source: entry.source, parent: entry.keyword, rank: entry.rank, category: entry.category });
    }
    for (const phrase of extractStackedPhrases(keyword)) {
      push({
        text: phrase,
        weight: baseWeight * 0.86 + stackedTargetBonus(phrase, targets),
        source: "derived",
        parent: entry.keyword,
        rank: entry.rank,
        category: entry.category
      });
    }
  }

  return dedupeStackedTerms(options)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.weight - a.weight || getGBKByteLength(b.text) - getGBKByteLength(a.text))
    .slice(0, 180);
}

function extractStackedPhrases(keyword: string): string[] {
  const phrases = new Set<string>();
  const natural = extractNaturalTerms(keyword);
  for (const term of natural) phrases.add(term);
  const materials = natural.filter((term) => MATERIAL_TERMS.includes(term));
  const categories = natural.filter((term) => /男裤|裤子男款|男士裤子|休闲裤|直筒裤|卫裤|运动裤|短裤男|五分裤|短裤/.test(term));
  for (const material of materials) {
    for (const category of categories) {
      const joined = `${material}${category}`;
      if (keyword.includes(joined)) phrases.add(joined);
    }
  }
  for (const season of ["夏季", "春季", "秋季", "冬季", "春秋", "春夏"]) {
    if (keyword.includes(`${season}薄款`)) phrases.add(`${season}薄款`);
  }
  return [...phrases].filter((phrase) => phrase.length >= 2 && phrase.length <= 10);
}

function isStackedEntryAllowed(entry: TitleKeywordEntry, product: TitleProductProfile, targetText: string, selectedCategory?: string) {
  const keyword = sanitizeTitleKeyword(entry.keyword);
  if (!isStackedTermTruthful(keyword, product, targetText)) return false;
  if (product.category === "long-pants" && /短裤|五分裤|内裤|短袖|背心|卫衣男/.test(keyword)) return false;
  if (product.category === "shorts" && /长裤|牛仔裤|西裤|卫裤|短袖|背心/.test(keyword)) return false;
  if (selectedCategory && entry.category === selectedCategory) return true;
  if (keywordFitsProduct(keyword, product)) return true;
  return targetsOverlapKeyword(targetText, keyword);
}

function isStackedTermTruthful(term: string, product: TitleProductProfile, targetText: string) {
  const text = normalizeTitleText(term);
  if (!text || containsThirdPartyBrand(text)) return false;
  if (/(官方|旗舰|专柜|品牌|大牌)/.test(text)) return false;
  if (hasSeasonConflict(text, product, targetText)) return false;
  if (hasMaterialConflict(text, product, targetText)) return false;
  if (STYLE_CONTEXT_TERMS.some((word) => text.includes(normalizeTitleText(word)) && !targetText.includes(word) && !product.normalizedName.includes(normalizeTitleText(word)))) return false;
  return true;
}

function targetsOverlapKeyword(targetText: string, keyword: string) {
  const cleanTarget = normalizeTitleText(targetText);
  const cleanKeyword = normalizeTitleText(keyword);
  return cleanTarget.length >= 2 && (cleanTarget.includes(cleanKeyword) || cleanKeyword.includes(cleanTarget) || coverage(cleanKeyword, cleanTarget) >= 0.65);
}

function hasSeasonConflict(text: string, product: TitleProductProfile, targetText: string) {
  const allowed = seasonCharsFrom(`${product.season}${targetText}`);
  if (!allowed.size) return false;
  const used = seasonCharsFrom(text);
  for (const ch of used) if (!allowed.has(ch)) return true;
  if (allowed.has("夏") && /春款|春装|春秋|秋冬|冬季|秋季/.test(text) && !targetText.includes("春秋") && !targetText.includes("秋冬")) return true;
  return false;
}

function seasonCharsFrom(text: string) {
  const set = new Set<string>();
  for (const ch of SEASON_CHARS) if (text.includes(ch)) set.add(ch);
  return set;
}

function hasMaterialConflict(text: string, product: TitleProductProfile, targetText: string) {
  const allowed = new Set<string>([...product.materials, ...MATERIAL_TERMS.filter((term) => targetText.includes(term))]);
  if (product.normalizedName.includes("彩棉")) ["彩棉", "棉麻", "亚麻", "纯棉"].forEach((word) => allowed.add(word));
  if (!allowed.size) return false;
  return MATERIAL_TERMS.some((material) => text.includes(normalizeTitleText(material)) && !allowed.has(material));
}

function stackedRankBonus(rank?: number) {
  if (!rank) return 0;
  return Math.max(0, 120 - rank);
}

function stackedTargetBonus(text: string, targets: string[]) {
  const clean = normalizeTitleText(text);
  return targets.reduce((sum, target, index) => {
    const t = normalizeTitleText(target);
    if (clean.includes(t) || t.includes(clean)) return sum + Math.max(20, 120 - index * 8);
    return sum;
  }, 0);
}

function dedupeStackedTerms(options: StackedTermOption[]) {
  const map = new Map<string, StackedTermOption>();
  for (const option of options) {
    const key = normalizeTitleText(option.text);
    const existing = map.get(key);
    if (!existing || option.weight > existing.weight || (option.priority ?? 0) > (existing.priority ?? 0)) map.set(key, option);
  }
  return [...map.values()];
}

function buildStackedDrafts(pool: StackedTermOption[], targets: string[], product: TitleProductProfile): StackedDraft[] {
  const bestForTargets = targets.slice(0, 8).map((target) => bestTermForTarget(target, pool)).filter((term): term is StackedTermOption => Boolean(term));
  const categoryWords = stackedCategoryWords(product)
    .map((word) => pool.find((term) => normalizeTitleText(term.text) === normalizeTitleText(word)) ?? { text: word, weight: 680, source: "rule" as const, priority: 60 })
    .filter((term) => isStackedTermTruthful(term.text, product, targets.join("")));
  const topExcel = pool.filter((term) => term.source === "market" || term.source === "breakdown" || term.source === "derived").slice(0, 36);
  const topBlue = pool.filter((term) => term.source === "blue-ocean").slice(0, 18);
  const manual = pool.filter((term) => term.source === "manual").slice(0, 16);
  const modes: Array<{ mode: TitleCandidateMode; terms: StackedTermOption[] }> = [
    { mode: "traffic", terms: [...bestForTargets, ...topExcel, ...categoryWords, ...manual] },
    { mode: "precise", terms: [...manual, ...bestForTargets, ...categoryWords, ...topExcel] },
    { mode: "category", terms: [...bestForTargets, ...categoryWords, ...topExcel, ...manual] },
    { mode: "blue-ocean", terms: [...bestForTargets, ...categoryWords, ...topBlue, ...topExcel] }
  ];
  const drafts: StackedDraft[] = [];
  for (const mode of modes) {
    drafts.push({ mode: mode.mode, tokens: mode.terms });
    drafts.push({ mode: mode.mode, tokens: [...mode.terms.slice(0, 5), ...mode.terms.slice(8, 24), ...mode.terms.slice(5, 8)] });
    drafts.push({ mode: mode.mode, tokens: [...mode.terms.filter((term) => getGBKByteLength(term.text) >= 8).slice(0, 12), ...mode.terms] });
  }
  return drafts;
}

function bestTermForTarget(target: string, pool: StackedTermOption[]) {
  const cleanTarget = normalizeTitleText(target);
  return pool
    .filter((term) => {
      const clean = normalizeTitleText(term.text);
      return clean.includes(cleanTarget) || cleanTarget.includes(clean) || areTargetAlternatives(cleanTarget, clean);
    })
    .sort((a, b) => b.weight - a.weight || getGBKByteLength(b.text) - getGBKByteLength(a.text))[0];
}

function areTargetAlternatives(target: string, term: string) {
  if (/男士裤子/.test(target) && /男裤|裤子男款/.test(term)) return true;
  if (/男裤|裤子男款/.test(target) && /男士裤子/.test(term)) return true;
  if (target.includes("天丝莱赛尔") && term.includes("天丝莱赛尔") && /男裤|裤子男款|男士裤子/.test(term)) return true;
  if (target.includes("夏薄款") && term.includes("夏季薄款")) return true;
  return false;
}

function stackedCategoryWords(product: TitleProductProfile) {
  if (product.category === "long-pants") return ["休闲裤", "直筒裤", "卫裤", "运动裤", "裤子男款", "男裤"];
  if (product.category === "shorts") return ["短裤男", "五分裤", "直筒裤", "运动裤", "裤子男款", "男裤"];
  if (product.category === "pants") return ["裤子男款", "男裤", "休闲裤", "直筒裤"];
  return [];
}

function fitStackedDraftToExact(draft: StackedDraft, pool: StackedTermOption[], targets: string[], product: TitleProductProfile): StackedDraft | null {
  let tokens: StackedTermOption[] = [];
  const targetText = targets.join("");
  const tryAdd = (option: StackedTermOption) => {
    const text = sanitizeTitleKeyword(option.text);
    if (!text || !isStackedTermTruthful(text, product, targetText)) return false;
    if (tokens.some((token) => normalizeTitleText(token.text) === normalizeTitleText(text))) return false;
    const next = [...tokens, { ...option, text }];
    const body = next.map((token) => token.text).join("");
    if (getGBKByteLength(body) > TITLE_BODY_TARGET_BYTES) return false;
    if (validateStackedHardRules(TITLE_PREFIX + body, next.map((token) => token.text), product, false, targetText).length) return false;
    tokens = next;
    return true;
  };

  for (const option of draft.tokens) tryAdd(option);
  tokens = expandStackedTokens(tokens, pool, product, targetText);
  const filled = fillStackedTokens(tokens, pool, product, targetText);
  if (!filled) return null;
  return { mode: draft.mode, tokens: filled };
}

function expandStackedTokens(tokens: StackedTermOption[], pool: StackedTermOption[], product: TitleProductProfile, targetText: string) {
  let next = [...tokens];
  let improved = true;
  while (improved) {
    improved = false;
    const currentBytes = getGBKByteLength(next.map((token) => token.text).join(""));
    const gap = TITLE_BODY_TARGET_BYTES - currentBytes;
    if (gap <= 0) break;
    for (let index = 0; index < next.length; index += 1) {
      const token = next[index];
      const expansions = pool
        .filter((option) => normalizeTitleText(option.text).includes(normalizeTitleText(token.text)) && normalizeTitleText(option.text) !== normalizeTitleText(token.text))
        .filter((option) => !option.rank || !token.rank || option.rank - token.rank <= 30)
        .filter((option) => getGBKByteLength(option.text) - getGBKByteLength(token.text) > 0 && getGBKByteLength(option.text) - getGBKByteLength(token.text) <= gap)
        .sort((a, b) => b.weight - a.weight);
      for (const expansion of expansions) {
        const candidate = [...next];
        candidate[index] = expansion;
        const body = candidate.map((item) => item.text).join("");
        if (getGBKByteLength(body) > TITLE_BODY_TARGET_BYTES) continue;
        if (validateStackedHardRules(TITLE_PREFIX + body, candidate.map((item) => item.text), product, false, targetText).length) continue;
        if (!isStackedTermTruthful(expansion.text, product, targetText)) continue;
        next = candidate;
        improved = true;
        break;
      }
      if (improved) break;
    }
  }
  return next;
}

function fillStackedTokens(tokens: StackedTermOption[], pool: StackedTermOption[], product: TitleProductProfile, targetText: string): StackedTermOption[] | null {
  const start = [...tokens];
  const startBody = start.map((token) => token.text).join("");
  if (getGBKByteLength(startBody) === TITLE_BODY_TARGET_BYTES) return start;
  if (getGBKByteLength(startBody) > TITLE_BODY_TARGET_BYTES) return null;
  const additions = pool
    .filter((option) => !start.some((token) => normalizeTitleText(token.text) === normalizeTitleText(option.text)))
    .filter((option) => isStackedTermTruthful(option.text, product, targetText))
    .filter((option) => !STYLE_CONTEXT_TERMS.some((word) => option.text.includes(word) && !targetText.includes(word)))
    .sort((a, b) => safeFillScore(b, targetText) - safeFillScore(a, targetText))
    .slice(0, 70);
  const dp = new Map<number, StackedTermOption[][]>();
  dp.set(getGBKByteLength(startBody), [start]);

  for (const addition of additions) {
    const additionBytes = getGBKByteLength(addition.text);
    const snapshot = [...dp.entries()];
    for (const [bytes, states] of snapshot) {
      const nextBytes = bytes + additionBytes;
      if (nextBytes > TITLE_BODY_TARGET_BYTES) continue;
      for (const state of states) {
        if (state.some((token) => normalizeTitleText(token.text) === normalizeTitleText(addition.text))) continue;
        const candidate = [...state, addition];
        const body = candidate.map((token) => token.text).join("");
        if (validateStackedHardRules(TITLE_PREFIX + body, candidate.map((token) => token.text), product, false, targetText).length) continue;
        const bucket = dp.get(nextBytes) ?? [];
        bucket.push(candidate);
        bucket.sort((a, b) => scoreStackedTokenList(b, targetText) - scoreStackedTokenList(a, targetText));
        dp.set(nextBytes, bucket.slice(0, 8));
      }
    }
  }

  const exact = dp.get(TITLE_BODY_TARGET_BYTES) ?? [];
  return exact.sort((a, b) => scoreStackedTokenList(b, targetText) - scoreStackedTokenList(a, targetText))[0] ?? null;
}

function safeFillScore(option: StackedTermOption, targetText: string) {
  let score = option.weight;
  if (targetText.includes(option.text)) score += 220;
  if (/2026新款|新款/.test(option.text)) score -= 45;
  if (option.source === "blue-ocean") score -= 20;
  return score;
}

function scoreStackedTokenList(tokens: StackedTermOption[], targetText: string) {
  const body = tokens.map((token) => token.text).join("");
  return tokens.reduce((sum, token) => sum + safeFillScore(token, targetText), 0) + getGBKByteLength(body) * 3;
}

function toStackedCandidate(
  draft: StackedDraft,
  product: TitleProductProfile,
  data: TitleKeywordData,
  selectedCategory: string | undefined,
  index: number,
  context: GenerationContext,
  targets: string[]
): TitleCandidate | null {
  const tokens = draft.tokens.map((token) => token.text);
  const body = tokens.join("");
  const title = TITLE_PREFIX + body;
  const hardErrors = validateStackedHardRules(title, tokens, product, true, targets.join(""));
  if (hardErrors.length) return null;
  const keywordHits = detectKeywordHits(title, data, context.scoreEntries).filter((hit) => hit.matchType === "exact").slice(0, 24);
  const substringHits = scanSubstringHits(title, context.keywordIndex).slice(0, 30);
  const targetHits = buildTargetHits(title, draft.tokens, targets);
  const unplacedTerms = targets.slice(0, 10).filter((target) => !targetHits.some((hit) => hit.target === target));
  const score = scoreStackedCandidate(title, keywordHits, targetHits, unplacedTerms, product);
  const ruleChecks = evaluateTitleRules(title, product).map((rule) => rule.key === "no-duplicate" ? { ...rule, required: true, passed: hardErrors.length === 0 } : rule);
  return {
    id: `stacked-${draft.mode}-${index}-${Math.abs(hashText(title))}`,
    mode: draft.mode,
    label: MODE_LABEL[draft.mode],
    title,
    body,
    bodyBytes: getGBKByteLength(body),
    totalBytes: getGBKByteLength(title),
    score,
    tokens,
    ruleChecks,
    keywordHits,
    substringHits,
    recommendations: [],
    suggestions: [
      `硬规则通过：帛先生开头，整条 ${getGBKByteLength(title)}/60 字节，未发现核心重复词。`,
      `目标词命中 ${targetHits.length}/${Math.min(targets.length, 10)} 个${selectedCategory ? `，主类目：${selectedCategory}` : ""}。`,
      unplacedTerms.length ? `未放入：${unplacedTerms.join("、")}` : "前置目标词均已覆盖。"
    ],
    strategy: "stacked-v2",
    strictPass: true,
    targetHits,
    sourceTerms: draft.tokens.map((token) => ({ text: token.text, source: token.source, parent: token.parent, rank: token.rank, category: token.category })),
    blockedTerms: hardErrors,
    unplacedTerms
  };
}

function validateStackedHardRules(title: string, tokens: string[], product: TitleProductProfile, final = true, truthText = ""): string[] {
  const errors: string[] = [];
  const body = stripPrefix(title);
  if (!title.startsWith(TITLE_PREFIX)) errors.push("缺少帛先生前缀");
  if (final && getGBKByteLength(title) !== TITLE_TOTAL_TARGET_BYTES) errors.push(`整条标题不是 60 字节（当前 ${getGBKByteLength(title)}）`);
  if (final && getGBKByteLength(body) !== TITLE_BODY_TARGET_BYTES) errors.push(`标题主体不是 54 字节（当前 ${getGBKByteLength(body)}）`);
  if ((product.category === "pants" || product.category === "long-pants" || product.category === "shorts") && !normalizeTitleText(title).includes("裤子")) errors.push("裤子类标题必须包含裤子");
  if (containsThirdPartyBrand(title)) errors.push("包含第三方品牌或品牌店词");
  if (/(休闲裤子|直筒裤子)/.test(title)) errors.push("休闲裤/直筒裤必须单独出现，不能变成休闲裤子或直筒裤子");
  const repeats = repeatedProtectedTerms(title);
  if (repeats.length) errors.push(`重复核心词：${repeats.join("、")}`);
  if (/(短裤.*长裤|长裤.*短裤|春款|春装|秋冬|冬季|秋季)/.test(title) && product.season.includes("夏")) errors.push("包含冲突季节或长短裤冲突");
  if (tokens.some((token) => !isStackedTermTruthful(token, product, truthText || tokens.join("")))) errors.push("包含与商品事实不匹配的词");
  return errors;
}

function repeatedProtectedTerms(title: string) {
  const clean = normalizeTitleText(title);
  const repeats: string[] = [];
  for (const term of PROTECTED_DUPLICATE_TERMS) {
    const key = normalizeTitleText(term);
    let count = 0;
    let cursor = 0;
    while (key && clean.indexOf(key, cursor) >= 0) {
      const found = clean.indexOf(key, cursor);
      count += 1;
      cursor = found + key.length;
    }
    if (count > 1) repeats.push(term);
  }
  return repeats;
}

function buildTargetHits(title: string, tokens: StackedTermOption[], targets: string[]) {
  const cleanTitle = normalizeTitleText(title);
  const hits: NonNullable<TitleCandidate["targetHits"]> = [];
  for (const target of targets.slice(0, 10)) {
    const cleanTarget = normalizeTitleText(target);
    if (cleanTitle.includes(cleanTarget)) {
      hits.push({ target, matched: target, kind: "exact", source: "manual" });
      continue;
    }
    const matched = tokens.find((token) => areTargetAlternatives(cleanTarget, normalizeTitleText(token.text)) || cleanTarget.includes(normalizeTitleText(token.text)));
    if (matched) {
      hits.push({
        target,
        matched: matched.text,
        kind: matched.source === "derived" ? "expanded" : "replacement",
        source: matched.source === "manual" ? "manual" : "excel",
        rank: matched.rank,
        category: matched.category
      });
    }
  }
  return hits;
}

function scoreStackedCandidate(title: string, keywordHits: TitleKeywordHit[], targetHits: NonNullable<TitleCandidate["targetHits"]>, unplacedTerms: string[], product: TitleProductProfile) {
  const targetScore = Math.min(42, targetHits.reduce((sum, hit) => sum + (hit.kind === "exact" ? 8 : hit.kind === "expanded" ? 7 : 6), 0));
  const keywordScore = Math.min(28, keywordHits.slice(0, 12).reduce((sum, hit) => sum + Math.max(2, 12 - Math.log2((hit.rank ?? 80) + 1)), 0));
  const structureScore = calcStructureScore(title, product) * 2;
  const endingScore = Math.max(0, titleEndingScore(title, product) / 4);
  const penalty = Math.min(18, unplacedTerms.length * 4);
  return Math.max(0, Math.min(100, Math.round(18 + targetScore + keywordScore + structureScore + endingScore - penalty)));
}

function evaluateTitleRules(title: string, product: TitleProductProfile): TitleRuleCheck[] {
  const body = stripPrefix(title);
  const text = normalizeTitleText(title || product.normalizedName);
  const checks: TitleRuleCheck[] = [];
  const add = (key: string, label: string, passed: boolean, required: boolean, detail: string, missing: string[] = []) => checks.push({ key, label, passed, required, detail, missing });
  add("prefix", "必须以帛先生开头", title.startsWith(TITLE_PREFIX), true, title.startsWith(TITLE_PREFIX) ? "品牌前缀正确" : "缺少帛先生前缀", title.startsWith(TITLE_PREFIX) ? [] : [TITLE_PREFIX]);
  const seasonMatched = product.season
    ? text.includes(product.season) || SEASON_CHARS.some((ch) => product.season.includes(ch) && text.includes(ch))
    : false;
  add("season", "必须包含季节", seasonMatched, true, product.season ? `已识别季节：${product.season}` : "商品名缺少季节", product.season ? [] : ["季节"]);
  const genderPassed = /男士|男款/.test(text);
  add("gender", "必须包含独立男士/男款", genderPassed, true, genderPassed ? "已包含男士或男款" : "缺少男士/男款", genderPassed ? [] : ["男士或男款"]);
  if (product.category === "pants" || product.category === "shorts" || product.category === "long-pants") {
    add("pants", "裤子系列必须含裤子", text.includes("裤子"), true, text.includes("裤子") ? "已包含裤子" : "缺少裤子", text.includes("裤子") ? [] : ["裤子"]);
  }
  if (product.normalizedName.includes("棉麻")) {
    const missing = ["棉麻", "亚麻"].filter((word) => !text.includes(word));
    add("linen", "棉麻材质必须含棉麻/亚麻", missing.length === 0, true, missing.length ? `缺少：${missing.join("、")}` : "棉麻、亚麻已包含", missing);
  }
  if (product.normalizedName.includes("彩棉")) {
    const missing = ["棉麻", "亚麻", "纯棉"].filter((word) => !text.includes(word));
    add("colored-cotton", "彩棉系列必须含棉麻/亚麻/纯棉", missing.length === 0, true, missing.length ? `缺少：${missing.join("、")}` : "彩棉系列材质词已完整", missing);
  }
  if (product.normalizedName.includes("百叶317")) {
    add("baiye-317", "百叶317必须含速干", text.includes("速干"), true, text.includes("速干") ? "已包含速干" : "缺少速干", text.includes("速干") ? [] : ["速干"]);
  }
  if (product.category === "long-pants") {
    const longPantsWords = ["直筒裤", "休闲裤", "卫裤"];
    const missing = longPantsWords.filter((word) => !text.includes(word));
    const hitCount = longPantsWords.length - missing.length;
    add("long-pants", "长裤类建议含直筒裤/休闲裤/卫裤（至少2个）", hitCount >= 2, hitCount < 1, missing.length ? `缺少：${missing.join("、")}` : "长裤三类目词已分别包含", missing);
  }
  if (product.category === "shorts") {
    const missing = ["五分裤", "直筒裤"].filter((word) => !text.includes(word));
    add("shorts", "短裤优先包含五分裤/直筒裤", missing.length === 0, false, missing.length ? `建议补充：${missing.join("、")}` : "短裤建议词已包含", missing);
  }
  const duplicateWords = findDuplicateWords(title);
  add("no-duplicate", "不能有重复词", duplicateWords.length === 0, false, duplicateWords.length ? `重复词：${duplicateWords.join("、")}` : "未发现重复词", duplicateWords);
  add("body-bytes", "标题主体严格 54 字节", getGBKByteLength(body) === TITLE_BODY_TARGET_BYTES, true, `${getGBKByteLength(body)}/${TITLE_BODY_TARGET_BYTES}`);
  add("total-bytes", "整条标题严格 60 字节", getGBKByteLength(title) === TITLE_TOTAL_TARGET_BYTES, true, `${getGBKByteLength(title)}/${TITLE_TOTAL_TARGET_BYTES}`);
  return checks;
}

function detectKeywordHits(title: string, data: TitleKeywordData, entries = data.categories.flatMap((category) => [...category.keywords, ...category.blueOceanWords])): TitleKeywordHit[] {
  const cleanTitle = normalizeTitleText(title);
  const hits = new Map<string, TitleKeywordHit>();
  for (const entry of entries) {
    const keyword = sanitizeTitleKeyword(entry.keyword);
    if (!keyword || keyword.length < 2 || containsThirdPartyBrand(keyword)) continue;
    const cleanKeyword = normalizeTitleText(keyword);
    let matchType: TitleKeywordHit["matchType"] | null = null;
    if (cleanTitle.includes(cleanKeyword)) matchType = "exact";
    else if (isOrderedSubsequence(cleanTitle, cleanKeyword) && cleanKeyword.length >= 3) matchType = "ordered";
    else if (coverage(cleanTitle, cleanKeyword) >= 0.55) matchType = "partial";
    if (!matchType) continue;
    const existing = hits.get(keyword);
    const next: TitleKeywordHit = { keyword, category: entry.category, source: entry.source, weight: entry.weight, compositeValue: calcCompositeKeywordValue(entry), matchType, rank: entry.rank };
    if (!existing || entry.weight > existing.weight) hits.set(keyword, next);
  }
  return [...hits.values()].sort((a, b) => b.compositeValue - a.compositeValue);
}

function keywordFitsProduct(keyword: string, product: TitleProductProfile) {
  const text = normalizeTitleText(keyword);
  if (containsThirdPartyBrand(keyword)) return false;
  if (product.category === "shorts" && /短裤|五分裤|中裤|裤子|男裤/.test(text)) return true;
  if (product.category === "long-pants" && /长裤|休闲裤|卫裤|直筒裤|运动裤|阔腿裤|西裤|裤子|男裤/.test(text)) return true;
  if (product.category === "pants" && /裤/.test(text)) return true;
  if (product.category === "top" && /短袖|t恤|背心|卫衣|衬衫|男装/.test(text)) return true;
  return [...product.materials, product.season, product.series, product.model, ...product.features].filter(Boolean).some((word) => text.includes(normalizeTitleText(word)));
}

function requiredWordsForProduct(product: TitleProductProfile): string[] {
  const required = new Set<string>();
  if (product.season) required.add(product.season);
  required.add(product.normalizedName.includes("男士") ? "男士" : "男款");
  if (product.category === "long-pants" || product.category === "shorts" || product.category === "pants") required.add("裤子");
  if (product.normalizedName.includes("棉麻") || product.materials.includes("棉麻")) {
    required.add("棉麻");
    required.add("亚麻");
  }
  if (product.normalizedName.includes("彩棉")) {
    required.add("棉麻");
    required.add("亚麻");
    required.add("纯棉");
  }
  if (product.normalizedName.includes("百叶317")) required.add("速干");
  if (product.category === "long-pants") {
    required.add("直筒裤");
  }
  return [...required];
}

function lockedWordsForProduct(product: TitleProductProfile): string[] {
  const locked = new Set(requiredWordsForProduct(product));
  if (product.category === "shorts") {
    locked.add("五分裤");
    locked.add("直筒裤");
  }
  if (product.category === "long-pants") {
    locked.add("直筒裤");
  }
  return [...locked];
}

function priorityWordsForProduct(product: TitleProductProfile): string[] {
  const priority = new Set<string>();
  if (product.category === "shorts") {
    priority.add("五分裤");
    priority.add("直筒裤");
    priority.add("短裤");
  }
  if (product.season && product.season.includes("夏")) {
    priority.add("薄款");
    priority.add("凉感");
  }
  if (product.category === "long-pants") {
    priority.add("裤子男款");
    priority.add("休闲裤");
    priority.add("卫裤");
  }
  for (const word of product.features) priority.add(word);
  return [...priority];
}

function entryRelevanceScore(entry: TitleKeywordEntry, product: TitleProductProfile, selectedCategory?: string) {
  const keyword = sanitizeTitleKeyword(entry.keyword);
  const text = normalizeTitleText(keyword);
  let score = entry.weight;
  if (entry.category === selectedCategory) score += 95;
  if (keywordFitsProduct(keyword, product)) score += 78;
  if (entry.source === "blue-ocean") score += 28;
  if (entry.source === "breakdown") score += 16;
  if (product.season && text.includes(product.season)) score += 34;
  if (product.materials.some((material) => text.includes(material))) score += 32;
  if (product.features.some((feature) => text.includes(feature))) score += 24;
  if (product.series && text.includes(normalizeTitleText(product.series))) score += 24;
  if (product.model && text.includes(product.model)) score += 12;
  score += overlapTermScore(text, product);
  score += byteEfficiencyBonus(keyword);
  return score;
}

function overlapTermScore(text: string, product: TitleProductProfile) {
  const signals = [...categoryHintsForProduct(product), product.season, ...product.materials, ...product.features, "男款", "男士", "裤子", "男裤"].filter(Boolean);
  return signals.reduce((sum, signal) => sum + (text.includes(normalizeTitleText(signal)) ? 10 : 0), 0);
}

function productFitBonus(token: string, product: TitleProductProfile) {
  let bonus = 0;
  const text = normalizeTitleText(token);
  if (product.season && text.includes(product.season)) bonus += 35;
  if (product.model && text.includes(product.model)) bonus += 12;
  if (product.materials.some((material) => text.includes(material))) bonus += 25;
  if (keywordFitsProduct(token, product)) bonus += 22;
  if (/男士|男款|男裤|裤子男款/.test(text)) bonus += 18;
  return bonus;
}

function titleEndingScore(title: string, product: TitleProductProfile) {
  const body = stripPrefix(title);
  const ending = preferredEndingWordsForProduct(product).find((word) => body.endsWith(word));
  if (ending) return 42;
  if (product.category === "long-pants" || product.category === "shorts" || product.category === "pants") return body.endsWith("裤") ? 16 : -12;
  if (product.category === "top") return /半袖|短袖|t恤|衬衫|卫衣$/.test(body) ? 20 : 0;
  return 0;
}

function buildEndingAdvice(title: string, product: TitleProductProfile) {
  const preferred = preferredEndingWordsForProduct(product);
  if (!preferred.length) return "";
  const body = stripPrefix(title);
  const matched = preferred.find((word) => body.endsWith(word));
  if (matched) return `结尾词已使用 ${matched}，符合类目收尾建议。`;
  return `建议标题末尾优先落在 ${preferred.slice(0, 4).join("、")} 这类明确类目词上。`;
}

function movePreferredEndingToken(tokens: string[], product: TitleProductProfile) {
  const preferred = preferredEndingWordsForProduct(product);
  if (!preferred.length || tokens.length < 2) return tokens;
  const index = tokens.findIndex((token) => preferred.some((word) => token === word || token.endsWith(word)));
  if (index < 0 || index === tokens.length - 1) return tokens;
  const next = [...tokens];
  const [ending] = next.splice(index, 1);
  next.push(ending);
  return next;
}

function preferredEndingWordsForProduct(product: TitleProductProfile) {
  if (product.category === "shorts") return ["五分裤", "运动裤", "休闲裤", "短裤", "中裤"];
  if (product.category === "long-pants") return ["休闲裤", "运动裤", "卫裤", "直筒裤", "阔腿裤", "西裤"];
  if (product.category === "pants") return ["休闲裤", "运动裤", "卫裤", "直筒裤", "裤子"];
  if (product.category === "top") return ["半袖", "短袖", "T恤", "衬衫", "卫衣"];
  return [];
}

function templatePhraseWeight(phrase: string, product: TitleProductProfile) {
  let weight = 80 + productFitBonus(phrase, product);
  if (EXAMPLE_STYLE_BLUEPRINTS.some((blueprint) => blueprint.includes(phrase))) weight += 24;
  if (product.category === "shorts" && /短裤|五分裤|直筒裤/.test(phrase)) weight += 40;
  if (product.category === "long-pants" && /直筒裤|休闲裤|卫裤|裤子男款/.test(phrase)) weight += 44;
  return weight;
}

function byteEfficiencyBonus(token: string) {
  const bytes = getGBKByteLength(token);
  return Math.max(0, 18 - bytes) + (token.length >= 2 && token.length <= 5 ? 10 : 0);
}

function tokenValue(token: string, context: GenerationContext) {
  const key = normalizeTitleText(token);
  const cached = context.tokenValueCache.get(key);
  if (cached !== undefined) return cached;
  const keywordWeight = context.scoreEntries
    .filter((entry) => normalizeTitleText(entry.keyword).includes(key) || key.includes(normalizeTitleText(entry.keyword)))
    .slice(0, 6)
    .reduce((sum, entry) => sum + entry.weight, 0);
  const value = keywordWeight + productFitBonus(token, context.product) + byteEfficiencyBonus(token);
  context.tokenValueCache.set(key, value);
  return value;
}

function calcOverlapScore(title: string, entries: TitleKeywordEntry[], context?: GenerationContext) {
  const clean = normalizeTitleText(title);
  let score = 0;
  const roots = context?.overlapRoots ?? buildOverlapRoots(entries);
  if (context && !context.overlapRoots) context.overlapRoots = roots;
  for (const [root, value] of roots) if (clean.includes(root)) score += Math.min(18, value);
  return score;
}

function buildOverlapRoots(entries: TitleKeywordEntry[]) {
  const roots = new Map<string, number>();
  for (const entry of entries.slice(0, 220)) {
    const keyword = sanitizeTitleKeyword(entry.keyword);
    for (let length = 2; length <= Math.min(5, keyword.length); length += 1) {
      for (let index = 0; index <= keyword.length - length; index += 1) {
        const root = keyword.slice(index, index + length);
        if (/^\d+$/.test(root)) continue;
        roots.set(root, (roots.get(root) ?? 0) + Math.max(1, entry.weight / 50));
      }
    }
  }
  return roots;
}

function scoreReadability(title: string) {
  let score = 60;
  if (/(束脚.*阔腿|阔腿.*束脚)/.test(title)) score -= 40;
  if (/(短裤.*长裤|长裤.*短裤)/.test(title)) score -= 50;
  if (/(男士男款|男款男士)/.test(title)) score -= 12;
  if (/(裤子裤|裤裤)/.test(title)) score -= 10;
  if (/(棉麻.*冰丝|冰丝.*棉麻)/.test(title)) score -= 8;
  const duplicates = findDuplicateWords(title);
  score -= duplicates.length * 25;
  return score;
}

function buildSuggestions(body: string, product: TitleProductProfile, hits: TitleKeywordHit[], selectedCategory?: string) {
  const bodyBytes = getGBKByteLength(body);
  const totalBytes = getGBKByteLength(TITLE_PREFIX + body);
  const suggestions = [
    `主体 ${bodyBytes}/54 字节，整条标题 ${totalBytes}/60 字节${bodyBytes === TITLE_BODY_TARGET_BYTES ? "（已满）" : bodyBytes >= TITLE_BODY_TARGET_BYTES - 4 ? "（接近满）" : ""}。`,
    `关键词命中 ${hits.length} 个${selectedCategory ? `，优先类目：${selectedCategory}` : ""}。`
  ];
  if (product.category === "shorts" && !body.includes("五分裤")) suggestions.push("短裤标题建议保留五分裤提高精准搜索覆盖。");
  if (hits.some((hit) => hit.source === "blue-ocean")) suggestions.push("已融入蓝海词，适合测试低竞争长尾流量。");
  return suggestions;
}

function buildAnalysisRecommendations(title: string, product: TitleProductProfile, checks: TitleRuleCheck[], hits: TitleKeywordHit[], selectedCategory: string | undefined, context: GenerationContext): TitleRecommendation[] {
  const recommendations: TitleRecommendation[] = [];
  const cleanTitle = normalizeTitleText(title);
  const missingRequired = checks.filter((rule) => rule.required && !rule.passed);

  if (missingRequired.length) {
    for (const rule of missingRequired.slice(0, 3)) {
      recommendations.push({
        type: "missing-element",
        message: `缺少必要元素：${rule.label}`,
        detail: rule.detail,
        estimatedGain: 8
      });
    }
    return recommendations;
  }

  const bodyBytes = getGBKByteLength(stripPrefix(title));
  if (bodyBytes > TITLE_BODY_TARGET_BYTES) {
    recommendations.push({
      type: "byte-tip",
      message: `标题超出 ${bodyBytes - TITLE_BODY_TARGET_BYTES} 字节（当前 ${bodyBytes}/${TITLE_BODY_TARGET_BYTES}），需要缩短`,
      detail: "超出字节会被淘宝截断，影响搜索展示",
      estimatedGain: 8
    });
  } else if (TITLE_BODY_TARGET_BYTES - bodyBytes >= 6) {
    recommendations.push({
      type: "byte-tip",
      message: `还有 ${TITLE_BODY_TARGET_BYTES - bodyBytes} 字节空间可用，建议添加更多关键词`,
      detail: "充分利用标题字节可以覆盖更多搜索词",
      estimatedGain: 4
    });
  }

  const hitKeywords = new Set(hits.map((h) => normalizeTitleText(h.keyword)));
  const unhitHighValue = context.scoreEntries
    .filter((e) => !hitKeywords.has(normalizeTitleText(e.keyword)))
    .filter((e) => keywordFitsProduct(e.keyword, product))
    .filter((e) => !containsThirdPartyBrand(e.keyword))
    .map((e) => ({ entry: e, value: calcCompositeKeywordValue(e) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const unhitTop5 = unhitHighValue.filter((item) => item.entry.source !== "blue-ocean").slice(0, 5);
  if (unhitTop5.length > 0) {
    const list = unhitTop5.map((item) => `「${item.entry.keyword}」(权重${Math.round(item.entry.weight)})`).join("、");
    recommendations.push({
      type: "unhit-keyword",
      message: `推荐高排名关键词：${list}`,
      detail: `来自${unhitTop5[0].entry.category}等类目`,
      estimatedGain: Math.min(8, Math.round(unhitTop5[0].value / 5))
    });
  }

  for (const { entry } of unhitHighValue.slice(0, 5)) {
    const cleanKw = normalizeTitleText(entry.keyword);
    const overlap = longestCommonSubstring(cleanTitle, cleanKw);
    const missing = cleanKw.length - overlap;

    if (overlap >= 2 && missing <= 4) {
      const missingPart = findMissingPart(cleanTitle, cleanKw);
      if (missingPart) {
        recommendations.push({
          type: "insert",
          message: `插入「${missingPart}」可命中「${entry.keyword}」`,
          detail: entry.rank ? `排名 ${entry.rank}，${entry.category}` : entry.category,
          estimatedGain: Math.min(8, Math.round(calcCompositeKeywordValue(entry) / 5))
        });
      }
    }
  }

  for (const { entry } of unhitHighValue.slice(0, 8)) {
    const cleanKw = normalizeTitleText(entry.keyword);
    const chars = [...cleanKw];
    const allInTitle = chars.every((c) => cleanTitle.includes(c));
    if (allInTitle && !cleanTitle.includes(cleanKw) && chars.length >= 3 && chars.length <= 7) {
      recommendations.push({
        type: "reorder",
        message: `调整词序可命中「${entry.keyword}」`,
        detail: `标题已包含所有字符但顺序不对，${entry.rank ? `排名 ${entry.rank}` : entry.category}`,
        estimatedGain: Math.min(6, Math.round(calcCompositeKeywordValue(entry) / 6))
      });
      break;
    }
  }

  const duplicateWords = findDuplicateWords(title);
  if (duplicateWords.length > 0) {
    recommendations.push({
      type: "duplicate",
      message: `标题中存在重复词：${duplicateWords.join("、")}`,
      detail: "重复词浪费宝贵字节且不增加搜索权重，建议去除重复并填入新关键词",
      estimatedGain: Math.min(8, duplicateWords.length * 3)
    });
  }

  const blueOceanEntries = context.scoreEntries.filter((e) => e.source === "blue-ocean");
  const unusedBlue = blueOceanEntries
    .filter((e) => !cleanTitle.includes(normalizeTitleText(e.keyword)))
    .filter((e) => !containsThirdPartyBrand(e.keyword))
    .sort((a, b) => {
      const demandA = Number(a.metrics?.demandSupplyRatio) || 0;
      const demandB = Number(b.metrics?.demandSupplyRatio) || 0;
      return demandB - demandA;
    })
    .slice(0, 3);
  if (unusedBlue.length > 0) {
    const list = unusedBlue.map((e) => `「${e.keyword}」(供需比${Math.round(Number(e.metrics?.demandSupplyRatio) || 0)})`).join("、");
    recommendations.push({
      type: "blue-ocean",
      message: `推荐蓝海词：${list}`,
      detail: "低竞争高需求词，有助于差异化引流",
      estimatedGain: 5
    });
  }

  const roots = extractHighFreqRoots(context.scoreEntries.slice(0, 50));
  const unusedRoots = roots.filter((r) => !cleanTitle.includes(r)).slice(0, 5);
  if (unusedRoots.length > 0) {
    recommendations.push({
      type: "root-hint",
      message: `高频词根未使用：${unusedRoots.join("、")}`,
      detail: "这些词根在多个高排名关键词中反复出现",
      estimatedGain: 3
    });
  }

  if (!product.season || !cleanTitle.includes(product.season)) {
    recommendations.push({ type: "missing-element", message: "建议补充季节词", detail: "如「夏季」「春秋」等，提高季节搜索覆盖", estimatedGain: 3 });
  }
  if (!product.materials.length || !product.materials.some((m) => cleanTitle.includes(m))) {
    recommendations.push({ type: "missing-element", message: "建议补充面料词", detail: "如「棉麻」「冰丝」「亚麻」等", estimatedGain: 3 });
  }
  if (!/直筒|阔腿|束脚|宽松|修身|弯刀/.test(cleanTitle)) {
    recommendations.push({ type: "missing-element", message: "建议补充版型词", detail: "如「直筒」「宽松」「阔腿」等", estimatedGain: 3 });
  }

  return recommendations
    .filter((r, i, arr) => arr.findIndex((x) => x.message === r.message) === i)
    .sort((a, b) => b.estimatedGain - a.estimatedGain)
    .slice(0, 10);
}

function extractHighFreqRoots(keywords: TitleKeywordEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const kw of keywords) {
    const clean = sanitizeTitleKeyword(kw.keyword);
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i <= clean.length - len; i++) {
        const root = clean.slice(i, i + len);
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

function longestCommonSubstring(a: string, b: string): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0;
      while (i + len < a.length && j + len < b.length && a[i + len] === b[j + len]) len++;
      if (len > max) max = len;
    }
  }
  return max;
}

function findMissingPart(title: string, keyword: string): string | null {
  for (let i = 0; i < keyword.length; i++) {
    const prefix = keyword.slice(0, i);
    const suffix = keyword.slice(i);
    if (prefix && title.includes(prefix) && !title.includes(keyword)) return suffix;
    if (suffix && title.includes(suffix) && !title.includes(keyword)) return prefix;
  }
  return null;
}

function extractAnalysisTokens(title: string, product: TitleProductProfile, hits: TitleKeywordHit[]) {
  return dedupeTextTokens([
    ...requiredWordsForProduct(product),
    ...priorityWordsForProduct(product),
    ...hits.slice(0, 12).map((hit) => hit.keyword),
    ...preferredEndingWordsForProduct(product).filter((word) => title.includes(word))
  ]).slice(0, 18);
}

function scoreAnalyzedTitle(title: string, product: TitleProductProfile, checks: TitleRuleCheck[], hits: TitleKeywordHit[], context: GenerationContext): { score: number; breakdown: TitleScoreBreakdown } {
  const requiredChecks = checks.filter((rule) => rule.required);
  const requiredPassed = requiredChecks.filter((rule) => rule.passed).length;
  if (requiredPassed < requiredChecks.length) {
    const raw = Math.max(0, Math.min(15, Math.round((requiredPassed / requiredChecks.length) * 15)));
    return { score: raw, breakdown: { keywordScore: 0, byteScore: 0, blueOceanScore: 0 } };
  }

  const hitWeightSum = hits.reduce((sum, h) => sum + h.weight * (h.matchType === "exact" ? 1 : h.matchType === "ordered" ? 0.5 : 0.2), 0);
  const top10Sum = context.scoreEntries.slice(0, 10).reduce((sum, e) => sum + e.weight, 0);
  const keywordScore = Math.min(100, top10Sum > 0 ? (hitWeightSum / top10Sum) * 100 : 0);

  const bodyBytes = getGBKByteLength(stripPrefix(title));
  const byteScore = bodyBytes > TITLE_BODY_TARGET_BYTES
    ? Math.max(0, 50 - (bodyBytes - TITLE_BODY_TARGET_BYTES) * 5)
    : (bodyBytes / TITLE_BODY_TARGET_BYTES) * 100;

  const blueOceanEntries = context.scoreEntries.filter((e) => e.source === "blue-ocean");
  const blueHitCount = blueOceanEntries.filter((e) => normalizeTitleText(title).includes(normalizeTitleText(e.keyword))).length;
  const blueOceanScore = blueOceanEntries.length === 0 ? 50 : Math.min(100, blueHitCount * 50);

  const total = Math.round(keywordScore * 0.6 + byteScore * 0.2 + blueOceanScore * 0.2);
  return {
    score: Math.max(0, Math.min(100, total)),
    breakdown: {
      keywordScore: Math.round(keywordScore),
      byteScore: Math.round(byteScore),
      blueOceanScore: Math.round(blueOceanScore)
    }
  };
}

function titleGrade(score: number, checks: TitleRuleCheck[]): TitleAnalysisResult["grade"] {
  if (checks.some((rule) => rule.required && !rule.passed)) return "blocked";
  if (score >= 86) return "excellent";
  if (score >= 72) return "good";
  return "needs-work";
}

function tokenOrderPriority(token: string, product: TitleProductProfile) {
  const text = normalizeTitleText(token);
  const blueprintIndex = EXAMPLE_STYLE_BLUEPRINTS.flat().findIndex((item) => normalizeTitleText(item) === text);
  if (blueprintIndex >= 0) return 5 + blueprintIndex / 100;
  if (token === product.season) return 10;
  if (/薄款|凉感|垂感/.test(text)) return 18;
  if (/棉麻|亚麻|彩棉|纯棉|天丝|冰丝|速干|尼龙/.test(text)) return 24;
  if (/短裤|五分裤|裤子男款|男士裤子|裤子/.test(text)) return 34;
  if (/男士|男款|男裤/.test(text)) return 38;
  if (/2026新款|新款/.test(text)) return 44;
  if (/直筒裤|休闲裤|卫裤|运动裤|阔腿裤|西裤|香蕉裤|弯刀/.test(text)) return 52;
  if (/\d/.test(token)) return 64;
  return 80;
}

function modeTokenBoost(token: TokenOption, mode: TitleCandidateMode, product: TitleProductProfile) {
  let boost = token.weight;
  if (mode === "blue-ocean" && token.source === "blue-ocean") boost += 180;
  if (mode === "precise" && (token.source === "product" || tokenAppliesToProduct(token.text, product))) boost += 120;
  if (mode === "traffic" && token.source === "excel") boost += 110;
  if (token.source === "filler") boost -= 30;
  return boost;
}

function tokenSource(token: string, context: GenerationContext): TitleKeywordEntry["source"] | TokenSource | undefined {
  const key = normalizeTitleText(token);
  return context.scoreEntries.find((entry) => normalizeTitleText(entry.keyword) === key)?.source;
}

function tokenAppliesToProduct(token: string, product: TitleProductProfile) {
  const text = normalizeTitleText(token);
  if (!text) return false;
  if (product.season && text.includes(product.season)) return true;
  if (product.materials.some((material) => text.includes(material))) return true;
  if (product.features.some((feature) => text.includes(feature))) return true;
  if (keywordFitsProduct(text, product)) return true;
  return false;
}

function isUsableToken(token: string, required: boolean) {
  if (!token || token === TITLE_PREFIX || containsThirdPartyBrand(token)) return false;
  if (!required && /^\d+$/.test(token)) return false;
  if (getGBKByteLength(token) > TITLE_BODY_TARGET_BYTES) return false;
  if (!required && getGBKByteLength(token) > 24 && !/裤子男款|休闲裤|直筒裤|卫裤|短裤|男裤/.test(token)) return false;
  return true;
}

function requiredCovered(body: string, required: string[]) {
  const text = normalizeTitleText(body);
  return required.every((word) => text.includes(normalizeTitleText(word)));
}

function areNearDuplicateTokens(a: string, b: string) {
  const left = normalizeTitleText(a);
  const right = normalizeTitleText(b);
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return Math.abs(getGBKByteLength(left) - getGBKByteLength(right)) <= 4;
  return jaccard(charNgrams(left), charNgrams(right)) >= 0.82;
}

function charNgrams(text: string) {
  if (text.length <= 2) return new Set([text]);
  const grams = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2));
  return grams;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function dedupeTokens(tokens: TokenOption[]) {
  const map = new Map<string, TokenOption>();
  for (const token of tokens) {
    const key = normalizeTitleText(token.text);
    const existing = map.get(key);
    if (!existing || token.required || token.weight > existing.weight) {
      map.set(key, { ...token, required: Boolean(existing?.required || token.required) });
    }
  }
  return [...map.values()];
}

function dedupeTextTokens(tokens: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens.map(sanitizeTitleKeyword).filter(Boolean)) {
    const key = normalizeTitleText(token);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return result;
}

function dedupeTitleEntries(entries: TitleKeywordEntry[]) {
  const map = new Map<string, TitleKeywordEntry>();
  for (const entry of entries) {
    const key = `${entry.category}:${entry.source}:${normalizeTitleText(entry.keyword)}`;
    const existing = map.get(key);
    if (!existing || entry.weight > existing.weight) map.set(key, entry);
  }
  return [...map.values()];
}

function dedupeBeamStates(states: BeamState[]) {
  const map = new Map<string, BeamState>();
  for (const state of states) {
    const key = state.tokens.map(normalizeTitleText).join("|");
    const existing = map.get(key);
    if (!existing || state.score > existing.score) map.set(key, state);
  }
  return [...map.values()];
}

function dedupeWorkingCandidates(candidates: WorkingCandidate[]) {
  const map = new Map<string, WorkingCandidate>();
  for (const candidate of candidates) {
    const existing = map.get(candidate.body);
    if (!existing || candidate.score > existing.score) map.set(candidate.body, candidate);
  }
  return [...map.values()];
}

function dedupeCandidates(candidates: TitleCandidate[]) {
  const seen = new Set<string>();
  const result: TitleCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.title)) continue;
    seen.add(candidate.title);
    result.push(candidate);
  }
  const byMode = new Map<TitleCandidateMode, TitleCandidate>();
  for (const candidate of result) if (!byMode.has(candidate.mode)) byMode.set(candidate.mode, candidate);
  const remaining = result.filter((candidate) => ![...byMode.values()].includes(candidate));
  return [...byMode.values(), ...remaining].sort((a, b) => b.score - a.score);
}

function tokenKey(tokens: string[]) {
  return tokens.map(normalizeTitleText).sort().join("|");
}

function stripPrefix(title: string) {
  return title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title;
}

function normalizeSubmittedTitle(title: string) {
  return String(title ?? "").replace(/\s+/g, "").trim();
}

function isOrderedSubsequence(title: string, keyword: string) {
  let cursor = 0;
  for (const char of keyword) {
    cursor = title.indexOf(char, cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return true;
}

function coverage(title: string, keyword: string) {
  if (!keyword) return 0;
  let hits = 0;
  const chars = new Set(keyword.split(""));
  for (const char of chars) if (title.includes(char)) hits += 1;
  return hits / chars.size;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash << 5) - hash + value.charCodeAt(index);
  return hash | 0;
}

function buildKeywordIndex(data: TitleKeywordData): Map<string, TitleKeywordEntry> {
  const index = new Map<string, TitleKeywordEntry>();
  for (const category of data.categories) {
    for (const entry of [...category.keywords, ...category.blueOceanWords]) {
      const key = normalizeTitleText(entry.keyword);
      if (key.length < 2) continue;
      const existing = index.get(key);
      if (!existing || calcCompositeKeywordValue(entry) > calcCompositeKeywordValue(existing)) {
        index.set(key, entry);
      }
    }
  }
  return index;
}

function calcCompositeKeywordValue(entry: TitleKeywordEntry): number {
  if (entry.source === "blue-ocean" && entry.metrics) {
    const pop = Number(entry.metrics.popularity) || 1;
    const conv = Number(entry.metrics.conversionRate) || 5;
    const demand = Number(entry.metrics.demandSupplyRatio) || 1;
    return Math.log10(Math.max(1, pop)) * conv * Math.log10(Math.max(2, demand)) * 0.5;
  }
  const rank = entry.rank ?? 500;
  return Math.max(1, 100 / Math.log2(rank + 2));
}

function scanSubstringHits(title: string, keywordIndex: Map<string, TitleKeywordEntry>): SubstringHit[] {
  const clean = normalizeTitleText(title);
  const hits: SubstringHit[] = [];
  for (let start = 0; start < clean.length; start++) {
    for (let len = 2; len <= Math.min(20, clean.length - start); len++) {
      const sub = clean.slice(start, start + len);
      const entry = keywordIndex.get(sub);
      if (entry && !containsThirdPartyBrand(entry.keyword)) {
        hits.push({
          keyword: entry.keyword,
          category: entry.category,
          source: entry.source,
          start,
          length: len,
          value: calcCompositeKeywordValue(entry),
          rank: entry.rank
        });
      }
    }
  }
  return hits.sort((a, b) => b.value - a.value);
}

function calcStackingScore(hits: SubstringHit[]): number {
  if (!hits.length) return 0;
  const uniqueKeywords = new Set(hits.map((h) => h.keyword));
  const totalValue = hits.reduce((sum, h) => sum + h.value, 0);
  const countBonus = Math.min(20, uniqueKeywords.size * 2.5);
  return totalValue + countBonus;
}

function calcDiversityScore(hits: SubstringHit[]): number {
  const roots = new Set<string>();
  for (const hit of hits) {
    const clean = normalizeTitleText(hit.keyword);
    if (clean.length >= 2) roots.add(clean.slice(0, 2));
  }
  return Math.min(20, roots.size * 4);
}

function calcStructureScore(title: string, product: TitleProductProfile): number {
  const text = normalizeTitleText(title);
  let score = 0;
  if (product.season && text.includes(product.season)) score += 3;
  if (product.materials.some((m) => text.includes(m))) score += 3;
  if (/直筒|阔腿|束脚|宽松|修身|弯刀/.test(text)) score += 3;
  const body = stripPrefix(title);
  if (preferredEndingWordsForProduct(product).some((w) => body.endsWith(w))) score += 3;
  if (!/(束脚.*阔腿|阔腿.*束脚|短裤.*长裤|长裤.*短裤|男士男款|男款男士)/.test(text)) score += 3;
  return score;
}

function estimateMaxStackingScore(context: GenerationContext): number {
  const topEntries = context.scoreEntries
    .map((e) => calcCompositeKeywordValue(e))
    .sort((a, b) => b - a)
    .slice(0, 15);
  const rawMax = topEntries.reduce((sum, v) => sum + v, 0) + 40;
  return Math.max(100, rawMax);
}

function findDuplicateWords(title: string): string[] {
  const clean = normalizeTitleText(title);
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (let len = 2; len <= Math.min(6, clean.length); len++) {
    for (let i = 0; i <= clean.length - len; i++) {
      const word = clean.slice(i, i + len);
      if (/^\d+$/.test(word)) continue;
      if (seen.has(word)) continue;
      const first = clean.indexOf(word);
      const second = clean.indexOf(word, first + 1);
      if (second >= 0 && second >= first + len) {
        const alreadyCovered = duplicates.some((d) => d.includes(word) || word.includes(d));
        if (!alreadyCovered) duplicates.push(word);
        seen.add(word);
      }
    }
  }
  return duplicates;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size > 5000) map.clear();
  map.set(key, value);
}
