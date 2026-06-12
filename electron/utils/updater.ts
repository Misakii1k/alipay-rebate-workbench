import { app, type BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from "electron-updater";
import {
  DEFAULT_GITHUB_UPDATE_REPO,
  DEFAULT_GITHUB_UPDATE_URL,
  DEFAULT_GITHUB_UPDATE_OWNER,
  type AppSettings,
  type UpdateStatus
} from "../../src/lib/shared";

type GithubTarget = {
  owner: string;
  repo: string;
};

let mainWindow: BrowserWindow | null = null;
let updateStatus: UpdateStatus = { state: "idle", detail: "尚未检查更新。" };
let updaterEventsBound = false;
let configuredTargetKey = "";

function publishStatus(status: UpdateStatus): UpdateStatus {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status", updateStatus);
  }
  return updateStatus;
}

function defaultGithubTarget(): GithubTarget {
  return {
    owner: DEFAULT_GITHUB_UPDATE_OWNER,
    repo: DEFAULT_GITHUB_UPDATE_REPO
  };
}

function parseGithubTarget(value: string | null | undefined): GithubTarget | null {
  const trimmed = (value || DEFAULT_GITHUB_UPDATE_URL).trim();
  if (!trimmed) return defaultGithubTarget();

  const directMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (directMatch) {
    return { owner: directMatch[1], repo: directMatch[2] };
  }

  try {
    const parsed = new URL(trimmed.replace(/\.git$/i, ""));
    if (!/^www\./i.test(parsed.hostname) && parsed.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function bindUpdaterEvents(): void {
  if (updaterEventsBound) return;
  updaterEventsBound = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.fullChangelog = false;

  autoUpdater.on("checking-for-update", () => {
    publishStatus({ state: "checking", detail: "正在检查新版本…" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    publishStatus({
      state: "available",
      version: info.version,
      detail: `发现新版本 ${info.version}，可以开始下载。`
    });
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    publishStatus({
      state: "not-available",
      version: info.version,
      detail: `当前已经是最新版本（${app.getVersion()}）。`
    });
  });

  autoUpdater.on("download-progress", (info: ProgressInfo) => {
    publishStatus({
      state: "downloading",
      percent: Math.max(0, Math.min(100, Number(info.percent || 0))),
      detail: `正在下载更新… ${Math.round(info.percent || 0)}%`
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    publishStatus({
      state: "downloaded",
      version: info.version,
      detail: `新版本 ${info.version} 已下载完成，点击即可安装。`
    });
  });

  autoUpdater.on("error", (error: Error, message?: string) => {
    const detail = [message, error?.message].filter(Boolean).join("：") || "自动更新失败。";
    publishStatus({ state: "error", detail });
  });
}

function describeGithubTarget(target: GithubTarget): string {
  return `${target.owner}/${target.repo}`;
}

function ensureUpdaterReady(settings: AppSettings): { ok: true; target: GithubTarget } | { ok: false; detail: string } {
  bindUpdaterEvents();

  if (process.platform !== "win32") {
    return { ok: false, detail: "自动更新目前仅支持 Windows 安装包。" };
  }
  if (!app.isPackaged) {
    return { ok: false, detail: "开发环境不检查更新，请安装打包后的版本测试。" };
  }

  const target = parseGithubTarget(settings.updateFeedUrl);
  if (!target) {
    return { ok: false, detail: "GitHub 更新仓库地址无效，请填写 owner/repo 或 GitHub 仓库链接。" };
  }

  const nextKey = describeGithubTarget(target);
  if (configuredTargetKey !== nextKey) {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: target.owner,
      repo: target.repo,
      private: false
    });
    configuredTargetKey = nextKey;
  }

  return { ok: true, target };
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export async function checkForUpdates(settings: AppSettings): Promise<UpdateStatus> {
  const ready = ensureUpdaterReady(settings);
  if (!ready.ok) return publishStatus({ state: "idle", detail: ready.detail });

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      return publishStatus({ state: "idle", detail: `更新器已就绪：${describeGithubTarget(ready.target)}。` });
    }
    return getUpdateStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : "自动更新检查失败。";
    return publishStatus({ state: "error", detail: message });
  }
}

export async function downloadUpdate(): Promise<unknown> {
  if (!configuredTargetKey) {
    throw new Error("请先检查更新，确认更新仓库已连接。");
  }
  if (updateStatus.state !== "available" && updateStatus.state !== "downloading") {
    throw new Error("当前没有可下载的新版本。");
  }

  try {
    return await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载更新失败。";
    publishStatus({ state: "error", detail: message });
    throw error;
  }
}

export async function installUpdate(): Promise<void> {
  if (updateStatus.state !== "downloaded") {
    throw new Error("更新尚未下载完成。");
  }
  autoUpdater.quitAndInstall(false, true);
}

export async function initializeAutoUpdater(settings: AppSettings): Promise<void> {
  const ready = ensureUpdaterReady(settings);
  if (!ready.ok) {
    publishStatus({ state: "idle", detail: ready.detail });
    return;
  }

  publishStatus({
    state: "idle",
    detail: `自动更新已启用，发布仓库：${describeGithubTarget(ready.target)}。`
  });
}
