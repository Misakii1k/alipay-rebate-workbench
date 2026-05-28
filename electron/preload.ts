import * as electron from "electron";
import type {
  AppSettings,
  ClipboardSnapshot,
  ExportPayload,
  ExportResult,
  FfmpegStatus,
  CloudReview,
  ModelConnectionStatus,
  RecognitionResult,
  ReviewGenerationOptions,
  ReviewGenerationResult,
  ReviewSearchResult,
  SelectFilesOptions,
  SelectPathResult,
  TitleAnalysisResult,
  TitleAnalyzePayload,
  TitleGeneratePayload,
  TitleKeywordData,
  TitleScoreResult,
  UpdateStatus,
  VideoCandidate,
  VideoRenderProgress,
  VideoRenderPayload,
  VideoRenderResult,
  VideoWorkbenchState,
  WorkbenchState
} from "../src/lib/shared";

const { contextBridge, ipcRenderer } = electron;
const webUtils = (electron as typeof electron & { webUtils?: { getPathForFile: (file: File) => string } }).webUtils;

const api = {
  loadSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("settings:save", settings),
  loadWorkbenchState: (): Promise<WorkbenchState> => ipcRenderer.invoke("workbench:load"),
  saveWorkbenchState: (state: WorkbenchState): Promise<WorkbenchState> => ipcRenderer.invoke("workbench:save", state),
  loadVideoWorkbenchState: (): Promise<VideoWorkbenchState> => ipcRenderer.invoke("videoWorkbench:load"),
  saveVideoWorkbenchState: (state: VideoWorkbenchState): Promise<VideoWorkbenchState> => ipcRenderer.invoke("videoWorkbench:save", state),
  appendLog: (level: "info" | "warn" | "error", message: string, meta?: unknown): Promise<void> => ipcRenderer.invoke("log:append", level, message, meta),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  selectFiles: (options: SelectFilesOptions): Promise<SelectPathResult> => ipcRenderer.invoke("files:select", options),
  getPathForFile: (file: File): string => webUtils?.getPathForFile(file) || (file as File & { path?: string }).path || "",
  selectDirectory: (title: string): Promise<SelectPathResult> => ipcRenderer.invoke("directory:select", title),
  selectTitleKeywordExcel: (): Promise<SelectPathResult> => ipcRenderer.invoke("title:selectExcel"),
  loadTitleKeywordData: (settings: AppSettings): Promise<TitleKeywordData> => ipcRenderer.invoke("title:loadKeywordData", settings),
  analyzeTitle: (settings: AppSettings, payload: TitleAnalyzePayload): Promise<TitleAnalysisResult> =>
    ipcRenderer.invoke("title:analyze", settings, payload),
  generateTitleCandidates: (settings: AppSettings, payload: TitleGeneratePayload): Promise<TitleScoreResult> =>
    ipcRenderer.invoke("title:generateCandidates", settings, payload),
  getFfmpegStatus: (settings: AppSettings): Promise<FfmpegStatus> => ipcRenderer.invoke("ffmpeg:status", settings),
  diagnoseFfmpeg: (settings: AppSettings): Promise<{ items: Array<{ label: string; passed: boolean; detail: string }>; suggestions: string[]; ok: boolean }> => ipcRenderer.invoke("ffmpeg:diagnose", settings),
  autoFixFfmpeg: (settings: AppSettings): Promise<{ fixed: string[]; failed: string[]; settingsPatch: Partial<AppSettings> | null }> => ipcRenderer.invoke("ffmpeg:autoFix", settings),
  scanVideoLibrary: (settings: AppSettings, productName: string, colorName: string): Promise<VideoCandidate[]> =>
    ipcRenderer.invoke("video:scanLibrary", settings, productName, colorName),
  renderVideoTask: (payload: VideoRenderPayload): Promise<VideoRenderResult> => ipcRenderer.invoke("video:renderTask", payload),
  onVideoRenderProgress: (callback: (progress: VideoRenderProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: VideoRenderProgress) => callback(progress);
    ipcRenderer.on("video:renderProgress", listener);
    return () => ipcRenderer.removeListener("video:renderProgress", listener);
  },
  getLatestImageInDirectory: (dir: string): Promise<string> => ipcRenderer.invoke("media:latestImage", dir),
  getImagePreview: (filePath: string): Promise<string> => ipcRenderer.invoke("media:imagePreview", filePath),
  scanReviewAssets: (root: string, query: string, settings?: AppSettings): Promise<ReviewSearchResult[]> => ipcRenderer.invoke("review:scanAssets", root, query, settings),
  loadReviewThumbnails: (paths: string[]): Promise<Record<string, string>> => ipcRenderer.invoke("review:loadThumbnails", paths),
  loadReviewThumbnailBatch: (paths: string[], size?: number): Promise<Record<string, string>> => ipcRenderer.invoke("review:loadThumbnailBatch", paths, size),
  rebuildReviewIndex: (root: string): Promise<{ ok: boolean; total: number }> => ipcRenderer.invoke("review:rebuildIndex", root),
  onReviewScanProgress: (callback: (progress: { scanned: number; currentDir: string; phase: string; elapsedMs?: number }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { scanned: number; currentDir: string; phase: string; elapsedMs?: number }) => callback(progress);
    ipcRenderer.on("review:scanProgress", listener);
    return () => ipcRenderer.removeListener("review:scanProgress", listener);
  },
  startDragFiles: (paths: string[]): Promise<void> => ipcRenderer.invoke("drag:startFiles", paths),
  enhanceTitlePool: (settings: AppSettings, payload: { productName: string; categoryName?: string; pool: Array<{ text: string; weight: number; source: string }> }): Promise<{ ok: boolean; selected: string[]; suggested: string[]; reason?: string }> => ipcRenderer.invoke("title:enhancePool", settings, payload),
  generateReviewCopy: (settings: AppSettings, options: ReviewGenerationOptions): Promise<ReviewGenerationResult> =>
    ipcRenderer.invoke("review:generateCopy", settings, options),
  recognizeText: (text: string, settings: AppSettings): Promise<RecognitionResult> =>
    ipcRenderer.invoke("recognition:recognizeText", text, settings),
  reviewRecognitionCloud: (
    rawText: string,
    localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">,
    settings: AppSettings
  ): Promise<CloudReview> => ipcRenderer.invoke("recognition:cloudReview", rawText, localResult, settings),
  testModelConnection: (settings: AppSettings): Promise<ModelConnectionStatus> =>
    ipcRenderer.invoke("ai:testConnection", settings),
  listAvailableModels: (settings: AppSettings): Promise<{ id: string; name: string }[]> =>
    ipcRenderer.invoke("ai:listModels", settings),
  testEverythingConnection: (settings: AppSettings): Promise<{ available: boolean; detail: string }> =>
    ipcRenderer.invoke("everything:test", settings),
  checkForUpdates: (settings: AppSettings): Promise<UpdateStatus> => ipcRenderer.invoke("update:check", settings),
  downloadUpdate: (): Promise<unknown> => ipcRenderer.invoke("update:download"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  readClipboard: (): Promise<ClipboardSnapshot> => ipcRenderer.invoke("clipboard:read"),
  writeClipboardText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:writeText", text),
  exportWorkbook: (payload: ExportPayload): Promise<ExportResult> => ipcRenderer.invoke("export:workbook", payload)
};

contextBridge.exposeInMainWorld("alipayWorkbench", api);

export type AlipayWorkbenchApi = typeof api;
