# 电商运营工具箱 — Codex 交接材料

## 项目一句话描述

Electron + React (TypeScript) Windows 桌面应用，电商运营中控台，包含 5 个独立工具模块。

---

## 一、近 9 个版本改动总览

### v0.10.4（当前版本）
- 视频路径校验回归修复：只检查文件名非法字符，不再误杀 `C:\...` 这类 Windows 正常路径
- 标题词优化对比页推荐分数修复：新版 `stacked-v2` 候选按 0-100 直接展示
- 支付宝识别流程修复：本地/模型识别先写入并继续录入，云端校验后台按原行回写，取消后忽略迟到结果
- 识别学习反馈接入：采纳云端、保留本地、手动保存都会在开关开启时总结可复用规则
- 全应用按钮 tooltip 补齐，版本号与安装包目标统一到 `0.10.4`

### v0.10.3
- 视频智能选择新增「极速模式」开关，设置页和剪辑页都能切换，开启后跳过缩略图加速扫描
- 全应用按钮增加悬浮提示（`title` 属性），悬停看功能说明

### v0.10.2
- 返现文件导出修复：路径清洗 + 错误 try-catch，不再静默失败
- 视频剪辑敏感词误判修复：`()` `{}` `[]` 不再被误判为"不安全字符"
- 视频智能选择性能优化：缩略图从评分阶段移到排序截取之后生成
- 支付宝返款云端 AI 二次校验功能恢复（重构时被误删）

### v0.10.1
- 剪切板自动识别恢复、收评缩略图 S/M/L 三档大小、AI 生成参考选中图片
- 视频切片功能暂时关闭（按钮灰显）、回到顶部按钮修复
- 预览/导出重复行检测（同名同账号黄色高亮）、录入页自动读取剪切板快捷开关
- 识别过程可取消、底部快捷栏优化、设置页面板宽度优化
- 安全加固：API Key 加密存储、HTTPS 强制、CSP 沙箱

### v0.9.5
- 收评助手索引增量更新（不再全量扫描）、文件夹展开功能
- 左侧菜单栏视觉优化、收评三种工作模式（混合/搜索/AI评价）
- 评分开关、目标字数滑块、思考模式控制、API Key 小眼睛

### v0.9.4
- 收评模式选择封面、云端校正恢复、滑块优化
- M 等级弹窗浅色主题适配、视频双标题清理

### v0.9.3
- 电商运营工具箱全模块升级

### v0.6.2
- 浅色模式对比度修复、剪切板自动识别

### v0.5.9
- 四项问题修复（UI 重设计前版本）

---

## 二、项目结构速查

```
alipay-rebate-workbench/
├── CLAUDE.md              ← 项目指南（必读）
├── package.json            ← 依赖 + 构建脚本 + version
├── tsconfig.json           ← 前端 TS 配置 (ESNext)
├── tsconfig.electron.json  ← Electron TS 配置 (CommonJS)
├── vite.config.ts
├── index.html
│
├── electron/               ← Electron 主进程
│   ├── main.ts             ← 入口（窗口创建、启动流程）
│   ├── preload.ts          ← contextBridge API 暴露
│   ├── handlers/           ← 18 个 IPC 处理模块
│   │   ├── index.ts        ← 统一注册入口
│   │   ├── ai.ts           ← 大模型连接测试
│   │   ├── clipboard.ts    ← 剪切板读写
│   │   ├── export.ts       ← Excel 导出
│   │   ├── ffmpeg.ts       ← FFmpeg 诊断/修复
│   │   ├── files.ts        ← 文件/目录选择对话框
│   │   ├── recognition.ts  ← AI 识别 + 云端校验
│   │   ├── review.ts       ← 收评助手（搜索/缩略图/生成/对话）
│   │   ├── title.ts        ← 标题分析/候选生成
│   │   ├── video.ts        ← 视频库扫描 + FFmpeg 渲染
│   │   └── ...             ← settings, workbench, window, update, log, everything, media
│   └── utils/              ← 工具函数
│       ├── security.ts     ← 路径验证、API URL 校验、输入消毒
│       ├── ffmpeg.ts       ← FFmpeg 路径解析
│       ├── everything.ts   ← Everything 搜索集成
│       ├── walk.ts         ← 递归目录遍历
│       ├── media.ts        ← 图片缩略图/尺寸探测
│       ├── logger.ts       ← 日志写入
│       └── ...
│
├── src/                    ← React 前端
│   ├── main.tsx            ← 入口 + 浏览器预览 mock
│   ├── App.tsx             ← 主组件（~1250 行）：路由、状态、设置、返款流程
│   ├── VideoWorkbench.tsx  ← 视频批量剪辑
│   ├── ReviewAssistant.tsx ← 收评助手
│   ├── TitleOptimizer.tsx  ← 标题词优化
│   ├── CompareWorkbench.tsx← 评价返款对比
│   ├── styles.css          ← 单文件 CSS（~3500 行）
│   └── lib/                ← 共享库（前端 + Electron 共用）
│       ├── shared.ts       ← ⚠️ 核心：所有类型、默认值、工具函数
│       ├── recognition.ts  ← 规则识别 + AI Prompt
│       ├── parsing.ts      ← 金额/备注解析
│       ├── compare.ts      ← 评价对比匹配
│       ├── titleOptimizer.ts← 标题评分算法
│       └── video.ts        ← 视频任务/模板
│
├── assets/                 ← 静态资源（extraResources 打包）
│   ├── alipay-template.xlsx← 支付宝导出模板
│   └── music/              ← CC0 背景音乐
├── bin/                    ← 外部二进制（extraResources 打包）
│   ├── ffmpeg.exe
│   └── es.exe              ← Everything 命令行工具
├── build/                  ← electron-builder 图标/安装器素材
└── dist/                   ← 构建输出（安装程序在此）
```

---

## 三、5 个功能模块速览

| 模块 | 文件 | 核心功能 | 依赖 |
|------|------|---------|------|
| 支付宝返款 | App.tsx (import/entry/preview/export views) | 粘贴金额备注 → 识别账号姓名 → 预览校验 → 导出 Excel | ExcelJS, AI API |
| 视频剪辑 | VideoWorkbench.tsx + electron/handlers/video.ts | 模板化短视频制作，智能匹配素材库，批量 FFmpeg 渲染 | FFmpeg, Everything |
| 收评助手 | ReviewAssistant.tsx + electron/handlers/review.ts | 搜索本地图片 + AI 生成好评文案 + AI 对话 | Everything, AI API |
| 标题优化 | TitleOptimizer.tsx + electron/handlers/title.ts | 分析标题搜索权重评分，AI 生成优化候选 | Excel, AI API |
| 评价对比 | CompareWorkbench.tsx | 导入评价名单 vs 返款名单，自动去重匹配，差异标红 | 纯前端计算 |

---

## 四、关键约定（给 Codex）

### 新增功能必做 checklist
1. `shared.ts` 加类型/字段 + 默认值 + normalize 条目
2. Electron handler 加 IPC 通道（`namespace:action` 命名）
3. `preload.ts` 暴露 API
4. `src/main.tsx` 加浏览器 mock 降级
5. `electron/handlers/index.ts` 注册新 handler

### 版本发布必做
1. `package.json` version 升级
2. `App.tsx` APP_VERSION 同步
3. `App.tsx` CHANGELOG_ITEMS 加更新说明（大白话，非技术术语）

### shared.ts 注意
- 被 `tsconfig.json`(ESNext) 和 `tsconfig.electron.json`(CommonJS) 同时编译
- 不能用 top-level await 等纯 ESM 特性

### 样式注意
- 浅色主题主色调是陶土橙（`--green: #9b4d2f`），不是绿色
- 浅色模式下避免硬编码绿色值，用 `var(--green)` / `var(--green-dim)`

### 状态管理注意
- App.tsx 大量闭包函数，useEffect 中引用可能过期
- 关键状态已用 ref 同步（`currentIndexRef`），新增类似模式需注意

### 外部二进制
- `bin/ffmpeg.exe` 和 `assets/alipay-template.xlsx` 通过 extraResources 打包
- 代码中使用 `path.join(process.resourcesPath, "bin", "ffmpeg.exe")` 等路径
- 不要删除这些文件

---

## 五、当前已知状态

### 正常运作
- 全部 5 个模块功能正常
- 深色/浅色主题切换正常
- 云端 AI 校验已恢复，并改为后台校验后按原行安全回写
- 识别学习反馈可在设置里开关、查看和清空学习规则
- 视频极速模式可用

### 暂时关闭
- 视频切片模板 (`video-slice`) 按钮灰显，标注"暂不可用"

### 已验证的修复
- 导出不再静默失败
- 文件路径含括号/中文不再误报敏感词，Windows 盘符路径不再误判为非法文件名
- 视频库大型扫描性能已优化
- 标题对比页推荐分数不再被错误缩小

---

## 六、常用命令

```bash
npm run dev          # 启动 Electron 开发环境
npm run web          # 仅启动前端（浏览器预览 http://127.0.0.1:4181）
npm run build        # 完整 TypeScript 编译 + Vite 构建
npm run dist         # 编译 + 打包 NSIS 安装程序
npx tsc -p tsconfig.json --noEmit        # 前端类型检查
npx tsc -p tsconfig.electron.json --noEmit # Electron 类型检查
```

没有测试套件，验证方式是 `npm run web` 浏览器手动测试。

---

## 七、AI API 集成说明

- 使用 OpenAI 兼容的 Chat Completions API
- 支持多 Profile 配置（OpenAI / Anthropic），可配置多个 API Key 做故障切换
- 文本模型：用于支付宝识别、云端校验、收评文案生成、标题候选、学习反馈
- `temperature: 0`，`response_format: json_object`
- 重试策略：408/409/425/429/5xx 自动重试，指数退避
- 并发限制：`modelConcurrency` 设置控制
