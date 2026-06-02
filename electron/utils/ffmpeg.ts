import { app } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { AppSettings } from "../../src/lib/shared";

/**
 * 获取 FFmpeg 可执行文件的候选路径列表。
 */
export function getFfmpegCandidates(settings: AppSettings): string[] {
  return [
    settings.ffmpegPath,
    path.join(process.resourcesPath, "bin", "ffmpeg.exe"),
    path.join(app.getAppPath(), "bin", "ffmpeg.exe"),
    path.join(__dirname, "../../bin/ffmpeg.exe")
  ].filter(Boolean);
}

/**
 * 从候选路径中找到第一个存在的 FFmpeg 路径。
 */
export function resolveFfmpegPath(settings: AppSettings): string | undefined {
  return getFfmpegCandidates(settings).find((candidate) => existsSync(candidate));
}

/**
 * 运行外部进程并收集输出。
 */
export function runProcess(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, { windowsHide: true });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", (error) => resolve({ code: -1, output: error.message }));
    child.on("exit", (code) => resolve({ code, output }));
  });
}
