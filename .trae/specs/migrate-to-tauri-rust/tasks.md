# Tasks

## 阶段 0：备份与回滚准备（前置必做）

- [ ] Task 0.1: 在原项目根目录确认 git 工作树状态，提交所有未跟踪文件并 commit，确保 HEAD 干净
- [ ] Task 0.2: 创建 git 标签 `v-electron-final` 指向当前 HEAD
- [ ] Task 0.3: 创建 git 分支 `legacy/electron` 指向同一 commit
- [ ] Task 0.4: 在上级目录创建物理备份 `..\新项目-electron-backup\`（robocopy 复制全部文件，排除 node_modules / dist / dist-renderer / dist-electron / target）
- [ ] Task 0.5: 在 README 或 TRANSFER.md 顶部追加"回滚说明"小节，记录 `git checkout legacy/electron` 和物理备份位置

## 阶段 1：Tauri 项目骨架搭建

- [ ] Task 1.1: 在项目根目录创建 `tauri-app/` 目录，初始化 Tauri 2.x 项目骨架（`npm create tauri-app@latest` 或手动搭建）
  - [ ] SubTask 1.1.1: 配置 `tauri-app/package.json`，仅引入 React + Vite + TypeScript，移除所有 electron 依赖
  - [ ] SubTask 1.1.2: 配置 `tauri-app/vite.config.ts`，base 路径适配 Tauri
  - [ ] SubTask 1.1.3: 配置 `tauri-app/tsconfig.json`（继承原前端配置）
  - [ ] SubTask 1.1.4: 配置 `tauri-app/src-tauri/tauri.conf.json`，设置 `productName=电商运营工具箱`、`appId=com.rebate.workbench`、`frontendDist=../dist-renderer`
- [ ] Task 1.2: 将 `build/icon.ico` 复制到 `tauri-app/src-tauri/icons/icon.ico`
- [ ] Task 1.3: 将 `assets/` 目录复制到 `tauri-app/resources/assets/`，并在 tauri.conf.json 的 `bundle.resources` 注册
- [ ] Task 1.4: 配置 `bin/ffmpeg.exe` 和 `bin/es.exe` 作为 resources 分发（复制到 `tauri-app/resources/bin/`）
- [ ] Task 1.5: 配置 NSIS 安装器参数（语言 2052、createDesktopShortcut、allowToChangeInstallationDirectory 等，对齐原 electron-builder 配置）
- [ ] Task 1.6: 验证 `cargo tauri dev` 能启动空白应用窗口（仅验证骨架，不接业务逻辑）

## 阶段 2：前端代码迁移

- [ ] Task 2.1: 将原项目 `src/` 目录整体复制到 `tauri-app/src/`（保留所有 .tsx / .ts / .css / 字体文件）
- [ ] Task 2.2: 验证 `titleOptimizer.ts` 和 `compare.ts` 文件字节级保留（用 fc / diff 对比确认零修改）
- [ ] Task 2.3: 创建 `tauri-app/src/lib/tauri-bridge.ts`，封装统一的 invoke 调用层（命名空间映射、错误处理、超时控制）
- [ ] Task 2.4: 全局替换 `window.alipayWorkbench.XXX(args)` 调用为 `invoke('xxx', args)`，对应关系表见 spec.md MODIFIED Requirements 部分
- [ ] Task 2.5: 修改 `src/main.tsx` 的浏览器 mock 逻辑，保留作为浏览器预览 fallback；新增 Tauri 模式检测（`'__TAURI_INTERNALS__' in window`），命中时走真实 invoke
- [ ] Task 2.6: 替换 Electron 专属 API：
  - [ ] SubTask 2.6.1: 文件对话框 → `@tauri-apps/plugin-dialog` 的 `open()`
  - [ ] SubTask 2.6.2: 剪切板 → `@tauri-apps/plugin-clipboard-manager` 的 `readText()` / `writeText()`
  - [ ] SubTask 2.6.3: 窗口控制（最小化/关闭/最大化）→ `@tauri-apps/api/window` 的 `appWindow` 方法
  - [ ] SubTask 2.6.4: 自动更新 → `@tauri-apps/plugin-updater` 的 `check()`
- [ ] Task 2.7: 调整 `vite.config.ts`（Tauri 版本），移除 electron 相关 entry，确保 Vite 单纯构建 React 前端
- [ ] Task 2.8: 验证 `npm run build`（Tauri 前端）能产出 dist-renderer/，并在 `cargo tauri dev` 启动后看到首页 UI

## 阶段 3：Rust 后端模块迁移（按依赖顺序）

- [ ] Task 3.1: 搭建 Rust 项目结构：`tauri-app/src-tauri/src/` 下创建 main.rs / lib.rs 入口和 16 个模块文件
- [ ] Task 3.2: 配置 `Cargo.toml` 依赖：tauri 2.x、serde、serde_json、tokio、reqwest、rust_xlsxwriter、image、tracing、tracing-subscriber、tracing-appender、aes-gcm、windows（COM 调用用）、tauri-plugin-* 系列
- [ ] Task 3.3: 实现 `log.rs`（tracing + 文件 rotate，路径同原 logger.ts）
- [ ] Task 3.4: 实现 `settings.rs`（JSON 持久化到 app config dir，加密 API Key），原 electron/handlers/settings.ts + electron/utils/settings.ts 对齐
- [ ] Task 3.5: 实现 `security.rs`（迁移 5 道安全防线：validatePathSafety / validateMediaFilePath / validateApiUrl / sanitizeCellText / sanitizeEverythingQuery）
- [ ] Task 3.6: 实现 `paths.rs`（资源路径解析：resourcesPath / appConfigDir / ffmpeg 路径 / es.exe 路径 / 模板路径）
- [ ] Task 3.7: 实现 `ffmpeg.rs`（FFmpeg 路径解析 + 8.3 短路径转换，沿用原 getShortPath 逻辑用 windows crate 调用 Scripting.FileSystemObject COM）
- [ ] Task 3.8: 实现 `ai.rs`（OpenAI 兼容 Chat Completions：reqwest + tokio，408/409/425/429/5xx 重试 + 指数退避 + modelConcurrency 信号量）
- [ ] Task 3.9: 实现 `clipboard.rs`（包装 tauri-plugin-clipboard-manager）
- [ ] Task 3.10: 实现 `files.rs`（文件/目录选择对话框，包装 tauri-plugin-dialog）
- [ ] Task 3.11: 实现 `window.rs`（窗口控制：最小化/最大化/关闭，包装 tauri::Window）
- [ ] Task 3.12: 实现 `everything.rs`（调用 es.exe 子进程，沿用原 everythingSearch.ts 逻辑）
- [ ] Task 3.13: 实现 `media.rs`（缩略图生成 + 图片尺寸探测，用 image crate 替代 sharp）
- [ ] Task 3.14: 实现 `export.rs`（Excel 导出，rust_xlsxwriter，对齐原 export.ts 输出格式和校验逻辑）
- [ ] Task 3.15: 实现 `recognition.rs`（支付宝账号/姓名识别规则引擎 + 云端 AI 校验，对齐原 recognition.ts 行为）
- [ ] Task 3.16: 实现 `review.rs`（收评助手：搜索 + 缩略图 + AI 文案 + 对话，对齐原 review.ts）
- [ ] Task 3.17: 实现 `title.rs`（仅代理 AI 调用，评分逻辑保留在前端 titleOptimizer.ts）
- [ ] Task 3.18: 实现 `video.rs`（视频库扫描 + FFmpeg 渲染调度，用 rayon + tokio 并行，对齐原 video.ts 行为）
- [ ] Task 3.19: 实现 `workbench.rs`（工作台状态）
- [ ] Task 3.20: 实现 `update.rs`（包装 tauri-plugin-updater，对齐原 update.ts 行为）
- [ ] Task 3.21: 在 `lib.rs` 注册所有 `#[tauri::command]` 到 invoke handler，配置 allowlist 最小权限

## 阶段 4：单元测试

- [ ] Task 4.1: 为 `security.rs` 编写单元测试（5 道防线各 3+ 用例：正常、边界、恶意输入）
- [ ] Task 4.2: 为 `recognition.rs` 的规则识别函数编写单元测试（用原 recognition.ts 测试用例对齐）
- [ ] Task 4.3: 为 `export.rs` 编写单元测试（导出格式、空数据、超长字段、公式注入防护）
- [ ] Task 4.4: 为 `ffmpeg.rs` 的 8.3 短路径转换编写单元测试（含中文路径、纯英文路径、不存在的路径）
- [ ] Task 4.5: 为 `paths.rs` 编写单元测试（资源路径拼接、跨平台兼容性）
- [ ] Task 4.6: 执行 `cargo test` 全部通过

## 阶段 5：集成测试（端到端）

- [ ] Task 5.1: 编写 Tauri 集成测试：支付宝返款完整流程（粘贴 → 识别 → 预览 → 导出 → 文件存在）
- [ ] Task 5.2: 编写 Tauri 集成测试：视频剪辑批量渲染（选目录 → 选模板 → 渲染 → 输出文件存在且时长正确）
- [ ] Task 5.3: 编写 Tauri 集成测试：收评助手扫描（指定小目录 → 返回图片列表 → AI 文案非空）
- [ ] Task 5.4: 编写 Tauri 集成测试：标题优化评分（输入目标词 → 评分结果与 Electron 版本对比一致性）
- [ ] Task 5.5: 编写 Tauri 集成测试：评价对比（导入两份名单 → 去重匹配结果与 Electron 版本对比一致性）
- [ ] Task 5.6: 执行 `cargo tauri test`（或对应测试命令）全部通过

## 阶段 6：手动冒烟测试（多轮，详见 checklist.md）

- [ ] Task 6.1: 第 1 轮冒烟测试 — 启动应用，验证首页 5 个工具卡片可见可点击
- [ ] Task 6.2: 第 1 轮冒烟测试 — 支付宝返款模块全流程跑通（含云端校验）
- [ ] Task 6.3: 第 1 轮冒烟测试 — 视频剪辑模块单文件渲染成功
- [ ] Task 6.4: 第 1 轮冒烟测试 — 收评助手模块扫描 + AI 文案生成成功
- [ ] Task 6.5: 第 1 轮冒烟测试 — 标题优化模块评分正常
- [ ] Task 6.6: 第 1 轮冒烟测试 — 评价对比模块匹配正常
- [ ] Task 6.7: 第 1 轮冒烟测试 — 主题切换（深色/浅色）正常
- [ ] Task 6.8: 第 1 轮冒烟测试 — 设置页保存/读取 API 配置正常
- [ ] Task 6.9: 修复第 1 轮发现的所有 bug，记录到 tasks.md 新建修复任务
- [ ] Task 6.10: 第 2 轮冒烟测试 — 重复 6.1-6.8，全部通过
- [ ] Task 6.11: 第 3 轮冒烟测试 — 边界场景（空输入、超长文本、特殊字符、断网、API Key 错误）

## 阶段 7：性能基准测试与对比

- [ ] Task 7.1: 测量 Electron 版本基线指标：安装包大小、冷启动时间、空闲内存、100 视频渲染耗时
- [ ] Task 7.2: 测量 Tauri 版本指标：同上四项
- [ ] Task 7.3: 对比报告，验证达成 spec.md 性能目标（包 ≤30MB、启动 ≤1s、内存 ≤150MB、CPU 任务提速 ≥30%）
- [ ] Task 7.4: 若任一指标未达标，在 tasks.md 新建优化任务并重测

## 阶段 8：构建与发布

- [ ] Task 8.1: 执行 `cargo tauri build` 生成 NSIS 安装包
- [ ] Task 8.2: 在干净 Windows 虚拟机/物理机安装，验证不带 Rust 工具链可独立运行
- [ ] Task 8.3: 同步版本号：tauri-app/package.json version、tauri.conf.json version、App.tsx APP_VERSION
- [ ] Task 8.4: 在 App.tsx CHANGELOG_ITEMS 追加本次迁移说明（大白话）

## Task Dependencies
- [Task 1.*] 全部依赖 [Task 0.*] 完成（备份先行）
- [Task 2.*] 可与 [Task 3.*] 并行（前端 vs 后端独立）
- [Task 3.21] 依赖 [Task 3.3-3.20] 全部完成
- [Task 4.*] 依赖对应 [Task 3.*] 完成
- [Task 5.*] 依赖 [Task 2.*] 和 [Task 3.*] 全部完成
- [Task 6.*] 依赖 [Task 5.*] 通过
- [Task 7.*] 依赖 [Task 6.10] 通过
- [Task 8.*] 依赖 [Task 7.*] 通过
