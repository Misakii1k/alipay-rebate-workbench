# 识别成功提示条改为从左侧滑入

## Summary

用户反馈：不想要当前"垂直淡入弹出"的提示效果，希望每识别成功时提示条从左侧滑进来。

当前动画 `noticeFadeIn` 是 `translateY(-4px) → translateY(0)`（垂直方向小幅淡入，像从上方弹出）。改为 `translateX(-20px) → translateX(0)`（水平方向从左侧滑入），更符合"从左侧滑进来"的预期。

仅改动 `src/styles.css` 一处文件，2 处编辑（keyframes 定义 + animation 引用），不涉及 JSX/逻辑。

## Current State Analysis

提示条样式位于 [src/styles.css#L2639-L2717](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2639-L2717)：

**当前动画定义（[L2670-L2673](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2670-L2673)）：**
```css
@keyframes noticeFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
```
→ 垂直方向 -4px 淡入，幅度小，呈现"轻微上跳弹出"感。

**当前引用（[L2651](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2651)）：**
```css
animation: noticeFadeIn 300ms ease both;
```

**引用全局排查结果（Grep `noticeFadeIn`）：**
- 仅 2 处出现：L2651（引用）+ L2670（定义）
- 主题文件 `claude.css`/`apple.css`/`atelier.css` 均无覆盖
- 无障碍/低性能降级（[L2695-L2698](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2695-L2698)、[L2715-L2717](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2715-L2717)）用 `animation: none` 禁用，不引用 keyframes 名字，改名不受影响。

→ 改名 + 改内容安全，无连带副作用。

## Proposed Changes

### 文件：`src/styles.css`（唯一改动文件）

**改动 1 — 重写 keyframes 定义（[L2670-L2673](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2670-L2673)）：**

将垂直淡入改为水平从左滑入，并改名 `noticeFadeIn` → `noticeSlideIn`（语义更准确）：

```css
@keyframes noticeSlideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}
```

- `translateX(-20px)`：从左侧 20px 处滑入，幅度明显但不夸张，适合提示条这种小尺寸元素（高 28px）。
- `opacity 0 → 1`：保留淡入，避免突兀。

**改动 2 — 更新 animation 引用（[L2651](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2651)）：**

```css
animation: noticeSlideIn 300ms ease-out both;
```

- 名字同步为 `noticeSlideIn`。
- 缓动 `ease` → `ease-out`：滑入结尾减速，更自然（滑入动画的标准选择）。
- 时长保持 `300ms`。
- `both` 保留：保证动画起始帧立即应用（避免首帧闪烁）。

**不改动的内容：**
- [L2695-L2698](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2695-L2698) `prefers-reduced-motion`：用 `animation: none` + `opacity: 1`，禁用后直接显示，无需改。
- [L2715-L2717](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2715-L2717) `[data-performance="low"]`：用 `animation: none`，禁用后元素走默认 opacity（1），无需改。
- [L2676-L2679](file:///c:/Users/87850/Desktop/新项目/src/styles.css#L2676-L2679) 浅色主题适配：只改背景/边框色，与动画无关，无需改。
- `src/App.tsx`：JSX 与触发逻辑（`key={`notice-${recognitionPulse}`}`、`showMarquee` 状态、3 秒定时器）完全保留——`key` 变化会重新挂载元素从而重放新动画，逻辑天然兼容。

## Assumptions & Decisions

1. **"从左侧滑进来"指水平方向 translateX 滑入**：与当前垂直 translateY 弹出对应。用户在前一轮已把提示条移到左侧 hero-panel 内，从该框左侧滑入符合视觉直觉。
2. **滑入距离 -20px**：提示条高度 28px、位于 hero-panel 内 current-card 上方，20px 滑入距离足够明显又不过度。若用户觉得不够明显可后续调大到 -28px 或 -32px。
3. **保留淡入 opacity**：纯 translateX 无 opacity 变化会显得生硬，保留 0→1 让滑入更柔和。
4. **改名 noticeFadeIn → noticeSlideIn**：让 keyframes 名与实际效果一致，避免后续维护困惑。已 Grep 确认仅 2 处引用，改名安全。
5. **缓动改 ease-out**：滑入动画减速停止比线性 ease 更自然，属动画常识，非过度设计。

## Verification

1. 启动预览（`npm run dev` 或现有预览端口 http://127.0.0.1:4181/），进入返款录入页（`view === "entry"`）。
2. 导入金额/备注数据，使 `currentRow` 存在。
3. 在"识别文本"框粘贴含支付宝账号+姓名的内容，点击"重新识别"。
4. 确认识别成功后：
   - ✅ 提示条从**左侧水平滑入**到"当前用户"框顶部位置（不再是垂直弹出）。
   - ✅ 滑入过程约 300ms，结尾减速，自然停下。
   - ✅ 3 秒后提示条自动消失。
5. 反复识别不同行，确认每次都重新触发从左滑入动画（`key` 绑定 `recognitionPulse` 生效）。
6. 系统设置开启"减少动画"偏好，确认识别成功时提示条直接显示（无滑入），不卡在 opacity:0。
7. 切换到低性能模式（若有开关），确认识别成功时提示条直接显示。
8. 切换浅色主题，确认滑入效果正常。
