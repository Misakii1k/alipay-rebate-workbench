import { autoUpdater } from "electron-updater";
import { type IpcMain } from "electron";
import type { AppSettings } from "../../src/lib/shared";
import { checkForUpdates, setMainWindow } from "../utils/updater";

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
export { initializeAutoUpdater, setMainWindow } from "../utils/updater";