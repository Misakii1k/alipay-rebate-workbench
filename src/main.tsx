import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-sc";
import "./styles.css";
import "./apple.css";
import { DEFAULT_SETTINGS, DEFAULT_WORKBENCH_STATE, normalizeSettings } from "./lib/shared";

document.documentElement.setAttribute("data-ui-design", "claude");
localStorage.removeItem("app-ui-design");

if (!window.alipayWorkbench) {
  window.alipayWorkbench = {
    loadSettings: async () => {
      const saved = localStorage.getItem("alipay-workbench-settings");
      return saved ? normalizeSettings(JSON.parse(saved)) : DEFAULT_SETTINGS;
    },
    saveSettings: async (settings) => {
      localStorage.setItem("alipay-workbench-settings", JSON.stringify(settings));
      return settings;
    },
    loadWorkbenchState: async () => {
      const saved = localStorage.getItem("alipay-workbench-state");
      return saved ? { ...DEFAULT_WORKBENCH_STATE, ...JSON.parse(saved) } : DEFAULT_WORKBENCH_STATE;
    },
    saveWorkbenchState: async (state) => {
      const next = { ...DEFAULT_WORKBENCH_STATE, ...state, savedAt: new Date().toISOString() };
      localStorage.setItem("alipay-workbench-state", JSON.stringify(next));
      return next;
    },
    loadVideoWorkbenchState: async () => {
      const saved = localStorage.getItem("alipay-video-workbench-state");
      return saved ? JSON.parse(saved) : { tasks: [], currentIndex: 0 };
    },
    saveVideoWorkbenchState: async (state) => {
      const next = { ...state, savedAt: new Date().toISOString() };
      localStorage.setItem("alipay-video-workbench-state", JSON.stringify(next));
      return next;
    },
    appendLog: async (level, message, meta) => {
      const saved = JSON.parse(localStorage.getItem("alipay-workbench-logs") || "[]");
      saved.push({ time: new Date().toISOString(), level, message, meta });
      localStorage.setItem("alipay-workbench-logs", JSON.stringify(saved.slice(-200)));
    },
    minimizeWindow: async () => undefined,
    toggleMaximizeWindow: async () => undefined,
    closeWindow: async () => undefined,
    selectFiles: async () => ({ canceled: true, paths: [] }),
    getPathForFile: (file) => (file as File & { path?: string }).path || "",
    selectDirectory: async () => ({ canceled: true, paths: [] }),
    selectTitleKeywordExcel: async () => ({ canceled: true, paths: [] }),
    loadTitleKeywordData: async (settings) => ({
      excelPath: settings.titleKeywordExcelPath,
      loadedAt: new Date().toISOString(),
      categories: [],
      totalKeywords: 0,
      warnings: ["浏览器预览模式无法读取本地 Excel，请使用桌面端。"]
    }),
    generateTitleCandidates: async () => ({
      ok: false,
      message: "浏览器预览模式无法读取本地 Excel，请使用桌面端。",
      product: { originalName: "", normalizedName: "", season: "", series: "", model: "", materials: [], category: "unknown", features: [] },
      candidates: [],
      warnings: ["浏览器预览模式无法读取本地 Excel。"]
    }),
    analyzeTitle: async (_settings, payload) => ({
      ok: false,
      message: "浏览器预览模式无法读取本地 Excel，请使用桌面端。",
      product: { originalName: payload.productName, normalizedName: payload.productName, season: "", series: "", model: "", materials: [], category: "unknown", features: [] },
      title: payload.title,
      body: payload.title,
      bodyBytes: 0,
      totalBytes: 0,
      score: 0,
      grade: "blocked",
      candidate: null,
      recommendations: [{ type: "missing-element" as const, message: "浏览器预览不可用", detail: "请使用桌面端", estimatedGain: 0 }],
      substringHits: [],
      suggestedTitles: [],
      warnings: ["浏览器预览模式无法读取本地 Excel。"]
    }),
    getFfmpegStatus: async () => ({ available: false, path: "", detail: "浏览器预览模式无法检测内置 FFmpeg，请使用桌面端。", acceleration: "浏览器预览不可用" }),
    diagnoseFfmpeg: async () => ({ items: [], suggestions: ["浏览器预览模式不支持诊断，请使用桌面端。"], ok: false }),
    autoFixFfmpeg: async () => ({ fixed: [], failed: ["浏览器预览模式不支持自动修复"], settingsPatch: null }),
    scanVideoLibrary: async () => [],
    renderVideoTask: async () => ({ success: false, log: "", error: "浏览器预览模式不执行 FFmpeg，请使用桌面端。" }),
    cancelVideoRender: async () => ({ canceled: false }),
    onVideoRenderProgress: () => () => undefined,
    getLatestImageInDirectory: async () => "",
    getImagePreview: async () => "",
    scanReviewAssets: async () => [],
    loadReviewThumbnails: async () => ({}),
    loadReviewThumbnailBatch: async () => ({}),
    loadReviewFolderChildren: async () => [],
    rebuildReviewIndex: async () => ({ ok: false, total: 0 }),
    onReviewScanProgress: () => () => undefined,
    startDragFiles: async () => undefined,
    enhanceTitlePool: async () => ({ ok: false, selected: [], suggested: [], reason: "浏览器预览模式不支持 AI 选词" }),
    generateReviewCopy: async () => ({ copies: [] }),
    reviewChat: async () => ({ reply: "浏览器预览模式不支持 AI 对话，请使用桌面端。" }),
    testModelConnection: async () => ({ state: "failed", detail: "浏览器预览模式不支持后台连接测试，请使用桌面端。" }),
    listAvailableModels: async () => [],
    testEverythingConnection: async () => ({ available: false, detail: "浏览器预览模式不支持 Everything 测试" }),
    checkForUpdates: async () => ({ state: "idle", detail: "浏览器预览模式不检查更新" }),
    downloadUpdate: async () => undefined,
    installUpdate: async () => undefined,
    onUpdateStatus: () => () => undefined,
    readClipboard: async () => {
      const text = await navigator.clipboard?.readText?.().catch(() => "");
      return text
        ? { kind: "text", text, signature: `text:${text}` }
        : { kind: "empty", signature: "empty" };
    },
    writeClipboardText: async (text) => {
      await navigator.clipboard?.writeText?.(text);
    },
    exportWorkbook: async () => {
      alert("浏览器预览模式不导出 Excel；Electron 窗口启动后会调用系统保存对话框导出。");
      return { canceled: true };
    },
    recognizeText: async (text) => {
      const { recognizeByRules, recognizePartialByRules } = await import("./lib/recognition");
      const rules = recognizeByRules(text);
      if (rules) return rules;
      const partial = recognizePartialByRules(text);
      if (partial) return partial;
      throw new Error("浏览器预览模式下本地规则无法识别，且不支持云端 AI 识别。");
    },
    reviewRecognitionCloud: async () => ({ status: "error", reason: "浏览器预览模式不支持云端校验，请使用桌面端。" }),
    learnFromChoice: async () => ({ note: "", reason: "浏览器预览模式不支持学习反馈" })
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
