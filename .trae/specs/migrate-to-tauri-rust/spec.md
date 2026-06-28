# Tauri + Rust 迁移 Spec

## Why

当前 Electron + React + TypeScript 应用（5 模块：支付宝返款、视频剪辑、收评助手、标题优化、评价对比）存在三大痛点：
1. **安装包体积过大**：含完整 Chromium + Node 运行时，估计 200MB+，远超用户期望。
2. **启动速度慢**：冷启动 1.5-3s 才能进入首屏可交互。
3. **CPU 密集任务（视频渲染、Excel 导出、规则识别）受 Node 单线程拖累**，无法充分利用多核。

迁移到 Tauri + Rust 可同时解决这三个问题，且 React 前端可基本保留（UI 改动 < 5%），后端用 Rust 重写获得原生性能。

## What Changes

### 架构迁移
- **BREAKING** 运行时从 Electron 替换为 Tauri 2.x（WebView2 + Rust 后端）
- **BREAKING** 主进程语言从 TypeScript 切换为 Rust
- **BREAKING** IPC 通信从 `ipcMain.handle` 切换为 Tauri `#[tauri::command]`
- **BREAKING** 外部二进制（ffmpeg.exe / es.exe）分发方式从 `extraResources` 改为 Tauri `resources` 配置
- **BREAKING** 文件对话框/剪切板/窗口管理等系统 API 从 Electron 内置改为 Tauri 插件（`@tauri-apps/plugin-dialog` / `clipboard-manager` / `window`）

### 保留不变
- React + TypeScript 前端代码（src/ 目录）
- 五个模块的业务逻辑（recognition.ts / parsing.ts / compare.ts / titleOptimizer.ts / video.ts）
- 前端视觉设计、CSS 样式、主题切换、毛玻璃效果
- 资源文件（assets/ 下的模板、字体、音乐、bin/ 下的 ffmpeg.exe / es.exe）
- Vite 构建配置（仅替换 electron 相关入口）

### Rust 后端模块化重写
将 Electron 的 16 个 handler 模块按职责迁移到 Rust：
- `ai.rs` — OpenAI 兼容 Chat Completions API 调用（reqwest + tokio）
- `clipboard.rs` — 剪切板读写（tauri-plugin-clipboard-manager）
- `export.rs` — Excel 导出（rust_xlsxwriter 替代 exceljs）
- `ffmpeg.rs` — FFmpeg 诊断/路径解析（保留 ffmpeg.exe 子进程调用，含中文路径 8.3 短路径转换）
- `files.rs` — 文件/目录选择对话框（tauri-plugin-dialog）
- `recognition.rs` — 支付宝识别规则引擎 + 云端校验
- `review.rs` — 收评助手（Everything 集成、缩略图、AI 文案）
- `title.rs` — 标题评分（原 titleOptimizer.ts 逻辑保留在前端，Rust 仅代理 AI 调用）
- `video.rs` — 视频库扫描 + FFmpeg 渲染调度
- `settings.rs` — 应用设置持久化（JSON 文件存储到 app config dir）
- `workbench.rs` — 工作台状态
- `window.rs` — 窗口控制（tauri::Window）
- `update.rs` — 自动更新（tauri-plugin-updater 替代 electron-updater）
- `log.rs` — 日志（tracing + 文件 rotate）
- `everything.rs` — Everything (voidtools) 集成
- `media.rs` — 缩略图/图片尺寸探测（image crate）

### 并行 Worker 优化
- 视频批量渲染：用 Rust `tokio::task::spawn_blocking` + `rayon` 并行 FFmpeg 调用
- 收评缩略图生成：`rayon` 并行处理图片目录
- Excel 批量导出：流式写入 + 异步任务

### 安全模型
- 保留现有 `validatePathSafety` / `validateMediaFilePath` / `validateApiUrl` / `sanitizeCellText` / `sanitizeEverythingQuery` 五道防线，用 Rust 重写
- API Key 继续加密存储（用 `aes-gcm` + 系统 keyring 或 master key 派生）
- CSP 配置迁移到 Tauri `tauri.conf.json` 的 `security.csp`
- 启用 Tauri `allowlist` 最小权限模型

### 回滚保障机制
- **前置备份**：迁移前在原项目根目录创建 `git tag v-electron-final` + `git branch legacy/electron` 分支，并复制一份独立目录 `..\新项目-electron-backup\` 作为物理备份
- **新项目隔离**：Tauri 新项目代码写入 `electron-app/`（保留 React 前端可被 Tauri 复用）的同级新目录 `tauri-app/`，原 `electron/`、`package.json` 等保持只读不动
- **回滚开关**：保留原 `npm run dev` / `npm run dist` 脚本可独立运行，出问题可立即切回 Electron 版本

### 多轮测试策略
1. **单元测试**：Rust 后端每个模块编写 `#[test]` 单元测试覆盖核心纯函数
2. **集成测试**：5 大模块的端到端 IPC 流程编写 Tauri 测试用例
3. **冒烟测试清单**：手动执行 5 个模块的核心 happy path（详见 checklist.md）
4. **回归对比**：与 Electron 版本逐模块对比行为一致性（识别准确率、导出格式、视频参数等）
5. **性能基准测试**：对比启动时间、内存占用、安装包大小、视频渲染耗时

## Impact

### Affected specs
- 无（本 spec 为新创建，与既有 specs 并行不冲突）

### Affected code
- **新增**：`tauri-app/` 目录（Rust 后端 + Tauri 配置）
- **新增**：`tauri-app/src-tauri/src/` Rust 源码（16 个模块）
- **新增**：`tauri-app/src-tauri/Cargo.toml` Rust 依赖
- **新增**：`tauri-app/src-tauri/tauri.conf.json` Tauri 配置
- **新增**：`tauri-app/package.json` 前端构建配置（仅依赖 Vite + React，移除 electron）
- **迁移**：`src/` 下 React 代码整体复制到 `tauri-app/src/`，仅修改 `window.alipayWorkbench` 调用为 `invoke('command_name', args)`
- **迁移**：`src/main.tsx` 的浏览器 mock 逻辑保留作为 fallback，新增 Tauri 模式下走真实 invoke
- **保留只读**：原项目根目录所有文件（electron/、src/、package.json 等），迁移期间不修改

### 不受影响
- `assets/` 资源目录（ffmpeg.exe / es.exe / alipay-template.xlsx / 字体 / 音乐）— 复制到 tauri-app/resources/
- `build/` 图标素材 — 复制到 tauri-app/src-tauri/icons/
- `CLAUDE.md` / `TRANSFER.md` 文档 — 保留作为历史参考

## ADDED Requirements

### Requirement: Tauri 项目骨架
系统 SHALL 在 `tauri-app/` 目录下建立独立 Tauri 2.x 项目，与原 Electron 项目物理隔离，互不干扰。

#### Scenario: 隔离性
- **WHEN** 在 tauri-app/ 目录运行 `cargo tauri dev`
- **THEN** 仅启动 Tauri 应用，不影响原 electron/ 目录代码

#### Scenario: 原项目可独立运行
- **WHEN** 在项目根目录运行 `npm run dev`（原 Electron 版本）
- **THEN** 原 Electron 应用正常启动，所有功能保持迁移前状态

### Requirement: 回滚保障
系统 SHALL 在迁移开始前提供完整回滚机制，确保任何时候都能切回 Electron 版本。

#### Scenario: 备份建立
- **WHEN** 迁移任务启动第一步
- **THEN** 创建 `git tag v-electron-final` 标签指向当前 HEAD
- **AND** 创建 `git branch legacy/electron` 分支
- **AND** 在上级目录创建 `..\新项目-electron-backup\` 物理副本

#### Scenario: 回滚触发
- **WHEN** Tauri 版本出现严重 bug 或无法继续推进
- **THEN** 用户可执行 `git checkout legacy/electron` 立即恢复可用版本
- **AND** 物理备份目录 `..\新项目-electron-backup\` 保留所有原始文件

### Requirement: 功能等价性
系统 SHALL 在 Tauri 版本中实现与 Electron 版本完全一致的 5 模块功能，不增不减。

#### Scenario: 支付宝返款
- **GIVEN** 用户粘贴一段含金额备注的文本
- **WHEN** 点击识别按钮
- **THEN** 识别结果（账号、姓名、金额、备注）与 Electron 版本完全一致
- **AND** 云端 AI 二次校验流程与 Electron 版本行为一致（后台校验、按原行回写、取消后忽略迟到结果）

#### Scenario: 视频剪辑
- **GIVEN** 用户选择视频库目录和模板
- **WHEN** 启动批量渲染
- **THEN** 渲染产物（文件名、时长、字幕、转场）与 Electron 版本字节级一致（或仅编码器版本差异导致的细微差异）
- **AND** 极速模式开关行为一致

#### Scenario: 收评助手
- **GIVEN** 用户指定搜索目录
- **WHEN** 执行扫描
- **THEN** 找到的图片列表、缩略图、AI 文案生成结果与 Electron 版本一致

#### Scenario: 标题优化
- **GIVEN** 用户输入目标词和标题
- **WHEN** 执行评分
- **THEN** 评分结果、子串命中数、候选生成与 Electron 版本完全一致（纯前端逻辑，必须保证 titleOptimizer.ts 算法字节级保留）

#### Scenario: 评价对比
- **GIVEN** 用户导入两份名单
- **WHEN** 执行对比
- **THEN** 去重匹配结果与 Electron 版本完全一致（纯前端逻辑，必须保证 compare.ts 字节级保留）

### Requirement: 性能提升
系统 SHALL 在 Tauri 版本中显著提升以下指标（与 Electron 版本对比）。

#### Scenario: 安装包体积
- **WHEN** 执行 `cargo tauri build` 生成最终 NSIS 安装包
- **THEN** 安装包体积不超过 30MB（不含 ffmpeg.exe / es.exe，二者作为独立 resources 分发）
- **AND** 含外部二进制的总体积不超过 80MB

#### Scenario: 启动速度
- **WHEN** 冷启动应用
- **THEN** 从双击图标到首屏可交互不超过 1 秒

#### Scenario: 内存占用
- **WHEN** 应用空闲状态运行 60 秒
- **THEN** 常驻内存不超过 150MB

#### Scenario: CPU 密集任务
- **WHEN** 执行 100 个视频的批量渲染
- **THEN** 总耗时比 Electron 版本降低至少 30%（得益于 Rust 并行调度）
- **AND** UI 主线程不阻塞

### Requirement: 冒烟测试覆盖
系统 SHALL 通过多轮冒烟测试验证 5 大模块功能可用性。

#### Scenario: 冒烟测试通过
- **WHEN** 执行 checklist.md 中列出的全部冒烟测试用例
- **THEN** 每个用例的预期结果均实际出现
- **AND** 测试报告记录所有通过项

#### Scenario: 测试失败处理
- **WHEN** 任一冒烟测试用例失败
- **THEN** 立即在 tasks.md 中创建修复任务
- **AND** 修复后重新执行全部冒烟测试（不允许部分通过即发布）

### Requirement: 外部依赖兼容
系统 SHALL 保留对现有外部依赖的兼容性。

#### Scenario: FFmpeg 中文路径
- **WHEN** FFmpeg 处理含中文的文件路径
- **THEN** 通过 Windows 8.3 短路径转换保证 FFmpeg 正确识别（沿用原 getShortPath 逻辑，用 Rust 重写）

#### Scenario: Everything 集成
- **WHEN** 收评助手启用 Everything 加速
- **THEN** 通过调用 es.exe 完成搜索（沿用原逻辑，用 Rust 重写子进程调用）

#### Scenario: 大模型 API
- **WHEN** 调用 OpenAI 兼容 Chat Completions API
- **THEN** 支持 temperature=0、response_format=json_object、408/409/425/429/5xx 自动重试、并发限制（modelConcurrency）
- **AND** API Key 加密存储

## MODIFIED Requirements

### Requirement: 双进程结构
原 Electron 双进程（main.ts + preload.ts + React renderer）调整为 Tauri 双进程（Rust 主进程 + WebView2 渲染进程），preload.ts 改为前端直接通过 `@tauri-apps/api` 的 `invoke` 调用 Rust 命令。

### Requirement: IPC 通信
原 `ipcMain.handle('namespace:action', handler)` 改为 `#[tauri::command] async fn namespace_action(...) -> Result<T, String>`，前端调用从 `window.alipayWorkbench.namespaceAction(args)` 改为 `invoke('namespace_action', args)`。

### Requirement: 构建产物
- `dist-renderer/` 保留（Vite 前端输出，Tauri 通过 `frontendDist` 配置指向）
- `dist-electron/` 删除（不再需要）
- `dist/` 替换为 Tauri 输出目录（`tauri-app/src-tauri/target/release/bundle/nsis/`）

## REMOVED Requirements

### Requirement: Electron 运行时依赖
**Reason**: 迁移到 Tauri 后不再需要 Electron
**Migration**: 删除 `electron` / `electron-updater` / `electron-builder` / `concurrently` / `cross-env` / `wait-on` 等 Electron 相关依赖；新增 `@tauri-apps/api` / `@tauri-apps/cli` / `@tauri-apps/plugin-*` 系列

### Requirement: preload.ts contextBridge 桥接
**Reason**: Tauri 通过 `invoke` 直接调用 Rust 命令，无需 contextBridge 中间层
**Migration**: preload.ts 整体删除，原 `window.alipayWorkbench` API 调用全部改为 `invoke('command_name', args)`
