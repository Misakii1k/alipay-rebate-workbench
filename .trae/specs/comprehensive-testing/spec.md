# 全面检测规范 - 前后端功能验证

## 背景与目标

本次会话修复了多个 Bug 并新增了 CPU/GPU 编码器选择功能。为确保所有改动稳定可用，需要对前后端功能进行全面检测。本规范覆盖**编译验证、单元测试、前端 UI 行为、后端命令、集成流程、近期修复回归、打包产物**七大部分。

## 范围

### 近期改动清单（必须回归验证）

| # | 改动 | 文件 | 风险点 |
|---|------|------|--------|
| 1 | 窗口控制按钮失效修复（`-webkit-app-region: no-drag`） | `src/styles.css` | 最小化/最大化/关闭按钮无响应 |
| 2 | 中文搜索关键词被清空修复（`\p{L}\p{N}` Unicode 属性类） | `src-tauri/src/security.rs` | 搜索中文关键词搜不到结果 |
| 3 | GPU 硬件编码器支持（h264_nvenc / h264_qsv / h264_amf） | `src-tauri/src/video.rs` | GPU 检测到但仍用 CPU 编码 |
| 4 | 编码器模式选择字段（`video_encoder_mode`: auto/gpu/cpu） | `types.rs` / `shared.ts` / `App.tsx` | 设置无法保存或读取 |
| 5 | Everything 静默启动（`-startup` + `CREATE_NO_WINDOW` + `DETACHED_PROCESS`） | `everything.rs` | 搜索时弹出 Everything GUI 窗口 |
| 6 | WebView2 离线安装（`embedBootstrapper`） | `tauri.conf.json` | 新电脑无 WebView2 时白屏 |

### 模块覆盖

电商运营工具箱 v1.0.5 包含 5 大模块：
1. **支付宝返款**：导入 → 录入 → 预览 → 导出
2. **视频批量剪辑**：视频库扫描、模板渲染、GPU 编码
3. **收评助手**：本地图片搜索、AI 生成评价
4. **评价返款对比**：名单导入、匹配、差异标红
5. **设置**：API 配置、文件路径、视频编码器选择

## 验收标准

### 编译与静态检查
- `cargo check` 退出码 0（允许 warning）
- `cargo test` 全部通过（允许 `ignored` 测试）
- `npx tsc --noEmit` 退出码 0

### 前端 UI 行为
- 窗口标题栏三个按钮（最小化/最大化还原/关闭）点击有响应
- 设置页 → 视频批量剪辑 → 「视频编码器」下拉框存在且有三选项
- 编码器选择切换后自动保存，重启应用仍保留
- 编码器模式选择持久化到 `app_settings.json` 的 `videoEncoderMode` 字段

### 后端命令
- `everything_test` 命令可正常调用，返回布尔值
- `search_with_everything` 中文关键词（如"红色产品"）能返回匹配文件
- `video_render_task` 使用 GPU 编码器时实际调用 h264_nvenc/h264_qsv/h264_amf
- `load_settings` / `save_settings` 正确序列化 `videoEncoderMode`

### 集成流程
- 视频剪辑：选择 GPU → 渲染日志出现 `h264_nvenc` 等编码器名
- 视频剪辑：选择 CPU → 渲染日志出现 `libx264`
- 搜索：中文关键词、英文关键词、混合关键词均能命中
- Everything 服务：搜索时静默启动，无 GUI 窗口弹出

### 打包产物
- NSIS 安装包生成成功
- 安装包大小合理（55-60 MB 区间）
- 安装到全新电脑后所有功能正常
- 无 WebView2 的电脑能自动安装 WebView2

## 非目标

- 不进行性能基准测试
- 不进行安全渗透测试
- 不修改任何代码（仅验证）
- 不覆盖 macOS / Linux 平台

## 依赖

- Rust 工具链（cargo）
- Node.js + npm
- 内置 `Everything.exe` v1.4.1.1024
- 内置 `es.exe`
- 内置 `ffmpeg.exe`（含硬件编码支持）
- 可选：NVIDIA GPU / Intel iGPU / AMD GPU 用于 GPU 编码验证
