# 走马灯提示位置修正：从右侧移到左侧"当前用户"框内

## Summary

用户反馈：最新版识别成功的"走马灯"提示（实为 `recognition-inline-notice` 淡入提示条，内部状态变量名为 `showMarquee`）位置不对——当前显示在页面右侧的"识别结果" Panel 内，应移到左侧"当前用户"大框（`hero-panel`）范围内。

本次改动仅调整一处 JSX 的渲染位置，不涉及 CSS/逻辑变更，风险极低。

## Current State Analysis

布局结构（[src/App.tsx#L886-L927](file:///c:/Users/87850/Desktop/新项目/src/App.tsx#L886-L927)）：

```
section.entry-layout  (CSS Grid: 左 1.18fr "当前用户" | 右 0.82fr "识别结果")
├── Panel "当前用户" (hero-panel)        ← 左列（目标位置）
│   └── currentRow ? <>
│       ├── div.current-card            ← 当前用户主卡片（深色渐变大框）
│       ├── div.manual-recognize
│       └── Toggle
│   : EmptyState
└── Panel "识别结果"                      ← 右列（当前提示所在位置）
    ├── div.recognition-inline-notice    ← 【走马灯提示，需移走】L910-L917
    ├── div.form-stack
    ├── div.result-box
    └── CloudReviewCard
```

提示条 JSX（[src/App.tsx#L910-L917](file:///c:/Users/87850/Desktop/新项目/src/App.tsx#L910-L917)）：

```tsx
{lastResult && showMarquee && (
  <div className="recognition-inline-notice" key={`notice-${recognitionPulse}`}>
    <Check className="notice-icon" size={13} />
    <span className="notice-text">
      识别成功：{manualName || lastResult.name} / {manualAccount || lastResult.account}
    </span>
  </div>
)}
```

提示条样式（[src/styles.css#L2639-L2673](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2639-L2673)）：
- `display: flex` + `margin-bottom: 8px`，纯文档流，**无 `position/left/right` 定位**。
- 动画 `noticeFadeIn`（垂直淡入），3 秒后由 `marqueeTimerRef` 自动隐藏（[App.tsx#L541-L542](file:///c:/Users/87850/Desktop/新项目/src/App.tsx#L541-L542)）。

关键结论：因提示条无定位属性，仅靠文档流渲染，**只需移动 JSX 块即可改变其位置，无需修改任何 CSS**。

## Proposed Changes

### 文件：`src/App.tsx`（唯一改动文件）

**操作**：将提示条 JSX 块从"识别结果" Panel 内移除，移到"当前用户" Panel（hero-panel）内、`current-card` 之前，作为 `<>` 片段的第一个元素。

**改动 1 — 从右侧 Panel 删除**（[L910-L917](file:///c:/Users/87850/Desktop/新项目/src/App.tsx#L910-L917)）：

删除"识别结果" Panel 中 `<div className="form-stack">` 之前的整个 `{lastResult && showMarquee && (...)}` 块。

**改动 2 — 插入到左侧 hero-panel 内**（[L890-L891](file:///c:/Users/87850/Desktop/新项目/src/App.tsx#L890-L891) 之间）：

在 `{currentRow ? (<>` 之后、`<div className="current-card">` 之前插入同一块：

```tsx
{currentRow ? (
  <>
    {lastResult && showMarquee && (
      <div className="recognition-inline-notice" key={`notice-${recognitionPulse}`}>
        <Check className="notice-icon" size={13} />
        <span className="notice-text">
          识别成功：{manualName || lastResult.name} / {manualAccount || lastResult.account}
        </span>
      </div>
    )}
    <div className="current-card">
      ...
```

**为何放在 `currentRow` 真值分支内、`current-card` 之前：**
1. 提示仅在识别成功时触发，而识别成功必然存在 `currentRow`，放入真值分支语义正确，不会出现在 `EmptyState` 之上。
2. 位于 hero-panel 顶部、current-card 之上，是"当前用户大框"内最显眼的位置，符合"在当前用户大框范围内"的要求。
3. `margin-bottom: 8px` 会让提示条与下方 current-card 自然留出间距，视觉协调。

**不改动的内容：**
- `src/styles.css` — 无需任何改动（提示条靠文档流布局，迁移后样式自动生效；主题文件 `claude.css`/`apple.css`/`atelier.css` 中也无该类的覆盖规则）。
- `showMarquee` 状态、`marqueeTimerRef`、触发逻辑（[L540-L542](file:///c:/Users/87850/Desktop/新项目/src/App.tsx#L540-L542)）— 完全保留。
- `key={`notice-${recognitionPulse}`}` — 保留，确保每次识别成功重新触发淡入动画。

## Assumptions & Decisions

1. **"走马灯"指 `recognition-inline-notice`**：代码库中状态变量名为 `showMarquee`，触发时显示"识别成功：…"提示条，与用户描述一致；代码库中不存在横向滚动动画，此为命名习惯。
2. **"当前用户这个大框"指 hero-panel（左列 Panel）**：即标题为"当前用户"的整个左侧 Panel，而非内部更小的 current-card 深色卡片。提示条放在 hero-panel 内、current-card 之上，既在"大框范围内"又最显眼。
3. **垂直位置选择顶部**：作为 hero-panel 内容的第一项，识别成功时提示从左侧大框顶部淡入，符合用户对"位置应在左侧"的预期。如用户希望放在 current-card 内部底部或其他位置，可后续微调。

## Verification

1. 启动开发预览（`npm run dev` 或现有预览端口），进入 `view === "entry"` 页面。
2. 导入金额/备注数据，使 `currentRow` 存在。
3. 在"识别文本"框粘贴含支付宝账号+姓名的内容，点击"重新识别"。
4. 确认识别成功后：
   - ✅ 绿色淡入提示条"识别成功：XXX / XXX"出现在**左侧"当前用户"框顶部**（current-card 上方）。
   - ✅ 提示条 3 秒后自动消失。
   - ✅ 右侧"识别结果" Panel 顶部不再出现该提示条。
5. 反复识别不同行，确认每次都重新触发淡入动画（`key` 绑定 `recognitionPulse` 生效）。
6. 切换浅色主题，确认提示条在浅色下样式正常（浅色适配规则 [styles.css#L2676-L2679](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2676-L2679) 仍生效）。
7. 窄屏（响应式单列堆叠，[styles.css#L3943](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L3943)）下确认提示条仍在"当前用户"框内、显示正常。
