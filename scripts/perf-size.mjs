import { brotliCompressSync, gzipSync } from "node:zlib";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const assetsDir = path.join(root, "dist-renderer", "assets");

async function walk(dir) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else files.push(fullPath);
    }
  }
  await visit(dir);
  return files;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function rel(file) {
  return path.relative(path.join(root, "dist-renderer"), file).replace(/\\/g, "/");
}

async function compressedSize(file) {
  const buffer = await readFile(file);
  return {
    gzip: gzipSync(buffer).length,
    brotli: brotliCompressSync(buffer).length
  };
}

const files = await walk(assetsDir);
const byExt = new Map();
const fileStats = [];

for (const file of files) {
  const size = (await stat(file)).size;
  const ext = path.extname(file) || "(none)";
  byExt.set(ext, { count: (byExt.get(ext)?.count ?? 0) + 1, bytes: (byExt.get(ext)?.bytes ?? 0) + size });
  fileStats.push({ file, ext, size });
}

console.log("dist-renderer asset size by extension");
for (const [ext, info] of [...byExt.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`${ext.padEnd(8)} ${String(info.count).padStart(4)} files  ${mb(info.bytes).padStart(10)}`);
}

const total = [...byExt.values()].reduce((sum, item) => sum + item.bytes, 0);
console.log(`total    ${String(files.length).padStart(4)} files  ${mb(total).padStart(10)}`);

const jsCss = fileStats
  .filter((item) => item.ext === ".js" || item.ext === ".css")
  .sort((a, b) => b.size - a.size);

console.log("\nentry and large JS/CSS chunks");
for (const item of jsCss.slice(0, 12)) {
  const compressed = await compressedSize(item.file);
  const marker = /assets\/js\/index-|assets\/css\/index-/.test(rel(item.file)) ? "entry" : "chunk";
  console.log(`${marker.padEnd(6)} ${rel(item.file).padEnd(56)} raw ${kb(item.size).padStart(10)}  gzip ${kb(compressed.gzip).padStart(10)}  br ${kb(compressed.brotli).padStart(10)}`);
}

const firstScreen = jsCss.filter((item) => /assets\/js\/index-|assets\/css\/index-|react-vendor|utils/.test(rel(item.file)));
if (firstScreen.length) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const item of firstScreen) {
    const compressed = await compressedSize(item.file);
    raw += item.size;
    gzip += compressed.gzip;
    brotli += compressed.brotli;
  }
  console.log(`\nfirst-screen tracked JS/CSS  raw ${kb(raw)}  gzip ${kb(gzip)}  br ${kb(brotli)}`);
}
