import type { IpcMain } from "electron";
import * as settingsHandler from "./settings";
import * as workbenchHandler from "./workbench";
import * as windowHandler from "./window";
import * as clipboardHandler from "./clipboard";
import * as exportHandler from "./export";
import * as mediaHandler from "./media";
import * as aiHandler from "./ai";
import * as everythingHandler from "./everything";

/**
 * 注册所有已模块化的 IPC handlers。
 *
 * 已完成的 handlers（9个）：
 * - settings (2个): settings:load, settings:save
 * - workbench (4个): workbench:load/save, videoWorkbench:load/save
 * - window (3个): window:minimize/toggleMaximize/close
 * - clipboard (2个): clipboard:read, clipboard:writeText
 * - export (1个): export:workbook
 * - media (2个): media:latestImage, media:imagePreview
 * - ai (2个): ai:testConnection, ai:listModels
 * - everything (1个): everything:test
 *
 * 待迁移的 handlers（仍在 main.ts 中）：
 * - title (6个): title:selectExcel/loadKeywordData/analyze/generateCandidates/enhancePool
 * - ffmpeg (3个): ffmpeg:status/diagnose/autoFix
 * - video (2个): video:scanLibrary/renderTask
 * - review (6个): review:scanAssets/loadThumbnails/loadThumbnailBatch/rebuildIndex/generateCopy, drag:startFiles
 * - recognition (2个): recognition:recognizeText/cloudReview
 * - update (3个): update:check/download/install
 * - files (2个): files:select, directory:select
 * - log (1个): log:append
 *
 * @param ipcMain Electron IpcMain 实例
 */
export function registerAllHandlers(ipcMain: IpcMain): void {
  // 已模块化的 handlers
  settingsHandler.register(ipcMain);
  workbenchHandler.register(ipcMain);
  windowHandler.register(ipcMain);
  clipboardHandler.register(ipcMain);
  exportHandler.register(ipcMain);
  mediaHandler.register(ipcMain);
  aiHandler.register(ipcMain);
  everythingHandler.register(ipcMain);
}
