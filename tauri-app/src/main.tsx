import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./assets/fonts/harmonyos-sans.css";
import "./styles.css";
import "./claude.css";
import "./apple.css";
import { DEFAULT_SETTINGS, DEFAULT_WORKBENCH_STATE, normalizeSettings } from "./lib/shared";
import { isTauri, alipayWorkbench } from "@/lib/tauri-bridge";

document.documentElement.setAttribute("data-ui-design", "claude");
localStorage.removeItem("app-ui-design");

// 全局 window.alipayWorkbench 兼容层
// - Tauri 模式：使用真实 invoke 桥接（@/lib/tauri-bridge 导出的 alipayWorkbench）
// - 浏览器预览模式：保留原 localStorage mock，作为浏览器 fallback
if (isTauri()) {
  // Tauri 模式：使用真实 invoke 桥接
  (window as unknown as { alipayWorkbench: typeof alipayWorkbench }).alipayWorkbench = alipayWorkbench;
} else {
  // 浏览器预览模式：使用 localStorage mock（保留原 mock 实现作为浏览器预览 fallback）
  (window as unknown as { alipayWorkbench: typeof alipayWorkbench }).alipayWorkbench = {
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
    getPathForFileAsync: async (file) => (file as File & { path?: string }).path || "",
    consumeRecentDropPaths: () => [],
    selectDirectory: async () => ({ canceled: true, paths: [] }),
    getFfmpegStatus: async () => ({ available: false, path: "", detail: "浏览器预览模式无法检测内置 FFmpeg，请使用桌面端。", acceleration: "浏览器预览不可用" }),
    diagnoseFfmpeg: async () => ({ items: [], suggestions: ["浏览器预览模式不支持诊断，请使用桌面端。"], ok: false }),
    autoFixFfmpeg: async () => ({ fixed: [], failed: ["浏览器预览模式不支持自动修复"], settingsPatch: null }),
    scanVideoLibrary: async () => [],
    renderVideoTask: async () => ({ success: false, log: "", error: "浏览器预览模式不执行 FFmpeg，请使用桌面端。" }),
    cancelVideoRender: async () => ({ canceled: false }),
    onVideoRenderProgress: () => () => undefined,
    getLatestImageInDirectory: async () => "",
    getImagePreview: async () => "",
    processImages: async () => [],
    generateImages: async () => [],
    scanReviewAssets: async () => [],
    loadReviewThumbnails: async () => ({}),
    loadReviewThumbnailBatch: async () => ({}),
    loadReviewFolderChildren: async () => [],
    rebuildReviewIndex: async () => ({ ok: false, total: 0 }),
    onReviewScanProgress: () => () => undefined,
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
      alert("浏览器预览模式不导出 Excel；Tauri 窗口启动后会调用系统保存对话框导出。");
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
  } as typeof alipayWorkbench;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
