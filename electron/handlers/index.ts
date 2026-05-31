import type { IpcMain } from "electron";
import * as settingsHandler from "./settings";
import * as workbenchHandler from "./workbench";
import * as windowHandler from "./window";
import * as clipboardHandler from "./clipboard";

/**
 * 注册所有 IPC handlers。
 * @param ipcMain Electron IpcMain 实例
 */
export function registerAllHandlers(ipcMain: IpcMain): void {
  settingsHandler.register(ipcMain);
  workbenchHandler.register(ipcMain);
  windowHandler.register(ipcMain);
  clipboardHandler.register(ipcMain);

  // TODO: 注册其他 handlers
  // - title
  // - ffmpeg
  // - video
  // - media
  // - review
  // - recognition
  // - ai
  // - everything
  // - update
  // - export
}
