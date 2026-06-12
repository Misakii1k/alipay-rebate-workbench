export type ToolboxTool = "rebate" | "video" | "review" | "title" | "compare" | "settings";
export type RebateViewKey = "import" | "entry" | "preview" | "export";
export type VideoTemplateId = "bos-template" | "video-slice";
export type VideoTaskStatus = "draft" | "ready" | "processing" | "done" | "failed";
export type FontScale = "small" | "normal" | "large";
export type PerformanceMode = "auto" | "quality" | "balanced" | "low";
export type VideoScanMode = "auto" | "speed" | "preview";
export type VideoOutputSize = "auto" | "portrait-1080" | "portrait-720" | "story-1080";
export type VideoQualityMode = "preserve" | "high" | "balanced";
export type ReviewWorkspaceMode = "search" | "ai" | "mixed";
export type ReviewThinkingMode = "off" | "auto" | "on";
export type DirectoryCapabilityKind = "mediaRoot" | "reviewRoot" | "videoLibrary" | "videoOutput";

export type ApiType = "openai" | "anthropic";

export interface ApiProfile {
  id: string;
  name: string;
  apiType: ApiType;
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
  videoSpeedMode: boolean;
  videoScanMode: VideoScanMode;
  videoTemplate: VideoTemplateId;
  videoOutputSize: VideoOutputSize;
  videoQualityMode: VideoQualityMode;
  updateFeedUrl: string;
  reviewRootDir: string;
  reviewProfessionalLevel: number;
  reviewBuyerLevel: number;
  reviewExaggerationLevel: number;
  reviewSceneLevel: number;
  reviewMentionValue: boolean;
  reviewProductDescription: string;
  reviewCopyCount: number;
  titleKeywordExcelPath: string;
  sliceMusicPresetId: string;
  sliceCustomMusicPath: string;
  reviewApiProfileId: string;
  reviewCustomPrompt: string;
  reviewSavedCopies?: string[];
  reviewFavoriteQueries?: string[];
  reviewGenerateHotkey: string;
  reviewWorkspaceMode: ReviewWorkspaceMode;
  reviewTargetLength: number;
  reviewThinkingMode: ReviewThinkingMode;
  titleAiSelectionEnabled: boolean;
  titleExtraKeywords: string;
  compareAutoOpenReminderDialog: boolean;
  compareShowPassedRowsAfterVerify: boolean;
  fontScale: FontScale;
  performanceMode: PerformanceMode;
  lastSeenChangelogVersion?: string;
  everythingEsPath: string;
  sidebarCollapsed: boolean;
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
  mtimeMs?: number;
  thumbnailDataUrl?: string;
  childCount?: number;
  coverPath?: string;
  childrenLoaded?: boolean;
  children?: ReviewSearchResult[];
}

export interface ReviewGenerationOptions {
  query: string;
  selectedPaths: string[];
  productDescription: string;
  targetLength: number;
  thinkingMode: ReviewThinkingMode;
  professionalLevel: number;
  buyerLevel: number;
  exaggerationLevel: number;
  sceneLevel: number;
  mentionValue: boolean;
  copyCount: number;
  batchSeed: number;
}

export interface ReviewGenerationResult {
  copies: string[];
}

export interface ReviewChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

export interface ReviewChatPayload {
  messages: ReviewChatMessage[];
  query: string;
  images?: string[];
  productDescription?: string;
  targetLength: number;
  thinkingMode: ReviewThinkingMode;
  professionalLevel?: number;
  buyerLevel?: number;
  exaggerationLevel?: number;
  sceneLevel?: number;
  mentionValue?: boolean;
  customPrompt?: string;
}

export interface ReviewChatResult {
  reply: string;
}

export type TitleKeywordSource = "market" | "breakdown" | "blue-ocean" | "manual";
export type TitleGenerationStrategy = "legacy" | "stacked-v2";
export type TitleCandidateMode = "traffic" | "precise" | "category" | "blue-ocean" | "legacy";

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
  strategy?: TitleGenerationStrategy;
  targetKeywords?: string[];
}

export interface TitleAnalyzePayload {
  productName: string;
  title: string;
  categoryName?: string;
  strategy?: TitleGenerationStrategy;
  targetKeywords?: string[];
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
  strategy?: TitleGenerationStrategy;
  strictPass?: boolean;
  targetHits?: Array<{ target: string; matched: string; kind: "exact" | "replacement" | "expanded"; source: "manual" | "excel"; rank?: number; category?: string }>;
  sourceTerms?: Array<{ text: string; source: TitleKeywordSource | "manual" | "derived" | "rule"; parent?: string; rank?: number; category?: string }>;
  blockedTerms?: string[];
  unplacedTerms?: string[];
}

export interface TitleGenerationDiagnostics {
  poolSize: number;
  recalledSize: number;
  generatedCount: number;
  elapsedMs: number;
  exactFitCount?: number;
  strictRejectedCount?: number;
  legacyCandidateCount?: number;
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

export interface CloudReview {
  status: "idle" | "checking" | "passed" | "warning" | "error";
  valid?: boolean;
  account?: string;
  name?: string;
  confidence?: number;
  reason?: string;
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
  createdAt?: string;
  cloudReview?: CloudReview;
}

export interface RecognitionResult {
  account: string;
  name: string;
  confidence: number;
  reason: string;
  source: "rules" | "text-model" | "vision-model" | "manual";
  rawText?: string;
}

export type RecognitionFinalChoiceMode = "local" | "manual" | "cloud";

export interface RecognitionLearningPayload {
  rawText?: string;
  localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">;
  cloudReview?: CloudReview;
  finalChoice: { account: string; name: string; mode: RecognitionFinalChoiceMode };
}

export interface RecognitionLearningResult {
  note: string;
  reason: string;
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
  error?: string;
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
  apiType: "openai",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  textModel: "gpt-4.1-mini",
  visionModel: "gpt-4.1-mini"
};

export const DEFAULT_TITLE_KEYWORD_EXCEL_PATH = "C:\\Users\\87850\\Desktop\\市场关键词帛先生.xlsx";
export const DEFAULT_GITHUB_UPDATE_OWNER = "Misakii1k";
export const DEFAULT_GITHUB_UPDATE_REPO = "alipay-rebate-workbench-releases";
export const DEFAULT_GITHUB_UPDATE_URL = `https://github.com/${DEFAULT_GITHUB_UPDATE_OWNER}/${DEFAULT_GITHUB_UPDATE_REPO}`;

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
  exportNameOwner: "",
  fixedTailAccount: "",
  fixedTailName: "",
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
  videoSpeedMode: false,
  videoScanMode: "auto",
  videoTemplate: "bos-template",
  videoOutputSize: "auto",
  videoQualityMode: "preserve",
  updateFeedUrl: DEFAULT_GITHUB_UPDATE_URL,
  reviewRootDir: "",
  reviewProfessionalLevel: 2,
  reviewBuyerLevel: 4,
  reviewExaggerationLevel: 2,
  reviewSceneLevel: 3,
  reviewMentionValue: true,
  reviewProductDescription: "",
  reviewCopyCount: 6,
  titleKeywordExcelPath: DEFAULT_TITLE_KEYWORD_EXCEL_PATH,
  sliceMusicPresetId: "",
  sliceCustomMusicPath: "",
  reviewApiProfileId: "",
  reviewCustomPrompt: "",
  reviewSavedCopies: [],
  reviewFavoriteQueries: [],
  reviewGenerateHotkey: "Ctrl+Enter",
  reviewWorkspaceMode: "mixed",
  reviewTargetLength: 80,
  reviewThinkingMode: "auto",
  titleAiSelectionEnabled: true,
  titleExtraKeywords: "",
  compareAutoOpenReminderDialog: true,
  compareShowPassedRowsAfterVerify: true,
  fontScale: "normal",
  performanceMode: "auto",
  lastSeenChangelogVersion: "",
  everythingEsPath: "",
  sidebarCollapsed: false
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
  account: "",
  name: "",
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
  const normalizedVideoScanMode = normalizeVideoScanMode(raw.videoScanMode, Boolean(raw.videoSpeedMode));
  const legacyProfile: ApiProfile = {
    ...DEFAULT_API_PROFILE,
    apiType: (raw as unknown as Record<string, unknown>).apiType === "anthropic" ? "anthropic" : "openai",
    apiBaseUrl: String(raw.apiBaseUrl ?? DEFAULT_API_PROFILE.apiBaseUrl),
    apiKey: String(raw.apiKey ?? DEFAULT_API_PROFILE.apiKey),
    textModel: String(raw.textModel ?? DEFAULT_API_PROFILE.textModel),
    visionModel: String(raw.visionModel ?? DEFAULT_API_PROFILE.visionModel)
  };
  const loadedProfiles = Array.isArray(raw.apiProfiles) ? raw.apiProfiles : [];
  const profiles: ApiProfile[] = loadedProfiles.length
    ? loadedProfiles.map((profile, index) => ({
        ...DEFAULT_API_PROFILE,
        id: String(profile.id || `profile-${index + 1}`),
        name: String(profile.name || `配置 ${index + 1}`),
        apiType: ((profile as unknown as Record<string, unknown>).apiType === "anthropic" ? "anthropic" : "openai") as ApiType,
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
    videoSpeedMode: normalizedVideoScanMode === "speed",
    videoScanMode: normalizedVideoScanMode,
    videoTemplate: normalizeVideoTemplate(raw.videoTemplate),
    videoOutputSize: normalizeVideoOutputSize(raw.videoOutputSize),
    videoQualityMode: normalizeVideoQualityMode(raw.videoQualityMode),
    updateFeedUrl: String(raw.updateFeedUrl ?? DEFAULT_GITHUB_UPDATE_URL),
    reviewRootDir: String(raw.reviewRootDir ?? ""),
    reviewProfessionalLevel: clampNumber(raw.reviewProfessionalLevel, 0, 5, DEFAULT_SETTINGS.reviewProfessionalLevel),
    reviewBuyerLevel: clampNumber(raw.reviewBuyerLevel, 0, 5, DEFAULT_SETTINGS.reviewBuyerLevel),
    reviewExaggerationLevel: clampNumber(raw.reviewExaggerationLevel, 0, 5, DEFAULT_SETTINGS.reviewExaggerationLevel),
    reviewSceneLevel: clampNumber(raw.reviewSceneLevel, 0, 5, DEFAULT_SETTINGS.reviewSceneLevel),
    reviewMentionValue: Boolean(raw.reviewMentionValue ?? DEFAULT_SETTINGS.reviewMentionValue),
    reviewProductDescription: String(raw.reviewProductDescription ?? ""),
    reviewCopyCount: clampNumber(raw.reviewCopyCount, 3, 12, DEFAULT_SETTINGS.reviewCopyCount),
    titleKeywordExcelPath: String(raw.titleKeywordExcelPath ?? DEFAULT_SETTINGS.titleKeywordExcelPath),
    sliceMusicPresetId: String(raw.sliceMusicPresetId ?? ""),
    sliceCustomMusicPath: String(raw.sliceCustomMusicPath ?? ""),
    reviewApiProfileId: String(raw.reviewApiProfileId ?? ""),
    reviewCustomPrompt: String(raw.reviewCustomPrompt ?? ""),
    reviewSavedCopies: Array.isArray(raw.reviewSavedCopies) ? raw.reviewSavedCopies.filter((x: unknown) => typeof x === "string").slice(0, 200) : [],
    reviewFavoriteQueries: Array.isArray(raw.reviewFavoriteQueries) ? raw.reviewFavoriteQueries.filter((x: unknown) => typeof x === "string").slice(0, 100) : [],
    reviewGenerateHotkey: String(raw.reviewGenerateHotkey ?? DEFAULT_SETTINGS.reviewGenerateHotkey),
    reviewWorkspaceMode: normalizeReviewWorkspaceMode(raw.reviewWorkspaceMode),
    reviewTargetLength: clampNumber(raw.reviewTargetLength, 30, 100, DEFAULT_SETTINGS.reviewTargetLength),
    reviewThinkingMode: normalizeReviewThinkingMode(raw.reviewThinkingMode),
    titleAiSelectionEnabled: Boolean(raw.titleAiSelectionEnabled ?? DEFAULT_SETTINGS.titleAiSelectionEnabled),
    titleExtraKeywords: String(raw.titleExtraKeywords ?? ""),
    compareAutoOpenReminderDialog: Boolean(raw.compareAutoOpenReminderDialog ?? DEFAULT_SETTINGS.compareAutoOpenReminderDialog),
    compareShowPassedRowsAfterVerify: Boolean(raw.compareShowPassedRowsAfterVerify ?? DEFAULT_SETTINGS.compareShowPassedRowsAfterVerify),
    fontScale: normalizeFontScale(raw.fontScale),
    performanceMode: normalizePerformanceMode(raw.performanceMode),
    lastSeenChangelogVersion: String(raw.lastSeenChangelogVersion ?? ""),
    everythingEsPath: String(raw.everythingEsPath ?? ""),
    sidebarCollapsed: Boolean(raw.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed)
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

function normalizeVideoScanMode(value: unknown, legacySpeedMode = false): VideoScanMode {
  if (value === "speed" || value === "preview" || value === "auto") return value;
  return legacySpeedMode ? "speed" : "auto";
}

function normalizeVideoOutputSize(value: unknown): VideoOutputSize {
  return value === "portrait-1080" || value === "portrait-720" || value === "story-1080" ? value : "auto";
}

function normalizeVideoQualityMode(value: unknown): VideoQualityMode {
  return value === "high" || value === "balanced" ? value : "preserve";
}

function normalizeFontScale(value: unknown): FontScale {
  return value === "small" || value === "large" ? value : "normal";
}

function normalizePerformanceMode(value: unknown): PerformanceMode {
  return value === "quality" || value === "balanced" || value === "low" ? value : "auto";
}

function normalizeReviewWorkspaceMode(value: unknown): ReviewWorkspaceMode {
  return value === "search" || value === "ai" || value === "mixed" ? value : "mixed";
}

function normalizeReviewThinkingMode(value: unknown): ReviewThinkingMode {
  return value === "on" || value === "auto" ? value : "off";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export const ANTHROPIC_API_VERSION = "2023-06-01";

export function detectModelCapabilities(modelId: string, apiType?: string): { supportsThinking: boolean; supportsReasoningEffort: boolean; isVision: boolean } {
  const id = modelId.toLowerCase();
  if (apiType === "anthropic") {
    const isVision = id.includes("claude-4") || id.includes("claude-3.7") || id.includes("claude-sonnet-4") || id.includes("claude-opus-4");
    return { supportsThinking: true, supportsReasoningEffort: false, isVision };
  }
  const isReasoning = /^(o1|o3|o4|gpt-5)/.test(id);
  const isVisionModel = /vision|llava|gemini.*vision|gpt-4o|gpt-5|claude/i.test(id);
  return { supportsThinking: false, supportsReasoningEffort: isReasoning, isVision: isVisionModel };
}
