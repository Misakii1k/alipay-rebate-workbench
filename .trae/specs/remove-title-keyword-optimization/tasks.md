# Tasks

## Task 1: 删除独立文件
- [x] SubTask 1.1: 删除 [src/TitleOptimizer.tsx](file:///c:/Users/87850/Desktop/新项目/src/TitleOptimizer.tsx)
- [x] SubTask 1.2: 删除 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts)
- [x] SubTask 1.3: 删除 [electron/handlers/title.ts](file:///c:/Users/87850/Desktop/新项目/electron/handlers/title.ts)
- [x] SubTask 1.4: 删除 [electron/workers/titleWorker.ts](file:///c:/Users/87850/Desktop/新项目/electron/workers/titleWorker.ts)

## Task 2: 清理 [src/lib/shared.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/shared.ts)
- [x] SubTask 2.1: 从 `ToolboxTool` 联合类型移除 `"title"`，并在 `normalizeSettings` 的 `completedTours` filter 允许列表中移除 `"title"`
- [x] SubTask 2.2: 从 `AppSettings` 接口移除 `titleKeywordExcelPath` / `titleAiSelectionEnabled` / `titleExtraKeywords` 三个字段
- [x] SubTask 2.3: 删除 `DEFAULT_TITLE_KEYWORD_EXCEL_PATH` 常量；从 `DEFAULT_SETTINGS` 移除上述 3 个字段的默认值
- [x] SubTask 2.4: 从 `normalizeSettings` 移除上述 3 个字段的回退处理（约 646/657/658 行）
- [x] SubTask 2.5: 删除全部 `Title*` 类型与 `SubstringHit` 接口（约 218-383 行的连续区块）

## Task 3: 清理 [src/App.tsx](file:///c:/Users/87850/Desktop/新项目/src/App.tsx)
- [x] SubTask 3.1: 删除 `Tags` 图标 import（约 25 行）
- [x] SubTask 3.2: 删除 `TitleOptimizer` 的 lazy import（约 35 行）与 `<TitleOptimizer ... />` 渲染分支（约 942 行）
- [x] SubTask 3.3: 从 `ViewKey` 联合类型移除 `"title"`（约 61 行）；从 `toolNavItems` 移除 "title" 条目（约 125 行）；从 `bentoCards` 移除 "bento-title" 条目（约 983 行）
- [x] SubTask 3.4: 从 `SettingsView` 的 `section` 联合类型移除 `"title"`（约 1192 行）；删除 `pickTitleExcel` 函数（约 1212-1215 行）；删除 `{section === "title" && ...}` 设置面板分支（约 1451 行）；从 `settingsHubItems` 移除 "title" 条目（约 1327 行）
- [x] SubTask 3.5: 从 `viewTitle` 与 `toolEyebrow` 的对象映射中移除 `title` 键（约 1574/1578 行）；从 `openTool` 路由判断中移除 `view === "title"` 分支（约 1569 行）

## Task 4: 清理 Electron 主进程
- [x] SubTask 4.1: 在 [electron/main.ts](file:///c:/Users/87850/Desktop/新项目/electron/main.ts) 移除 `setTitleMainWindow` 的 import（约 8 行）与调用（约 69 行）
- [x] SubTask 4.2: 在 [electron/handlers/index.ts](file:///c:/Users/87850/Desktop/新项目/electron/handlers/index.ts) 移除 `titleHandler` 的 import（约 13 行）与 `titleHandler.register(ipcMain)` 调用（约 55 行），并更新文档注释（约 34/55 行）
- [x] SubTask 4.3: 在 [electron/preload.ts](file:///c:/Users/87850/Desktop/新项目/electron/preload.ts) 移除 5 个 title 相关 IPC 绑定（约 52-57、84 行）与类型 import（约 21-25 行的 TitleAnalysisResult / TitleAnalyzePayload / TitleGeneratePayload / TitleKeywordData / TitleScoreResult）

## Task 5: 清理浏览器预览 mock 与工具函数
- [x] SubTask 5.1: 在 [src/main.tsx](file:///c:/Users/87850/Desktop/新项目/src/main.tsx) 的 mock 对象中移除 `selectTitleKeywordExcel` / `loadTitleKeywordData` / `generateTitleCandidates` / `analyzeTitle` / `enhanceTitlePool` 共 5 个 mock（约 52-82、99 行）
- [x] SubTask 5.2: 在 [electron/utils/capabilities.ts](file:///c:/Users/87850/Desktop/新项目/electron/utils/capabilities.ts) 从 `CapabilityKind` 联合类型移除 `"titleExcel"`（约 12 行）；删除 `authorizeFileCapability` 中的 `kind === "titleExcel"` 分支（约 112 行）；删除 `authorizeSettingsCapabilities` 中的 titleExcel 块（约 129-130 行）；删除 `assertAuthorizedTitleExcel` 函数（约 186-191 行）
- [x] SubTask 5.3: 在 [electron/utils/settings.ts](file:///c:/Users/87850/Desktop/新项目/electron/utils/settings.ts) 的 `sanitizeCapabilityFields` 中移除 `titleKeywordExcelPath` IIFE 块（约 127-135 行）；从 import 列表中移除 `assertAuthorizedTitleExcel`（约 12 行）
- [x] SubTask 5.4: 在 [electron/utils/worker.ts](file:///c:/Users/87850/Desktop/新项目/electron/utils/worker.ts) 的 `WORKER_LIMITS` 中移除 `titleWorker: 1` 条目（约 42 行）

## Task 6: 验证
- [x] SubTask 6.1: `npx tsc --noEmit` 编译通过
- [x] SubTask 6.2: `npx tsc --noEmit -p tsconfig.electron.json` 编译通过
- [x] SubTask 6.3: 全局 grep 验证 `TitleOptimizer` / `titleOptimizer` / `TitleKeyword` / `titleKeyword` / `titleAi` / `titleExtra` / `titleWorker` / `titleExcel` / `selectTitleKeywordExcel` / `loadTitleKeywordData` / `analyzeTitle` / `generateTitleCandidates` / `enhanceTitlePool` / `setTitleMainWindow` / `assertAuthorizedTitleExcel` / `TitleGenerationStrategy` / `TitleCandidate` / `SubstringHit` 等关键字在 src/ 和 electron/ 下已无残留（仅 .trae/specs/ 历史文档可保留）
- [ ] SubTask 6.4: 启动 `npm run dev`，应用正常打开，侧边栏与首页 Bento 不再出现"标题词优化"卡片，设置中心不再出现"标题词优化"分类（需用户手动验证）

# Task Dependencies
- Task 1 独立，最先完成（先删文件，让 TS 立即报错暴露所有引用点）
- Task 2 独立（shared.ts 类型清理）
- Task 3 依赖 Task 1（App.tsx 不再能 import TitleOptimizer.tsx）
- Task 4 依赖 Task 1（handlers/index.ts 不再能 import 已删除的 title.ts）
- Task 5 依赖 Task 2（mock 与 capabilities 引用的类型已从 shared.ts 移除）
- Task 6 依赖 Task 1-5 全部完成
