import { app, BrowserWindow, ipcMain, Menu, session } from "electron";
import path from "node:path";
import { DEFAULT_VIDEO_WORKBENCH_STATE } from "../src/lib/shared";
import { registerAllHandlers } from "./handlers";
import { setMainWindow as setExportMainWindow } from "./handlers/export";
import { setMainWindow as setUpdateMainWindow, initializeAutoUpdater } from "./handlers/update";
import { setMainWindow as setFilesMainWindow } from "./handlers/files";
import { setMainWindow as setTitleMainWindow } from "./handlers/title";
import { setMainWindow as setVideoMainWindow } from "./handlers/video";
import { setMainWindow as setReviewMainWindow } from "./handlers/review";
import { loadSettings } from "./utils/settings";
import { saveVideoWorkbenchState } from "./utils/workbench";

let mainWindow: BrowserWindow | null = null;
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1160,
    minHeight: 760,
    autoHideMenuBar: true,
    frame: false,
    title: "电商运营工具箱",
    backgroundColor: "#080b0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();

  mainWindow.webContents.on("will-navigate", (_event, url) => {
    if (!isDev || !url.startsWith(process.env.VITE_DEV_SERVER_URL!)) {
      _event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (isDev) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else mainWindow.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: file:; font-src 'self' data:; connect-src 'self' https:; " +
          "media-src 'self' file:; object-src 'none'"
        ]
      }
    });
  });

  registerAllHandlers(ipcMain);

  createWindow();
  setExportMainWindow(mainWindow);
  setUpdateMainWindow(mainWindow);
  setFilesMainWindow(mainWindow);
  setTitleMainWindow(mainWindow);
  setVideoMainWindow(mainWindow);
  setReviewMainWindow(mainWindow);

  const settings = await loadSettings();
  await initializeAutoUpdater(settings);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  try {
    await saveVideoWorkbenchState(DEFAULT_VIDEO_WORKBENCH_STATE);
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
