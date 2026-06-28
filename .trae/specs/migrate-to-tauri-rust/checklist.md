# Checklist

## 阶段 0：备份与回滚验证
- [ ] git 工作树干净，所有未跟踪文件已 commit
- [ ] git 标签 `v-electron-final` 已创建，`git tag` 命令可见
- [ ] git 分支 `legacy/electron` 已创建，`git branch` 可见
- [ ] 物理备份目录 `..\新项目-electron-backup\` 存在且包含完整文件
- [ ] 回滚说明已写入 TRANSFER.md 顶部小节
- [ ] 验证回滚：`git checkout legacy/electron` 后 `npm run dev` 能正常启动 Electron 应用

## 阶段 1：Tauri 骨架验证
- [ ] `tauri-app/` 目录存在，与原 `electron/` 目录互不干扰
- [ ] `tauri-app/package.json` 不含 electron / electron-builder / electron-updater 依赖
- [ ] `tauri-app/src-tauri/tauri.conf.json` 的 productName 为 "电商运营工具箱"，appId 为 `com.rebate.workbench`
- [ ] `tauri-app/src-tauri/icons/icon.ico` 存在且与原 `build/icon.ico` 一致
- [ ] `tauri-app/resources/assets/` 包含 alipay-template.xlsx 和 music/ 目录
- [ ] `tauri-app/resources/bin/` 包含 ffmpeg.exe 和 es.exe
- [ ] NSIS 安装器配置：language=2052、createDesktopShortcut=always、allowToChangeInstallationDirectory=true、displayLanguageSelector=false
- [ ] `cargo tauri dev` 能启动空白应用窗口，无 Rust 编译错误

## 阶段 2：前端迁移验证
- [ ] `tauri-app/src/` 包含原 `src/` 所有文件（App.tsx、VideoWorkbench.tsx、ReviewAssistant.tsx、CompareWorkbench.tsx、main.tsx、styles.css、apple.css、claude.css、atelier.css 等）
- [ ] `tauri-app/src/lib/titleOptimizer.ts` 与原文件字节级一致（fc / diff 验证）
- [ ] `tauri-app/src/lib/compare.ts` 与原文件字节级一致
- [ ] `tauri-app/src/lib/shared.ts` 与原文件一致（仅模块系统语法允许调整）
- [ ] `tauri-app/src/lib/tauri-bridge.ts` 存在，封装了 invoke 调用层
- [ ] 全代码无 `window.alipayWorkbench` 调用残留（grep 验证）
- [ ] `src/main.tsx` 检测 `'__TAURI_INTERNALS__' in window`，Tauri 模式走 invoke，浏览器模式走 mock
- [ ] 文件对话框 API 调用全部使用 `@tauri-apps/plugin-dialog`
- [ ] 剪切板 API 调用全部使用 `@tauri-apps/plugin-clipboard-manager`
- [ ] 窗口控制 API 调用全部使用 `@tauri-apps/api/window`
- [ ] `npm run build`（Tauri 前端）能产出 `dist-renderer/`，无 TypeScript 错误
- [ ] `cargo tauri dev` 启动后能看到首页 5 个工具卡片（即使后端未实现，UI 应可见）

## 阶段 3：Rust 后端验证（按模块）
- [ ] `tauri-app/src-tauri/Cargo.toml` 包含 tauri 2.x、serde、tokio、reqwest、rust_xlsxwriter、image、tracing、aes-gcm、windows 等依赖
- [ ] `log.rs` 实现 tracing + 文件 rotate，日志路径与原 logger.ts 一致
- [ ] `settings.rs` 实现 JSON 持久化到 app config dir，API Key 用 aes-gcm 加密
- [ ] `security.rs` 实现五道防线，每个函数有对应单元测试
- [ ] `paths.rs` 正确解析 resourcesPath / appConfigDir / ffmpeg 路径
- [ ] `ffmpeg.rs` 实现 8.3 短路径转换，含中文路径测试通过
- [ ] `ai.rs` 实现 OpenAI 兼容 Chat Completions，含 408/409/425/429/5xx 重试 + 指数退避 + modelConcurrency 并发限制
- [ ] `clipboard.rs` 包装 tauri-plugin-clipboard-manager
- [ ] `files.rs` 包装 tauri-plugin-dialog
- [ ] `window.rs` 实现最小化/最大化/关闭
- [ ] `everything.rs` 调用 es.exe 子进程正常
- [ ] `media.rs` 缩略图生成和尺寸探测正常
- [ ] `export.rs` Excel 导出文件格式与原 electron 版本一致（用 Excel 打开验证）
- [ ] `recognition.rs` 规则识别结果与原 recognition.ts 完全一致（同一组测试输入对比）
- [ ] `review.rs` 搜索/缩略图/AI 文案流程跑通
- [ ] `title.rs` 仅代理 AI 调用，评分逻辑在前端
- [ ] `video.rs` 视频库扫描 + 批量渲染成功，并行任务不阻塞 UI
- [ ] `workbench.rs` 状态管理正常
- [ ] `update.rs` 自动更新检查能正常调用 tauri-plugin-updater
- [ ] `lib.rs` 注册所有 #[tauri::command]，allowlist 配置最小权限
- [ ] `cargo build --release` 无错误无警告

## 阶段 4：单元测试
- [ ] `security.rs` 单元测试全部通过（每道防线 3+ 用例）
- [ ] `recognition.rs` 规则识别单元测试全部通过
- [ ] `export.rs` 单元测试全部通过（含公式注入防护）
- [ ] `ffmpeg.rs` 8.3 短路径单元测试全部通过
- [ ] `paths.rs` 单元测试全部通过
- [ ] `cargo test` 整体通过，无失败用例

## 阶段 5：集成测试
- [ ] 支付宝返款端到端测试通过（识别结果正确，导出 Excel 文件存在）
- [ ] 视频剪辑端到端测试通过（输出视频文件时长正确）
- [ ] 收评助手端到端测试通过（图片列表非空，AI 文案非空）
- [ ] 标题优化端到端测试通过（评分结果与 Electron 版本一致）
- [ ] 评价对比端到端测试通过（匹配结果与 Electron 版本一致）

## 阶段 6：手动冒烟测试（多轮）

### 第 1 轮：基础功能
- [ ] 应用启动，首页 5 个工具卡片可见
- [ ] 点击"支付宝返款"进入模块，看到 4 步流程
- [ ] 粘贴含金额备注文本，点击识别，结果显示账号姓名金额
- [ ] 切换到"预览"页，行数据正确
- [ ] 点击导出，文件保存对话框弹出，导出后 Excel 文件存在且内容正确
- [ ] 云端校验开关开启时，识别后后台调用 AI 校验，结果显示在 UI
- [ ] 点击"视频剪辑"进入模块，选择视频目录，看到视频列表
- [ ] 选择模板，启动单个视频渲染，输出文件存在且能播放
- [ ] 极速模式开关切换，扫描速度有差异
- [ ] 点击"收评助手"进入模块，选择搜索目录，扫描返回图片列表
- [ ] 选中图片，AI 文案生成成功，结果非空
- [ ] 点击"标题优化"进入模块，输入目标词和标题，评分结果显示
- [ ] 子串命中数显示正确，候选生成正常
- [ ] 点击"评价对比"进入模块，导入两份名单，匹配结果显示，差异标红
- [ ] 主题切换：深色 → 浅色，水滴扩散动画正常，浅色为陶土橙主色调
- [ ] 设置页保存 API 配置，关闭重开应用后配置仍在
- [ ] API Key 显示为加密形式，"小眼睛"切换可见

### 第 2 轮：稳定性回归
- [ ] 重复第 1 轮全部测试项，全部通过
- [ ] 修复第 1 轮发现的所有 bug 后再进行第 2 轮

### 第 3 轮：边界场景
- [ ] 支付宝返款：粘贴空文本，识别按钮禁用或返回友好提示
- [ ] 支付宝返款：粘贴超长文本（10000 字符），不崩溃
- [ ] 支付宝返款：粘贴含特殊字符（emoji / 换行 / 制表符），不崩溃
- [ ] 视频剪辑：选择空目录，扫描返回空列表
- [ ] 视频剪辑：选择含中文路径的目录，扫描和渲染成功（验证 8.3 短路径转换）
- [ ] 收评助手：API Key 错误时，AI 调用返回友好错误提示
- [ ] 收评助手：断网状态下，扫描功能仍可用（仅 AI 文案失败）
- [ ] 标题优化：空标题输入，评分返回 0 或友好提示
- [ ] 评价对比：两份完全相同的名单，全部标红或显示完全匹配
- [ ] 评价对比：两份完全不同的名单，全部显示为未匹配

## 阶段 7：性能基准测试
- [ ] Electron 版本基线指标已记录（包大小 / 启动时间 / 空闲内存 / 100 视频渲染耗时）
- [ ] Tauri 版本指标已记录
- [ ] Tauri 安装包（不含 ffmpeg）≤ 30MB
- [ ] Tauri 含 ffmpeg 总体积 ≤ 80MB
- [ ] Tauri 冷启动 ≤ 1 秒
- [ ] Tauri 空闲内存 ≤ 150MB
- [ ] Tauri 100 视频渲染耗时比 Electron 低 ≥ 30%
- [ ] UI 主线程在渲染期间不卡顿（动画/滚动流畅）

## 阶段 8：构建与发布
- [ ] `cargo tauri build` 成功生成 NSIS 安装包
- [ ] 干净 Windows 环境安装后，应用可独立运行（无需 Rust 工具链）
- [ ] 版本号三处同步：tauri-app/package.json / tauri.conf.json / App.tsx APP_VERSION
- [ ] CHANGELOG_ITEMS 已追加迁移说明（大白话）

## 阶段 9：最终验收
- [ ] 原 Electron 项目目录未受任何修改（git status 在 legacy/electron 分支干净）
- [ ] 回滚演练：能立即 `git checkout legacy/electron` 切回 Electron 版本
- [ ] Tauri 版本所有冒烟测试用例通过（3 轮全过）
- [ ] 性能指标全部达标
- [ ] 用户确认验收通过
