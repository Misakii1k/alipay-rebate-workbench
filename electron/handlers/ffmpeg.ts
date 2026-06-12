import { app, shell, type IpcMain } from "electron";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { AppSettings, FfmpegStatus } from "../../src/lib/shared";
import { normalizeSettings } from "../../src/lib/shared";
import { getFfmpegCandidates, resolveFfmpegPath, runProcess } from "../utils/ffmpeg";
import { validatePathSafety, validateMediaFilePath } from "../utils/security";
import { authorizeDirectoryCapability, isAuthorizedFfmpegPath } from "../utils/capabilities";
import { appendLog } from "../utils/logger";
import { userDataPath } from "../utils/paths";
import { loadSettings } from "../utils/settings";

// ============================================================================
// 类型定义
// ============================================================================
interface FfmpegDiagnosisItem {
  label: string;
  passed: boolean;
  detail: string;
}

interface FfmpegDiagnosisResult {
  items: FfmpegDiagnosisItem[];
  suggestions: string[];
  ok: boolean;
}

interface AutoFixResult {
  fixed: string[];
  failed: string[];
  settingsPatch: Partial<AppSettings> | null;
}

// ============================================================================
// 全局变量
// ============================================================================
let cpuThreads = Math.max(1, os.cpus().length);

// ============================================================================
// 工具函数
// ============================================================================
async function readFfmpegEncoders(ffmpegPath: string): Promise<string> {
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]);
  return result.output.toLowerCase();
}

async function testDirectoryWritable(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const testFile = path.join(dir, `.write-test-${Date.now()}.tmp`);
    await fs.writeFile(testFile, "test", "utf-8");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

async function quickFindFfmpeg(root: string, maxDepth: number, currentDepth = 0): Promise<string | null> {
  if (currentDepth > maxDepth) return null;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.toLowerCase() === "ffmpeg.exe" && !entry.isDirectory()) {
        return path.join(root, entry.name);
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.toLowerCase();
      if (name === "node_modules" || name === ".git" || name === "windows" || name === "$recycle.bin") continue;
      if (name.includes("ffmpeg") || name === "bin" || name === "tools") {
        const found = await quickFindFfmpeg(path.join(root, entry.name), maxDepth, currentDepth + 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

async function searchFfmpegOnSystem(): Promise<string | null> {
  const candidates = [
    path.join(process.resourcesPath, "bin", "ffmpeg.exe"),
    path.join(app.getAppPath(), "bin", "ffmpeg.exe"),
    path.join(os.homedir(), "Desktop", "ffmpeg.exe"),
    path.join(os.homedir(), "Desktop", "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(os.homedir(), "Downloads", "ffmpeg.exe"),
    path.join(os.homedir(), "Downloads", "ffmpeg", "bin", "ffmpeg.exe"),
  ];
  const programDirs = [
    process.env["ProgramFiles"] || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env["LOCALAPPDATA"] || ""
  ].filter(Boolean);
  for (const dir of programDirs) {
    candidates.push(
      path.join(dir, "ffmpeg", "bin", "ffmpeg.exe"),
      path.join(dir, "ffmpeg", "ffmpeg.exe")
    );
  }
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("where", ["ffmpeg.exe"], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout });
      });
    });
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {}

  try {
    const searchDirs = [
      os.homedir(),
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Downloads"),
      "D:\\",
      "E:\\"
    ];
    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;
      const result = await quickFindFfmpeg(dir, 3);
      if (result) return result;
    }
  } catch {}

  return null;
}

// ============================================================================
// 主要功能
// ============================================================================
async function getFfmpegStatus(settings: AppSettings): Promise<FfmpegStatus> {
  const ffmpegPath = resolveFfmpegPath(settings) ?? "";
  if (!ffmpegPath) return { available: false, path: "", detail: "未找到 FFmpeg，剪辑功能将在配置后可用。" };
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-version"], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.on("error", (error) => resolve({ available: false, path: ffmpegPath, detail: error.message }));
    child.on("exit", async (code) => {
      resolve({
        available: code === 0,
        path: ffmpegPath,
        detail: code === 0 ? output.split(/\r?\n/)[0] || "FFmpeg 可用" : "FFmpeg 无法执行",
        acceleration: code === 0 ? `CPU 多线程：${cpuThreads} 线程` : undefined
      });
    });
  });
}

async function diagnoseFfmpeg(settings: AppSettings): Promise<FfmpegDiagnosisResult> {
  const items: FfmpegDiagnosisItem[] = [];
  const suggestions: string[] = [];
  const ffmpegPath = resolveFfmpegPath(settings) ?? "";

  items.push({
    label: "FFmpeg 路径",
    passed: Boolean(ffmpegPath && existsSync(ffmpegPath)),
    detail: ffmpegPath ? `找到：${ffmpegPath}` : "未找到 FFmpeg 可执行文件"
  });
  if (!ffmpegPath) {
    suggestions.push("在设置中指定 FFmpeg 路径，或将 ffmpeg.exe 放入程序 bin 目录。");
    suggestions.push("可从 https://www.gyan.dev/ffmpeg/builds/ 下载 FFmpeg（选择 release essentials 版本）。");
    return { items, suggestions, ok: false };
  }

  const version = await runProcess(ffmpegPath, ["-version"]);
  const versionLine = version.output.split(/\r?\n/)[0] || "";
  items.push({ label: "FFmpeg 可执行", passed: version.code === 0, detail: version.code === 0 ? versionLine : `执行失败：${version.output.slice(0, 200)}` });
  if (version.code !== 0) {
    suggestions.push("FFmpeg 无法执行，请检查文件是否损坏或被安全软件拦截。");
    return { items, suggestions, ok: false };
  }

  const encoders = await readFfmpegEncoders(ffmpegPath);
  const requiredEncoders = [
    { name: "libx264", label: "H.264 CPU 编码器 (libx264)" },
    { name: "aac", label: "AAC 音频编码器" }
  ];
  for (const enc of requiredEncoders) {
    const has = encoders.includes(enc.name);
    items.push({ label: enc.label, passed: has, detail: has ? "可用" : "缺失" });
    if (!has) suggestions.push(`缺少 ${enc.label}，请下载完整版 FFmpeg。`);
  }

  items.push({ label: "编码模式", passed: true, detail: `CPU 多线程：${cpuThreads} 线程` });

  const testResult = await runProcess(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.1:r=30",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "视频编码测试", passed: testResult.code === 0, detail: testResult.code === 0 ? "视频编码功能正常" : `测试失败：${testResult.output.slice(0, 100)}` });
  if (testResult.code !== 0) suggestions.push("FFmpeg 视频编码测试失败，可能文件损坏，建议重新下载。");

  const audioTestResult = await runProcess(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1",
    "-c:a", "aac",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "音频编码测试", passed: audioTestResult.code === 0, detail: audioTestResult.code === 0 ? "音频编码功能正常" : `测试失败：${audioTestResult.output.slice(0, 100)}` });
  if (audioTestResult.code !== 0) suggestions.push("FFmpeg 音频编码测试失败，AAC 编码器可能不可用。");

  const concatTest = await runProcess(ffmpegPath, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=red:s=320x240:d=0.1:r=30",
    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=0.1:r=30",
    "-filter_complex", "[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[out]",
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-f", "null", os.platform() === "win32" ? "NUL" : "/dev/null"
  ]);
  items.push({ label: "滤镜拼接测试", passed: concatTest.code === 0, detail: concatTest.code === 0 ? "filter_complex + concat 正常" : `测试失败：${concatTest.output.slice(0, 100)}` });
  if (concatTest.code !== 0) suggestions.push("视频拼接滤镜测试失败，FFmpeg 可能版本过低或编译缺少 filter 支持。");

  const outputDir = settings.videoOutputDir;
  if (outputDir) {
    const writable = await testDirectoryWritable(outputDir);
    items.push({ label: "输出目录可写", passed: writable, detail: writable ? `可写：${outputDir}` : `无法写入：${outputDir}` });
    if (!writable) suggestions.push("输出目录没有写入权限，请在设置中更换输出文件夹。");
  }

  if (!suggestions.length) suggestions.push("FFmpeg 运行正常，所有检查项通过。");
  return { items, suggestions, ok: items.every((item) => item.passed) };
}

async function autoFixFfmpeg(settings: AppSettings): Promise<AutoFixResult> {
  const fixed: string[] = [];
  const failed: string[] = [];
  let settingsPatch: Partial<AppSettings> | null = null;

  const currentPath = resolveFfmpegPath(settings);
  if (!currentPath) {
    const found = await searchFfmpegOnSystem();
    if (found && !isAuthorizedFfmpegPath(found)) {
      failed.push(`Found FFmpeg, but please confirm it through the FFmpeg picker before using it: ${found}`);
    } else if (found) {
      settingsPatch = { ffmpegPath: found };
      fixed.push(`在系统中找到了 FFmpeg：${found}`);
    } else {
      await shell.openExternal("https://www.gyan.dev/ffmpeg/builds/");
      failed.push("系统中未找到 FFmpeg，已打开下载页面。下载 release essentials 版本，解压后把 ffmpeg.exe 放入任意文件夹，再回来在设置中指定路径即可。");
    }
  } else {
    fixed.push(`FFmpeg 已可用：${currentPath}`);
  }

  if (settings.videoOutputDir) {
    try {
      await fs.mkdir(settings.videoOutputDir, { recursive: true });
      authorizeDirectoryCapability("videoOutput", settings.videoOutputDir);
      const writable = await testDirectoryWritable(settings.videoOutputDir);
      if (writable) {
        fixed.push("输出目录已就绪");
      } else {
        const fallback = path.join(os.homedir(), "Desktop", "视频输出");
        await fs.mkdir(fallback, { recursive: true });
        settingsPatch = { ...settingsPatch, videoOutputDir: fallback };
        fixed.push(`原输出目录无法写入，已切换到：${fallback}`);
      }
    } catch {
      const fallback = path.join(os.homedir(), "Desktop", "视频输出");
      try {
        await fs.mkdir(fallback, { recursive: true });
        settingsPatch = { ...settingsPatch, videoOutputDir: fallback };
        fixed.push(`已创建输出目录：${fallback}`);
      } catch {
        failed.push("无法创建输出目录");
      }
    }
  } else {
    const defaultDir = path.join(os.homedir(), "Desktop", "视频输出");
    try {
      await fs.mkdir(defaultDir, { recursive: true });
      settingsPatch = { ...settingsPatch, videoOutputDir: defaultDir };
      fixed.push(`已自动设置输出目录：${defaultDir}`);
    } catch {
      failed.push("无法创建默认输出目录");
    }
  }

  if (!settings.videoLibraryDir) {
    failed.push("视频库文件夹未设置，请在设置中手动选择你的素材文件夹。");
  }

  return { fixed, failed, settingsPatch };
}

/**
 * 注册 FFmpeg 相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("ffmpeg:status", async () => getFfmpegStatus(await loadSettings()));
  ipcMain.handle("ffmpeg:diagnose", async () => diagnoseFfmpeg(await loadSettings()));
  ipcMain.handle("ffmpeg:autoFix", async () => autoFixFfmpeg(normalizeSettings(await loadSettings())));
}
