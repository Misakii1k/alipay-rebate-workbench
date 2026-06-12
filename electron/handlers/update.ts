import { type IpcMain } from "electron";
import type { AppSettings } from "../../src/lib/shared";
import { checkForUpdates, downloadUpdate, installUpdate, setMainWindow } from "../utils/updater";
import { loadSettings } from "../utils/settings";

/**
 * 注册自动更新相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("update:check", async (_event, _settings: AppSettings) => checkForUpdates(await loadSettings()));
  ipcMain.handle("update:download", () => downloadUpdate());
  ipcMain.handle("update:install", () => installUpdate());
}

/**
 * 初始化自动更新（在 app.whenReady 后调用）。
 */
export { initializeAutoUpdater, setMainWindow } from "../utils/updater";
