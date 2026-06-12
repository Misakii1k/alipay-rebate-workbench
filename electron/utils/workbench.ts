import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { WorkbenchState, VideoCandidate, VideoTask, VideoWorkbenchState } from "../../src/lib/shared";
import { DEFAULT_WORKBENCH_STATE, DEFAULT_VIDEO_WORKBENCH_STATE } from "../../src/lib/shared";
import { appendLog } from "./logger";
import { userDataPath, ensureUserDataDir } from "./paths";

export async function loadWorkbenchState(): Promise<WorkbenchState> {
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
}

export async function saveWorkbenchState(state: WorkbenchState): Promise<WorkbenchState> {
  await ensureUserDataDir();
  const next = { ...DEFAULT_WORKBENCH_STATE, ...state, savedAt: new Date().toISOString() };
  await fs.writeFile(userDataPath("workbench-state.json"), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export async function loadVideoWorkbenchState(): Promise<VideoWorkbenchState> {
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
}

function compactCandidate(candidate: VideoCandidate): VideoCandidate {
  const { thumbnailDataUrl: _thumbnailDataUrl, ...rest } = candidate;
  return rest;
}

function compactVideoTask(task: VideoTask): VideoTask {
  return {
    ...task,
    candidates: (task.candidates || []).slice(0, 80).map(compactCandidate),
    log: task.log ? task.log.slice(-16_000) : task.log
  };
}

function compactVideoWorkbenchState(state: VideoWorkbenchState): VideoWorkbenchState {
  return {
    ...DEFAULT_VIDEO_WORKBENCH_STATE,
    ...state,
    tasks: (state.tasks || []).map(compactVideoTask),
    savedAt: new Date().toISOString()
  };
}

export async function saveVideoWorkbenchState(state: VideoWorkbenchState): Promise<VideoWorkbenchState> {
  await ensureUserDataDir();
  const next = compactVideoWorkbenchState(state);
  await fs.writeFile(userDataPath("video-workbench-state.json"), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
