import { autoUpdater } from "electron-updater";
import { type IpcMain, type BrowserWindow } from "electron";
import type { AppSettings, UpdateStatus } from "../../src/lib/shared";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";

let mainWindow: BrowserWindow | null = null;
let updateStatus: UpdateStatus = { state: "idle", detail: "尚未检查更新" };
let updaterListenersConfigured = false;
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

function configureAutoUpdater(settings: AppSettings): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const url = settings.updateFeedUrl.trim();
  if (url) {
    // 强制 HTTPS
    if (!url.startsWith("https://")) {
      void appendLog("warn", "更新源 URL 不是 HTTPS，已拒绝", { url }, userDataPath);
      updateStatus = { state: "error", detail: "更新源 URL 必须使用 HTTPS 协议" };
      mainWindow?.webContents.send("update:status", updateStatus);
      return;
    }

    // 校验 URL 格式
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      void appendLog("warn", "更新源 URL 格式无效，已拒绝", { url }, userDataPath);
      return;
    }

    // 域名白名单校验（可根据实际情况配置）
    const ALLOWED_UPDATE_DOMAINS = [
      "example.com", // 替换为实际的更新服务器域名
      "github.com",
      "githubusercontent.com"
    ];

    const hostname = parsedUrl.hostname.toLowerCase();
    const isAllowed = ALLOWED_UPDATE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      void appendLog("error", "更新源域名不在白名单中，已拒绝", { hostname, url: url.slice(0, 50) }, userDataPath);
      updateStatus = { state: "error", detail: `更新源域名 ${hostname} 不在允许列表中` };
      mainWindow?.webContents.send("update:status", updateStatus);
      return;
    }

    autoUpdater.setFeedURL({ provider: "generic", url });
  }

  if (updaterListenersConfigured) return;
  updaterListenersConfigured = true;
  autoUpdater.on("checking-for-update", () => {
    updateStatus = { state: "checking", detail: "正在检查更新" };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("update-available", (info) => {
    const notes = String((info as { releaseNotes?: unknown }).releaseNotes ?? "");
    updateStatus = { state: "available", version: info.version, mandatory: /force|mandatory|强制/i.test(notes), detail: `发现新版本 ${info.version}` };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("update-not-available", () => {
    updateStatus = { state: "not-available", detail: "当前已是最新版本" };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("download-progress", (progress) => {
    updateStatus = { ...updateStatus, state: "downloading", percent: progress.percent, detail: `正在下载更新 ${Math.round(progress.percent)}%` };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateStatus = { ...updateStatus, state: "downloaded", version: info.version, detail: "更新已下载，重启后安装" };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
  autoUpdater.on("error", (error) => {
    updateStatus = { state: "error", detail: error.message };
    mainWindow?.webContents.send("update:status", updateStatus);
  });
}

async function checkForUpdates(settings: AppSettings): Promise<UpdateStatus> {
  if (isDev) return { state: "idle", detail: "开发模式不检查更新" };
  if (!settings.updateFeedUrl.trim()) return { state: "idle", detail: "未配置更新源" };
  configureAutoUpdater(settings);
  await autoUpdater.checkForUpdates();
  return updateStatus;
}

/**
 * 注册自动更新相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("update:check", (_event, settings: AppSettings) => checkForUpdates(settings));
  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall(false, true));
}

/**
 * 初始化自动更新（在 app.whenReady 后调用）。
 */
export async function initializeAutoUpdater(settings: AppSettings): Promise<void> {
  configureAutoUpdater(settings);
  setTimeout(() => {
    void checkForUpdates(settings).catch((error) =>
      appendLog("warn", "后台检查更新失败", { message: error.message }, userDataPath)
    );
  }, 2500);
}
