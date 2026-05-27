export type ToolboxTool = "rebate" | "video" | "review" | "title" | "compare" | "settings";
export type RebateViewKey = "import" | "entry" | "preview" | "export";
export type VideoTemplateId = "bos-template" | "video-slice";
export type VideoTaskStatus = "draft" | "ready" | "processing" | "done" | "failed";
export type FontScale = "small" | "normal" | "large";
export type ReviewWorkspaceMode = "search" | "ai" | "mixed";
export type ReviewThinkingMode = "off" | "fast" | "balanced" | "deep";
export type ReviewThinkingEffort = "minimal" | "low" | "medium" | "high";

export interface ApiProfile {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
}

export interface AppSettings {
  apiProfiles: ApiProfile[];
  activeApiProfileId: string;
  apiBaseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
  aiEnabled: boolean;
  enhancedCloudValidation: boolean;
  autoListenClipboard: boolean;
  autoAdvance: boolean;
  confirmLowConfidence: boolean;
  strictExportValidation: boolean;
  exportNameOwner: string;
  fixedTailAccount: string;
  fixedTailName: string;
  modelConcurrency: number;
  modelRetryCount: number;
  enableLearningFeedback: boolean;
  learningPromptNotes: string;
  showBeginnerGuide: boolean;
  completedTours: ToolboxTool[];
  toolboxName: string;
  videoLibraryDir: string;
  videoOutputDir: string;
  ffmpegPath: string;
  videoTemplate: VideoTemplateId;
  updateFeedUrl: string;
  reviewRootDir: string;
  reviewEmojiLevel: number;
  reviewProfessionalLevel: number;
  reviewBuyerLevel: number;
  reviewExaggerationLevel: number;
  reviewSceneLevel: number;
  reviewMentionValue: boolean;
  reviewProductDescription: string;
  titleKeywordExcelPath: string;
  sliceMusicPresetId: string;
  sliceCustomMusicPath: string;
  reviewApiProfileId: string;
  reviewCustomPrompt: string;
  reviewSavedCopies?: string[];
  reviewWorkspaceMode: ReviewWorkspaceMode;
  reviewScoringEnabled: boolean;
  reviewTargetLength: number;
  reviewThinkingMode: ReviewThinkingMode;
  reviewThinkingEffort: ReviewThinkingEffort;
  titleAiSelectionEnabled: boolean;
  titleExtraKeywords: string;
  compareAutoOpenReminderDialog: boolean;
  compareShowPassedRowsAfterVerify: boolean;
  fontScale: FontScale;
  lastSeenChangelogVersion?: string;
  everythingEsPath: string;
}

export interface VideoCandidate {
  path: string;
  fileName: string;
  score: number;
  reason: string;
  kind?: "video" | "image" | "folder";
  thumbnailDataUrl?: string;
  matchedPath?: string;
}

export interface VideoTask {
  id: string;
  template: VideoTemplateId;
  productName: string;
  colorName: string;
  outputName: string;
  imagePath: string;
  imagePaths: string[];
  videoPath: string;
  musicPath?: string;
  musicPresetId?: string;
  candidates: VideoCandidate[];
  outputPath?: string;
  status: VideoTaskStatus;
  progress: number;
  progressStage?: string;
  log?: string;
  error?: string;
}

export interface VideoWorkbenchState {
  tasks: VideoTask[];
  currentIndex: number;
  savedAt?: string;
}

export interface SelectFilesOptions {
  kind: "image" | "video" | "audio" | "ffmpeg";
  multi?: boolean;
}

export interface SelectPathResult {
  canceled: boolean;
  paths: string[];
}

export interface FfmpegStatus {
  available: boolean;
  path: string;
  detail: string;
  acceleration?: string;
}

export interface VideoRenderPayload {
  task: VideoTask;
  settings: AppSettings;
}

export interface VideoRenderResult {
  success: boolean;
  outputPath?: string;
  log: string;
  error?: string;
}

export interface VideoRenderProgress {
  taskId: string;
  percent: number;
  stage: string;
  currentTime?: number;
}

export interface ReviewSearchResult {
  path: string;
  name: string;
  kind: "image" | "folder";
  score: number;
  reason: string;
  thumbnailDataUrl?: string;
  children?: ReviewSearchResult[];
}

export interface ReviewGenerationOptions {
  query: string;
  selectedPaths: string[];
  productDescription: string;
  targetLength: number;
  thinkingMode: ReviewThinkingMode;
  thinkingEffort: ReviewThinkingEffort;
  emojiLevel: number;
  professionalLevel: number;
  buyerLevel: number;
  exaggerationLevel: number;
  sceneLevel: number;
  mentionValue: boolean;
  batchSeed: number;
}

export interface ReviewGenerationResult {
  copies: string[];
}

export type TitleKeywordSource = "market" | "breakdown" | "blue-ocean" | "manual";
export type TitleCandidateMode = "traffic" | "precise" | "blue-ocean";

export interface TitleKeywordEntry {
  keyword: string;
  category: string;
  source: TitleKeywordSource;
  rank?: number;
  weight: number;
  trend?: number;
  blueOceanScore?: number;
  metrics?: Record<string, string | number>;
}

export interface TitleCategoryData {
  name: string;
  source: "market" | "breakdown" | "blue-ocean" | "mixed";
  keywords: TitleKeywordEntry[];
  blueOceanWords: TitleKeywordEntry[];
  keywordCount: number;
}

export interface TitleKeywordData {
  excelPath: string;
  loadedAt: string;
  modifiedAt?: string;
  categories: TitleCategoryData[];
  totalKeywords: number;
  warnings: string[];
}

export interface TitleProductProfile {
  originalName: string;
  normalizedName: string;
  season: string;
  series: string;
  model: string;
  materials: string[];
  category: "long-pants" | "shorts" | "pants" | "top" | "unknown";
  features: string[];
}

export interface TitleGeneratePayload {
  productName: string;
  categoryName?: string;
  variantCount?: number;
}

export interface TitleAnalyzePayload {
  productName: string;
  title: string;
  categoryName?: string;
}

export interface TitleRuleCheck {
  key: string;
  label: string;
  passed: boolean;
  required: boolean;
  detail: string;
  missing?: string[];
}

export interface TitleKeywordHit {
  keyword: string;
  category: string;
  source: TitleKeywordSource;
  weight: number;
  compositeValue: number;
  matchType: "exact" | "ordered" | "partial";
  rank?: number;
}

export interface SubstringHit {
  keyword: string;
  category: string;
  source: TitleKeywordSource;
  start: number;
  length: number;
  value: number;
  rank?: number;
}

export interface TitleRecommendation {
  type: "insert" | "reorder" | "missing-element" | "unhit-keyword" | "byte-tip" | "blue-ocean" | "root-hint" | "duplicate";
  message: string;
  detail: string;
  estimatedGain: number;
}

export interface TitleScoreBreakdown {
  keywordScore: number;
  byteScore: number;
  blueOceanScore: number;
}

export interface TitleCandidate {
  id: string;
  mode: TitleCandidateMode;
  label: string;
  title: string;
  body: string;
  bodyBytes: number;
  totalBytes: number;
  score: number;
  tokens: string[];
  ruleChecks: TitleRuleCheck[];
  keywordHits: TitleKeywordHit[];
  substringHits: SubstringHit[];
  recommendations: TitleRecommendation[];
  suggestions: string[];
}

export interface TitleGenerationDiagnostics {
  poolSize: number;
  recalledSize: number;
  generatedCount: number;
  elapsedMs: number;
  exactFitCount?: number;
}

export interface TitleScoreResult {
  ok: boolean;
  message: string;
  product: TitleProductProfile;
  selectedCategory?: string;
  candidates: TitleCandidate[];
  warnings: string[];
  diagnostics?: TitleGenerationDiagnostics;
}

export interface TitleAnalysisResult {
  ok: boolean;
  message: string;
  product: TitleProductProfile;
  selectedCategory?: string;
  title: string;
  body: string;
  bodyBytes: number;
  totalBytes: number;
  score: number;
  scoreBreakdown?: TitleScoreBreakdown;
  grade: "excellent" | "good" | "needs-work" | "blocked";
  candidate: TitleCandidate | null;
  recommendations: TitleRecommendation[];
  substringHits: SubstringHit[];
  suggestedTitles: TitleCandidate[];
  endingAdvice?: string;
  warnings: string[];
  diagnostics?: TitleGenerationDiagnostics;
}

export interface WindowControls {
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  mandatory?: boolean;
  percent?: number;
  detail: string;
}

export interface RebateRow {
  id: string;
  amount: string;
  remark: string;
  account: string;
  name: string;
  status: "pending" | "done" | "failed" | "manual" | "skipped";
  confidence?: number;
  reason?: string;
  rawText?: string;
  cloudReview?: CloudReview;
  createdAt?: string;
}

export interface RecognitionResult {
  account: string;
  name: string;
  confidence: number;
  reason: string;
  source: "rules" | "text-model" | "vision-model" | "manual";
  rawText?: string;
}

export interface CloudReview {
  status: "idle" | "checking" | "passed" | "warning" | "error";
  valid?: boolean;
  account?: string;
  name?: string;
  confidence?: number;
  reason?: string;
}

export interface ClipboardSnapshot {
  kind: "empty" | "text" | "image";
  text?: string;
  imageDataUrl?: string;
  signature: string;
}

export interface ExportPayload {
  rows: RebateRow[];
  defaultFileName: string;
  tailRow?: Pick<RebateRow, "account" | "name" | "amount" | "remark">;
}

export interface ExportResult {
  canceled: boolean;
  filePath?: string;
}

export interface ModelConnectionStatus {
  state: "unknown" | "testing" | "connected" | "failed";
  detail: string;
}

export interface WorkbenchState {
  amountInput: string;
  remarkInput: string;
  rows: RebateRow[];
  currentIndex: number;
  savedAt?: string;
}

export const DEFAULT_API_PROFILE: ApiProfile = {
  id: "default",
  name: "默认配置",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  textModel: "gpt-4.1-mini",
  visionModel: "gpt-4.1-mini"
};

export const DEFAULT_TITLE_KEYWORD_EXCEL_PATH = "C:\\Users\\87850\\Desktop\\市场关键词帛先生.xlsx";

export const DEFAULT_SETTINGS: AppSettings = {
  apiProfiles: [DEFAULT_API_PROFILE],
  activeApiProfileId: DEFAULT_API_PROFILE.id,
  apiBaseUrl: DEFAULT_API_PROFILE.apiBaseUrl,
  apiKey: DEFAULT_API_PROFILE.apiKey,
  textModel: DEFAULT_API_PROFILE.textModel,
  visionModel: DEFAULT_API_PROFILE.visionModel,
  aiEnabled: true,
  enhancedCloudValidation: false,
  autoListenClipboard: true,
  autoAdvance: true,
  confirmLowConfidence: true,
  strictExportValidation: true,
  exportNameOwner: "丛宇航",
  fixedTailAccount: "19216140087",
  fixedTailName: "丛宇航",
  modelConcurrency: 2,
  modelRetryCount: 2,
  enableLearningFeedback: true,
  learningPromptNotes: "",
  showBeginnerGuide: false,
  completedTours: [],
  toolboxName: "电商运营工具箱",
  videoLibraryDir: "",
  videoOutputDir: "",
  ffmpegPath: "",
  videoTemplate: "bos-template",
  updateFeedUrl: "",
  reviewRootDir: "",
  reviewEmojiLevel: 2,
  reviewProfessionalLevel: 2,
  reviewBuyerLevel: 4,
  reviewExaggerationLevel: 2,
  reviewSceneLevel: 3,
  reviewMentionValue: true,
  reviewProductDescription: "",
  titleKeywordExcelPath: DEFAULT_TITLE_KEYWORD_EXCEL_PATH,
  sliceMusicPresetId: "",
  sliceCustomMusicPath: "",
  reviewApiProfileId: "",
  reviewCustomPrompt: "",
  reviewSavedCopies: [],
  reviewWorkspaceMode: "mixed",
  reviewScoringEnabled: true,
  reviewTargetLength: 80,
  reviewThinkingMode: "balanced",
  reviewThinkingEffort: "medium",
  titleAiSelectionEnabled: true,
  titleExtraKeywords: "",
  compareAutoOpenReminderDialog: true,
  compareShowPassedRowsAfterVerify: true,
  fontScale: "normal",
  lastSeenChangelogVersion: "",
  everythingEsPath: ""
};

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = {
  amountInput: "",
  remarkInput: "",
  rows: [],
  currentIndex: 0
};

export const DEFAULT_VIDEO_WORKBENCH_STATE: VideoWorkbenchState = {
  tasks: [],
  currentIndex: 0
};

export const DEFAULT_FIXED_TAIL_ROW = {
  account: "19216140087",
  name: "丛宇航",
  amount: "",
  remark: ""
};

export function getActiveApiProfile(settings: AppSettings): ApiProfile {
  return settings.apiProfiles.find((profile) => profile.id === settings.activeApiProfileId) ?? settings.apiProfiles[0] ?? DEFAULT_API_PROFILE;
}

export function getReviewApiProfile(settings: AppSettings): ApiProfile {
  if (settings.reviewApiProfileId) {
    const found = settings.apiProfiles.find((profile) => profile.id === settings.reviewApiProfileId);
    if (found) return found;
  }
  return getActiveApiProfile(settings);
}

export function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const raw = value ?? {};
  const legacyProfile: ApiProfile = {
    ...DEFAULT_API_PROFILE,
    apiBaseUrl: String(raw.apiBaseUrl ?? DEFAULT_API_PROFILE.apiBaseUrl),
    apiKey: String(raw.apiKey ?? DEFAULT_API_PROFILE.apiKey),
    textModel: String(raw.textModel ?? DEFAULT_API_PROFILE.textModel),
    visionModel: String(raw.visionModel ?? DEFAULT_API_PROFILE.visionModel)
  };
  const loadedProfiles = Array.isArray(raw.apiProfiles) ? raw.apiProfiles : [];
  const profiles = loadedProfiles.length
    ? loadedProfiles.map((profile, index) => ({
        ...DEFAULT_API_PROFILE,
        id: String(profile.id || `profile-${index + 1}`),
        name: String(profile.name || `配置 ${index + 1}`),
        apiBaseUrl: String(profile.apiBaseUrl ?? legacyProfile.apiBaseUrl),
        apiKey: String(profile.apiKey ?? ""),
        textModel: String(profile.textModel ?? legacyProfile.textModel),
        visionModel: String(profile.visionModel ?? legacyProfile.visionModel)
      }))
    : [legacyProfile];
  const activeId = profiles.some((profile) => profile.id === raw.activeApiProfileId) ? String(raw.activeApiProfileId) : profiles[0].id;
  const activeProfile = profiles.find((profile) => profile.id === activeId) ?? profiles[0];

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    apiProfiles: profiles,
    activeApiProfileId: activeId,
    apiBaseUrl: activeProfile.apiBaseUrl,
    apiKey: activeProfile.apiKey,
    textModel: activeProfile.textModel,
    visionModel: activeProfile.visionModel,
    fixedTailAccount: String(raw.fixedTailAccount ?? DEFAULT_SETTINGS.fixedTailAccount),
    fixedTailName: String(raw.fixedTailName ?? DEFAULT_SETTINGS.fixedTailName),
    modelConcurrency: clampNumber(raw.modelConcurrency, 1, 6, DEFAULT_SETTINGS.modelConcurrency),
    modelRetryCount: clampNumber(raw.modelRetryCount, 0, 5, DEFAULT_SETTINGS.modelRetryCount),
    enableLearningFeedback: Boolean(raw.enableLearningFeedback ?? DEFAULT_SETTINGS.enableLearningFeedback),
    learningPromptNotes: String(raw.learningPromptNotes ?? ""),
    showBeginnerGuide: Boolean(raw.showBeginnerGuide ?? DEFAULT_SETTINGS.showBeginnerGuide),
    completedTours: Array.isArray(raw.completedTours)
      ? raw.completedTours.filter((tool): tool is ToolboxTool => ["rebate", "video", "review", "title", "compare", "settings"].includes(String(tool)))
      : [],
    toolboxName: String(raw.toolboxName ?? DEFAULT_SETTINGS.toolboxName),
    videoLibraryDir: String(raw.videoLibraryDir ?? ""),
    videoOutputDir: String(raw.videoOutputDir ?? ""),
    ffmpegPath: String(raw.ffmpegPath ?? ""),
    videoTemplate: normalizeVideoTemplate(raw.videoTemplate),
    updateFeedUrl: String(raw.updateFeedUrl ?? ""),
    reviewRootDir: String(raw.reviewRootDir ?? ""),
    reviewEmojiLevel: clampNumber(raw.reviewEmojiLevel, 0, 5, DEFAULT_SETTINGS.reviewEmojiLevel),
    reviewProfessionalLevel: clampNumber(raw.reviewProfessionalLevel, 0, 5, DEFAULT_SETTINGS.reviewProfessionalLevel),
    reviewBuyerLevel: clampNumber(raw.reviewBuyerLevel, 0, 5, DEFAULT_SETTINGS.reviewBuyerLevel),
    reviewExaggerationLevel: clampNumber(raw.reviewExaggerationLevel, 0, 5, DEFAULT_SETTINGS.reviewExaggerationLevel),
    reviewSceneLevel: clampNumber(raw.reviewSceneLevel, 0, 5, DEFAULT_SETTINGS.reviewSceneLevel),
    reviewMentionValue: Boolean(raw.reviewMentionValue ?? DEFAULT_SETTINGS.reviewMentionValue),
    reviewProductDescription: String(raw.reviewProductDescription ?? ""),
    titleKeywordExcelPath: String(raw.titleKeywordExcelPath ?? DEFAULT_SETTINGS.titleKeywordExcelPath),
    sliceMusicPresetId: String(raw.sliceMusicPresetId ?? ""),
    sliceCustomMusicPath: String(raw.sliceCustomMusicPath ?? ""),
    reviewApiProfileId: String(raw.reviewApiProfileId ?? ""),
    reviewCustomPrompt: String(raw.reviewCustomPrompt ?? ""),
    reviewSavedCopies: Array.isArray(raw.reviewSavedCopies) ? raw.reviewSavedCopies.filter((x: unknown) => typeof x === "string").slice(0, 200) : [],
    reviewWorkspaceMode: normalizeReviewWorkspaceMode(raw.reviewWorkspaceMode),
    reviewScoringEnabled: Boolean(raw.reviewScoringEnabled ?? DEFAULT_SETTINGS.reviewScoringEnabled),
    reviewTargetLength: clampNumber(raw.reviewTargetLength, 30, 100, DEFAULT_SETTINGS.reviewTargetLength),
    reviewThinkingMode: normalizeReviewThinkingMode(raw.reviewThinkingMode),
    reviewThinkingEffort: normalizeReviewThinkingEffort(raw.reviewThinkingEffort),
    titleAiSelectionEnabled: Boolean(raw.titleAiSelectionEnabled ?? DEFAULT_SETTINGS.titleAiSelectionEnabled),
    titleExtraKeywords: String(raw.titleExtraKeywords ?? ""),
    compareAutoOpenReminderDialog: Boolean(raw.compareAutoOpenReminderDialog ?? DEFAULT_SETTINGS.compareAutoOpenReminderDialog),
    compareShowPassedRowsAfterVerify: Boolean(raw.compareShowPassedRowsAfterVerify ?? DEFAULT_SETTINGS.compareShowPassedRowsAfterVerify),
    fontScale: normalizeFontScale(raw.fontScale),
    lastSeenChangelogVersion: String(raw.lastSeenChangelogVersion ?? ""),
    everythingEsPath: String(raw.everythingEsPath ?? "")
  };
}

export function syncActiveApiProfile(settings: AppSettings, patch: Partial<ApiProfile>): AppSettings {
  const current = getActiveApiProfile(settings);
  const nextProfile = { ...current, ...patch };
  const profiles = settings.apiProfiles.map((profile) => (profile.id === current.id ? nextProfile : profile));
  return normalizeSettings({ ...settings, apiProfiles: profiles, activeApiProfileId: nextProfile.id });
}

export function switchActiveApiProfile(settings: AppSettings, activeApiProfileId: string): AppSettings {
  return normalizeSettings({ ...settings, activeApiProfileId });
}

export function getFixedTailRow(settings: AppSettings) {
  return {
    ...DEFAULT_FIXED_TAIL_ROW,
    account: settings.fixedTailAccount.trim() || DEFAULT_FIXED_TAIL_ROW.account,
    name: settings.fixedTailName.trim() || DEFAULT_FIXED_TAIL_ROW.name
  };
}

export function normalizeVideoTemplate(value: unknown): VideoTemplateId {
  return value === "video-slice" ? "video-slice" : "bos-template";
}

function normalizeFontScale(value: unknown): FontScale {
  return value === "small" || value === "large" ? value : "normal";
}

function normalizeReviewWorkspaceMode(value: unknown): ReviewWorkspaceMode {
  return value === "search" || value === "ai" || value === "mixed" ? value : "mixed";
}

function normalizeReviewThinkingMode(value: unknown): ReviewThinkingMode {
  return value === "off" || value === "fast" || value === "deep" ? value : "balanced";
}

function normalizeReviewThinkingEffort(value: unknown): ReviewThinkingEffort {
  return value === "minimal" || value === "low" || value === "high" ? value : "medium";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
