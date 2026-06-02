import { type IpcMain } from "electron";
import type { AppSettings } from "../../src/lib/shared";
import { loadSettings, saveSettings } from "../utils/settings";

/**
 * 注册设置相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("settings:load", loadSettings);
  ipcMain.handle("settings:save", (_event, settings: AppSettings) => saveSettings(settings));
}