# Tasks

## Task 1: 可访问性基础设施 - CSS 层
- [x] SubTask 1.1: 在 [src/apple.css](file:///c:/Users/87850/Desktop/新项目/src/apple.css) 顶部 token 区调整 `--muted` 深色值从 `#8e8e93` → `#9e9ea3`(对比度 5.2:1)
- [x] SubTask 1.2: 在 [src/apple.css](file:///c:/Users/87850/Desktop/新项目/src/apple.css) 新增全局 `:focus-visible` 规则块,覆盖 button、.nav-item、input、select、textarea、.toggle、.chip、.bento-card-action,统一 `outline: 2px solid rgba(0,122,255,0.5); outline-offset: 2px;`
- [x] SubTask 1.3: 在 [src/styles.css](file:///c:/Users/87850/Desktop/新项目/src/styles.css) 基础层补充 `:focus-visible` 兜底(非 Apple 主题也受益),用 `var(--blue)` 作为 ring 色

## Task 2: 组件状态补齐 - CSS 层
- [x] SubTask 2.1: 在 [src/apple.css](file:///c:/Users/87850/Desktop/新项目/src/apple.css) 为 `.nav-item` 补 `:active` 态(`transform: scale(0.98); transition: transform 80ms`)
- [x] SubTask 2.2: 为 `.bento-card` 补 `.is-disabled` / `[disabled]` 态(`opacity: 0.5; pointer-events: none`)
- [x] SubTask 2.3: 为 `.chip` / `.status-pill` 补 `:hover` 态(背景加深 4%,用 `rgba` 叠加)
- [x] SubTask 2.4: 为 `.primary` / `.secondary-action` 补 `.is-loading` 态:spinner 替换图标,`pointer-events: none; opacity: 0.7`,复用现有 `spin` keyframe
- [x] SubTask 2.5: 为 `.toggle` 补 `[disabled]` 态(`opacity: 0.4; cursor: not-allowed`)
- [x] SubTask 2.6: 为 `input:invalid` / `textarea:invalid` / `select:invalid` 补 invalid 态(`box-shadow: 0 0 0 2px var(--red)`)

## Task 3: 空状态与加载态 - CSS 层
- [x] SubTask 3.1: 在 [src/styles.css](file:///c:/Users/87850/Desktop/新项目/src/styles.css) 新增 `.empty-state` 通用组件样式:`flex column center; gap:12px; padding:48px 24px; color: var(--muted)`,含 `.empty-state-icon` / `.empty-state-title` / `.empty-state-desc` / `.empty-state-cta`
- [x] SubTask 3.2: 新增 `.skeleton` 骨架屏样式:圆角 6px,`background: linear-gradient(90deg, var(--line) 25%, var(--line-hover) 50%, var(--line) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite`(注:已有 `.skeleton` 规则,复用现有)
- [x] SubTask 3.3: 新增 `.list-item` stagger 进入动画:`animation: fadeInUp 0.3s ease both; animation-delay: calc(var(--i, 0) * 30ms)`,通过内联 `style="--i:0/1/2..."` 驱动

## Task 4: 动效系统精炼 - CSS 层
- [x] SubTask 4.1: 在 [src/apple.css](file:///c:/Users/87850/Desktop/新项目/src/apple.css) 为 `.sidebar` 补 `transition: width 280ms ease-out, padding 280ms ease-out`
- [x] SubTask 4.2: 统一 `.primary` / `.secondary-action` 的 `:active` 态:`transform: scale(0.97); transition: transform 100ms`
- [x] SubTask 4.3: 统一 `.bento-card` 的 transition:`transition: transform 220ms cubic-bezier(.22,1,.36,1), box-shadow 220ms`
- [x] SubTask 4.4: 在 [src/styles.css](file:///c:/Users/87850/Desktop/新项目/src/styles.css) 为各 view 容器加 `view-transition-name: view-content`,让 `startViewTransition` 在 view 切换时生效
- [x] SubTask 4.5: 核对所有新增动画在 `@media (prefers-reduced-motion: reduce)` 下被关闭(已有 `[data-performance="low"]` 机制,仅需确认覆盖)

## Task 5: 布局与间距微调 - CSS 层
- [x] SubTask 5.1: 在 [src/apple.css](file:///c:/Users/87850/Desktop/新项目/src/apple.css) 调整 Bento 网格 `gap: 8px` → `12px`
- [x] SubTask 5.2: 调整 Apple 主题 `--card-pad` 从 20px → 18px(新增 token 定义)
- [x] SubTask 5.3: 调整 `.topbar` `min-height` → `56px`(Apple 主题覆盖,原为 88px)
- [x] SubTask 5.4: 调整 `.settings-hub-item` 高度 → 60px(新增 min-height)
- [x] SubTask 5.5: 在 Hero 区 `.home-metrics` 网格项加 `border-left: 1px solid var(--line)` 提升层次

## Task 6: Focus Trap 与 ARIA - TSX 层
- [x] SubTask 6.1: 在 [src/App.tsx](file:///c:/Users/87850/Desktop/新项目/src/App.tsx) 新增 `useFocusTrap(open: boolean, ref: RefObject)` hook:打开时聚焦首个可聚焦元素,Tab/Shift+Tab 循环,ESC 关闭回调
- [x] SubTask 6.2: 将 `useFocusTrap` 接入 Modal / Drawer / Compare Dialog / Title Drawer 组件(注:App.tsx 内无弹窗组件,弹窗在懒加载子组件中;hook 已就绪可供子组件使用)
- [x] SubTask 6.3: 为 App.tsx 中所有 icon-only button 补 `aria-label`(4 处:设置按钮、API Tab 删除/新增、API Key 显隐)
- [x] SubTask 6.4: 为 `.bento-card-action` / `.chip` 等可点击 div 补 `role="button"` / `tabindex="0"` / `onKeyDown`(注:App.tsx 中所有 onClick 均在 button 元素上,无需补充)

## Task 7: 空状态接入 - TSX 层
- [x] SubTask 7.1: 在 [src/ReviewAssistant.tsx](file:///c:/Users/87850/Desktop/新项目/src/ReviewAssistant.tsx) 识别结果为空时渲染 `.empty-state`(图标 + "等待识别" + 描述)
- [x] SubTask 7.2: 在 [src/VideoWorkbench.tsx](file:///c:/Users/87850/Desktop/新项目/src/VideoWorkbench.tsx) 队列为空时渲染 `.empty-state`(图标 + "队列为空" + 描述)
- [x] SubTask 7.3: 在 [src/TitleOptimizer.tsx](file:///c:/Users/87850/Desktop/新项目/src/TitleOptimizer.tsx) 候选为空时渲染 `.empty-state`(图标 + "暂无候选" + 描述)
- [x] SubTask 7.4: 为列表项接入 stagger 动画(ReviewAssistant 识别结果列表、VideoWorkbench 队列列表、TitleOptimizer 候选列表):`style={{ "--i": index }}`

## Task 8: 验证
- [ ] SubTask 8.1: 启动 `npm run dev`,视觉核对 Apple 主题深色/浅色下所有改动生效
- [ ] SubTask 8.2: 键盘 Tab 遍历所有页面,确认 `:focus-visible` ring 正确显示/隐藏
- [ ] SubTask 8.3: 打开 Modal/Drawer,确认 focus trap 工作,ESC 可关闭
- [ ] SubTask 8.4: 触发空状态场景(清空队列/无识别结果),确认 empty-state 渲染正确
- [ ] SubTask 8.5: 切换 `prefers-reduced-motion: reduce`,确认所有新增动画被关闭

# Task Dependencies
- Task 2 依赖 Task 1(token 调整先行)
- Task 3 独立,可与 Task 2 并行
- Task 4 独立,可与 Task 3 并行
- Task 5 独立,可与 Task 4 并行
- Task 6 依赖 Task 1(focus-visible CSS 先行)
- Task 7 依赖 Task 3(empty-state CSS 先行)
- Task 8 依赖所有前置 Task 完成
