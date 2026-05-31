import { type IpcMain } from "electron";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";

/**
 * 注册日志相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("log:append", (_event, level: "info" | "warn" | "error", message: string, meta?: unknown) =>
    appendLog(level, message, meta, userDataPath)
  );
}
