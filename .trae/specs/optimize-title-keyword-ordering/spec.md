# 标题词序与叠加命中优化 Spec

## Why
当前叠词实验版（`stacked-v2`）虽然已支持用户输入目标搜索词并从 Excel 读取关键词，但词序由硬编码的 `tokenOrderPriority` 与固定的 `EXAMPLE_STYLE_BLUEPRINTS` 决定，`movePreferredEndingToken` 只移动一个结尾词。**没有一步是真正基于"能命中多少个 Excel 关键词"来优化词序的**。而淘宝搜索的核心机制是子串命中：同一组词在不同顺序下，命中子串数量天差地别（如 `[夏季,薄款,裤子男款]` 拼成"夏季薄款裤子男款"能命中"夏季薄款"，但调成"薄款夏季裤子男款"就命中不了）。

同时，填充到 60 字节的 DP（`fillStackedTokens`）每个字节桶只保留 8 个状态，`safeFillScore` 只看权重和目标词重叠，不看"加入这个词能新增几个 Excel 关键词命中"。导致生成结果经常 miss 掉可以叠加命中的词。

本次优化在不改变现有数据流（Excel 读取、用户目标词输入、60 字节硬规则）的前提下，新增**词序局部搜索**与**覆盖感知填充**两个算法环节，让用户给定目标词后，系统能自动重排词序、挑选能同时命中更多 Excel 关键词的组合。

## What Changes

### 1. 新增词序局部搜索（token order local search）
- 在 `src/lib/titleOptimizer.ts` 新增 `optimizeTokenOrder(tokens, context)` 函数
- 输入：已选定的 token 列表（来自 `fitStackedDraftToExact` 的结果）
- 算法：
  - 以当前顺序为起点，计算 `scanSubstringHits` 得到的**唯一关键词命中数**作为评估值
  - 邻域：相邻交换 + 单 token 移动到任意位置
  - 爬山搜索（hill climbing），最多 200 次迭代，保留命中数最高的顺序（并列时取总命中值更高者）
  - 硬规则保护：重排后仍需通过 `validateStackedHardRules`，否则回退
- 接入点：`toStackedCandidate` 在计算 `keywordHits`/`substringHits` 之前调用
- **不改 token 集合，只改顺序**，所以字节、硬规则都不受影响

### 2. 覆盖感知填充（coverage-aware filling）
- 修改 `fillStackedTokens` 的 DP 状态评分：除了 `safeFillScore`（权重），新增"该 token 加入后新增的唯一子串命中数"作为加分项
- 新增 `countNewSubstringHits(currentBody, addition, keywordIndex)` 辅助函数
- DP 桶容量从 8 提升到 16，给覆盖更优的组合留位置
- `safeFillScore` 增加覆盖加分：`+ newHits * 30`（newHits 为新增命中数）

### 3. 目标词锚定 Excel 桥接词（target-bridge boosting）
- 在 `buildStackedTermPool` 中，对每个用户目标词，查找 Excel 中"包含该目标词作为子串"或"被该目标词包含"的关键词，标记为 `bridge` 来源
- 这些 bridge 词在 `safeFillScore` 中获得额外加分（`+ 40`），因为它们能让用户目标词与 Excel 关键词同时命中
- 复用现有 `targetsOverlapKeyword` 逻辑，不新增数据结构

### 4. 诊断信息增强（diagnostics）
- `TitleGenerationDiagnostics` 新增 `orderOptimizationGain`（重排前后命中数差值）与 `maxSubstringHits`（最优顺序的命中数）字段（可选）
- 在候选 `suggestions` 中追加一条："词序已优化：命中子串从 X 提升到 Y"

## Impact
- 受影响代码：[src/lib/titleOptimizer.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/titleOptimizer.ts)（主修改，新增 `optimizeTokenOrder`/`countNewSubstringHits`，修改 `fillStackedTokens`/`safeFillScore`/`buildStackedTermPool`/`toStackedCandidate`）、[src/lib/shared.ts](file:///c:/Users/87850/Desktop/新项目/src/lib/shared.ts)（`TitleGenerationDiagnostics` 增加两个可选字段）
- 不影响：Excel 解析逻辑（`electron/handlers/title.ts`、`electron/workers/titleWorker.ts`）、IPC 层、UI 组件结构、`legacy` 策略
- 不影响：现有 60 字节硬规则、品牌前缀规则、季节/材质冲突规则
- **BREAKING**：无。所有改动为算法增强，输入输出接口不变，仅 `TitleGenerationDiagnostics` 增加可选字段

## ADDED Requirements

### Requirement: Token Order Local Search
系统 SHALL 在叠词实验版候选生成时，对每个已选定的 token 集合执行局部搜索重排，使标题作为字符串时命中的 Excel 关键词子串数量最大化。

#### Scenario: 重排能增加命中
- **WHEN** 拟定 token 顺序为 [薄款, 夏季, 裤子男款] 且 Excel 中存在关键词"夏季薄款"
- **THEN** 系统将其重排为 [夏季, 薄款, 裤子男款]，使"夏季薄款"作为子串被命中
- **AND** 候选的 `substringHits` 数量相比重排前增加

#### Scenario: 重排无法增加命中
- **WHEN** 任何相邻交换或移动都不能增加命中数
- **THEN** 系统保留原顺序，不改变候选标题

#### Scenario: 硬规则保护
- **WHEN** 重排后的顺序导致结尾词不再是类目词（如"裤子"不在末尾但硬规则要求结尾为类目）
- **THEN** 系统回退到重排前顺序，保证 `validateStackedHardRules` 通过

### Requirement: Coverage-Aware Fill Selection
系统 SHALL 在填充剩余字节时，优先选择能新增唯一 Excel 关键词子串命中的 token，而非仅按权重排序。

#### Scenario: 两个候选 token 字节相同
- **WHEN** 剩余 4 字节，候选 A（权重 80，新增 0 个命中）与候选 B（权重 70，新增 3 个命中）
- **THEN** 系统优先选择候选 B，因为覆盖得分（70 + 3×30 = 160）高于 A（80 + 0 = 80）

#### Scenario: 覆盖不优于权重时保留原行为
- **WHEN** 候选 A 权重远高于 B 且 B 的覆盖增益不足以弥补
- **THEN** 系统仍选 A，避免为覆盖牺牲过多权重

### Requirement: Target-Bridge Keyword Boosting
系统 SHALL 对与用户目标词存在子串重叠的 Excel 关键词给予额外加分，使其更可能被选入最终标题。

#### Scenario: 目标词与 Excel 关键词重叠
- **WHEN** 用户目标词为"天丝莱赛尔"且 Excel 中存在"天丝莱赛尔男士裤子"
- **THEN** "天丝莱赛尔男士裤子"被标记为 bridge 词并获得加分
- **AND** 该词被选入标题时，用户目标词与 Excel 关键词同时命中

## MODIFIED Requirements

### Requirement: Stacked Title Generation
现有 `generateStackedTitleScore` 流程修改为：
1. 构建 term pool（不变）
2. 构建 drafts（不变）
3. `fitStackedDraftToExact` 填充到 60 字节（DP 改为覆盖感知，桶容量 8 → 16）
4. **新增**：对填充结果调用 `optimizeTokenOrder` 执行局部搜索重排
5. `toStackedCandidate` 评分与构建候选（使用重排后的 token 顺序）

### Requirement: Title Generation Diagnostics
`TitleGenerationDiagnostics` 增加两个可选字段：
- `orderOptimizationGain?: number` — 重排前后唯一子串命中数的差值
- `maxSubstringHits?: number` — 重排后的最优命中数

## REMOVED Requirements
无移除项。
