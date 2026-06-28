# 全量移除标题词优化 Spec

## Why
"标题词优化"工具长期未达预期效果，用户决定彻底废弃该模块，专注返款、视频、收评、对比四大核心工具，减少代码维护面与设置项噪声。

## What Changes
- 删除"标题词优化"工具入口（侧边栏 nav-item、首页 bento 卡片、设置中心 hub-item、ViewKey/ToolboxTool 中的 "title" 取值）
- 删除前端组件 [src/TitleOptimizer.tsx](file:///c:/Users/87850/Desktop/新项目/src/TitleOptimizer.tsx) 与算法库 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts)
- 删除 Electron 主进程 IPC handler [electron/handlers/title.ts](file:///c:/Users/87850/Desktop/新项目/electron/handlers/title.ts) 与 worker [electron/workers/titleWorker.ts](file:///c:/Users/87850/Desktop/新项目/electron/workers/titleWorker.ts)
- 在 [electron/handlers/index.ts](file:///c:/Users/87850/Desktop/新项目/electron/handlers/index.ts) 移除 `titleHandler` 注册与 import；在 [electron/main.ts](file:///c:/Users/87850/Desktop/新项目/electron/main.ts) 移除 `setTitleMainWindow` 调用与 import
- 在 [electron/preload.ts](file:///c:/Users/87850/Desktop/新项目/electron/preload.ts) 移除 5 个 title 相关 IPC 绑定（selectTitleKeywordExcel / loadTitleKeywordData / analyzeTitle / generateTitleCandidates / enhanceTitlePool）与对应类型 import
- 在 [src/main.tsx](file:///c:/Users/87850/Desktop/新项目/src/main.tsx) 的浏览器预览 mock 中移除上述 5 个 title 相关 mock
- 在 [electron/utils/capabilities.ts](file:///c:/Users/87850/Desktop/新项目/electron/utils/capabilities.ts) 移除 `titleExcel` capability kind、`assertAuthorizedTitleExcel`、相关 authorize 分支
- 在 [electron/utils/settings.ts](file:///c:/Users/87850/Desktop/新项目/electron/utils/settings.ts) 的 `sanitizeCapabilityFields` 中移除 `titleKeywordExcelPath` 处理与 `assertAuthorizedTitleExcel` import
- 在 [electron/utils/worker.ts](file:///c:/Users/87850/Desktop/新项目/electron/utils/worker.ts) 的 `WORKER_LIMITS` 中移除 `titleWorker: 1`
- 在 [src/lib/shared.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/shared.ts) 中：
  - 从 `ToolboxTool` 联合类型移除 `"title"`
  - 从 `AppSettings` 接口移除 `titleKeywordExcelPath` / `titleAiSelectionEnabled` / `titleExtraKeywords` 三个字段
  - 删除 `DEFAULT_TITLE_KEYWORD_EXCEL_PATH` 常量
  - 从 `DEFAULT_SETTINGS` 移除上述 3 个字段的默认值
  - 从 `normalizeSettings` 移除上述 3 个字段的回退处理
  - 从 `completedTours` filter 的允许列表移除 `"title"`
  - 删除全部 `Title*` 类型与接口（`TitleKeywordSource` / `TitleGenerationStrategy` / `TitleCandidateMode` / `TitleKeywordEntry` / `TitleCategoryData` / `TitleKeywordData` / `TitleProductProfile` / `TitleGeneratePayload` / `TitleAnalyzePayload` / `TitleRuleCheck` / `TitleKeywordHit` / `SubstringHit` / `TitleRecommendation` / `TitleScoreBreakdown` / `TitleCandidate` / `TitleGenerationDiagnostics` / `TitleScoreResult` / `TitleAnalysisResult`）—— 它们仅被 title 模块使用
- 在 [src/App.tsx](file:///c:/Users/87850/Desktop/新项目/src/App.tsx) 中：
  - 删除 `TitleOptimizer` 的 lazy import 与 `<TitleOptimizer ... />` 渲染分支
  - 删除 `Tags` 图标 import（已确认仅 title 相关入口使用）
  - 从 `toolNavItems`、`bentoCards`、`settingsHubItems` 三处移除 "title" 条目
  - 从 `ViewKey` 联合类型与 `SettingsView` 的 `section` 联合类型中移除 `"title"`
  - 从 `viewTitle` / `toolEyebrow` 的对象映射中移除 `title` 键
  - 从 `openTool` 路由判断中移除 `view === "title"` 分支
  - 删除 `pickTitleExcel` 函数及其调用（含 `selectTitleKeywordExcel` 调用）
- **BREAKING**：本地已存的 `titleKeywordExcelPath` / `titleAiSelectionEnabled` / `titleExtraKeywords` 三个设置字段在升级后将被静默丢弃（`normalizeSettings` 不再回写），不影响其它设置

## Impact
- Affected specs: 无（与 `optimize-title-keyword-ordering` spec 互斥，后者随代码一并失效，按规则不删除 spec 文档）
- Affected code: 前端 `src/App.tsx`、`src/main.tsx`、`src/TitleOptimizer.tsx`（删）、`src/lib/titleOptimizer.ts`（删）、`src/lib/shared.ts`；Electron `electron/main.ts`、`electron/preload.ts`、`electron/handlers/index.ts`、`electron/handlers/title.ts`（删）、`electron/workers/titleWorker.ts`（删）、`electron/utils/capabilities.ts`、`electron/utils/settings.ts`、`electron/utils/worker.ts`
- 不受影响：返款、视频、收评、对比、设置、首页 Bento 布局（其它卡片）、API 配置、加密、日志、更新等模块
- 副产物：桌面 `市场关键词帛先生.xlsx` 与 `.tmp-title-cache/` 缓存目录可由用户自行删除，应用不再读取

## REMOVED Requirements

### Requirement: 标题词优化工具
**Reason**: 算法效果长期不达预期，用户决定废弃
**Migration**:
- 已安装旧版本的设备升级后，"标题词优化" 入口从侧边栏与设置中心消失
- `titleKeywordExcelPath` 等三个设置字段被丢弃，不影响其它设置项
- 不再做数据迁移；用户若需标题词分析请使用第三方工具

### Requirement: Title IPC 通道
**Reason**: 前端入口已移除，IPC 通道不再需要
**Migration**: 删除 `title:selectExcel` / `title:loadKeywordData` / `title:analyze` / `title:generateCandidates` / `title:enhancePool` 共 5 个 ipcMain.handle 通道

### Requirement: titleExcel 文件能力授权
**Reason**: 不再读取任何 Excel，capability kind 多余
**Migration**: 从 `CapabilityKind` 联合类型与 `authorizeSettingsCapabilities` / `sanitizeCapabilityFields` 中移除

### Requirement: titleWorker 线程池
**Reason**: 唯一调用方（title handler）已删除
**Migration**: 从 `WORKER_LIMITS` 移除 `titleWorker` 条目；worker 文件整体删除
