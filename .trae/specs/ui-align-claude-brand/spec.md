# Claude 主题对齐 Anthropic 官方品牌规范 Spec

## Why
当前 [src/claude.css](file:///c:/Users/87850/Desktop/新项目/src/claude.css) 已是一套"Claude 风格"主题,但与 Anthropic 官方品牌规范(brand-guidelines)存在系统性偏差:`--blue` 误用棕色 `#b05730`(规范为 `#6a9bcc`)、标题字体误用 Newsreader(规范为 Poppins)、正文字体误用 Poppins(规范为 Lora)、核心色值 `--ink`/`--muted`/深色背景与规范取值不一致,且缺少规范定义的 Light Gray `#e8e6dc` 与 Green `#788c5d` 两个 token。本次优化在不破坏现有交互与布局的前提下,将 token 体系与字体系统对齐到官方规范,使 Claude 主题名实相符。

## What Changes

### 1. 字体系统对齐(Typography Alignment)
- `--font-display`: `Newsreader, Georgia, ui-serif, serif` → `Poppins, "Noto Sans SC Variable", ui-sans-serif, system-ui, sans-serif`(规范标题字体)
- `--font-body`: `Poppins, ...` → `Lora, Georgia, "Noto Serif SC", ui-serif, serif`(规范正文字体)
- `--font-numeric`: 保持 `Poppins`(数字仍用 Poppins,与规范标题字体一致,保证数字可读性)
- `--font-micro`: 保持 `Poppins`(micro 标签需无衬线,符合规范)
- Google Fonts `@import`:移除 `Newsreader`,新增 `Lora`(保留 `Poppins` 与 `Geist Mono`)

### 2. 核心色值对齐(Core Color Token Alignment)
深色模式(`html[data-ui-design="claude"]`):
- `--ink`: `#f1f1ef` → `#faf9f5`(规范 Light)
- `--muted`: `#b7b5a9` → `#b0aea5`(规范 Mid Gray)
- 背景色: `#262624` → `#1a1a18`(规范 Dark `#141413` 的应用适配,略提亮以保证 Electron 窗口可视性,接近规范)
- `--panel`: `rgba(44, 44, 43, 0.88)` → `rgba(31, 31, 29, 0.88)`(跟随背景调深)
- `--line`: `rgba(62, 62, 56, 0.50)` → `rgba(176, 174, 165, 0.18)`(基于规范 Mid Gray 派生)
- 新增 `--light-gray: #e8e6dc`(规范 Light Gray,用于 subtle 背景)

浅色模式(`[data-theme="light"]`):
- `--ink`: `#3d3929` → `#141413`(规范 Dark,作为浅色背景上的正文色)
- `--muted`: `#6e6d68` → `#b0aea5` 经适配 → `#6b6a63`(规范 Mid Gray 在浅色背景上需加深以保证 AA 对比度,文档化为可访问性适配)
- 新增 `--light-gray: #e8e6dc`(规范 Light Gray)
- 浅色背景保持 `#faf9f5`(规范 Light,已正确)

### 3. 强调色修正(Accent Color Correction)
- **`--blue` 修正**(关键 bug):深色 `#b05730`(棕色) → `#6a9bcc`(规范 Blue);浅色 `#b05730` → `#6a9bcc`
- `--blue-dim`: `rgba(176, 87, 48, 0.15)` → `rgba(106, 155, 204, 0.15)`(跟随规范蓝)
- 新增 `--accent-green: #788c5d`(规范 Green,第三强调色),用于需要三色循环的场景
- `--green`(语义主强调色,实际为规范 Orange `#d97757`):深色保持 `#d97757` ✓(已正确);浅色 `#c96442` 保留作为**文本场景的可访问性适配**(规范 `#d97757` 在 `#faf9f5` 上对比度仅 2.3:1,不满足 AA),但在**非文本大色块**(按钮背景、进度条)上改用规范 `#d97757`
- `--gold: #e0a892` 保留作为 orange 的浅色衍生(用于次要装饰),不纳入规范 token 但不删除

### 4. 非文本元素三色循环(Accent Cycling for Non-text Shapes)
按规范"Non-text shapes use accent colors, cycles through orange, blue, and green":
- `.bento-video` 图标:orange `#d97757` ✓(已正确)
- `.bento-review` 图标:当前 `#8ca06f` → `#788c5d`(规范 Green)
- `.bento-compare` 图标:当前 `#e0a892` → `#6a9bcc`(规范 Blue,实现三色循环)
- `.bento-title` 图标:保持 `#8a5740`(orange 暗衍生)或调整为规范 orange 浅色
- Bento icon hover 统一使用对应规范强调色

### 5. body 背景渐变对齐
- 深色 body radial-gradient 的 orange glow 保持,基底从 `#262624` → `#1a1a18`
- 浅色 body 保持 `#faf9f5` ✓(已正确)

## Impact
- Affected code: [src/claude.css](file:///c:/Users/87850/Desktop/新项目/src/claude.css)(唯一修改文件,纯 CSS token 与字体声明调整)
- 不影响:业务逻辑、DOM 结构、Electron 主进程、其他主题(apple/atelier)、交互行为
- **BREAKING**:无。所有改动为 CSS 变量值与 font-family 声明,不改变类名、DOM 或 API
- 可访问性:浅色模式正文色 `--ink` 改为 `#141413`(对比度从 ~12:1 提升至 ~19:1),`--muted` 调整后保持 AA 通过

## ADDED Requirements

### Requirement: Brand Light Gray Token
The system SHALL provide a `--light-gray` CSS variable equal to `#e8e6dc` (Anthropic brand Light Gray) in both dark and light themes, available for subtle background surfaces.

#### Scenario: Subtle background usage
- **WHEN** a component needs a subtle background tint
- **THEN** `var(--light-gray)` resolves to `#e8e6dc` (light mode) or an adapted dark variant (dark mode)

### Requirement: Brand Green Accent Token
The system SHALL provide an `--accent-green` CSS variable equal to `#788c5d` (Anthropic brand Green) as the tertiary accent color, distinct from the semantic `--green` (which maps to brand Orange).

#### Scenario: Tertiary accent application
- **WHEN** a non-text shape requires the third brand accent color
- **THEN** `var(--accent-green)` resolves to `#788c5d`

## MODIFIED Requirements

### Requirement: Claude Theme Typography
The Claude theme font system (`claude.css:14-17`) is modified to:
- `--font-display`: Poppins (was Newsreader) — aligns with brand heading font
- `--font-body`: Lora (was Poppins) — aligns with brand body font
- `--font-numeric`: Poppins (unchanged)
- `--font-micro`: Poppins (unchanged)
- Google Fonts import includes Lora, excludes Newsreader

### Requirement: Claude Theme Color Tokens
The Claude theme color tokens (`claude.css:19-34` dark, `52-66` light) are modified to:
- Dark: `--ink: #faf9f5`, `--muted: #b0aea5`, background `#1a1a18`, `--blue: #6a9bcc`
- Light: `--ink: #141413`, `--muted: #6b6a63`, `--blue: #6a9bcc`
- Both: add `--light-gray: #e8e6dc`, add `--accent-green: #788c5d`
- `--green` (brand Orange): dark `#d97757` unchanged; light stays `#c96442` for text AA, `#d97757` for non-text via new utility

### Requirement: Bento Icon Accent Cycling
The Bento card icon colors (`claude.css:808-830`) are modified to cycle through the three brand accents:
- `.bento-video`: orange `#d97757` (unchanged)
- `.bento-review`: green `#788c5d` (was `#8ca06f`)
- `.bento-compare`: blue `#6a9bcc` (was `#e0a892`)
- `.bento-title`: orange-dark `#8a5740` (unchanged)

## REMOVED Requirements
无移除项。所有改动为 token 值修正与字体声明调整,不删除现有类或功能。
