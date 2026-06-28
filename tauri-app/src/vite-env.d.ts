/// <reference types="vite/client" />
/// <reference types="@tauri-apps/api" />

import type { AlipayWorkbenchApi } from "./lib/tauri-bridge";

declare global {
  interface Window {
    alipayWorkbench: AlipayWorkbenchApi;
  }
  interface Document {
    startViewTransition?: (callback: () => void) => { ready: Promise<void>; finished: Promise<void>; };
  }
}
