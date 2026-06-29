# Claude Code Handoff Entry

Read this first:

```text
.trae/documents/claude-code-handoff-after-tauri-regression-audit.md
```

Task:

Continue the Tauri migration regression audit and fixes in `tauri-app`, using the last stable Electron release as the behavior baseline:

```text
v-electron-final
legacy/electron
electron/
```

Critical constraint:

The title optimization feature was intentionally removed by the user. Do not restore it. Do not recreate `TitleOptimizer.tsx`, `titleOptimizer.ts`, `titleKeywordData.ts`, or any related UI/settings/API.

First concrete steps:

1. Run `git status --short` and inspect the existing dirty worktree without resetting it.
2. Compare `electron/preload.ts`, `tauri-app/src/lib/tauri-bridge.ts`, and `tauri-app/src-tauri/src/lib.rs` for API parity.
3. Then verify and fix the real desktop workflows listed in the handoff document.

Known baseline checks already completed before this handoff:

```powershell
cd tauri-app
npm run build
```

Passed.

```powershell
cd tauri-app/src-tauri
cargo check
```

Passed with warnings only.
