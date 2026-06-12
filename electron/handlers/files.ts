import { dialog, type IpcMain, type BrowserWindow } from "electron";
import path from "node:path";
import type { DirectoryCapabilityKind, SelectFilesOptions, SelectPathResult } from "../../src/lib/shared";
import { authorizeDirectoryCapability, authorizeFileCapability } from "../utils/capabilities";
import { authorizeMediaRoot } from "./media";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

function safeAuthorizeMediaRoot(root: string): void {
  try {
    authorizeMediaRoot(root);
  } catch {
    // Selection still returns the path; preview IPC will refuse unsafe roots later.
  }
}

async function selectFiles(request: SelectFilesOptions): Promise<SelectPathResult> {
  const filters =
    request.kind === "image"
      ? [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }]
      : request.kind === "video"
        ? [{ name: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm"] }]
        : request.kind === "audio"
          ? [{ name: "音乐", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }]
          : [{ name: "FFmpeg", extensions: ["exe"] }];
  const title = request.kind === "image" ? "选择图片" : request.kind === "video" ? "选择视频" : request.kind === "audio" ? "选择音乐" : "选择 ffmpeg.exe";
  const dialogOptions = {
    title,
    properties: request.multi ? ["openFile", "multiSelections"] : ["openFile"],
    filters
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  if (request.kind === "image") {
    for (const filePath of result.filePaths) safeAuthorizeMediaRoot(path.dirname(filePath));
  }
  if (request.kind === "video" || request.kind === "audio") {
    for (const filePath of result.filePaths) safeAuthorizeMediaRoot(path.dirname(filePath));
  }
  if (request.kind === "ffmpeg") {
    for (const filePath of result.filePaths) authorizeFileCapability("ffmpeg", filePath);
  }
  return { canceled: result.canceled, paths: result.filePaths };
}

async function selectDirectory(title: string, kind: DirectoryCapabilityKind = "mediaRoot"): Promise<SelectPathResult> {
  const dialogOptions = {
    title,
    properties: ["openDirectory", "createDirectory"]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  for (const dir of result.filePaths) {
    safeAuthorizeMediaRoot(dir);
    authorizeDirectoryCapability(kind, dir);
  }
  return { canceled: result.canceled, paths: result.filePaths };
}

/**
 * 注册文件选择相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("files:select", (_event, options: SelectFilesOptions) => selectFiles(options));
  ipcMain.handle("directory:select", (_event, title: string, kind?: DirectoryCapabilityKind) => selectDirectory(title, kind));
}
