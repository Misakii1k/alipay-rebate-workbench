import { type IpcMain } from "electron";
import type { WorkbenchState, VideoWorkbenchState } from "../../src/lib/shared";
import { loadWorkbenchState, saveWorkbenchState, loadVideoWorkbenchState, saveVideoWorkbenchState } from "../utils/workbench";

/**
 * 注册工作台状态相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("workbench:load", loadWorkbenchState);
  ipcMain.handle("workbench:save", (_event, state: WorkbenchState) => saveWorkbenchState(state));
  ipcMain.handle("videoWorkbench:load", loadVideoWorkbenchState);
  ipcMain.handle("videoWorkbench:save", (_event, state: VideoWorkbenchState) => saveVideoWorkbenchState(state));
}