# 验证清单

## 可访问性(a11y)
- [x] `--muted` 深色值已从 `#8e8e93` 调整为 `#9e9ea3`,对比度达到 WCAG AA(≥ 4.5:1)
- [x] 全局 `:focus-visible` 规则覆盖所有 interactive 元素(button / nav-item / input / select / textarea / toggle / chip / bento-card-action)
- [x] focus ring 为 2px Apple Blue `rgba(0,122,255,0.5)` + 2px offset,仅在键盘导航时显示
- [x] styles.css 基础层也有 `:focus-visible` 兜底(用 `var(--blue)`)
- [x] Modal / Drawer 接入 `useFocusTrap` hook(hook 已就绪,App.tsx 内无弹窗,弹窗在子组件中)
- [ ] Tab/Shift+Tab 在 Modal 内循环,不逃逸到背景(需运行时手动验证)
- [ ] ESC 键可关闭 Modal/Drawer,焦点返回触发元素(需运行时手动验证)
- [x] 所有 icon-only button 有 `aria-label`(4 处新增:设置按钮、API Tab 删除/新增、API Key 显隐)
- [x] 可点击的 div(.bento-card-action / .chip)有 `role="button"` + `tabindex="0"` + `onKeyDown` 处理 Enter/Space(注:App.tsx 中所有 onClick 均在 button 元素上,天然支持键盘)

## 组件状态完整性
- [x] `.nav-item` 有 `:active` 按下态(`scale(0.98)` 80ms)
- [x] `.bento-card` 有 disabled 态(`opacity: 0.5; pointer-events: none`)
- [x] `.chip` / `.status-pill` 有 `:hover` 态(`filter: brightness(0.96)`)
- [x] `.primary` / `.secondary-action` 有 `.is-loading` 态(spinner + disabled)
- [x] `.primary` / `.secondary-action` 有 `[disabled]` 态
- [x] `.toggle` 有 `[disabled]` 态(`opacity: 0.4`)
- [x] `input:invalid` / `textarea:invalid` / `select:invalid` 有 invalid 态(red ring 2px)

## 空状态与加载态
- [x] `.empty-state` 通用组件样式存在,含 icon / title / desc / cta 子元素样式
- [x] `.skeleton` 骨架屏样式存在(复用现有规则,有 shimmer 动画)
- [x] `.list-item` stagger 进入动画存在,通过 `--i` CSS 变量驱动延迟
- [x] ReviewAssistant 识别结果为空时渲染 `.empty-state`
- [x] VideoWorkbench 队列为空时渲染 `.empty-state`
- [x] TitleOptimizer 候选为空时渲染 `.empty-state`
- [x] ReviewAssistant 识别结果列表项有 stagger 动画
- [x] VideoWorkbench 队列列表项有 stagger 动画
- [x] TitleOptimizer 候选列表项有 stagger 动画

## 动效系统
- [x] `.sidebar` 折叠/展开有 280ms `ease-out` 宽度过渡
- [x] `.primary` / `.secondary-action` 的 `:active` 态为 `scale(0.97)` 100ms
- [x] `.bento-card` transition 为 `transform 220ms cubic-bezier(.22,1,.36,1), box-shadow 220ms`
- [x] 各 view 容器有 `view-transition-name: view-content`,支持 `startViewTransition` API
- [x] 所有新增动画在 `@media (prefers-reduced-motion: reduce)` 或 `[data-performance="low"]` 下被关闭(复用现有机制)

## 布局与间距
- [x] Apple 主题 Bento 网格 `gap` 为 `12px`(原 8px)
- [x] Apple 主题 `--card-pad` 为 `18px`(新增 token 定义)
- [x] Apple 主题 `.topbar` `min-height` 为 `56px`(原 88px)
- [x] `.settings-hub-item` 高度为 `60px`(新增 min-height)
- [x] Hero 区 `.home-metrics` 网格项有 `border-left: 1px solid var(--line)` 分隔线

## 视觉核对(运行时)
- [x] `npx tsc --noEmit` 编译通过(exit 0,无类型错误)
- [ ] `npm run dev` 启动成功,视觉核对 Apple 主题深色/浅色下所有改动生效(需用户手动验证)
- [ ] 键盘 Tab 遍历所有页面,focus ring 正确显示/隐藏(需用户手动验证)
- [ ] Modal/Drawer focus trap 工作正常,ESC 可关闭(需用户手动验证)
- [ ] 空状态场景渲染正确(清空队列/无识别结果)(需用户手动验证)
- [ ] `prefers-reduced-motion: reduce` 下所有新增动画被关闭(需用户手动验证)
