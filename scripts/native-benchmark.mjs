import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const mediaExts = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ...imageExts]);
const maxItems = Number(process.env.BENCH_MAX_ITEMS || 5000);

async function walkMedia(dir) {
  const results = [];
  async function visit(current) {
    if (results.length >= maxItems) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= maxItems || entry.isSymbolicLink()) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (mediaExts.has(path.extname(entry.name).toLowerCase())) results.push(fullPath);
    }
  }
  await visit(dir);
  return results;
}

const started = performance.now();
const files = await walkMedia(root);
const walkMs = performance.now() - started;

const statStarted = performance.now();
let newest = 0;
for (const file of files) {
  const mtimeMs = await stat(file).then((item) => item.mtimeMs).catch(() => 0);
  if (mtimeMs > newest) newest = mtimeMs;
}
const statMs = performance.now() - statStarted;

console.log(JSON.stringify({
  root,
  maxItems,
  files: files.length,
  walkMs: Math.round(walkMs),
  statMs: Math.round(statMs),
  note: "This is the TypeScript/Node baseline. Add a Rust/C++ sidecar later only if it beats this by a meaningful margin on real media folders."
}, null, 2));
