import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const buildDir = join(root, "build");
const publicDir = join(root, "public");

const svgPath = join(buildDir, "icon.svg");
const svg = readFileSync(svgPath);

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

function rawToBmp(rawBuf, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const bmp = Buffer.alloc(fileSize);
  bmp.write("BM", 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 3;
      const a = rawBuf[si + 3] / 255;
      bmp[di + 0] = Math.round(rawBuf[si + 2] * a + 10 * (1 - a));
      bmp[di + 1] = Math.round(rawBuf[si + 1] * a + 13 * (1 - a));
      bmp[di + 2] = Math.round(rawBuf[si + 0] * a + 20 * (1 - a));
    }
  }
  return bmp;
}

async function main() {
  const pngBuffers = {};
  for (const size of sizes) {
    const buf = await sharp(svg).resize(size, size).png().toBuffer();
    pngBuffers[size] = buf;
    console.log(`  Generated ${size}x${size} PNG`);
  }

  writeFileSync(join(buildDir, "icon.png"), pngBuffers[256]);
  console.log("  -> build/icon.png (256x256)");
  writeFileSync(join(publicDir, "icon.png"), pngBuffers[256]);
  console.log("  -> public/icon.png (256x256)");

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = icoSizes.map((s) => pngBuffers[s]);
  const ico = await pngToIco(icoPngs);
  writeFileSync(join(buildDir, "icon.ico"), ico);
  console.log("  -> build/icon.ico (multi-size ICO)");

  const W_SIDE = 164, H_SIDE = 314;
  const sidebarIcon = await sharp(svg).resize(120, 120, { fit: "contain", background: { r: 10, g: 13, b: 20, alpha: 1 } }).png().toBuffer();
  const sidebarComposite = await sharp({
    create: { width: W_SIDE, height: H_SIDE, channels: 4, background: { r: 10, g: 13, b: 20, alpha: 1 } }
  }).composite([{ input: sidebarIcon, top: 60, left: 22 }]).raw().toBuffer();
  const sidebarBmp = rawToBmp(sidebarComposite, W_SIDE, H_SIDE);
  writeFileSync(join(buildDir, "installerSidebar.bmp"), sidebarBmp);
  console.log("  -> build/installerSidebar.bmp (164x314)");
  writeFileSync(join(buildDir, "uninstallerSidebar.bmp"), sidebarBmp);
  console.log("  -> build/uninstallerSidebar.bmp (164x314)");

  const W_HDR = 150, H_HDR = 57;
  const headerIcon = await sharp(svg).resize(44, 44, { fit: "contain", background: { r: 10, g: 13, b: 20, alpha: 1 } }).png().toBuffer();
  const headerComposite = await sharp({
    create: { width: W_HDR, height: H_HDR, channels: 4, background: { r: 10, g: 13, b: 20, alpha: 1 } }
  }).composite([{ input: headerIcon, top: 6, left: 53 }]).raw().toBuffer();
  const headerBmp = rawToBmp(headerComposite, W_HDR, H_HDR);
  writeFileSync(join(buildDir, "installerHeader.bmp"), headerBmp);
  console.log("  -> build/installerHeader.bmp (150x57)");

  console.log("\nDone!");
}

main().catch((err) => { console.error(err); process.exit(1); });
