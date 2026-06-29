# 内置 Everything 与 WebView2 离线安装 Spec

## Why
当前安装包在新电脑上存在两个可用性问题：
1. Everything 主程序未内置，新电脑需手动安装才能使用索引式搜索（否则降级为 walkdir 全目录扫描，慢）
2. WebView2 Runtime 依赖网络下载安装，离线环境或老版 Windows 10 可能无法启动应用

用户要求：
- 保证新电脑开箱即用，所有功能正常使用
- Everything 搜索时可以静默启动 Everything 服务
- 全程静默，不弹窗，不让用户感知到有其他软件正在启动
- 但确实用的是 Everything 的服务

## What Changes
- 将 `Everything.exe` (v1.4.1.1024, 2.16 MB) 重新内置到 `resources/bin/`
- 在 `everything.rs` 新增 `ensure_everything_running` 函数：
  - 用 `-startup` 参数静默启动 Everything（进入托盘模式，不显示主窗口）
  - 用 `CREATE_NO_WINDOW` + `DETACHED_PROCESS` 标志（不显示控制台窗口）
  - 仅在 Everything 未运行时启动
  - 启动后等待 2 秒让 Everything 初始化索引
- 在 `search_with_everything` 函数开头调用 `ensure_everything_running`（搜索时按需启动）
- **不在应用启动时自动启动 Everything**（避免不必要的资源占用）
- 配置 `tauri.conf.json` 的 `webviewInstallMode` 为 `embedBootstrapper`，NSIS 安装器内置 WebView2 bootstrapper
- 清理 `release/bin/` 目录中的遗留 Everything.exe

## Impact
- Affected specs: `revert-to-classic-everything-search`（方向部分调整：重新内置 Everything.exe，搜索时静默启动）
- Affected code:
  - `tauri-app/resources/bin/Everything.exe`（新增）
  - `tauri-app/src-tauri/src/everything.rs`（新增 ensure_everything_running，在 search_with_everything 中调用）
  - `tauri-app/src-tauri/tauri.conf.json`（webviewInstallMode 配置）

## ADDED Requirements
### Requirement: Everything 搜索时静默启动
系统 SHALL 在执行 Everything 搜索时检测 Everything 服务是否运行，若未运行则用 `-startup` 参数静默启动内置的 Everything.exe，启动后等待初始化再执行搜索。

#### Scenario: 首次搜索（Everything 未运行）
- **WHEN** 用户执行搜索且 Everything 服务未运行
- **THEN** 用 `-startup` + `CREATE_NO_WINDOW` + `DETACHED_PROCESS` 启动内置 Everything.exe
- **AND** 不显示控制台窗口
- **AND** 不显示 Everything 主窗口（-startup 参数让 Everything 进入托盘模式）
- **AND** 等待 2 秒让 Everything 初始化索引
- **AND** 然后执行 es.exe 查询

#### Scenario: Everything 已运行
- **WHEN** 用户执行搜索且 Everything 服务已在运行
- **THEN** 不重复启动，直接执行 es.exe 查询

#### Scenario: Everything 启动失败
- **WHEN** Everything.exe 启动失败或初始化超时
- **THEN** 降级为 walkdir 全目录扫描（不抛错，不阻塞用户）

### Requirement: WebView2 离线安装
系统 SHALL 在 NSIS 安装器中内置 WebView2 bootstrapper，使安装包在无网络环境下也能安装 WebView2 Runtime。

#### Scenario: 全新 Windows 10 离线安装
- **WHEN** 用户在无网络环境的全新 Windows 10 上运行安装包
- **THEN** NSIS 安装器使用内置的 WebView2 bootstrapper 安装 Runtime
- **AND** 应用能正常启动
