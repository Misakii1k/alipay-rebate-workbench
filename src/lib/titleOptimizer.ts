import type {
  TitleAnalyzePayload,
  TitleAnalysisResult,
  TitleCandidate,
  TitleCandidateMode,
  TitleGenerationDiagnostics,
  TitleKeywordData,
  TitleKeywordEntry,
  TitleKeywordHit,
  TitleProductProfile,
  TitleRuleCheck,
  TitleScoreResult
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
  "gxg",
  "fila",
  "nike",
  "adidas",
  "uniqlo",
  "levi"
];

const SEASONS = ["春季", "夏季", "秋季", "冬季", "春秋", "四季", "早春", "初秋"];
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
  "blue-ocean": "蓝海型"
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
  const season = SEASONS.find((item) => normalizedName.includes(item)) ?? "";
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

export function generateTitleScore(data: TitleKeywordData, productName: string, categoryName?: string, variantCount = 3): TitleScoreResult {
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
  const poolResult = buildTokenPool(context);
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
    message: unique.length ? "已生成严格 54 字节标题主体。" : "硬规则词较多，未能拼出刚好 54 字节的合格标题。",
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

export function analyzeTitleScore(data: TitleKeywordData, payload: TitleAnalyzePayload): TitleAnalysisResult {
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
      recommendations: ["缺少标题，无法进行字节、规则和关键词命中分析。"],
      warnings: data.warnings,
      diagnostics
    };
  }

  const category = selectCategory(data, product, payload.categoryName);
  const context = createGenerationContext(data, product, category?.name, payload.categoryName, diagnostics);
  const poolResult = buildTokenPool(context);
  diagnostics.poolSize = poolResult.rawSize;
  diagnostics.recalledSize = poolResult.options.length;

  const body = stripPrefix(title);
  const ruleChecks = evaluateTitleRules(title, product);
  const keywordHits = detectKeywordHits(title, data, context.scoreEntries);
  const score = scoreAnalyzedTitle(title, product, ruleChecks, keywordHits, context);
  const grade = titleGrade(score, ruleChecks);
  const recommendations = buildAnalysisRecommendations(title, product, ruleChecks, keywordHits, category?.name);
  const endingAdvice = buildEndingAdvice(title, product);
  diagnostics.generatedCount = 1;
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
    suggestions: recommendations
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
    grade,
    candidate,
    recommendations,
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
  const ruleScore = ruleChecks.every((rule) => !rule.required || rule.passed) ? 220 : -300;
  const hitScore = hits.slice(0, 30).reduce((sum, hit) => sum + hit.weight * (hit.matchType === "exact" ? 1 : hit.matchType === "ordered" ? 0.7 : 0.35), 0);
  const overlapScore = calcOverlapScore(title, entries, context);
  const readabilityScore = scoreReadability(title);
  const byteScore = getGBKByteLength(stripPrefix(title)) === TITLE_BODY_TARGET_BYTES ? 160 : -260;
  const endingScore = titleEndingScore(title, product);
  const score = Math.round(ruleScore + hitScore + overlapScore + readabilityScore + byteScore + endingScore);
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
  return {
    data,
    product,
    selectedCategory,
    requestedCategory,
    scoreEntries: collectScoreEntries(data, product, selectedCategory, requestedCategory),
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

function buildTokenPool(context: GenerationContext): TokenPoolResult {
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

  const weighted = dedupeTokens(options)
    .map((token) => ({ ...token, weight: token.weight + productFitBonus(token.text, product) + byteEfficiencyBonus(token.text) }))
    .sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)) || b.weight - a.weight);

  return {
    rawSize: weighted.length,
    options: compressTokenPool(weighted, context)
  };
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
    product.season === "夏季" ? "薄款" : "",
    product.season === "夏季" ? "凉感" : "",
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
  if (baseBytes === TITLE_BODY_TARGET_BYTES) return { tokens: baseTokens, body: baseBody };
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

  const exactStates = dp.get(TITLE_BODY_TARGET_BYTES) ?? [];
  const best = exactStates
    .map((state) => ({ state, score: scoreTitleCandidate(TITLE_PREFIX + state.tokens.join(""), context.data, context.product, context) }))
    .sort((a, b) => b.score - a.score)[0]?.state;
  if (!best) return null;
  const body = best.tokens.join("");
  return { tokens: best.tokens, body };
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
  if (bodyBytes !== TITLE_BODY_TARGET_BYTES || totalBytes !== TITLE_TOTAL_TARGET_BYTES) return null;
  const ruleChecks = evaluateTitleRules(title, product);
  if (ruleChecks.some((rule) => rule.required && !rule.passed)) return null;
  const keywordHits = detectKeywordHits(title, data, context.scoreEntries);
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
    suggestions
  };
}

function evaluateTitleRules(title: string, product: TitleProductProfile): TitleRuleCheck[] {
  const body = stripPrefix(title);
  const text = normalizeTitleText(title || product.normalizedName);
  const checks: TitleRuleCheck[] = [];
  const add = (key: string, label: string, passed: boolean, required: boolean, detail: string, missing: string[] = []) => checks.push({ key, label, passed, required, detail, missing });
  add("prefix", "必须以帛先生开头", title.startsWith(TITLE_PREFIX), true, title.startsWith(TITLE_PREFIX) ? "品牌前缀正确" : "缺少帛先生前缀", title.startsWith(TITLE_PREFIX) ? [] : [TITLE_PREFIX]);
  add("season", "必须包含季节", Boolean(product.season && text.includes(product.season)), true, product.season ? `已识别季节：${product.season}` : "商品名缺少季节", product.season ? [] : ["季节"]);
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
    const missing = ["直筒裤", "休闲裤", "卫裤"].filter((word) => !text.includes(word));
    add("long-pants", "长裤类必须含直筒裤/休闲裤/卫裤", missing.length === 0, true, missing.length ? `缺少：${missing.join("、")}` : "长裤三类目词已分别包含", missing);
  }
  if (product.category === "shorts") {
    const missing = ["五分裤", "直筒裤"].filter((word) => !text.includes(word));
    add("shorts", "短裤优先包含五分裤/直筒裤", missing.length === 0, false, missing.length ? `建议补充：${missing.join("、")}` : "短裤建议词已包含", missing);
  }
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
    const next: TitleKeywordHit = { keyword, category: entry.category, source: entry.source, weight: entry.weight, matchType };
    if (!existing || entry.weight > existing.weight) hits.set(keyword, next);
  }
  return [...hits.values()].sort((a, b) => b.weight - a.weight);
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
    required.add("休闲裤子");
    required.add("卫裤");
  }
  return [...required];
}

function lockedWordsForProduct(product: TitleProductProfile): string[] {
  const locked = new Set(requiredWordsForProduct(product));
  if (product.category === "shorts") {
    locked.add("五分裤");
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
  if (product.season === "夏季") {
    priority.add("薄款");
    priority.add("凉感");
  }
  if (product.category === "long-pants") priority.add("裤子男款");
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
  return score;
}

function buildSuggestions(body: string, product: TitleProductProfile, hits: TitleKeywordHit[], selectedCategory?: string) {
  const suggestions = [
    `主体 ${getGBKByteLength(body)}/54 字节，整条标题 ${getGBKByteLength(TITLE_PREFIX + body)}/60 字节。`,
    `关键词命中 ${hits.length} 个${selectedCategory ? `，优先类目：${selectedCategory}` : ""}。`
  ];
  if (product.category === "shorts" && !body.includes("五分裤")) suggestions.push("短裤标题建议保留五分裤提高精准搜索覆盖。");
  if (hits.some((hit) => hit.source === "blue-ocean")) suggestions.push("已融入蓝海词，适合测试低竞争长尾流量。");
  return suggestions;
}

function buildAnalysisRecommendations(title: string, product: TitleProductProfile, checks: TitleRuleCheck[], hits: TitleKeywordHit[], selectedCategory?: string) {
  const recommendations: string[] = [];
  const missingRequired = checks.filter((rule) => rule.required && !rule.passed);
  const body = stripPrefix(title);
  if (missingRequired.length) {
    recommendations.push(`硬规则未通过：${missingRequired.map((rule) => rule.label).join("、")}。`);
  } else {
    recommendations.push("硬规则已通过，可以继续看关键词覆盖和结尾词质量。");
  }
  if (getGBKByteLength(body) < TITLE_BODY_TARGET_BYTES) {
    recommendations.push(`主体还差 ${TITLE_BODY_TARGET_BYTES - getGBKByteLength(body)} 字节，可补高价值短词或蓝海词。`);
  } else if (getGBKByteLength(body) > TITLE_BODY_TARGET_BYTES) {
    recommendations.push(`主体超出 ${getGBKByteLength(body) - TITLE_BODY_TARGET_BYTES} 字节，优先删低命中修饰词。`);
  }
  if (!hits.length) {
    recommendations.push("当前标题未命中关键词库，建议先确认 Excel 类目或补充更明确的商品信息。");
  } else {
    recommendations.push(`命中关键词 ${hits.length} 个${selectedCategory ? `，当前参考类目：${selectedCategory}` : ""}。`);
  }
  const endingAdvice = buildEndingAdvice(title, product);
  if (endingAdvice) recommendations.push(endingAdvice);
  return recommendations.slice(0, 6);
}

function extractAnalysisTokens(title: string, product: TitleProductProfile, hits: TitleKeywordHit[]) {
  return dedupeTextTokens([
    ...requiredWordsForProduct(product),
    ...priorityWordsForProduct(product),
    ...hits.slice(0, 12).map((hit) => hit.keyword),
    ...preferredEndingWordsForProduct(product).filter((word) => title.includes(word))
  ]).slice(0, 18);
}

function scoreAnalyzedTitle(title: string, product: TitleProductProfile, checks: TitleRuleCheck[], hits: TitleKeywordHit[], context: GenerationContext) {
  const requiredChecks = checks.filter((rule) => rule.required);
  const requiredPassed = requiredChecks.filter((rule) => rule.passed).length;
  const ruleScore = requiredChecks.length ? (requiredPassed / requiredChecks.length) * 44 : 0;
  const bodyBytes = getGBKByteLength(stripPrefix(title));
  const totalBytes = getGBKByteLength(title);
  const byteScore = bodyBytes === TITLE_BODY_TARGET_BYTES && totalBytes === TITLE_TOTAL_TARGET_BYTES
    ? 24
    : Math.max(0, 20 - Math.abs(TITLE_BODY_TARGET_BYTES - bodyBytes) * 1.6 - Math.abs(TITLE_TOTAL_TARGET_BYTES - totalBytes) * 0.6);
  const hitScore = Math.min(22, hits.slice(0, 12).reduce((sum, hit) => sum + (hit.matchType === "exact" ? 2.2 : hit.matchType === "ordered" ? 1.5 : 0.8), 0));
  const overlapScore = Math.min(6, calcOverlapScore(title, context.scoreEntries, context) / 18);
  const endingScore = titleEndingScore(title, product) > 0 ? 4 : 0;
  return Math.max(0, Math.min(100, Math.round(ruleScore + byteScore + hitScore + overlapScore + endingScore)));
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

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size > 5000) map.clear();
  map.set(key, value);
}
