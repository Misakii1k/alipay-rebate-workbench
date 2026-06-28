# 验证清单

## 类型与接口
- [x] `TitleGenerationDiagnostics` 新增 `orderOptimizationGain?: number` 与 `maxSubstringHits?: number` 两个可选字段
- [x] `StackedTermOption` 新增 `bridge?: boolean` 可选字段
- [x] `safeFillScore` 签名变更后所有调用点已同步更新

## 词序局部搜索
- [x] `optimizeTokenOrder` 函数已实现，输入 token 列表，返回 `{ tokens, beforeHits, afterHits }`
- [x] 局部搜索使用相邻交换 + 单 token 移动作为邻域
- [x] 最大迭代次数限制为 200，避免性能问题
- [x] 每次产生新顺序均调用 `validateStackedHardRules` 校验，失败时回退
- [x] 并列命中数时取总命中值（`hits.reduce((sum, h) => sum + h.value, 0)`）更高者
- [x] `toStackedCandidate` 中已接入 `optimizeTokenOrder`，重排在计算 body 之前

## 覆盖感知填充
- [x] `countNewSubstringHits` 函数已实现，正确计算新增唯一子串命中数
- [x] `fillStackedTokens` 中 `additions` 列表已用 `countNewSubstringHits` 计算覆盖
- [x] `safeFillScore` 已增加 `newHits * 30` 覆盖加分
- [x] DP 桶容量已从 8 提升到 16
- [x] `scoreStackedTokenList` 与新的 `safeFillScore` 评分一致

## 目标词桥接
- [x] `buildStackedTermPool` 中对与 target 子串重叠的 entry 标记 `bridge: true`
- [x] `safeFillScore` 中 `option.bridge === true` 时额外 `+ 40`
- [x] bridge 标记复用 `targetsOverlapKeyword`，不新增重叠判断逻辑

## 诊断与提示
- [x] `context.diagnostics.orderOptimizationGain` 正确累加各 draft 的 `afterHits - beforeHits`
- [x] `context.diagnostics.maxSubstringHits` 取所有 draft 中的最大值
- [x] 候选 `suggestions` 在 `afterHits > beforeHits` 时追加"词序已优化：命中子串从 X 提升到 Y"
- [x] `afterHits === beforeHits` 时不追加提示

## 硬规则与兼容性
- [x] 重排后所有候选仍通过 `validateStackedHardRules`（60 字节、帛先生前缀、无重复核心词、无冲突季节/材质）
- [x] `legacy` 策略路径不经过 `optimizeTokenOrder`，行为不变
- [x] Excel 解析、IPC、UI 组件结构均未改动
- [x] `npx tsc --noEmit` 编译通过
- [x] `npx tsc --noEmit -p tsconfig.electron.json` 编译通过

## 运行时验证
- [ ] 输入目标词"天丝莱赛尔 男士裤子 夏薄款"，生成候选，至少 1 个候选的 `suggestions` 出现"词序已优化"（需用户手动验证）
- [ ] 对比重构前后，同一商品名+目标词下，候选的 `substringHits.length` 有提升（需用户手动验证）
- [ ] 候选标题仍为 60 字节，以"帛先生"开头（需用户手动验证）
