import { app, dialog, type IpcMain, type BrowserWindow } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import type { ExportPayload, ExportResult } from "../../src/lib/shared";
import { DEFAULT_FIXED_TAIL_ROW } from "../../src/lib/shared";
import { sanitizeCellText } from "../utils/security";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

function hasExportRowValue(row: { account?: string; name?: string; amount?: string; remark?: string }): boolean {
  return Boolean(row.account?.trim() || row.name?.trim() || row.amount?.trim() || row.remark?.trim());
}

async function exportWorkbook(payload: ExportPayload): Promise<ExportResult> {
  try {
    const safeName = sanitizeFileName(payload.defaultFileName);
    const dialogOptions = {
      title: "导出支付宝返款表",
      defaultPath: path.join(app.getPath("desktop"), safeName),
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
    } satisfies Electron.SaveDialogOptions;
    const saveResult = mainWindow ? await dialog.showSaveDialog(mainWindow, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const templateCandidates = [path.join(app.getAppPath(), "assets", "alipay-template.xlsx"), path.join(process.resourcesPath, "assets", "alipay-template.xlsx")];
    const templatePath = templateCandidates.find((candidate) => existsSync(candidate));
    if (!templatePath) throw new Error("未找到支付宝 Excel 模板文件。");
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.worksheets[0];
    const startRow = 3;
    const tailRow = payload.tailRow ?? DEFAULT_FIXED_TAIL_ROW;
    const rows = [
      ...payload.rows.map((row) => ({ account: row.account, name: row.name, amount: row.amount, remark: row.remark })),
      ...(hasExportRowValue(tailRow) ? [tailRow] : [])
    ];

    for (let index = 0; index < rows.length; index += 1) {
      const targetRow = worksheet.getRow(startRow + index);
      const sourceRow = worksheet.getRow(index < 22 ? startRow + index : 25);
      [1, 2, 3, 4, 5].forEach((col) => (targetRow.getCell(col).style = { ...sourceRow.getCell(col).style }));
      targetRow.getCell(1).value = index + 1;
      targetRow.getCell(2).value = sanitizeCellText(rows[index].account);
      targetRow.getCell(3).value = sanitizeCellText(rows[index].name);
      targetRow.getCell(4).value = rows[index].amount === "" ? null : Number(rows[index].amount);
      targetRow.getCell(5).value = sanitizeCellText(rows[index].remark);
      targetRow.commit();
    }

    for (let rowIndex = startRow + rows.length; rowIndex <= 200; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      [1, 2, 3, 4, 5].forEach((col) => (row.getCell(col).value = null));
      row.commit();
    }

    await workbook.xlsx.writeFile(saveResult.filePath);
    return { canceled: false, filePath: saveResult.filePath };
  } catch (err) {
    return { canceled: false, error: (err as Error).message || "导出失败，请重试。" };
  }
}

/**
 * 注册 Excel 导出相关的 IPC handlers。
 */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle("export:workbook", (_event, payload: ExportPayload) => exportWorkbook(payload));
}
