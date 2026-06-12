import { app } from "electron";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { AppSettings } from "../../src/lib/shared";
import { isPathInsideRoot, validatePathSafety } from "./security";

export type CapabilityKind =
  | "mediaRoot"
  | "reviewRoot"
  | "videoLibrary"
  | "videoOutput"
  | "titleExcel"
  | "ffmpeg"
  | "everything";

const directoryKinds = new Set<CapabilityKind>(["mediaRoot", "reviewRoot", "videoLibrary", "videoOutput"]);
const capabilities = new Map<CapabilityKind, Set<string>>();

function bucket(kind: CapabilityKind): Set<string> {
  const existing = capabilities.get(kind);
  if (existing) return existing;
  const next = new Set<string>();
  capabilities.set(kind, next);
  return next;
}

export function canonicalPath(targetPath: string): string {
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

function samePath(a: string, b: string): boolean {
  return canonicalPath(a).toLowerCase() === canonicalPath(b).toLowerCase();
}

function extensionAllowed(filePath: string, allowedExts?: Set<string>): boolean {
  return !allowedExts || allowedExts.has(path.extname(filePath).toLowerCase());
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function executableNameIs(filePath: string, expectedName: string): boolean {
  return path.basename(filePath).toLowerCase() === expectedName.toLowerCase() &&
    path.extname(filePath).toLowerCase() === ".exe";
}

export function bundledFfmpegCandidates(): string[] {
  return [
    path.join(process.resourcesPath, "bin", "ffmpeg.exe"),
    path.join(app.getAppPath(), "bin", "ffmpeg.exe"),
    path.join(__dirname, "../../bin/ffmpeg.exe")
  ];
}

export function knownEverythingCandidates(): string[] {
  return [
    path.join(process.resourcesPath, "bin", "es.exe"),
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Everything", "es.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Everything", "es.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Everything", "es.exe")
  ].filter(Boolean);
}

function isBundledFfmpeg(filePath: string): boolean {
  return bundledFfmpegCandidates().some((candidate) => samePath(candidate, filePath));
}

function isKnownEverything(filePath: string): boolean {
  return knownEverythingCandidates().some((candidate) => samePath(candidate, filePath));
}

export function authorizeDirectoryCapability(kind: CapabilityKind, dir: string, options: { mustExist?: boolean } = {}): boolean {
  if (!dir || !directoryKinds.has(kind)) return false;
  try {
    validatePathSafety(dir);
    if (options.mustExist && !isDirectory(dir)) return false;
    bucket(kind).add(canonicalPath(dir));
    return true;
  } catch {
    return false;
  }
}

export function authorizeFileCapability(kind: CapabilityKind, filePath: string, allowedExts?: Set<string>): boolean {
  if (!filePath || directoryKinds.has(kind)) return false;
  try {
    if (!existsSync(filePath) || !isFile(filePath) || !extensionAllowed(filePath, allowedExts)) return false;
    if (kind === "ffmpeg" && !executableNameIs(filePath, "ffmpeg.exe")) return false;
    if (kind === "everything" && !executableNameIs(filePath, "es.exe")) return false;
    if (kind === "titleExcel") validatePathSafety(filePath);
    bucket(kind).add(canonicalPath(filePath));
    return true;
  } catch {
    return false;
  }
}

export function authorizeSettingsCapabilities(settings: AppSettings, source: "load" | "save" = "load"): void {
  const mayAuthorizeRoot = (kind: CapabilityKind, value: string) => source === "load" || isAuthorizedRoot(kind, value);
  if (mayAuthorizeRoot("reviewRoot", settings.reviewRootDir)) authorizeDirectoryCapability("reviewRoot", settings.reviewRootDir);
  if (mayAuthorizeRoot("videoLibrary", settings.videoLibraryDir)) authorizeDirectoryCapability("videoLibrary", settings.videoLibraryDir);
  if (mayAuthorizeRoot("videoOutput", settings.videoOutputDir)) authorizeDirectoryCapability("videoOutput", settings.videoOutputDir);
  if (source === "load" || isAuthorizedRoot("mediaRoot", settings.reviewRootDir)) authorizeDirectoryCapability("mediaRoot", settings.reviewRootDir);
  if (source === "load" || isAuthorizedRoot("mediaRoot", settings.videoLibraryDir)) authorizeDirectoryCapability("mediaRoot", settings.videoLibraryDir);
  if (source === "load" || isAuthorizedRoot("mediaRoot", settings.videoOutputDir)) authorizeDirectoryCapability("mediaRoot", settings.videoOutputDir);

  if (source === "load" || isAuthorizedExactCapability("titleExcel", settings.titleKeywordExcelPath)) {
    authorizeFileCapability("titleExcel", settings.titleKeywordExcelPath, new Set([".xlsx", ".xlsm"]));
  }
  if (settings.sliceCustomMusicPath && (source === "load" || isAuthorizedRoot("mediaRoot", path.dirname(settings.sliceCustomMusicPath)))) {
    authorizeDirectoryCapability("mediaRoot", path.dirname(settings.sliceCustomMusicPath));
  }

  if (source === "load" || isAuthorizedExactCapability("ffmpeg", settings.ffmpegPath) || isBundledFfmpeg(settings.ffmpegPath)) {
    authorizeFileCapability("ffmpeg", settings.ffmpegPath);
  }
  if (source === "load" || isAuthorizedExactCapability("everything", settings.everythingEsPath) || isKnownEverything(settings.everythingEsPath)) {
    authorizeFileCapability("everything", settings.everythingEsPath);
  }
}

export function isAuthorizedExactCapability(kind: CapabilityKind, filePath: string): boolean {
  if (!filePath) return false;
  const target = canonicalPath(filePath).toLowerCase();
  return [...(capabilities.get(kind) ?? [])].some((item) => item.toLowerCase() === target);
}

export function isAuthorizedRoot(kind: CapabilityKind, root: string): boolean {
  if (!root || !directoryKinds.has(kind)) return false;
  const roots = capabilities.get(kind);
  if (!roots?.size) return false;
  return [...roots].some((allowedRoot) => samePath(allowedRoot, root));
}

export function isAuthorizedChildPath(kind: CapabilityKind, targetPath: string, root?: string, allowedExts?: Set<string>): boolean {
  if (!targetPath || !directoryKinds.has(kind) || !extensionAllowed(targetPath, allowedExts)) return false;
  const roots = capabilities.get(kind);
  if (!roots?.size) return false;
  if (root) {
    if (!isAuthorizedRoot(kind, root)) return false;
    return isPathInsideRoot(targetPath, root);
  }
  return [...roots].some((allowedRoot) => isPathInsideRoot(targetPath, allowedRoot));
}

export function assertAuthorizedRoot(kind: CapabilityKind, root: string): string {
  if (!isAuthorizedRoot(kind, root)) throw new Error("Path is not authorized.");
  return canonicalPath(root);
}

export function assertAuthorizedChildPath(kind: CapabilityKind, targetPath: string, root?: string, allowedExts?: Set<string>): string {
  if (!isAuthorizedChildPath(kind, targetPath, root, allowedExts)) throw new Error("Path is outside the authorized directory.");
  return canonicalPath(targetPath);
}

export function isAuthorizedFfmpegPath(filePath: string): boolean {
  return Boolean(filePath && executableNameIs(filePath, "ffmpeg.exe") && existsSync(filePath) && (isBundledFfmpeg(filePath) || isAuthorizedExactCapability("ffmpeg", filePath)));
}

export function isAuthorizedEverythingPath(filePath: string): boolean {
  return Boolean(filePath && executableNameIs(filePath, "es.exe") && existsSync(filePath) && (isKnownEverything(filePath) || isAuthorizedExactCapability("everything", filePath)));
}

export function assertAuthorizedTitleExcel(filePath: string): string {
  if (!isAuthorizedExactCapability("titleExcel", filePath) || !extensionAllowed(filePath, new Set([".xlsx", ".xlsm"]))) {
    throw new Error("Title keyword Excel is not authorized.");
  }
  return canonicalPath(filePath);
}

export function isAuthorizedMediaPath(filePath: string, allowedExts?: Set<string>): boolean {
  return isAuthorizedChildPath("mediaRoot", filePath, undefined, allowedExts) ||
    isAuthorizedChildPath("reviewRoot", filePath, undefined, allowedExts) ||
    isAuthorizedChildPath("videoLibrary", filePath, undefined, allowedExts);
}
