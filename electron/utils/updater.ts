import type { BrowserWindow } from "electron";
import type { AppSettings, UpdateStatus } from "../../src/lib/shared";

let mainWindow: BrowserWindow | null = null;
let updateStatus: UpdateStatus = { state: "idle", detail: "自动更新暂未启用。" };

function publishStatus(status: UpdateStatus): UpdateStatus {
  updateStatus = status;
  mainWindow?.webContents.send("update:status", updateStatus);
  return updateStatus;
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export async function checkForUpdates(settings: AppSettings): Promise<UpdateStatus> {
  void settings;
  return publishStatus({ state: "idle", detail: "自动更新暂未启用。" });
}

export async function downloadUpdate(): Promise<unknown> {
  throw new Error("自动更新暂未启用。");
}

export async function installUpdate(): Promise<void> {
  throw new Error("自动更新暂未启用。");
}

export async function initializeAutoUpdater(settings: AppSettings): Promise<void> {
  void settings;
  publishStatus({ state: "idle", detail: "自动更新暂未启用。" });
}
