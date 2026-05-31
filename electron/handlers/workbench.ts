import { type IpcMain } from "electron";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { WorkbenchState, VideoWorkbenchState } from "../../src/lib/shared";
import { DEFAULT_WORKBENCH_STATE, DEFAULT_VIDEO_WORKBENCH_STATE } from "../../src/lib/shared";
import { appendLog } from "../utils/logger";
import { userDataPath, ensureUserDataDir } from "../utils/paths";

/**
 * 注册工作台状态相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("workbench:load", async (): Promise<WorkbenchState> => {
    await ensureUserDataDir();
    const filePath = userDataPath("workbench-state.json");
    if (!existsSync(filePath)) return DEFAULT_WORKBENCH_STATE;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return { ...DEFAULT_WORKBENCH_STATE, ...JSON.parse(raw) };
    } catch {
      await appendLog("error", "读取支付宝工作台状态失败，已回退空状态", undefined, userDataPath);
      return DEFAULT_WORKBENCH_STATE;
    }
  });

  ipcMain.handle("workbench:save", async (_event, state: WorkbenchState): Promise<WorkbenchState> => {
    await ensureUserDataDir();
    const next = { ...DEFAULT_WORKBENCH_STATE, ...state, savedAt: new Date().toISOString() };
    await fs.writeFile(userDataPath("workbench-state.json"), JSON.stringify(next, null, 2), "utf-8");
    return next;
  });

  ipcMain.handle("videoWorkbench:load", async (): Promise<VideoWorkbenchState> => {
    await ensureUserDataDir();
    const filePath = userDataPath("video-workbench-state.json");
    if (!existsSync(filePath)) return DEFAULT_VIDEO_WORKBENCH_STATE;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return { ...DEFAULT_VIDEO_WORKBENCH_STATE, ...JSON.parse(raw) };
    } catch {
      await appendLog("error", "读取视频工作台状态失败，已回退空状态", undefined, userDataPath);
      return DEFAULT_VIDEO_WORKBENCH_STATE;
    }
  });

  ipcMain.handle("videoWorkbench:save", async (_event, state: VideoWorkbenchState): Promise<VideoWorkbenchState> => {
    await ensureUserDataDir();
    const next = { ...DEFAULT_VIDEO_WORKBENCH_STATE, ...state, savedAt: new Date().toISOString() };
    await fs.writeFile(userDataPath("video-workbench-state.json"), JSON.stringify(next, null, 2), "utf-8");
    return next;
  });
}
