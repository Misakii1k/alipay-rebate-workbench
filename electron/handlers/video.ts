import { app, type IpcMain, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { AppSettings, VideoCandidate, VideoRenderPayload, VideoRenderResult, VideoRenderProgress } from "../../src/lib/shared";
import { normalizeSettings } from "../../src/lib/shared";
import { validatePathSafety, validateMediaFilePath } from "../utils/security";
import { normalizeMatchText } from "../utils/text";
import { resolveFfmpegPath, runProcess } from "../utils/ffmpeg";
import { resolveEverythingEsPath, searchWithEverything } from "../utils/everything";
import { walkMedia } from "../utils/walk";
import { imageToDataUrl, probeImageSize } from "../utils/media";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

// ============================================================================
// 全局变量
// ============================================================================
const videoExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
let cpuThreads = Math.max(1, os.cpus().length);

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

async function scanVideoLibrary(settings: AppSettings, productName: string, colorName: string, speedMode = false): Promise<VideoCandidate[]> {
  const root = settings.videoLibraryDir;
  if (!root || !existsSync(root)) throw new Error("请先在设置中选择视频库文件夹。");

  validatePathSafety(root);

  const allExts = new Set([...videoExts, ...imageExts]);
  const esPath = resolveEverythingEsPath(settings);
  let files: string[];
  if (esPath) {
    const esResults = await searchWithEverything(esPath, root, `${productName} ${colorName}`.trim(), allExts, 2000);
    files = esResults.length > 0 ? esResults : await walkMedia(root, allExts, 8000);
  } else {
    files = await walkMedia(root, allExts, 8000);
  }
  const terms = buildMatchTerms(`${productName} ${colorName}`);
  const candidates = files
    .map((filePath) => scoreMediaCandidate(root, filePath, terms))
    .filter((item): item is VideoCandidate => Boolean(item && item.score >= 35))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  for (const candidate of candidates) {
    if (speedMode) continue;
    const ext = path.extname(candidate.path).toLowerCase();
    if (imageExts.has(ext)) {
      candidate.thumbnailDataUrl = imageToDataUrl(candidate.path, 280);
    }
  }

  return candidates;
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

  if (/no such file|does not exist/i.test(log)) return "输入文件不存在，请检查素材路径是否正确。";
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

function runFfmpeg(ffmpegPath: string, args: string[], taskId?: string, stage = "剪辑中", duration?: number): Promise<VideoRenderResult> {
  const argsLog = `[ffmpeg cmd] ${ffmpegPath} ${args.map((a) => /[\s"']/.test(a) ? `"${a}"` : a).join(" ")}\n`;
  return new Promise((resolve) => {
    let log = argsLog;
    let lastPercent = 15;
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    child.stdout.on("data", (chunk) => (log += String(chunk)));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      log += text;
      const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match && taskId) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const percentByDuration = duration && duration > 0 ? Math.round(12 + (seconds / duration) * 84) : Math.round(20 + seconds * 10);
        lastPercent = Math.min(96, Math.max(lastPercent + 1, percentByDuration));
        emitVideoProgress(taskId, lastPercent, stage, seconds);
      }
    });
    child.on("error", (error) => resolve({ success: false, log, error: error.message }));
    child.on("exit", (code) => {
      const signedCode = code !== null && code > 0x7FFFFFFF ? code - 0x100000000 : code;
      resolve({ success: code === 0, log, error: code === 0 ? undefined : parseFfmpegError(log, signedCode) });
    });
  });
}

async function validateVideoInput(ffmpegPath: string, videoPath: string): Promise<{ hasVideo: boolean; hasAudio: boolean; detail: string }> {
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-i", videoPath]);
  const hasVideo = /Stream\s+#\d+:\d+.*Video/i.test(result.output);
  const hasAudio = /Stream\s+#\d+:\d+.*Audio/i.test(result.output);
  return { hasVideo, hasAudio, detail: result.output };
}

async function estimateTaskDuration(ffmpegPath: string, task: VideoRenderPayload["task"]): Promise<number | undefined> {
  if (task.template === "video-slice") return 15;
  if (!task.videoPath) return undefined;
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-i", task.videoPath]);
  const match = result.output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
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

function encoderArgs(): string[] {
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", String(cpuThreads)];
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

async function buildBosTemplateArgs(ffmpegPath: string, payload: VideoRenderPayload, outputPath: string): Promise<string[]> {
  const image = payload.task.imagePath || payload.task.imagePaths[0];
  if (!image || !payload.task.videoPath) throw new Error("帛先生模板需要 1 张图片和 1 个视频。");
  const { width, height } = await probeImageSize(image);
  const w = width;
  const h = height;
  const probe = await validateVideoInput(ffmpegPath, payload.task.videoPath);
  return [
    "-y",
    "-hide_banner",
    "-loop",
    "1",
    "-t",
    "0.034",
    "-framerate",
    "30",
    "-i",
    image,
    "-i",
    payload.task.videoPath,
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p[intro];` +
      `[1:v]split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=min(iw\\,${w}):min(ih\\,${h}):(iw-min(iw\\,${w}))/2:(ih-min(ih\\,${h}))/2,boxblur=24:2[blur];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fit];` +
      `[blur][fit]overlay=(W-w)/2:(H-h)/2,format=yuv420p[main];` +
      `[intro][main]concat=n=2:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    ...(probe.hasAudio ? ["-map", "1:a", "-c:a", "aac", "-shortest"] : []),
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    ...encoderArgs(),
    outputPath
  ];
}

async function buildVideoSliceArgs(payload: VideoRenderPayload, outputPath: string): Promise<string[]> {
  const images = payload.task.imagePaths.filter(Boolean).slice(0, 5);
  if (images.length < 5) throw new Error("视频切片模板需要 5 张图片。");
  const { width, height } = await probeImageSize(images[0]);
  const fps = 30;
  const segmentDuration = 3;
  const musicPath = payload.task.musicPath || resolveMusicPresetPath(payload.task.musicPresetId || payload.settings.sliceMusicPresetId);
  const args = ["-y", "-hide_banner"];
  images.forEach((image) => args.push("-loop", "1", "-t", String(segmentDuration), "-framerate", String(fps), "-i", image));
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  const filters =
    images
      .map((_, index) => {
        const effect = index === 1 || index === 4 ? bounceFilter(width, height, segmentDuration) : swingFilter(width, height, index, segmentDuration);
        return `[${index}:v]${effect},fps=${fps},format=yuv420p[v${index}]`;
      })
      .join(";") + `;${images.map((_, index) => `[v${index}]`).join("")}concat=n=5:v=1:a=0[out]`;
  args.push("-filter_complex", filters, "-map", "[out]");
  if (musicPath) args.push("-map", `${images.length}:a:0`, "-c:a", "aac", "-shortest");
  args.push("-r", String(fps), "-pix_fmt", "yuv420p", ...encoderArgs(), outputPath);
  return args;
}

async function renderVideoTask(payload: VideoRenderPayload): Promise<VideoRenderResult> {
  const settings = normalizeSettings(payload.settings);
  const ffmpegPath = resolveFfmpegPath(settings);
  if (!ffmpegPath) throw new Error("未找到 FFmpeg，请在设置中指定 ffmpeg.exe 或放入程序 bin 目录。");
  if (!settings.videoOutputDir) throw new Error("请先选择输出文件夹。");
  await fs.mkdir(settings.videoOutputDir, { recursive: true });

  validatePathSafety(settings.videoOutputDir);

  if (payload.task.template !== "video-slice") {
    const image = payload.task.imagePath || payload.task.imagePaths[0];
    if (!image || !existsSync(image)) throw new Error(`图片文件不存在：${image || "未选择"}`);
    if (!payload.task.videoPath || !existsSync(payload.task.videoPath)) throw new Error(`视频文件不存在：${payload.task.videoPath || "未选择"}`);

    validateMediaFilePath(image);
    validateMediaFilePath(payload.task.videoPath);

    const probe = await validateVideoInput(ffmpegPath, payload.task.videoPath);
    if (!probe.hasVideo) throw new Error("视频文件没有可解码的视频流，请检查文件是否损坏或格式不支持。");
  } else {
    const missing = payload.task.imagePaths.filter(Boolean).filter((p) => !existsSync(p));
    if (missing.length) throw new Error(`以下图片文件不存在：${missing.map((p) => path.basename(p)).join("、")}`);

    for (const imagePath of payload.task.imagePaths.filter(Boolean)) {
      validateMediaFilePath(imagePath);
    }
  }

  if (payload.task.musicPath) {
    validateMediaFilePath(payload.task.musicPath);
  }

  const outputPath = await uniqueOutputPath(settings.videoOutputDir, payload.task.outputName || `${payload.task.productName}-${payload.task.colorName}`);
  const acceleration = cpuAcceleration();
  const duration = await estimateTaskDuration(ffmpegPath, payload.task);
  emitVideoProgress(payload.task.id, 8, "准备素材");
  const args = await (payload.task.template === "video-slice"
    ? buildVideoSliceArgs(payload, outputPath)
    : buildBosTemplateArgs(ffmpegPath, payload, outputPath));
  const result = await runFfmpeg(ffmpegPath, args, payload.task.id, `剪辑中（${acceleration.label}）`, duration);
  emitVideoProgress(payload.task.id, result.success ? 100 : 0, result.success ? "完成" : "失败");
  await appendLog(result.success ? "info" : "error", "视频剪辑任务完成", { outputPath, success: result.success, error: result.error }, userDataPath);
  return { ...result, outputPath };
}

/**
 * 注册视频相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("video:scanLibrary", (_event, settings: AppSettings, productName: string, colorName: string, speedMode?: boolean) => scanVideoLibrary(settings, productName, colorName, speedMode));
  ipcMain.handle("video:renderTask", (_event, payload: VideoRenderPayload) => renderVideoTask(payload));
}
