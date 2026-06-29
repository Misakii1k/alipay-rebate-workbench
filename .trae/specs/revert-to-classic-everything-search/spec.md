# 回退到经典 Everything 搜索架构 Spec

## Why
当前 Tauri 版的 Everything 集成存在两个顽疾：
1. **弹窗问题**：es.exe 是控制台程序，Tauri 作为 GUI 应用调用子进程时 Windows 会为新进程创建控制台窗口，即使加了 `CREATE_NO_WINDOW` 仍可能有残留闪烁。
2. **自动拉起服务引发循环**：内置 Everything.exe 便携模式 + 启动时 / 搜索前自动 `ensure_everything_running`，会在某些环境下导致 Everything 主窗口反复打开关闭。

老 Electron 架构的搜索方案非常稳定：**不内置 Everything.exe、不自动拉起服务**，只通过 `execFile(esPath, args)` 调用用户已安装的 Everything 的 es.exe。Node.js 进程本身有控制台句柄，不会弹出新的控制台窗口。用户需要自行安装并启动 Everything 桌面版（这是 voidtools Everything 的标准用法）。

## What Changes
- **移除** `everything::ensure_everything_running` 函数及其所有调用点（review_scan_assets / video_scan_library / everything_test 命令入口）
- **移除** `paths::get_everything_path` 辅助函数（不再需要解析 Everything.exe 路径）
- **移除** `resources/bin/Everything.exe` 二进制资源（保留 es.exe 作为命令行客户端）
- **简化** `everything_test` 命令：回退到老架构的实现 —— 用一个简单的 test 查询执行 `search_with_everything`，成功则 `available: true`，失败则 `available: false` 并给出友好提示
- **保留** `CREATE_NO_WINDOW` 标志（虽然老架构没加，但 Tauri 是纯 GUI 进程必须加，避免控制台闪烁）
- **保留** es.exe 内置（用户无需单独安装 es.exe，只需要装 Everything 主程序）
- **保留** 路径解析逻辑（resource_dir/bin/es.exe 优先 + 用户安装路径 + settings.everythingEsPath）

## Impact
- Affected specs: migrate-to-tauri-rust（Everything 集成子模块）
- Affected code:
  - `tauri-app/src-tauri/src/everything.rs`（核心改动：删除 ensure_everything_running、简化 everything_test）
  - `tauri-app/src-tauri/src/paths.rs`（删除 get_everything_path）
  - `tauri-app/src-tauri/src/review.rs`（删除 ensure_everything_running 调用）
  - `tauri-app/src-tauri/src/video.rs`（删除 ensure_everything_running 调用）
  - `tauri-app/resources/bin/Everything.exe`（删除文件）
  - `tauri-app/src-tauri/tauri.conf.json`（bundle.resources 不变，仍指向 `../resources/bin/*`，删除文件后自动不再打包）

## ADDED Requirements

### Requirement: 简化的 Everything 集成模型
系统 SHALL 仅通过调用 es.exe 子进程与 Everything 服务交互，不内置 Everything.exe 主程序，不在应用启动或搜索时自动拉起 Everything 服务。

#### Scenario: 用户已安装并启动 Everything
- **WHEN** 用户在系统托盘有 Everything 运行中
- **AND** 用户在应用中执行搜索或点击"测试连接"
- **THEN** 应用通过 es.exe 调用 Everything 服务，返回搜索结果
- **AND** 不弹出任何控制台窗口（CREATE_NO_WINDOW 抑制）
- **AND** 不启动新的 Everything 实例

#### Scenario: 用户未安装或未启动 Everything
- **WHEN** 用户系统中没有 Everything 进程运行
- **AND** 用户点击"测试连接"
- **THEN** `everything_test` 命令返回 `{ available: false, detail: "未找到 es.exe 或 Everything 主程序未运行，请先安装并启动 Everything。" }`
- **AND** 不尝试自动启动 Everything
- **AND** 不弹出任何窗口

#### Scenario: 搜索时 Everything 未运行
- **WHEN** 用户执行收评助手扫描或视频库扫描
- **AND** Everything 服务未运行
- **THEN** `search_with_everything` 返回空数组（不抛错）
- **AND** 上层逻辑降级到 walkdir 全目录扫描
- **AND** 不弹出任何窗口、不尝试启动 Everything

## REMOVED Requirements

### Requirement: 自动拉起 Everything 服务
**Reason**: 自动拉起引发弹窗反复打开关闭的 bug，且与用户已安装的 Everything 可能冲突，违背 voidtools Everything 的标准用法。
**Migration**: 用户需自行安装并启动 Everything 桌面版（https://www.voidtools.com/）。es.exe 仍内置在安装包中作为命令行客户端，用户无需单独下载 es.exe。

### Requirement: 内置 Everything.exe 便携模式
**Reason**: 便携模式启动会弹出主窗口（即使加 -hide），且与 -instance 参数组合在不同 Windows 版本下行为不一致。
**Migration**: 从 `resources/bin/` 删除 Everything.exe，安装包体积减小约 2.26MB。
