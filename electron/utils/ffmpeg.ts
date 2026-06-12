import { app } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { AppSettings } from "../../src/lib/shared";
import { bundledFfmpegCandidates, isAuthorizedFfmpegPath } from "./capabilities";

const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;

/**
 * 获取 FFmpeg 可执行文件的候选路径列表。
 */
export function getFfmpegCandidates(settings: AppSettings): string[] {
  return [
    settings.ffmpegPath,
    ...bundledFfmpegCandidates()
  ].filter(Boolean);
}

/**
 * 从候选路径中找到第一个存在的 FFmpeg 路径。
 */
export function resolveFfmpegPath(settings: AppSettings): string | undefined {
  return getFfmpegCandidates(settings).find((candidate) => existsSync(candidate) && isAuthorizedFfmpegPath(candidate));
}

/**
 * 运行外部进程并收集输出。
 */
function appendLimitedOutput(current: string, chunk: string): string {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= MAX_PROCESS_OUTPUT_BYTES) return next;
  return next.slice(Math.max(0, next.length - MAX_PROCESS_OUTPUT_BYTES));
}

export function runProcess(command: string, args: string[], timeoutMs = 30_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(command, args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: -1, output: appendLimitedOutput(output, `\nProcess timed out after ${timeoutMs}ms`) });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (output = appendLimitedOutput(output, String(chunk))));
    child.stderr.on("data", (chunk) => (output = appendLimitedOutput(output, String(chunk))));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, output: error.message });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}
