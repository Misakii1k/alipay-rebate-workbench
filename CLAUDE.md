# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

电商运营工具箱 — Electron + React (TypeScript) Windows 桌面应用，包含 5 个独立工具模块：支付宝返款、视频批量剪辑、收评助手、标题词优化、评价返款对比。

## 常用命令

```bash
npm run dev          # 启动 Electron 开发环境（Vite + Electron 并行）
npm run web          # 仅启动 Vite 前端（http://127.0.0.1:4181），用于浏览器预览调试
npm run build        # TypeScript 编译 + Vite 生产构建 + Electron TS 编译
npm run dist         # build + electron-builder 打包 NSIS 安装程序（Windows x64）
npx tsc -p tsconfig.json --noEmit   # 前端类型检查
npx tsc -p tsconfig.electron.json   # Electron 主进程类型检查
```

没有测试套件。验证方式是 `npm run web` 后在浏览器中手动测试。

## 架构

### 双进程结构

```
electron/main.ts      → Electron 主进程（1567行）：IPC handlers、文件系统、FFmpeg、Excel 导出、剪切板
electron/preload.ts   → contextBridge 桥接，暴露 window.alipayWorkbench API
src/main.tsx          → React 入口，含浏览器预览时的 API mock（localStorage 降级）
src/App.tsx           → 主组件（~950行），管理所有视图路由和全局状态
```

### 视图路由

App.tsx 通过 `view` 状态变量切换视图，没有使用路由库：
- `home` — 工具首页（bento card 网格）
- `import` / `entry` / `preview` / `export` — 支付宝返款四步流程
- `video` → `VideoWorkbench.tsx` — FFmpeg 视频批量剪辑
- `review` → `ReviewAssistant.tsx` — 收评助手（图片搜索 + AI 文案生成）
- `title` → `TitleOptimizer.tsx` — 标题关键词优化（Excel 数据驱动）
- `compare` → `CompareWorkbench.tsx` — 评价返款对比
- `settings` — 设置页（内嵌在 App.tsx 的 SettingsView 组件）

### 共享库 (src/lib/)

- `shared.ts` — **核心共享模块**，被前端和 Electron 主进程同时引用（见 tsconfig.electron.json 的 include）。包含所有类型定义（AppSettings、RebateRow、VideoCandidate 等）、默认值、工具函数。
- `recognition.ts` — 支付宝账号/姓名识别（规则引擎 + 大模型 API 调用）
- `parsing.ts` — 金额/备注文本解析、导出校验
- `compare.ts` — 评价对比名单解析与匹配
- `titleOptimizer.ts` — 标题评分算法（纯前端计算，不调用 AI）
- `video.ts` — 视频模板定义

### IPC 通信

preload.ts 通过 `contextBridge.exposeInMainWorld("alipayWorkbench", api)` 暴露 API。所有 IPC 通道使用 `namespace:action` 命名（如 `settings:load`、`video:renderTask`、`review:scanAssets`）。

### 样式

单文件 `src/styles.css`（~3400 行），使用 CSS 自定义属性实现深/浅主题切换。浅色模式通过 `[data-theme="light"]` 选择器覆盖变量和组件样式。主题切换使用 View Transition API 实现水滴扩散动画（`::view-transition-old/new(root)` + `clip-path: circle()` 动画）。毛玻璃风格（backdrop-filter + 半透明背景）。无 CSS 框架。

浅色主题色调：暖米白纸感底色 + 陶土橙强调色（`--green: #9b4d2f`、`--gold: #b8793a`），不是绿色。修改浅色模式时不要使用绿色系硬编码值（如 `#059669`、`rgba(4,120,87,...)`），应使用 `var(--green)` / `var(--green-dim)` 或对应的棕色系值。

### 构建产物

- `dist-renderer/` — Vite 前端构建输出
- `dist-electron/` — Electron TypeScript 编译输出
- `dist/` — electron-builder 最终打包产物（NSIS 安装程序）

## 关键约定

### 版本同步（三处必须一致）

每次修改后需要同步升版本号：
1. `package.json` 的 `version` 字段
2. `App.tsx` 的 `APP_VERSION` 常量
3. `CHANGELOG_ITEMS` 数组中添加本次更新说明（用普通人能看懂的大白话，不用技术术语）

### shared.ts 双编译约束

`shared.ts` 被两个 tsconfig 同时编译：
- `tsconfig.json`（前端）：`module: "ESNext"`
- `tsconfig.electron.json`（Electron）：`module: "CommonJS"`

修改时需确保同时兼容两种模块系统。不能使用仅 ESM 的特性（如 top-level await）。

### React 状态管理注意事项

App.tsx 中大量使用闭包函数（如 `applyRecognition`、`advanceEntry`）。在 `useEffect` 的定时器/轮询回调中引用这些函数时，由于 effect 依赖数组不包含所有闭包变量，**会产生过期闭包问题**。关键状态（如 `currentIndex`）已通过 `currentIndexRef` ref 同步解决。新增类似模式时需注意此问题。

### 浏览器预览降级

`src/main.tsx` 在检测不到 `window.alipayWorkbench` 时提供完整的 localStorage 降级 mock，所有 Electron IPC API 都有对应的浏览器端实现。新增 IPC 通道时必须同步在 mock 中添加存根。

### 外部依赖

- Electron 主进程使用 `assets/` 目录存放模板文件（如 alipay-template.xlsx），通过 extraResources 打包
- FFmpeg 二进制放在 `bin/` 目录，同样通过 extraResources 分发
- 大模型调用（recognition.ts、ReviewAssistant）通过 OpenAI 兼容的 Chat Completions API，配置在 AppSettings 的 apiProfiles 中
- 收评助手文件搜索可选用 Everything (voidtools) 的 `es.exe` 加速
