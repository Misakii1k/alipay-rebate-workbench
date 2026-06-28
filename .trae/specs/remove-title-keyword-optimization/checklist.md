# 验证清单

## 文件删除
- [x] `src/TitleOptimizer.tsx` 已删除
- [x] `src/lib/titleOptimizer.ts` 已删除
- [x] `electron/handlers/title.ts` 已删除
- [x] `electron/workers/titleWorker.ts` 已删除

## 类型与设置字段（src/lib/shared.ts）
- [x] `ToolboxTool` 联合类型中不再包含 `"title"`
- [x] `AppSettings` 接口中不再包含 `titleKeywordExcelPath` / `titleAiSelectionEnabled` / `titleExtraKeywords`
- [x] `DEFAULT_TITLE_KEYWORD_EXCEL_PATH` 常量已删除
- [x] `DEFAULT_SETTINGS` 中不再包含上述 3 个字段
- [x] `normalizeSettings` 中不再回退上述 3 个字段
- [x] `completedTours` filter 允许列表中不再包含 `"title"`
- [x] 全部 `Title*` 类型与 `SubstringHit` 接口已删除

## 前端入口（src/App.tsx）
- [x] 不再 import `Tags` 图标
- [x] 不再 lazy import `TitleOptimizer`
- [x] 不再渲染 `<TitleOptimizer ... />`
- [x] `ViewKey` 联合类型中不再包含 `"title"`
- [x] `toolNavItems` 中不再有 "title" 条目
- [x] `bentoCards` 中不再有 "bento-title" 条目
- [x] `SettingsView` 的 `section` 联合类型中不再包含 `"title"`
- [x] `settingsHubItems` 中不再有 "title" 条目
- [x] `pickTitleExcel` 函数已删除
- [x] `{section === "title" && ...}` 设置面板分支已删除
- [x] `viewTitle` / `toolEyebrow` 映射中不再有 `title` 键
- [x] `openTool` 路由判断中不再有 `view === "title"` 分支

## Electron 主进程
- [x] `electron/main.ts` 不再 import 与调用 `setTitleMainWindow`
- [x] `electron/handlers/index.ts` 不再 import 与 register `titleHandler`，文档注释已更新
- [x] `electron/preload.ts` 不再有 5 个 title 相关 IPC 绑定与对应类型 import

## 浏览器预览 mock 与工具函数
- [x] `src/main.tsx` mock 对象中不再有 5 个 title 相关 mock
- [x] `electron/utils/capabilities.ts` 不再有 `"titleExcel"` capability kind、`assertAuthorizedTitleExcel`、相关 authorize 分支
- [x] `electron/utils/settings.ts` `sanitizeCapabilityFields` 中不再处理 `titleKeywordExcelPath`，不再 import `assertAuthorizedTitleExcel`
- [x] `electron/utils/worker.ts` `WORKER_LIMITS` 中不再有 `titleWorker` 条目

## 编译与残留
- [x] `npx tsc --noEmit` 编译通过
- [x] `npx tsc --noEmit -p tsconfig.electron.json` 编译通过
- [x] grep 验证 src/ 与 electron/ 下已无 `TitleOptimizer` / `titleOptimizer` / `TitleKeyword` / `titleKeyword` / `titleAi` / `titleExtra` / `titleWorker` / `titleExcel` / `selectTitleKeywordExcel` / `loadTitleKeywordData` / `analyzeTitle` / `generateTitleCandidates` / `enhanceTitlePool` / `setTitleMainWindow` / `assertAuthorizedTitleExcel` / `TitleGenerationStrategy` / `TitleCandidate` / `SubstringHit` 残留

## 运行时验证
- [ ] `npm run dev` 启动成功，应用主窗口正常打开（需用户手动验证）
- [ ] 侧边栏不再出现"标题词优化"导航项（需用户手动验证）
- [ ] 首页 Bento 网格不再出现"标题词优化"卡片（需用户手动验证）
- [ ] 设置中心分类列表不再出现"标题词优化"分类（需用户手动验证）
- [ ] 返款、视频、收评、对比四大工具正常工作（需用户手动验证）
