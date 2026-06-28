# Tasks

## Task 1: 扩展诊断类型定义
- [x] SubTask 1.1: 在 [src/lib/shared.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/shared.ts) 的 `TitleGenerationDiagnostics` 接口新增两个可选字段：`orderOptimizationGain?: number` 与 `maxSubstringHits?: number`

## Task 2: 实现子串命中计数辅助函数
- [x] SubTask 2.1: 在 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts) 新增 `countNewSubstringHits(currentBody: string, addition: string, keywordIndex: Map<string, TitleKeywordEntry>): number`，计算把 `addition` 拼到 `currentBody` 后新增的唯一 Excel 关键词子串命中数
- [x] SubTask 2.2: 复用现有 `normalizeTitleText` 与 `keywordIndex`，不新建索引

## Task 3: 实现词序局部搜索
- [x] SubTask 3.1: 在 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts) 新增 `optimizeTokenOrder(tokens: string[], product: TitleProductProfile, context: GenerationContext, targetText: string): { tokens: string[]; beforeHits: number; afterHits: number }`
- [x] SubTask 3.2: 算法实现：以 `tokens` 为起点，用 `scanSubstringHits(TITLE_PREFIX + tokens.join(""), context.keywordIndex)` 计算唯一命中数；邻域为相邻交换 + 单 token 移动到任意位置；爬山搜索最多 200 次迭代；并列时取总命中值（`hits.reduce(sum + h.value)`）更高者
- [x] SubTask 3.3: 硬规则保护：每次产生新顺序后调用 `validateStackedHardRules(TITLE_PREFIX + newBody, newTokens, product, false, targetText)`，若返回非空则回退该次移动
- [x] SubTask 3.4: 返回重排后的 tokens 与前/后命中数

## Task 4: 覆盖感知填充
- [x] SubTask 4.1: 修改 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts) 的 `safeFillScore` 函数签名，增加 `newHits: number` 参数，返回值增加 `newHits * 30` 覆盖加分
- [x] SubTask 4.2: 修改 `fillStackedTokens`，在构建 `additions` 列表时对每个候选用 `countNewSubstringHits` 计算覆盖数，传入 `safeFillScore`
- [x] SubTask 4.3: 将 `fillStackedTokens` 中 DP 桶容量 `bucket.slice(0, 8)` 改为 `bucket.slice(0, 16)`
- [x] SubTask 4.4: 同步修改 `scoreStackedTokenList`，使其也考虑覆盖加分（或在 `fillStackedTokens` 内统一用新的 safeFillScore）

## Task 5: 目标词桥接加分
- [x] SubTask 5.1: 修改 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts) 的 `buildStackedTermPool`，在遍历 `context.scoreEntries` 时，对每个 entry 判断是否与任意 target 存在子串重叠（复用 `targetsOverlapKeyword`），若是则在该 option 上标记 `bridge: true`
- [x] SubTask 5.2: 在 `StackedTermOption` 接口新增 `bridge?: boolean` 字段
- [x] SubTask 5.3: 修改 `safeFillScore`，当 `option.bridge === true` 时额外 `+ 40`

## Task 6: 接入局部搜索到候选生成
- [x] SubTask 6.1: 修改 [src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts) 的 `toStackedCandidate`，在计算 `body = draft.tokens.map(t => t.text).join("")` 之前，先调用 `optimizeTokenOrder` 对 `tokens`（字符串数组）重排
- [x] SubTask 6.2: 将 `optimizeTokenOrder` 返回的 `beforeHits`/`afterHits` 写入 `context.diagnostics.orderOptimizationGain`（累加，因为有多个 draft）与 `context.diagnostics.maxSubstringHits`（取最大）
- [x] SubTask 6.3: 在候选的 `suggestions` 数组追加一条：当 `afterHits > beforeHits` 时追加 `词序已优化：命中子串从 ${beforeHits} 提升到 ${afterHits}`，否则不追加

## Task 7: 验证
- [x] SubTask 7.1: `npx tsc --noEmit` 编译通过（含 electron 的 tsconfig.electron.json）
- [ ] SubTask 7.2: 在 TitleOptimizer UI 中输入目标词（如"天丝莱赛尔 男士裤子 夏薄款"），点击"生成实验版候选"，确认候选的 `suggestions` 中出现"词序已优化"提示，且 `substringHits` 数量相比改动前提升
- [x] SubTask 7.3: 确认所有候选仍通过硬规则（60 字节、帛先生前缀、无重复核心词、无冲突季节）
- [x] SubTask 7.4: 确认 `legacy` 策略不受影响（legacy 路径不经过 `optimizeTokenOrder`）

# Task Dependencies
- Task 1 独立，最先完成（类型先行）
- Task 2 依赖 Task 1（诊断字段，虽然 countNewSubstringHits 不直接用，但同批次）
- Task 3 依赖 Task 2（局部搜索复用 scanSubstringHits，countNewSubstringHits 是参考）
- Task 4 依赖 Task 2（fillStackedTokens 调用 countNewSubstringHits）
- Task 5 独立，可与 Task 3/4 并行
- Task 6 依赖 Task 3 + Task 5（局部搜索与 bridge 标记就绪后接入）
- Task 7 依赖所有前置 Task 完成
