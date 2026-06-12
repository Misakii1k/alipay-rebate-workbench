import { existsSync } from "node:fs";
import type { AppSettings } from "../../src/lib/shared";
import { knownEverythingCandidates, isAuthorizedEverythingPath } from "./capabilities";
export { searchWithEverything } from "./everythingSearch";

export function resolveEverythingEsPath(settings: AppSettings, options: { requireAuthorized?: boolean } = {}): string {
  const requireAuthorized = options.requireAuthorized ?? true;
  const candidates = [
    settings.everythingEsPath,
    ...knownEverythingCandidates()
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate) && (!requireAuthorized || isAuthorizedEverythingPath(candidate))) || "";
}
