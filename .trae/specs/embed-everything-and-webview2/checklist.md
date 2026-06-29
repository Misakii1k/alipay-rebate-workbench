# Checklist

## Everything 内置验证
- [x] `resources/bin/Everything.exe` 已存在（v1.4.1.1024, 2.16 MB）
- [x] `resources/bin/` 包含 es.exe / ffmpeg.exe / Everything.exe 三个文件

## Everything 搜索时静默启动验证
- [x] `everything.rs` 新增 `resolve_everything_exe_path` 函数
- [x] `everything.rs` 新增 `is_everything_running` 函数（用 es.exe test 检测）
- [x] `everything.rs` 新增 `ensure_everything_running` 函数
- [x] 启动命令使用 `-startup` 参数（Everything 进入托盘模式，不显示主窗口）
- [x] 启动命令使用 `CREATE_NO_WINDOW` 标志（不显示控制台）
- [x] 启动命令使用 `DETACHED_PROCESS` 标志（脱离父进程控制台）
- [x] 仅在 Everything 未运行时启动（避免重复启动）
- [x] 启动后等待 2 秒让 Everything 初始化索引
- [x] 启动失败时降级为 walkdir（不抛错，不阻塞用户）
- [x] `search_with_everything` 函数开头调用 `ensure_everything_running`

## WebView2 离线安装验证
- [x] `tauri.conf.json` 配置 `webviewInstallMode: { type: "embedBootstrapper" }`
- [x] NSIS 安装器内置 WebView2 bootstrapper（构建时从 Microsoft 下载并嵌入）

## 清理验证
- [x] `target/release/bin/Everything.exe` 已删除（由 tauri build 重新生成，符合预期）
- [x] `target/debug/bin/Everything.exe` 已删除

## 编译与测试验证
- [x] `cargo check` 通过（34.40s）
- [x] `cargo test` 全部通过（222 passed / 0 failed / 16 ignored）
- [x] `npx tsc --noEmit` 通过

## 打包与产物验证
- [x] `npx tauri build` 成功生成 NSIS 安装包（Rust 编译 4m 27s）
- [x] 安装包已复制到 `成品` 文件夹
- [x] 安装包大小合理（55.88 MB：原 53.65 MB + Everything 2.16 MB + WebView2 bootstrapper 增量）
