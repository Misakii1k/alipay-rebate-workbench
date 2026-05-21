/// <reference types="vite/client" />

import type { AlipayWorkbenchApi } from "../electron/preload";
import type { WindowControls } from "./lib/shared";

declare global {
  interface Window {
    alipayWorkbench: AlipayWorkbenchApi & WindowControls;
  }
}

declare namespace Electron {
  interface WebUtils {
    getPathForFile(file: File): string;
  }
}
