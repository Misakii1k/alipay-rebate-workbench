# Tasks

- [x] Task 1: 简化 everything.rs 模块（移除自动拉起逻辑）
- [x] Task 2: 移除 paths.rs 中的 get_everything_path 函数
- [x] Task 3: 移除 review.rs 和 video.rs 中的 ensure_everything_running 调用
- [x] Task 4: 删除内置 Everything.exe 二进制
- [x] Task 5: 编译验证与单元测试（cargo check 通过 / cargo test 218 passed / tsc 通过）
- [x] Task 6: 重新打包 NSIS 安装包并复制到成品文件夹

# 追加任务（用户反馈后追加）

- [x] Task 7: 修复 ffmpeg 子进程弹窗问题（CREATE_NO_WINDOW）
  - [x] SubTask 7.1: ffmpeg.rs 的 `run_process` 添加 CREATE_NO_WINDOW
  - [x] SubTask 7.2: ffmpeg.rs 的 powershell.exe 调用添加 CREATE_NO_WINDOW
  - [x] SubTask 7.3: ffmpeg.rs 的 `where` 命令添加 CREATE_NO_WINDOW
  - [x] SubTask 7.4: video.rs 的 ffmpeg spawn 添加 CREATE_NO_WINDOW
  - [x] SubTask 7.5: video.rs 的 taskkill 调用添加 CREATE_NO_WINDOW

- [x] Task 8: 视频渲染进度改为整数显示
  - [x] SubTask 8.1: video.rs 的 `last_percent` 在 emit 前 round 为整数

- [x] Task 9: 自动检测 GPU 并用于加速视频剪辑
  - [x] SubTask 9.1: ffmpeg.rs 新增 `detect_hwaccel` 函数（运行 `ffmpeg -hwaccels` 探测可用硬件加速器）
  - [x] SubTask 9.2: `get_ffmpeg_status` 返回 acceleration 字段时包含 GPU 信息（describe_hwaccel）
  - [x] SubTask 9.3: video.rs 的 `encoder_args` 在检测到 GPU 时添加 `-hwaccel auto` 参数
  - [x] SubTask 9.4: 在渲染日志中记录使用的硬件加速器便于排查

# Task Dependencies
- Task 7、8、9 互相独立，可并行实现
- Task 6 必须在所有代码改动完成后执行
