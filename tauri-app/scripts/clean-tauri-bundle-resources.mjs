import { rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(appDir, "src-tauri", "target", "release");

for (const directory of ["bin", "assets"]) {
  const target = resolve(releaseDir, directory);
  if (!target.startsWith(`${releaseDir}${sep}`)) {
    throw new Error(`Refusing to clean a path outside the Tauri release directory: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
