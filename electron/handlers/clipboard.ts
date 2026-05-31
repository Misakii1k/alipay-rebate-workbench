import { clipboard, type IpcMain } from "electron";
import type { ClipboardSnapshot } from "../../src/lib/shared";
import { appendLog } from "../utils/logger";
import { imageSignature } from "../utils/media";
import { userDataPath } from "../utils/paths";

/**
 * 注册剪贴板相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("clipboard:read", (): ClipboardSnapshot => {
    const text = clipboard.readText().trim();
    if (text) {
      // 限制读取大小，防止内存溢出
      const MAX_CLIPBOARD_READ_SIZE = 10 * 1024 * 1024; // 10MB
      if (text.length > MAX_CLIPBOARD_READ_SIZE) {
        void appendLog("warn", "剪贴板内容过大，已截断", { size: text.length }, userDataPath);
        const truncated = text.slice(0, MAX_CLIPBOARD_READ_SIZE);
        const sig = truncated.length > 40 ? `${truncated.slice(0, 40)}...` : truncated;
        return { kind: "text", text: truncated, signature: `text:${sig}` };
      }
      const sig = text.length > 40 ? `${text.slice(0, 40)}...` : text;
      return { kind: "text", text, signature: `text:${sig}` };
    }
    const image = clipboard.readImage();
    if (!image.isEmpty()) return { kind: "image", imageDataUrl: image.toDataURL(), signature: `image:${imageSignature(image)}` };
    return { kind: "empty", signature: "empty" };
  });

  ipcMain.handle("clipboard:writeText", (_event, text: string) => {
    if (typeof text !== "string") return;
    const MAX_CLIPBOARD_WRITE_SIZE = 100_000; // 100KB
    if (text.length > MAX_CLIPBOARD_WRITE_SIZE) {
      void appendLog("warn", "剪贴板写入被拒绝：文本过长", { length: text.length }, userDataPath);
      return;
    }

    // 检查是否包含敏感信息（API Key 模式）
    if (/sk-[a-zA-Z0-9]{20,}/.test(text) || /Bearer\s+[a-zA-Z0-9\-_]{20,}/i.test(text)) {
      void appendLog("warn", "剪贴板写入包含疑似 API Key，已阻止", { preview: text.slice(0, 20) }, userDataPath);
      throw new Error("安全警告：检测到剪贴板内容包含疑似 API Key 或敏感令牌，已阻止写入。请勿复制敏感凭据。");
    }

    clipboard.writeText(text);
  });
}
