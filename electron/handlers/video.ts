import { app, type IpcMain, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { AppSettings, VideoCandidate, VideoRenderPayload, VideoRenderResult, VideoRenderProgress } from "../../src/lib/shared";
import { normalizeSettings } from "../../src/lib/shared";
import { validatePathSafety, validateMediaFilePath } from "../utils/security";
import { assertAuthorizedRoot, isAuthorizedMediaPath } from "../utils/capabilities";
import { normalizeMatchText } from "../utils/text";
import { resolveFfmpegPath, runProcess } from "../utils/ffmpeg";
import { imageToDataUrl, probeImageSize } from "../utils/media";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";
import { runWorkerTask } from "../utils/worker";
import { loadSettings } from "../utils/settings";
import { resolveEverythingEsPath } from "../utils/everything";

let mainWindow: BrowserWindow | null = null;

/**
 * 将含非 ASCII 字符的 Windows 路径转为 8.3 短路径，解决 FFmpeg 无法识别中文路径的问题。
 * 非 Windows 平台或转换失败时原样返回。
 */
const FFMPEG_ALIAS_DIR = "alipay_rebate_ffmpeg";
const MAX_FFMPEG_LOG_BYTES = 256 * 1024;
const MAX_FFMPEG_RENDER_MS = 30 * 60 * 1000;

interface TemporaryAliasContext {
  files: string[];
  dirs: string[];
}

interface VideoProbe {
  hasVideo: boolean;
  hasAudio: boolean;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  detail: string;
}

const shortPathCache = new Map<string, string>();
const videoProbeCache = new Map<string, { mtimeMs: number; probe: VideoProbe }>();
let activeVideoScanController: AbortController | null = null;

function hasNonAscii(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

function isUsableShortPath(candidate: string): boolean {
  if (!candidate) return false;
  if (candidate.includes("\uFFFD")) return false;
  if (/[^\x00-\x7F]/.test(candidate)) return false;
  return existsSync(candidate);
}

async function getShortPath(filePath: string, kind: "file" | "directory" = "file"): Promise<string> {
  if (process.platform !== "win32") return filePath;
  if (!hasNonAscii(filePath)) return filePath;
  if (!existsSync(filePath)) return filePath;
  const cacheKey = `${kind}:${filePath}`;
  const cached = shortPathCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  try {
    const method = kind === "directory" ? "GetFolder" : "GetFile";
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      `$path = '${escapePowerShellSingleQuotedString(filePath)}'`,
      `$shortPath = (New-Object -ComObject Scripting.FileSystemObject).${method}($path).ShortPath`,
      "[Console]::Out.Write($shortPath)"
    ].join("; ");
    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        timeout: 5000,
        windowsHide: true
      }, (_error, stdout) => {
        const result = String(stdout || "").trim();
        const next = isUsableShortPath(result) ? result : filePath;
        shortPathCache.set(cacheKey, next);
        resolve(next);
      });
    });
  } catch {
    return Promise.resolve(filePath);
  }
}

function normalizedUuid(): string {
  return randomUUID().replace(/-/g, "");
}

function safeAliasExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
}

async function ensureWritableDirectory(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${normalizedUuid()}.tmp`);
    await fs.writeFile(probe, "");
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

async function findFfmpegAliasDir(filePath: string, runId: string): Promise<string> {
  const parentShortPath = await getShortPath(path.dirname(filePath), "directory");
  const tempShortPath = await getShortPath(os.tmpdir(), "directory");
  const driveRoot = path.parse(filePath).root;
  const candidates = [
    parentShortPath ? path.join(parentShortPath, FFMPEG_ALIAS_DIR, runId) : "",
    tempShortPath ? path.join(tempShortPath, FFMPEG_ALIAS_DIR, runId) : "",
    driveRoot ? path.join(driveRoot, FFMPEG_ALIAS_DIR, runId) : "",
    path.join("C:\\Users\\Public", FFMPEG_ALIAS_DIR, runId)
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (!candidate || hasNonAscii(candidate)) continue;
    if (await ensureWritableDirectory(candidate)) return candidate;
  }
  return "";
}

async function createFfmpegInputAlias(filePath: string, runId: string, cleanup: TemporaryAliasContext): Promise<string> {
  const aliasDir = await findFfmpegAliasDir(filePath, runId);
  if (!aliasDir) return filePath;

  const aliasPath = path.join(aliasDir, `${normalizedUuid()}${safeAliasExtension(filePath)}`);
  cleanup.dirs.push(aliasDir);
  try {
    await fs.link(filePath, aliasPath);
  } catch {
    try {
      await fs.copyFile(filePath, aliasPath);
    } catch {
      return filePath;
    }
  }
  cleanup.files.push(aliasPath);
  return aliasPath;
}

async function prepareFfmpegInputPath(filePath: string, runId: string, cleanup: TemporaryAliasContext): Promise<string> {
  if (process.platform !== "win32") return filePath;
  const shortPath = await getShortPath(filePath);
  if (!hasNonAscii(shortPath) && existsSync(shortPath)) return shortPath;
  if (!hasNonAscii(filePath)) return filePath;
  const aliasPath = await createFfmpegInputAlias(filePath, runId, cleanup);
  if (hasNonAscii(aliasPath)) {
    throw new Error(`素材路径含中文且无法创建临时副本，请将以下文件移到英文路径后重试：\n${path.basename(filePath)}`);
  }
  return aliasPath;
}

async function prepareFfmpegOutputPath(outputPath: string, runId: string, cleanup: TemporaryAliasContext): Promise<string> {
  if (process.platform !== "win32" || !hasNonAscii(outputPath)) return outputPath;

  const shortOutputDir = await getShortPath(path.dirname(outputPath), "directory");
  const shortOutputPath = path.join(shortOutputDir, path.basename(outputPath));
  if (!hasNonAscii(shortOutputPath)) return shortOutputPath;

  const aliasDir = await findFfmpegAliasDir(outputPath, runId);
  if (!aliasDir) {
    throw new Error(`输出路径含中文且无法创建临时副本，请将输出目录改为英文路径后重试。`);
  }

  const aliasPath = path.join(aliasDir, `${normalizedUuid()}.mp4`);
  cleanup.dirs.push(aliasDir);
  cleanup.files.push(aliasPath);
  return aliasPath;
}

async function moveFfmpegOutput(ffmpegOutputPath: string, outputPath: string): Promise<void> {
  if (ffmpegOutputPath === outputPath) return;
  const [ffmpegRealPath, outputRealPath] = await Promise.all([
    fs.realpath(ffmpegOutputPath).catch(() => ""),
    fs.realpath(outputPath).catch(() => "")
  ]);
  if (ffmpegRealPath && outputRealPath && ffmpegRealPath.toLowerCase() === outputRealPath.toLowerCase()) return;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.rename(ffmpegOutputPath, outputPath);
  } catch {
    await fs.copyFile(ffmpegOutputPath, outputPath);
    await fs.unlink(ffmpegOutputPath).catch(() => undefined);
  }
}

async function cleanupTemporaryAliases(cleanup: TemporaryAliasContext): Promise<void> {
  for (const filePath of [...new Set(cleanup.files)].reverse()) {
    await fs.unlink(filePath).catch(() => undefined);
  }
  for (const dir of [...new Set(cleanup.dirs)].reverse()) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

// ============================================================================
// 全局变量
// ============================================================================
const videoExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
let cpuThreads = Math.max(1, os.cpus().length);
const runningFfmpegProcesses = new Map<string, ReturnType<typeof spawn>>();
const canceledRenderTasks = new Set<string>();

// ============================================================================
// 类型定义
// ============================================================================
interface VideoAcceleration {
  encoder: string;
  label: string;
}

// ============================================================================
// 视频库扫描
// ============================================================================
function buildMatchTerms(value: string): string[] {
  const normalized = normalizeMatchText(value);
  const chunks = value
    .toLowerCase()
    .split(/[\s_\-—–()（）[\]【】.·,，。]+/)
    .map(normalizeMatchText)
    .filter(Boolean);
  const numbers = normalized.match(/[a-z]*\d+[a-z]*/g) ?? [];
  return [...new Set([normalized, ...chunks, ...numbers].filter((term) => term.length >= 2))];
}

function tokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  let hits = 0;
  for (const char of new Set(a.split(""))) if (b.includes(char)) hits += 1;
  return hits / Math.max(1, new Set(a.split("")).size);
}

function scoreMediaCandidate(root: string, filePath: string, terms: string[]): VideoCandidate {
  const relative = path.relative(root, filePath);
  const fileName = path.basename(filePath);
  const folderText = path.dirname(relative);
  const fileText = normalizeMatchText(fileName);
  const pathText = normalizeMatchText(relative);
  const folderNorm = normalizeMatchText(folderText);
  let score = 0;
  const reasons: string[] = [];

  for (const term of terms) {
    if (!term) continue;
    if (fileText.includes(term)) {
      score += /\d/.test(term) ? 28 : 24;
      reasons.push(`文件名命中 ${term}`);
    } else if (folderNorm.includes(term)) {
      score += /\d/.test(term) ? 24 : 20;
      reasons.push(`文件夹命中 ${term}`);
    } else if (pathText.includes(term)) {
      score += 12;
      reasons.push(`路径命中 ${term}`);
    } else {
      const overlap = tokenOverlap(term, pathText);
      if (overlap > 0.45) score += Math.round(overlap * 16);
    }
  }

  const depth = relative.split(/[\\/]/).length - 1;
  score += Math.max(0, 10 - depth);
  const ext = path.extname(filePath).toLowerCase();
  if (videoExts.has(ext)) score += 8;
  if (imageExts.has(ext)) score += 4;

  return {
    path: filePath,
    fileName,
    score,
    reason: reasons.slice(0, 3).join("；") || "路径文字相似",
    kind: videoExts.has(ext) ? "video" : "image",
    matchedPath: relative,
    thumbnailDataUrl: undefined
  };
}

async function scanVideoLibrary(settings: AppSettings, productName: string, colorName: string, speedMode = false, requestId?: string): Promise<VideoCandidate[]> {
  const root = settings.videoLibraryDir;
  if (!root || !existsSync(root)) throw new Error("请先在设置中选择视频库文件夹。");

  validatePathSafety(root);
  assertAuthorizedRoot("videoLibrary", root);
  const esPath = resolveEverythingEsPath(settings);
  activeVideoScanController?.abort();
  const controller = new AbortController();
  activeVideoScanController = controller;
  try {
    const candidates = await runWorkerTask<{ settings: AppSettings; productName: string; colorName: string; userDataDir: string; esPath?: string }, VideoCandidate[]>(
      "videoIndexWorker",
      { settings, productName, colorName, userDataDir: app.getPath("userData"), esPath },
      undefined,
      { requestId, timeoutMs: 180_000, signal: controller.signal }
    );
    if (speedMode) return candidates;
    const imagePaths = candidates
      .filter((candidate) => candidate.kind === "image" && isAuthorizedMediaPath(candidate.path, imageExts))
      .map((candidate) => candidate.path)
      .slice(0, 40);
    if (!imagePaths.length) return candidates;
    const thumbnails = await runWorkerTask<{ paths: string[]; size: number; maxCount: number; cacheDir?: string }, Record<string, string>>(
      "thumbnailWorker",
      { paths: imagePaths, size: 280, maxCount: 40, cacheDir: path.join(app.getPath("userData"), "thumb-cache") },
      undefined,
      { requestId, timeoutMs: 45_000, signal: controller.signal }
    );
    return candidates.map((candidate) => ({ ...candidate, thumbnailDataUrl: thumbnails[candidate.path] }));
  } finally {
    if (activeVideoScanController === controller) activeVideoScanController = null;
  }
}

// ============================================================================
// 视频渲染
// ============================================================================
function emitVideoProgress(taskId: string, percent: number, stage: string, currentTime?: number): void {
  const payload: VideoRenderProgress = { taskId, percent: Math.max(0, Math.min(100, Math.round(percent))), stage, currentTime };
  mainWindow?.webContents.send("video:renderProgress", payload);
}

function parseFfmpegError(log: string, code: number | null): string {
  const lower = log.toLowerCase();
  const logLines = log.split(/\r?\n/).filter(Boolean);
  const errorLines = logLines.filter((line) => /error|invalid|fail|cannot|denied|not found/i.test(line)).slice(-3);
  const contextTail = errorLines.length ? errorLines.join("\n") : log.slice(-200).trim();

  if (/no such file|does not exist/i.test(log)) return "输入文件不存在，请检查素材路径是否正确。如果路径包含中文，请将素材移到英文路径后重试。";
  if (/invalid data found when processing input/i.test(log)) return "素材文件格式损坏或不支持，请更换文件后重试。";
  if (/codec not found|encoder.*not found|unknown encoder/i.test(log)) return "缺少必要的编码器，请使用诊断修复检查 FFmpeg 安装。";
  if (/permission denied/i.test(log)) return "输出目录没有写入权限，请检查输出文件夹权限。";
  if (/out of memory|cannot allocate/i.test(lower)) return "内存不足，请关闭其他程序后重试。";
  if (/device or resource busy/i.test(lower)) return "输出文件被占用，请关闭使用该文件的程序。";
  if (/nothing was written into output file/i.test(log)) {
    if (/no audio/i.test(log) || !/Stream\s+#\d+:\d+.*Audio/i.test(log)) return "输出文件为空：视频没有音频轨道导致合成失败，程序已自动适配。如果仍然报错请使用诊断修复。";
    return `输出文件为空：可能是编码器与素材不兼容。\n${contextTail}`;
  }
  if (/invalid argument/i.test(log) && /encoder/i.test(log)) return `硬件编码器参数不兼容，尝试切换 CPU 编码。\n${contextTail}`;
  if (/invalid argument/i.test(log)) return `FFmpeg 参数错误（退出码 ${code}），请使用诊断修复排查。\n${contextTail}`;
  if (/error while opening encoder/i.test(log)) return `编码器初始化失败，可能是硬件加速不兼容。\n${contextTail}`;
  if (/conversion failed/i.test(log)) return `格式转换失败，素材可能不兼容。\n${contextTail}`;
  return `FFmpeg 退出码 ${code}：${contextTail || "无详细日志，请使用诊断修复功能排查。"}`;
}

function appendLimitedLog(current: string, chunk: string): string {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= MAX_FFMPEG_LOG_BYTES) return next;
  return next.slice(Math.max(0, next.length - MAX_FFMPEG_LOG_BYTES));
}

function runFfmpeg(ffmpegPath: string, args: string[], taskId?: string, stage = "剪辑中", duration?: number): Promise<VideoRenderResult> {
  const argsLog = `[ffmpeg cmd] ${ffmpegPath} ${args.map((a) => /[\s"']/.test(a) ? `"${a}"` : a).join(" ")}\n`;
  return new Promise((resolve) => {
    let log = argsLog;
    let lastPercent = 15;
    let settled = false;
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    if (taskId) runningFfmpegProcesses.set(taskId, child);
    const timer = setTimeout(() => {
      if (settled) return;
      log = appendLimitedLog(log, `\nFFmpeg timed out after ${MAX_FFMPEG_RENDER_MS}ms`);
      child.kill();
    }, MAX_FFMPEG_RENDER_MS);
    child.stdout.on("data", (chunk) => (log = appendLimitedLog(log, String(chunk))));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      log = appendLimitedLog(log, text);
      const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match && taskId) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const percentByDuration = duration && duration > 0 ? Math.round(12 + (seconds / duration) * 84) : Math.round(20 + seconds * 10);
        lastPercent = Math.min(96, Math.max(lastPercent + 1, percentByDuration));
        emitVideoProgress(taskId, lastPercent, stage, seconds);
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (taskId) runningFfmpegProcesses.delete(taskId);
      resolve({ success: false, log, error: error.message });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (taskId) runningFfmpegProcesses.delete(taskId);
      if (taskId && canceledRenderTasks.delete(taskId)) {
        resolve({ success: false, log, error: "Render canceled." });
        return;
      }
      const signedCode = code !== null && code > 0x7FFFFFFF ? code - 0x100000000 : code;
      resolve({ success: code === 0, log, error: code === 0 ? undefined : parseFfmpegError(log, signedCode) });
    });
  });
}

async function validateVideoInput(ffmpegPath: string, videoPath: string): Promise<{ hasVideo: boolean; hasAudio: boolean; detail: string }> {
  const probe = await probeVideoInput(ffmpegPath, videoPath);
  return { hasVideo: probe.hasVideo, hasAudio: probe.hasAudio, detail: probe.detail };
}

async function estimateTaskDuration(ffmpegPath: string, task: VideoRenderPayload["task"]): Promise<number | undefined> {
  if (task.template === "video-slice") return 15.07;
  if (!task.videoPath) return undefined;
  const probe = await probeVideoInput(ffmpegPath, task.videoPath);
  return probe.duration;
}

async function probeVideoInput(ffmpegPath: string, videoPath: string): Promise<VideoProbe> {
  const mtimeMs = await fs.stat(videoPath).then((stat) => stat.mtimeMs).catch(() => 0);
  const cacheKey = `${ffmpegPath}|${videoPath}`;
  const cached = videoProbeCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) return cached.probe;
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-i", videoPath]);
  const hasVideo = /Stream\s+#\d+:\d+.*Video/i.test(result.output);
  const hasAudio = /Stream\s+#\d+:\d+.*Audio/i.test(result.output);
  const match = result.output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
  const videoLine = result.output.split(/\r?\n/).find((line) => /Stream\s+#\d+:\d+.*Video/i.test(line)) ?? "";
  const sizeMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = videoLine.match(/,\s*(\d+(?:\.\d+)?)\s*(?:fps|tbr)\b/i);
  const width = sizeMatch ? Number(sizeMatch[1]) : undefined;
  const height = sizeMatch ? Number(sizeMatch[2]) : undefined;
  const fps = fpsMatch ? Number(fpsMatch[1]) : undefined;
  const probe: VideoProbe = { hasVideo, hasAudio, duration, width, height, fps, detail: result.output };
  videoProbeCache.set(cacheKey, { mtimeMs, probe });
  return probe;
}

async function uniqueOutputPath(dir: string, baseName: string): Promise<string> {
  const safeName = (baseName || `video-${randomUUID().slice(0, 8)}`).replace(/[\\/:*?"<>|]/g, "_");
  let candidate = path.join(dir, `${safeName}.mp4`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${safeName}-${index}.mp4`);
    index += 1;
  }
  return candidate;
}

function cpuAcceleration(): VideoAcceleration {
  return { encoder: "libx264", label: `CPU 多线程：${cpuThreads} 线程` };
}

function normalizeEvenDimension(value: number | undefined, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 1) return fallback;
  return Math.max(2, Math.round(next / 2) * 2);
}

function resolveRenderDimensions(
  settings: AppSettings,
  probe?: Pick<VideoProbe, "width" | "height">,
  fallback?: { width: number; height: number }
): { width: number; height: number } {
  if (settings.videoOutputSize === "portrait-1080") return { width: 1080, height: 1440 };
  if (settings.videoOutputSize === "portrait-720") return { width: 720, height: 960 };
  if (settings.videoOutputSize === "story-1080") return { width: 1080, height: 1920 };
  if (probe?.width && probe?.height) {
    return {
      width: normalizeEvenDimension(probe.width, 1080),
      height: normalizeEvenDimension(probe.height, 1440)
    };
  }
  return {
    width: normalizeEvenDimension(fallback?.width, 1080),
    height: normalizeEvenDimension(fallback?.height, 1440)
  };
}

function resolveRenderFps(probe?: Pick<VideoProbe, "fps">): number {
  const fps = Number(probe?.fps);
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  return Math.min(60, Math.max(15, Number(fps.toFixed(3))));
}

function frameDurationForFps(fps: number): string {
  return Math.max(0.01, 1 / fps).toFixed(6);
}

function encoderArgs(qualityMode: AppSettings["videoQualityMode"]): string[] {
  if (qualityMode === "balanced") {
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", String(cpuThreads)];
  }
  if (qualityMode === "high") {
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-threads", String(cpuThreads)];
  }
  return ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-threads", String(cpuThreads)];
}

function audioEncodeArgs(): string[] {
  return ["-c:a", "aac", "-b:a", "192k"];
}

function resolveMusicPresetPath(id: string): string {
  if (!id) return "";
  const candidate = path.join(process.resourcesPath, "assets", "music", `${id}.mp3`);
  if (existsSync(candidate)) return candidate;
  const devCandidate = path.join(app.getAppPath(), "assets", "music", `${id}.mp3`);
  return existsSync(devCandidate) ? devCandidate : "";
}

function swingFilter(width: number, height: number, index: number, duration: number): string {
  const direction = index === 2 ? "1" : "-1";
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white,rotate='${direction}*0.06*cos(2*PI*t/2.2)*exp(-0.35*t)':ow=${width}:oh=${height}:c=white`;
}

function bounceFilter(width: number, height: number, duration: number): string {
  const padW = Math.round(width * 1.15 / 2) * 2;
  const padH = Math.round(height * 1.15 / 2) * 2;
  return `scale=${padW}:${padH}:force_original_aspect_ratio=decrease,pad=${padW}:${padH}:(ow-iw)/2:(oh-ih)/2:white,scale='iw*(1+0.10*exp(-1.5*t)*cos(3.5*t))':'ih*(1+0.10*exp(-1.5*t)*cos(3.5*t))':eval=frame,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`;
}

function normalizedVideoTail(fps: number): string {
  return `setsar=1,fps=${fps},format=yuv420p`;
}

async function buildBosTemplateArgs(
  ffmpegPath: string,
  payload: VideoRenderPayload,
  settings: AppSettings,
  outputPath: string,
  probe?: VideoProbe
): Promise<string[]> {
  const image = payload.task.imagePath || payload.task.imagePaths[0];
  if (!image || !payload.task.videoPath) throw new Error("帛先生模板需要 1 张图片和 1 个视频。");
  const inputProbe = probe ?? await probeVideoInput(ffmpegPath, payload.task.videoPath);
  const imageSize = await probeImageSize(image);
  const { width: w, height: h } = resolveRenderDimensions(settings, inputProbe, imageSize);
  const fps = resolveRenderFps(inputProbe);
  return [
    "-y",
    "-hide_banner",
    "-loop",
    "1",
    "-t",
    frameDurationForFps(fps),
    "-framerate",
    String(fps),
    "-i",
    image,
    "-i",
    payload.task.videoPath,
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,${normalizedVideoTail(fps)}[intro];` +
      `[1:v]split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2,boxblur=24:2,${normalizedVideoTail(fps)}[blur];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease,${normalizedVideoTail(fps)}[fit];` +
      `[blur][fit]overlay=(W-w)/2:(H-h)/2:shortest=1,${normalizedVideoTail(fps)}[main];` +
      `[intro][main]concat=n=2:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    ...(inputProbe.hasAudio ? ["-map", "1:a", ...audioEncodeArgs(), "-shortest"] : []),
    "-r",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    ...encoderArgs(settings.videoQualityMode),
    outputPath
  ];
}

async function buildVideoSliceArgs(payload: VideoRenderPayload, settings: AppSettings, outputPath: string): Promise<string[]> {
  const images = payload.task.imagePaths.filter(Boolean).slice(0, 5);
  if (images.length < 5) throw new Error("视频切片模板需要 5 张图片。");
  const imageSize = await probeImageSize(images[0]);
  const sliceFallback = settings.videoOutputSize === "auto" ? { width: 1440, height: 1920 } : imageSize;
  const { width, height } = resolveRenderDimensions(settings, undefined, sliceFallback);
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  const fps = 30;
  const inputDuration = 3.6;
  const stableDurations = [2.9, 2.7, 2.7, 2.7, 2.77] as const;
  const transitionDurations = [0.3, 0.3, 0.3, 0.4] as const;
  const musicPath = payload.task.musicPath || resolveMusicPresetPath(payload.task.musicPresetId || settings.sliceMusicPresetId);
  const args = ["-y", "-hide_banner"];
  images.forEach((image) => args.push("-loop", "1", "-t", String(inputDuration), "-framerate", String(fps), "-i", image));
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  const filters = [
    ...images.map((_, index) =>
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=${fps},format=rgba[img${index}]`
    ),
    "[img0]split=2[i0s][i0t]",
    "[img1]split=3[i1t1][i1s][i1t2]",
    "[img2]split=3[i2t1][i2s][i2t2]",
    "[img3]split=3[i3t1][i3s][i3t2]",
    "[img4]split=2[i4s][i4t]",
    `[i0s]trim=duration=${stableDurations[0]},setpts=PTS-STARTPTS[seg1]`,
    `[i1s]trim=duration=${stableDurations[1]},setpts=PTS-STARTPTS[seg2]`,
    `[i2s]trim=duration=${stableDurations[2]},setpts=PTS-STARTPTS[seg3]`,
    `[i3s]trim=duration=${stableDurations[3]},setpts=PTS-STARTPTS[seg4]`,
    `[i4s]trim=duration=${stableDurations[4]},setpts=PTS-STARTPTS[seg5]`,
    `[i0t]trim=duration=${transitionDurations[0]},setpts=PTS-STARTPTS[t12a]`,
    `[i1t1]trim=duration=${transitionDurations[0]},setpts=PTS-STARTPTS[t12b]`,
    `[t12a][t12b]xfade=transition=hblur:duration=${transitionDurations[0]}:offset=0,eq=brightness=0.04:saturation=1.08[t12]`,
    `[i1t2]trim=duration=${transitionDurations[1]},setpts=PTS-STARTPTS[t23a]`,
    `[i2t1]trim=duration=${transitionDurations[1]},setpts=PTS-STARTPTS[t23b]`,
    `[t23a][t23b]xfade=transition=zoomin:duration=${transitionDurations[1]}:offset=0[t23]`,
    `[i2t2]trim=duration=${transitionDurations[2]},setpts=PTS-STARTPTS[slidebase0]`,
    "[slidebase0]boxblur=5:1[slidebase]",
    `[i3t1]trim=duration=${transitionDurations[2]},setpts=PTS-STARTPTS,boxblur=12:1[slidelayer]`,
    `[slidebase][slidelayer]overlay=x='main_w-(t/${transitionDurations[2]})*main_w':y=0:shortest=1:eval=frame[t34]`,
    `[i4t]trim=duration=${transitionDurations[3]},setpts=PTS-STARTPTS[gridbg]`,
    `[i3t2]trim=duration=${transitionDurations[3]},setpts=PTS-STARTPTS,split=4[gridq1][gridq2][gridq3][gridq4]`,
    `[gridq1]crop=${halfW}:${halfH}:0:0,boxblur=4:1[g1]`,
    `[gridq2]crop=${halfW}:${halfH}:${halfW}:0,boxblur=4:1[g2]`,
    `[gridq3]crop=${halfW}:${halfH}:0:${halfH},boxblur=4:1[g3]`,
    `[gridq4]crop=${halfW}:${halfH}:${halfW}:${halfH},boxblur=4:1[g4]`,
    `[gridbg][g1]overlay=x='0-(t/${transitionDurations[3]})*${halfW}':y='0-(t/${transitionDurations[3]})*${halfH}':shortest=1:eval=frame[o1]`,
    `[o1][g2]overlay=x='${halfW}+(t/${transitionDurations[3]})*${halfW}':y='0-(t/${transitionDurations[3]})*${halfH}':shortest=1:eval=frame[o2]`,
    `[o2][g3]overlay=x='0-(t/${transitionDurations[3]})*${halfW}':y='${halfH}+(t/${transitionDurations[3]})*${halfH}':shortest=1:eval=frame[o3]`,
    `[o3][g4]overlay=x='${halfW}+(t/${transitionDurations[3]})*${halfW}':y='${halfH}+(t/${transitionDurations[3]})*${halfH}':shortest=1:eval=frame[t45]`,
    "[seg1][t12][seg2][t23][seg3][t34][seg4][t45][seg5]concat=n=9:v=1:a=0,format=yuv420p[out]"
  ].join(";");
  args.push("-filter_complex", filters, "-map", "[out]");
  if (musicPath) args.push("-map", `${images.length}:a:0`, ...audioEncodeArgs(), "-shortest");
  args.push("-r", String(fps), "-pix_fmt", "yuv420p", ...encoderArgs(settings.videoQualityMode), outputPath);
  return args;
}

async function renderVideoTask(payload: VideoRenderPayload): Promise<VideoRenderResult> {
  const settings = normalizeSettings(payload.settings);
  const ffmpegPath = resolveFfmpegPath(settings);
  if (!ffmpegPath) throw new Error("未找到 FFmpeg，请在设置中指定 ffmpeg.exe 或放入程序 bin 目录。");
  if (!settings.videoOutputDir) throw new Error("请先选择输出文件夹。");
  await fs.mkdir(settings.videoOutputDir, { recursive: true });

  validatePathSafety(settings.videoOutputDir);
  assertAuthorizedRoot("videoOutput", settings.videoOutputDir);

  if (payload.task.template !== "video-slice") {
    const image = payload.task.imagePath || payload.task.imagePaths[0];
    if (!image || !existsSync(image)) throw new Error(`图片文件不存在：${image || "未选择"}`);
    if (!payload.task.videoPath || !existsSync(payload.task.videoPath)) throw new Error(`视频文件不存在：${payload.task.videoPath || "未选择"}`);

    validateMediaFilePath(image);
    validateMediaFilePath(payload.task.videoPath);
    if (!isAuthorizedMediaPath(image, imageExts) || !isAuthorizedMediaPath(payload.task.videoPath, videoExts)) {
      throw new Error("Selected media is outside authorized folders.");
    }
  } else {
    const missing = payload.task.imagePaths.filter(Boolean).filter((p) => !existsSync(p));
    if (missing.length) throw new Error(`以下图片文件不存在：${missing.map((p) => path.basename(p)).join("、")}`);

    for (const imagePath of payload.task.imagePaths.filter(Boolean)) {
      validateMediaFilePath(imagePath);
      if (!isAuthorizedMediaPath(imagePath, imageExts)) throw new Error("Selected image is outside authorized folders.");
    }
  }

  if (payload.task.musicPath) {
    validateMediaFilePath(payload.task.musicPath);
    if (!isAuthorizedMediaPath(payload.task.musicPath, new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]))) {
      throw new Error("Selected music is outside authorized folders.");
    }
  }

  const outputPath = await uniqueOutputPath(settings.videoOutputDir, payload.task.outputName || `${payload.task.productName}-${payload.task.colorName}`);
  const acceleration = cpuAcceleration();
  const cleanup: TemporaryAliasContext = { files: [], dirs: [] };

  try {
    const renderPayload: VideoRenderPayload = {
      ...payload,
      task: {
        ...payload.task,
        imagePath: payload.task.imagePath ? await prepareFfmpegInputPath(payload.task.imagePath, payload.task.id, cleanup) : payload.task.imagePath,
        imagePaths: await Promise.all(payload.task.imagePaths.map((p) => p ? prepareFfmpegInputPath(p, payload.task.id, cleanup) : p)),
        videoPath: payload.task.videoPath ? await prepareFfmpegInputPath(payload.task.videoPath, payload.task.id, cleanup) : payload.task.videoPath,
        musicPath: payload.task.musicPath ? await prepareFfmpegInputPath(payload.task.musicPath, payload.task.id, cleanup) : payload.task.musicPath
      }
    };
    // 使用路径转换后的视频路径进行 probe，确保 FFmpeg 能正确识别
    let inputProbe: VideoProbe | undefined;
    if (renderPayload.task.template !== "video-slice" && renderPayload.task.videoPath) {
      inputProbe = await probeVideoInput(ffmpegPath, renderPayload.task.videoPath);
      if (!inputProbe.hasVideo) throw new Error("视频文件没有可解码的视频流，请检查文件是否损坏或格式不支持。");
    }
    const ffmpegOutputPath = await prepareFfmpegOutputPath(outputPath, payload.task.id, cleanup);
    const duration = await estimateTaskDuration(ffmpegPath, renderPayload.task);
    emitVideoProgress(payload.task.id, 8, "准备素材");
    const args = await (renderPayload.task.template === "video-slice"
      ? buildVideoSliceArgs(renderPayload, settings, ffmpegOutputPath)
      : buildBosTemplateArgs(ffmpegPath, renderPayload, settings, ffmpegOutputPath, inputProbe));
    const result = await runFfmpeg(ffmpegPath, args, payload.task.id, `剪辑中（${acceleration.label}）`, duration);
    if (result.success) await moveFfmpegOutput(ffmpegOutputPath, outputPath);
    emitVideoProgress(payload.task.id, result.success ? 100 : 0, result.success ? "完成" : "失败");
    await appendLog(result.success ? "info" : "error", "视频剪辑任务完成", { outputPath, ffmpegOutputPath, success: result.success, error: result.error }, userDataPath);
    return { ...result, outputPath };
  } finally {
    await cleanupTemporaryAliases(cleanup);
  }
}

function cancelVideoRender(taskId: string): { canceled: boolean } {
  if (!taskId) return { canceled: false };
  const child = runningFfmpegProcesses.get(taskId);
  if (!child) return { canceled: false };
  canceledRenderTasks.add(taskId);
  child.kill();
  return { canceled: true };
}

/**
 * 注册视频相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("video:scanLibrary", async (_event, _settings: AppSettings, productName: string, colorName: string, speedMode?: boolean, requestId?: string) =>
    scanVideoLibrary(await loadSettings(), productName, colorName, speedMode, requestId)
  );
  ipcMain.handle("video:renderTask", (_event, payload: VideoRenderPayload) => renderVideoTask(payload));
  ipcMain.handle("video:cancelRender", (_event, taskId: string) => cancelVideoRender(taskId));
}
