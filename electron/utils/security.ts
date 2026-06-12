import path from "node:path";
import { existsSync, realpathSync } from "node:fs";

function canonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  try {
    return realpathSync.native(resolved);
  } catch {
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }
}

function normalizeForCompare(targetPath: string): string {
  return path.normalize(targetPath).toLowerCase();
}

function pathEqualsOrContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isPathInsideRoot(targetPath: string, root: string): boolean {
  if (!targetPath || !root) return false;
  const resolvedTarget = canonicalPath(targetPath);
  const resolvedRoot = canonicalPath(root);
  return pathEqualsOrContains(resolvedRoot, resolvedTarget);
}

export function validatePathSafety(targetPath: string, allowedRoots?: string[]): void {
  if (!targetPath) throw new Error("Path cannot be empty.");

  const resolved = path.resolve(targetPath);
  const canonical = canonicalPath(resolved);
  const normalizedTargets = [normalizeForCompare(resolved), normalizeForCompare(canonical)];
  const forbiddenPaths = [
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    process.env.SystemRoot || "C:\\Windows",
    process.env.ProgramFiles || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
  ].map(canonicalPath);

  for (const forbiddenPath of forbiddenPaths) {
    const forbidden = normalizeForCompare(forbiddenPath);
    const blocked = normalizedTargets.some((candidate) => (
      candidate === forbidden || candidate.startsWith(forbidden + path.sep)
    ));
    if (blocked) throw new Error(`Access to system path is blocked: ${forbiddenPath}`);
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const isAllowed = allowedRoots.some((root) => isPathInsideRoot(targetPath, root));
    if (!isAllowed) throw new Error("Path is outside the allowed directory.");
  }
}

export function validateMediaFilePath(filePath: string): void {
  if (!filePath) throw new Error("File path cannot be empty.");
  if (!existsSync(filePath)) throw new Error(`File does not exist: ${filePath}`);

  const illegalChars = /[<>|?*]/;
  const fileName = path.basename(filePath);
  const match = illegalChars.exec(fileName);
  if (match) throw new Error(`File name contains an illegal character: ${match[0]}`);
  if (fileName.length > 255) throw new Error("File name is too long.");

  validatePathSafety(filePath);
}

export function validateApiUrl(url: string): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("API Base URL is invalid.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHttp = parsed.protocol === "http:" && (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("API Base URL must use HTTPS, except exact localhost HTTP addresses.");
  }
}

export function sanitizeCellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text === "") return null;
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export function sanitizeEverythingQuery(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
