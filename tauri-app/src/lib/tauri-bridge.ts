/**
 * Tauri Bridge
 * 统一封装所有 Tauri 命令调用，对外提供与原 Electron `window.alipayWorkbench` 一致的 API 接口。
 *
 * - 命令名采用 snake_case，对应后端 Rust 函数命名规范（如 `settings_load`、`video_render_task`）。
 * - 文件选择对话框、剪切板、窗口控制等可直接由前端 Tauri 插件完成的操作，直接走插件，不走 invoke。
 * - 后端 Rust 命令尚未实现（阶段 3），这里保证类型签名正确，运行时调用会失败直到后端就绪。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type {
  AppSettings,
  ClipboardSnapshot,
  CloudReview,
  DirectoryCapabilityKind,
  ExportPayload,
  ExportResult,
  FfmpegStatus,
  ModelConnectionStatus,
  RecognitionLearningPayload,
  RecognitionLearningResult,
  RecognitionResult,
  ReviewChatPayload,
  ReviewChatResult,
  ReviewGenerationOptions,
  ReviewGenerationResult,
  ReviewSearchResult,
  SelectFilesOptions,
  SelectPathResult,
  UpdateStatus,
  VideoCandidate,
  VideoRenderPayload,
  VideoRenderProgress,
  VideoRenderResult,
  VideoWorkbenchState,
  WorkbenchState
} from "./shared";

/** 检测当前是否运行在 Tauri 环境中。 */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

let latestDragDrop: { paths: string[]; x: number; y: number; at: number } | null = null;

/** 自定义拖放事件名：绕开 WebView2 拦截原生拖放、DOM onDrop 拿不到文件的问题。 */
export const TAURI_FILE_DROP_EVENT = "tauri-files-drop";

if (typeof window !== "undefined" && isTauri()) {
  getCurrentWebview().onDragDropEvent((event: { payload: DragDropEvent }) => {
    if (event.payload.type === "drop") {
      const paths = event.payload.paths ?? [];
      // Tauri 给的是物理像素坐标；Windows 缩放(125%/150%)下需除以 devicePixelRatio
      // 换算成 CSS 像素，否则 elementFromPoint / getBoundingClientRect 命中判断会错位。
      const ratio = window.devicePixelRatio || 1;
      const cssX = event.payload.position.x / ratio;
      const cssY = event.payload.position.y / ratio;
      latestDragDrop = { paths, x: cssX, y: cssY, at: Date.now() };

      // 命中拖放位置下的元素并派发冒泡自定义事件，让对应放置区接收文件路径。
      // 这是 Tauri 下拖放导入的主路径（DOM 原生 drop 在 WebView2 里通常不带文件）。
      if (paths.length > 0) {
        const target = document.elementFromPoint(cssX, cssY);
        if (target) {
          target.dispatchEvent(
            new CustomEvent(TAURI_FILE_DROP_EVENT, { bubbles: true, detail: { paths } })
          );
        }
      }
    }
  }).catch(() => undefined);
}

/** 把 File 对象（来自 input/drag）转换为本地路径。Tauri 环境下走 invoke；浏览器回退 file.path。 */
async function resolveFilePath(file: File): Promise<string> {
  if (isTauri()) {
    try {
      // 后端通过 webview drag-drop 拿到路径；这里兜底走 invoke
      const path = await invoke<string>("files_get_path_for_file", { file });
      if (path) return path;
    } catch {
      // 忽略，走 fallback
    }
  }
  return (file as File & { path?: string }).path || "";
}

function consumeRecentDropPaths(rect?: DOMRect | null): string[] {
  const drop = latestDragDrop;
  if (!drop || Date.now() - drop.at > 1500) return [];
  if (rect) {
    const inside = drop.x >= rect.left && drop.x <= rect.right && drop.y >= rect.top && drop.y <= rect.bottom;
    if (!inside) return [];
  }
  latestDragDrop = null;
  return drop.paths;
}

/** 根据文件选择 kind 构造 Tauri dialog 过滤器。 */
function filtersForKind(kind: SelectFilesOptions["kind"]): Array<{ name: string; extensions: string[] }> {
  switch (kind) {
    case "image":
      return [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }];
    case "video":
      return [{ name: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }];
    case "audio":
      return [{ name: "音频", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }];
    case "ffmpeg":
      return [
        { name: "可执行", extensions: ["exe", "bat", "cmd", "ps1"] },
        { name: "全部", extensions: ["*"] }
      ];
    default:
      return [{ name: "全部", extensions: ["*"] }];
  }
}

/**
 * alipayWorkbench 与原 Electron preload.ts 暴露的 API 完全一致。
 * 调用方式：`alipayWorkbench.loadSettings()` 等，与原 `window.alipayWorkbench.loadSettings()` 等价。
 */
export const alipayWorkbench = {
  // ---------------- settings ----------------
  loadSettings: (): Promise<AppSettings> => invoke<AppSettings>("settings_load"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => invoke<AppSettings>("settings_save", { settings }),

  // ---------------- workbench ----------------
  loadWorkbenchState: (): Promise<WorkbenchState> => invoke<WorkbenchState>("workbench_load"),
  saveWorkbenchState: (state: WorkbenchState): Promise<WorkbenchState> => invoke<WorkbenchState>("workbench_save", { state }),

  // ---------------- video workbench ----------------
  loadVideoWorkbenchState: (): Promise<VideoWorkbenchState> => invoke<VideoWorkbenchState>("video_workbench_load"),
  saveVideoWorkbenchState: (state: VideoWorkbenchState): Promise<VideoWorkbenchState> => invoke<VideoWorkbenchState>("video_workbench_save", { state }),

  // ---------------- log ----------------
  appendLog: (level: "info" | "warn" | "error", message: string, meta?: unknown): Promise<void> =>
    invoke<void>("log_append", { level, message, meta }),

  // ---------------- window control ----------------
  minimizeWindow: async (): Promise<void> => {
    await getCurrentWindow().minimize();
  },
  toggleMaximizeWindow: async (): Promise<void> => {
    await getCurrentWindow().toggleMaximize();
  },
  closeWindow: async (): Promise<void> => {
    await getCurrentWindow().close();
  },

  // ---------------- files ----------------
  selectFiles: async (options: SelectFilesOptions): Promise<SelectPathResult> => {
    if (isTauri()) {
      const result = await openDialog({
        multiple: options.multi === true,
        filters: filtersForKind(options.kind)
      });
      if (result === null || result === undefined) {
        return { canceled: true, paths: [] };
      }
      const paths = Array.isArray(result) ? result.filter((p): p is string => typeof p === "string") : [String(result)];
      return { canceled: paths.length === 0, paths };
    }
    return { canceled: true, paths: [] };
  },
  getPathForFile: (file: File): string => {
    // 同步签名保留；如需走 invoke，调用方应改用 async 版本
    return (file as File & { path?: string }).path || "";
  },
  getPathForFileAsync: (file: File): Promise<string> => resolveFilePath(file),
  consumeRecentDropPaths: (rect?: DOMRect | null): string[] => consumeRecentDropPaths(rect),
  selectDirectory: async (title: string, _kind?: DirectoryCapabilityKind): Promise<SelectPathResult> => {
    if (isTauri()) {
      const result = await openDialog({ directory: true, title });
      if (result === null || result === undefined) {
        return { canceled: true, paths: [] };
      }
      const path = String(result);
      return { canceled: !path, paths: path ? [path] : [] };
    }
    return { canceled: true, paths: [] };
  },

  // ---------------- ffmpeg ----------------
  getFfmpegStatus: (settings: AppSettings): Promise<FfmpegStatus> => invoke<FfmpegStatus>("ffmpeg_status", { settings }),
  diagnoseFfmpeg: (settings: AppSettings): Promise<{ items: Array<{ label: string; passed: boolean; detail: string }>; suggestions: string[]; ok: boolean }> =>
    invoke("ffmpeg_diagnose", { settings }),
  autoFixFfmpeg: (settings: AppSettings): Promise<{ fixed: string[]; failed: string[]; settingsPatch: Partial<AppSettings> | null }> =>
    invoke("ffmpeg_auto_fix", { settings }),

  // ---------------- video ----------------
  scanVideoLibrary: (
    settings: AppSettings,
    productName: string,
    colorName: string,
    speedMode?: boolean,
    requestId?: string
  ): Promise<VideoCandidate[]> =>
    invoke<VideoCandidate[]>("video_scan_library", { settings, productName, colorName, speedMode, requestId }),
  renderVideoTask: (payload: VideoRenderPayload): Promise<VideoRenderResult> => invoke<VideoRenderResult>("video_render_task", { payload }),
  cancelVideoRender: (taskId: string): Promise<{ canceled: boolean }> => invoke<{ canceled: boolean }>("video_cancel_render", { taskId }),
  onVideoRenderProgress: (callback: (progress: VideoRenderProgress) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    listen<VideoRenderProgress>("video_render_progress", (event) => {
      callback(event.payload);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  },

  // ---------------- media ----------------
  getLatestImageInDirectory: (dir: string): Promise<string> => invoke<string>("media_latest_image", { dir }),
  getImagePreview: (filePath: string): Promise<string> => invoke<string>("media_image_preview", { filePath }),

  // ---------------- review ----------------
  scanReviewAssets: (
    root: string,
    query: string,
    settings?: AppSettings,
    requestId?: string
  ): Promise<ReviewSearchResult[]> =>
    invoke<ReviewSearchResult[]>("review_scan_assets", { root, query, settings, requestId }),
  loadReviewThumbnails: (paths: string[]): Promise<Record<string, string>> =>
    invoke<Record<string, string>>("review_load_thumbnails", { paths }),
  loadReviewThumbnailBatch: (paths: string[], size?: number, root?: string): Promise<Record<string, string>> =>
    invoke<Record<string, string>>("review_load_thumbnail_batch", { paths, size, root }),
  loadReviewFolderChildren: (
    root: string,
    folderPath: string,
    offset?: number,
    limit?: number
  ): Promise<ReviewSearchResult[]> =>
    invoke<ReviewSearchResult[]>("review_load_folder_children", { root, folderPath, offset, limit }),
  rebuildReviewIndex: (root: string): Promise<{ ok: boolean; total: number }> =>
    invoke<{ ok: boolean; total: number }>("review_rebuild_index", { root }),
  onReviewScanProgress: (
    callback: (progress: { scanned: number; currentDir: string; phase: string; elapsedMs?: number }) => void
  ): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    listen<{ scanned: number; currentDir: string; phase: string; elapsedMs?: number }>("review_scan_progress", (event) => {
      callback(event.payload);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  },

  // ---------------- drag ----------------
  startDragFiles: (paths: string[]): Promise<void> => invoke<void>("drag_start_files", { paths }),

  // ---------------- review generation / chat ----------------
  generateReviewCopy: (settings: AppSettings, options: ReviewGenerationOptions): Promise<ReviewGenerationResult> =>
    invoke<ReviewGenerationResult>("review_generate_copy", { settings, options }),
  reviewChat: (settings: AppSettings, payload: ReviewChatPayload): Promise<ReviewChatResult> =>
    invoke<ReviewChatResult>("review_chat", { settings, payload }),

  // ---------------- ai ----------------
  testModelConnection: (settings: AppSettings): Promise<ModelConnectionStatus> =>
    invoke<ModelConnectionStatus>("ai_test_connection", { settings }),
  listAvailableModels: (settings: AppSettings): Promise<{ id: string; name: string }[]> =>
    invoke<{ id: string; name: string }[]>("ai_list_models", { settings }),

  // ---------------- everything ----------------
  testEverythingConnection: (settings: AppSettings): Promise<{ available: boolean; detail: string }> =>
    invoke<{ available: boolean; detail: string }>("everything_test", { settings }),

  // ---------------- updater ----------------
  checkForUpdates: (settings: AppSettings): Promise<UpdateStatus> =>
    invoke<UpdateStatus>("update_check", { settings }),
  downloadUpdate: (): Promise<unknown> => invoke<unknown>("update_download"),
  installUpdate: async (): Promise<void> => {
    // 优先使用 Tauri updater 插件
    try {
      const update = await checkUpdate();
      if (update) {
        await update.downloadAndInstall();
        return;
      }
    } catch {
      // 回退到 invoke
    }
    await invoke<void>("update_install");
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    listen<UpdateStatus>("update_status", (event) => {
      callback(event.payload);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  },

  // ---------------- clipboard ----------------
  readClipboard: (): Promise<ClipboardSnapshot> => invoke<ClipboardSnapshot>("clipboard_read"),
  writeClipboardText: async (text: string): Promise<void> => {
    if (isTauri()) {
      await writeText(text);
      return;
    }
    await navigator.clipboard?.writeText?.(text);
  },

  // ---------------- export ----------------
  exportWorkbook: async (payload: ExportPayload): Promise<ExportResult> => {
    if (isTauri()) {
      // 优先调用 Tauri save 对话框获取输出路径，再走后端导出
      try {
        const filePath = await saveDialog({
          defaultPath: payload.defaultFileName.endsWith(".xlsx") ? payload.defaultFileName : `${payload.defaultFileName}.xlsx`,
          filters: [{ name: "Excel", extensions: ["xlsx"] }]
        });
        if (!filePath) {
          return { canceled: true };
        }
        return await invoke<ExportResult>("export_workbook", { payload, filePath });
      } catch {
        return await invoke<ExportResult>("export_workbook", { payload });
      }
    }
    return invoke<ExportResult>("export_workbook", { payload });
  },

  // ---------------- recognition ----------------
  recognizeText: (text: string, settings: AppSettings): Promise<RecognitionResult> =>
    invoke<RecognitionResult>("recognition_recognize_text", { text, settings }),
  reviewRecognitionCloud: (
    rawText: string,
    localResult: Pick<RecognitionResult, "account" | "name" | "confidence" | "reason">,
    settings: AppSettings
  ): Promise<CloudReview> =>
    invoke<CloudReview>("recognition_cloud_review", { rawText, localResult, settings }),
  learnFromChoice: (payload: RecognitionLearningPayload, settings: AppSettings): Promise<RecognitionLearningResult> =>
    invoke<RecognitionLearningResult>("recognition_learn_from_choice", { payload, settings })
};

export type AlipayWorkbenchApi = typeof alipayWorkbench;
