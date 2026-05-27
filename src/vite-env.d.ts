/// <reference types="vite/client" />

import type { AlipayWorkbenchApi } from "../electron/preload";
import type { WindowControls } from "./lib/shared";

declare global {
  interface Window {
    alipayWorkbench: AlipayWorkbenchApi & WindowControls;
  }
  interface Document {
    startViewTransition?: (callback: () => void) => { ready: Promise<void>; finished: Promise<void>; };
  }
}

declare namespace Electron {
  interface WebUtils {
    getPathForFile(file: File): string;
  }
}
