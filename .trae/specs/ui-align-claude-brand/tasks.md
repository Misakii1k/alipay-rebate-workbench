# Tasks

- [x] Task 1: 更新 Google Fonts @import 与字体 token 声明
  - [x] SubTask 1.1: 修改 `claude.css:6` 的 `@import`,移除 `Newsreader`,新增 `Lora`(保留 `Poppins`、`Geist Mono`)
  - [x] SubTask 1.2: 修改 `claude.css:14-17` 的 `--font-*` 变量:`--font-display` → Poppins,`--font-body` → Lora(`--font-numeric`、`--font-micro` 保持 Poppins)

- [x] Task 2: 对齐深色模式核心色值 token
  - [x] SubTask 2.1: 修改 `claude.css:20-24` 深色 token:`--ink` → `#faf9f5`,`--muted` → `#b0aea5`,`--panel` → `rgba(31, 31, 29, 0.88)`,`--line` → `rgba(176, 174, 165, 0.18)`,`--line-hover` → `rgba(176, 174, 165, 0.28)`
  - [x] SubTask 2.2: 修正深色 `--blue`: `#b05730` → `#6a9bcc`;`--blue-dim`: `rgba(176, 87, 48, 0.15)` → `rgba(106, 155, 204, 0.15)`
  - [x] SubTask 2.3: 在深色块新增 `--light-gray: #2a2a28;`(规范 Light Gray 的深色适配)与 `--accent-green: #788c5d;`
  - [x] SubTask 2.4: 修改深色 `background: #262624` → `#1a1a18`(第 45 行)

- [x] Task 3: 对齐浅色模式核心色值 token
  - [x] SubTask 3.1: 修改 `claude.css:54-58` 浅色 token:`--ink` → `#141413`,`--muted` → `#6b6a63`(Mid Gray 加深适配 AA)
  - [x] SubTask 3.2: 修正浅色 `--blue`: `#b05730` → `#6a9bcc`;`--blue-dim`: `rgba(176, 87, 48, 0.12)` → `rgba(106, 155, 204, 0.12)`
  - [x] SubTask 3.3: 在浅色块新增 `--light-gray: #e8e6dc;`(规范值原样)与 `--accent-green: #788c5d;`

- [x] Task 4: 同步 body 背景与面板背景色
  - [x] SubTask 4.1: 修改 `claude.css:81` 深色 body 背景基底 `#262624` → `#1a1a18`
  - [x] SubTask 4.2: 核对浅色 body 背景 `#faf9f5` 保持不变(已正确)

- [x] Task 5: 调整 Bento 图标三色循环
  - [x] SubTask 5.1: 修改 `.bento-review .bento-icon`(约 814-818 行):color `#8ca06f` → `#788c5d`,背景与边框的 rgba 同步跟随 `rgba(120, 140, 93, ...)`
  - [x] SubTask 5.2: 修改 `.bento-compare .bento-icon`(约 820-824 行):color `#e0a892` → `#6a9bcc`,背景与边框 rgba 同步跟随 `rgba(106, 155, 204, ...)`
  - [x] SubTask 5.3: 同步浅色模式下 `.bento-review` 与 `.bento-compare` 图标色(约 853-861 行)使用规范 Green / Blue

- [x] Task 6: 核对 `--blue` 相关派生样式一致性
  - [x] SubTask 6.1: 全文搜索 `claude.css` 中所有 `176, 87, 48` 与 `#b05730` 出现处,确认是否需要同步更新为规范蓝 `106, 155, 204` / `#6a9bcc`(主要影响 `--blue-dim` 已在 Task 2/3 处理,核对是否有遗漏)
  - [x] SubTask 6.2: 核对 `.bento-icon` 默认色 `var(--blue)`(约 803 行)现在会渲染为规范蓝,确认视觉协调

# Task Dependencies
- Task 2、Task 3 可并行(分别处理深/浅色 token 块)
- Task 4 依赖 Task 2(背景色值已定义)
- Task 5 独立,可与 Task 2/3 并行
- Task 6 依赖 Task 2/3/5 完成后做一致性核对
