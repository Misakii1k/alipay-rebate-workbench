import { nativeImage } from "electron";
import type { NativeImage } from "electron";
import path from "node:path";

/**
 * 生成图片签名（用于剪贴板变化检测）。
 * @param image Electron NativeImage 对象
 * @returns 签名字符串（格式：宽x高:字节数）
 */
export function imageSignature(image: NativeImage): string {
  if (image.isEmpty()) return "";
  const size = image.getSize();
  return `${size.width}x${size.height}:${image.toPNG().byteLength}`;
}

/**
 * 将图片文件转换为 Data URL（用于预览）。
 * @param filePath 图片文件路径
 * @param maxSide 最大边长（默认 720px）
 * @returns Data URL 或 undefined（如果图片无效）
 */
export function imageToDataUrl(filePath: string, maxSide = 720): string | undefined {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return undefined;
  const size = image.getSize();
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  const resized = scale < 1 ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }) : image;
  return resized.toDataURL();
}

function imageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

export async function imageToDataUrlAsync(filePath: string, maxSide = 720): Promise<string | undefined> {
  try {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp(filePath)
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toBuffer();
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    const fallback = imageToDataUrl(filePath, maxSide);
    if (!fallback) return undefined;
    if (fallback.startsWith("data:image/")) return fallback;
    const marker = "base64,";
    const index = fallback.indexOf(marker);
    return index >= 0 ? `data:${imageMimeType(filePath)};base64,${fallback.slice(index + marker.length)}` : fallback;
  }
}

/**
 * 探测图片尺寸并缩放到合适大小（用于视频渲染）。
 * @param imagePath 图片文件路径
 * @returns 缩放后的宽高（偶数，最大边长 1440px）
 */
export async function probeImageSize(imagePath: string): Promise<{ width: number; height: number }> {
  const image = nativeImage.createFromPath(imagePath);
  const size = image.getSize();
  if (!size.width || !size.height) return { width: 1080, height: 1440 };
  const maxSide = 1440;
  const ratio = Math.min(1, maxSide / Math.max(size.width, size.height));
  const width = Math.max(2, Math.round((size.width * ratio) / 2) * 2);
  const height = Math.max(2, Math.round((size.height * ratio) / 2) * 2);
  return { width, height };
}
