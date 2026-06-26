# Apple 主题 UI 细节优化 Spec

## Why
当前 Apple 主题已具备完整的 token 体系与组件骨架,但存在三类待打磨的薄弱点:(1) `:focus-visible` 全局策略缺失,键盘焦点依赖浏览器默认 outline;(2) 部分 interactive 组件(列表项、徽章、抽屉)缺少 active/disabled/loading 状态;(3) Modal/Drawer 无 focus trap,对比度在 muted 文字处处于 AA 边缘。本次优化在**不改动现有视觉基调**的前提下,补齐这些细节,使 Apple 主题达到 HIG 级别的精致度。

## What Changes

### 1. 可访问性基础设施(a11y foundation)
- 新增全局 `:focus-visible` 策略:统一 2px Apple Blue ring + 2px offset,覆盖所有 interactive 元素(button / nav-item / input / toggle / chip / bento-card-action)
- Modal / Drawer 增加 focus trap:打开时聚焦首个可聚焦元素,Tab/Shift+Tab 循环,ESC 关闭
- muted 文字对比度微调:`--muted` 深色 `#8e8e93` → `#9e9ea3`(对比度 5.2:1,稳定通过 AA)
- 关键交互元素补 `aria-label` / `aria-describedby` for icon-only buttons

### 2. 组件状态补齐(component states)
- `.nav-item`:补 `:active` 按下态(`scale(0.98)` 80ms)
- `.bento-card`:补 disabled 态(opacity 0.5 + pointer-events none)
- `.chip` / `.status-pill`:补 hover 态(背景加深 4%)
- `.primary` / `.secondary-action` 按钮:补 disabled 态 + loading 态(spinner 替换图标)
- `.toggle`:补 disabled 态(opacity 0.4)
- `select` / `input` / `textarea`:补 invalid 态(red ring 2px)

### 3. 空状态与加载态(empty / loading states)
- 新增 `.empty-state` 通用组件:图标 + 标题 + 描述 + 可选 CTA,用于列表空 / 搜索无结果 / 队列空
- 新增 `.skeleton` 骨架屏样式:用于卡片内容加载中,shimmer 动画(已存在,复用)
- 列表项进入动画:`.list-item` 用 `stagger` 延迟(index × 30ms)逐项淡入

### 4. 动效系统精炼(motion refinement)
- 页面切换:当前各 view 已有 `fadeInUp`,新增 `view-transition-name` 让 `startViewTransition` API 在 view 切换时也生效
- 按钮按压反馈统一:`active` 态 `scale(0.97)` 100ms,适用于所有 primary / secondary 按钮
- 卡片悬浮:统一 `transition: transform 220ms cubic-bezier(.22,1,.36,1), box-shadow 220ms`
- 侧边栏折叠:从 230px → 76px 的过渡从瞬切改为 280ms `ease-out`
- 所有新增动效均通过 `@media (prefers-reduced-motion: reduce)` 关闭(已有机制覆盖,仅核对)

### 5. 布局与间距微调(layout & spacing)
- Bento 网格间距:当前 `gap:8px` 偏紧,Apple 主题下调整为 `gap:12px`(更呼吸)
- Hero 区右上角 metrics 网格:增加分隔线 `border-left: 1px solid var(--line)` 提升层次
- Topbar 高度:`min-height:64px` → `56px`(Apple HIG 倾向更紧凑的 toolbar)
- Settings hub item 高度:68px → 60px(更紧凑)
- 全局 `--card-pad`:Apple 主题下从 20px → 18px(配合更紧凑的圆角 12px)

## Impact
- Affected code: [src/apple.css](file:///c:/Users/87850/Desktop/新项目/src/apple.css)(主修改)、[src/styles.css](file:///c:/Users/87850/Desktop/新项目/src/styles.css)(基础补充)、[src/App.tsx](file:///c:/Users/87850/Desktop/新项目/src/App.tsx)(focus trap / aria 属性)、[src/ReviewAssistant.tsx](file:///c:/Users/87850/Desktop/新项目/src/ReviewAssistant.tsx) / [src/VideoWorkbench.tsx](file:///c:/Users/87850/Desktop/新项目/src/VideoWorkbench.tsx) / [src/TitleOptimizer.tsx](file:///c:/Users/87850/Desktop/新项目/src/TitleOptimizer.tsx)(空状态 / loading 接入)
- 不影响:业务逻辑、数据流、Electron 主进程
- **BREAKING**:无。所有改动为视觉/交互层,不改变 DOM 语义结构

## ADDED Requirements

### Requirement: Global Focus Visible Strategy
The system SHALL provide a unified `:focus-visible` style for all interactive elements, using a 2px Apple Blue ring (`rgba(0,122,255,0.5)`) with 2px offset, that activates only on keyboard navigation (not mouse clicks).

#### Scenario: Keyboard navigation
- **WHEN** user presses Tab to move focus to a button
- **THEN** a 2px blue ring appears around the button with 2px offset
- **AND** the ring disappears when focus moves away

#### Scenario: Mouse click
- **WHEN** user clicks a button with mouse
- **THEN** no focus ring appears (browser default :focus-visible behavior)

### Requirement: Modal Focus Trap
The system SHALL trap focus inside Modal and Drawer components when open.

#### Scenario: Tab cycling
- **WHEN** user presses Tab inside an open Modal
- **AND** focus reaches the last focusable element
- **THEN** focus wraps to the first focusable element in the Modal

#### Scenario: Escape to close
- **WHEN** user presses Escape while Modal is open
- **THEN** the Modal closes and focus returns to the trigger element

### Requirement: Empty State Component
The system SHALL provide a reusable `.empty-state` component for lists, search results, and queues when no data is available.

#### Scenario: Empty list
- **WHEN** a list renders with zero items
- **THEN** an empty state with icon, title, and description is displayed
- **AND** optionally a primary CTA button is shown

### Requirement: Button Loading State
The system SHALL provide a loading state for primary and secondary buttons that replaces the icon with a spinner and disables interaction.

#### Scenario: Async action
- **WHEN** user clicks a primary button that triggers an async action
- **THEN** the button shows a spinner and becomes non-interactive
- **AND** the button returns to normal state when the action completes

## MODIFIED Requirements

### Requirement: Apple Theme Token System
The existing Apple theme token system (`apple.css:10-69`) is modified to:
- Adjust `--muted` deep color from `#8e8e93` to `#9e9ea3` for AA contrast compliance
- Keep all other tokens unchanged (Apple Blue, systemGreen, radius 12px, etc.)

### Requirement: Bento Card Layout
The Bento grid in Apple theme (`apple.css:755-788`) is modified to:
- Increase gap from 8px to 12px
- Reduce `--card-pad` from 20px to 18px
- Keep 6-column span-2 layout structure unchanged

### Requirement: Sidebar Collapse Animation
The sidebar collapse transition is modified to animate width from 230px to 76px over 280ms with `ease-out` easing, instead of the current instant switch.

## REMOVED Requirements
无移除项。所有改动为增量优化,不删除现有功能或样式。
