# UI 主题重构：迁移至 Claude 设计系统

## 概述

将电商运营工具箱的 UI 从当前 Apple 玻璃拟态风格重构为 Claude 温暖编辑式风格。通过创建新主题文件 `claude.css`，映射 Claude 设计 Token 到应用现有的 CSS 变量体系，实现视觉风格的全面切换。

## 现状分析

- 主题通过 `html[data-ui-design="X"]` CSS 属性选择器实现多主题切换
- 当前激活主题：`apple.css`（`main.tsx` 第 7 行导入，第 10 行设置属性）
- 备选主题：`atelier.css`（未导入，可作为结构参考）
- 基础样式：`styles.css`（235KB，含默认暗色 Token 和所有组件的通用样式）
- 应用使用的核心变量：`--ink`, `--muted`, `--panel`, `--line`, `--green`, `--gold`, `--red`, `--blue`, `--radius`, `--shadow`, `--glass-blur`

## Token 映射方案

| 应用变量 | 用途 | Apple 暗色值 | Claude 暗色值 | Claude 亮色值 |
|---------|------|-------------|--------------|--------------|
| `--ink` | 主文字 | `#f5f5f7` | `#f1f1ef` | `#3d3929` |
| `--muted` | 次要文字 | `#9e9ea3` | `#b7b5a9` | `#6e6d68` |
| `--panel` | 面板背景 | `rgba(28,28,30,0.72)` | `rgba(44,44,43,0.88)` | `rgba(245,244,239,0.90)` |
| `--line` | 边框 | `rgba(255,255,255,0.08)` | `rgba(62,62,56,0.50)` | `rgba(218,217,212,0.60)` |
| `--line-hover` | 悬停边框 | `rgba(255,255,255,0.14)` | `rgba(74,74,67,0.60)` | `rgba(205,202,191,0.70)` |
| `--green` | 主强调色 | `#30d158` | `#d97757` | `#c96442` |
| `--green-dim` | 强调色淡化 | `rgba(48,209,88,0.12)` | `rgba(217,119,87,0.15)` | `rgba(201,100,66,0.12)` |
| `--gold` | 次强调色 | `#ff9f0a` | `#e0a892` | `#e0a892` |
| `--gold-dim` | 次强调色淡化 | `rgba(255,159,10,0.12)` | `rgba(224,168,146,0.15)` | `rgba(224,168,146,0.12)` |
| `--red` | 错误色 | `#ff453a` | `#ef4444` | `#d64545` |
| `--blue` | 信息色 | `#0a84ff` | `#b05730` | `#b05730` |
| `--radius` | 圆角 | `12px` | `16px` | `16px` |
| `--radius-sm` | 小圆角 | `8px` | `12px` | `12px` |
| `--glass-blur` | 毛玻璃 | `blur(40px) saturate(1.8)` | `none` | `none` |

字体映射：`--font-body` → Poppins, `--font-display` → Newsreader

## 变更计划

### 1. CREATE `src/claude.css` (~2200 行)

以 `apple.css` 的区块结构为骨架，以 `atelier.css` 为风格参考（更接近编辑式美学），逐块重写。

**关键区块与变更要点：**

- **字体导入** — 顶部 `@import` Google Fonts（Poppins + Newsreader + Geist Mono）
- **根变量** — 映射 Claude Token 到应用变量体系
- **亮色主题** — 使用 Claude `:root` Token（亮色默认）
- **背景** — 暗色 `#262624`，亮色 `#faf9f5`，微妙暖色径向渐变
- **主题过渡** — 保持 Apple 的 `.theme-smooth-transition` 方案
- **容器/面板** — **移除所有 `backdrop-filter`**，改用实色/微透明背景 + 纸张式阴影
- **窗口标题栏** — 使用 Claude sidebar Token
- **侧边栏** — active 态使用 terra-cotta（通过 `--green` 变量映射）
- **导航项** — active 态 `--green`（terra-cotta），hover 为温暖米色
- **顶部栏** — eyebrow 用 `--brand-500` 色调
- **首页 Hero** — 移除蓝紫色渐变，使用温暖的 brand 色径向渐变
- **Bento 卡片** — 移除 backdrop-filter，纸张阴影，hover 温和提升
- **按钮** — 主按钮使用 terra-cotta 实色，hover 微提升
- **聊天气泡** — 助手气泡温暖米色卡片，用户气泡 terra-cotta 品牌色
- **Toggle** — 开启态使用 terra-cotta
- **表格** — 表头使用 brand 暖色调
- **进度条** — 渐变改为 brand 色系
- **模态框** — 实色背景 + 安静阴影
- **滚动条** — 暖色调滚动条
- **响应式** — 保持与 Apple 相同的断点逻辑

**特殊处理 — 成功/活跃语义的绿色保留：**
- `.status-pill.connected` 等语义性"成功"指示器 → 显式覆盖为 Claude `--success-500`（`#8ca06f` 暗 / `#788c5d` 亮）
- 进度条、分数环等语义性"完成/成功"元素 → 同上

### 2. MODIFY `src/main.tsx`

- 第 7 行：`import "./apple.css"` → `import "./claude.css"`
- 第 10 行：`"apple"` → `"claude"`

### 3. MODIFY `index.html`

- 第 18 行 font-family：改为 `Poppins, "Noto Sans SC Variable", ui-sans-serif, system-ui, sans-serif`
- 第 19 行 background：改为 `#262624`
- 添加 `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`

## 设计决策

- **毛玻璃移除**：Claude 风格的核心区别是"纸张质感"而非"玻璃质感"，所有 `backdrop-filter` 移除
- **主强调色映射**：应用中 `--green` 是最核心的交互色，在 Claude 主题中映射为 terra-cotta 品牌色 `#d97757`，变量名不变但视觉为暖橙色
- **侧边栏亮色行为**：跟随亮色模式（方案 A），使用 Claude sidebar Token `#f5f4ee`
- **不修改的文件**：`styles.css`、`apple.css`、`atelier.css`、所有 `.tsx` 组件文件

## 验证步骤

1. 运行 `npm run web` 启动浏览器预览
2. 逐页面检查：首页 Hero 渐变、Bento 卡片、侧边栏 active 态、主按钮颜色、输入框聚焦、聊天气泡、Toggle、模态框、表格、进度条
3. 切换亮色模式验证所有对应样式
4. 测试侧边栏折叠/展开状态
5. 检查响应式布局（1100px / 720px 断点）
