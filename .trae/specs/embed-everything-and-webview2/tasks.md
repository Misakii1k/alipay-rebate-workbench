# Tasks

- [x] Task 1: 将 Everything.exe 重新内置到 resources/bin/
  - [x] SubTask 1.1: 从 release/bin/Everything.exe 复制到 resources/bin/Everything.exe
  - [x] SubTask 1.2: 验证 resources/bin/ 目录包含 es.exe / ffmpeg.exe / Everything.exe 三个文件

- [x] Task 2: 在 everything.rs 新增静默启动 Everything 的函数
  - [x] SubTask 2.1: 添加 resolve_everything_exe_path 函数（解析内置 Everything.exe 路径）
  - [x] SubTask 2.2: 添加 is_everything_running 函数（用 es.exe -n 1 test 检测服务是否运行）
  - [x] SubTask 2.3: 添加 ensure_everything_running 函数（用 -startup + CREATE_NO_WINDOW + DETACHED_PROCESS 静默启动）
  - [x] SubTask 2.4: 在 search_with_everything 函数开头调用 ensure_everything_running

- [x] Task 3: 配置 WebView2 离线安装
  - [x] SubTask 3.1: 修改 tauri.conf.json 添加 webviewInstallMode: { type: "embedBootstrapper" }

- [x] Task 4: 清理 release/bin/ 目录遗留的 Everything.exe
  - [x] SubTask 4.1: 删除 target/release/bin/Everything.exe 和 target/debug/bin/Everything.exe

- [x] Task 5: 编译验证与单元测试
  - [x] SubTask 5.1: cargo check 通过（34.40s）
  - [x] SubTask 5.2: cargo test 全部通过（222 passed / 0 failed / 16 ignored）
  - [x] SubTask 5.3: npx tsc --noEmit 通过

- [x] Task 6: 重新打包 NSIS 安装包并复制到成品文件夹
  - [x] SubTask 6.1: npx tauri build 成功（Rust 编译 4m 27s + NSIS 打包）
  - [x] SubTask 6.2: 安装包已复制到成品文件夹（55.88 MB）

# Task Dependencies
- Task 2 依赖 Task 1（需要 Everything.exe 已内置）
- Task 5 依赖 Task 1-4
- Task 6 依赖 Task 5
