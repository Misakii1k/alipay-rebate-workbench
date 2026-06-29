# Checklist

## 代码改动验证
- [x] `everything.rs` 中已删除 `ensure_everything_running` 函数
- [x] `everything_test` 命令简化为执行 test 查询并返回 `{ available, detail }`
- [x] `review.rs` 的 `review_scan_assets` 已删除 ensure_everything_running 调用
- [x] `video.rs` 的 `video_scan_library` 已删除 ensure_everything_running 调用
- [x] `paths.rs` 已删除 `get_everything_path` 函数
- [x] 全局搜索 `ensure_everything_running` 无任何残留引用
- [x] 全局搜索 `get_everything_path` 无任何残留引用
- [x] `CREATE_NO_WINDOW` 标志在 everything.rs 所有 Command 调用处保留

## 二进制资源验证
- [x] `tauri-app/resources/bin/Everything.exe` 已删除
- [x] `tauri-app/resources/bin/es.exe` 保留
- [x] `tauri-app/resources/bin/ffmpeg.exe` 保留

## ffmpeg 弹窗修复验证
- [x] ffmpeg.rs 的 `run_process` 已添加 CREATE_NO_WINDOW
- [x] ffmpeg.rs 的 powershell.exe 短路径转换已添加 CREATE_NO_WINDOW
- [x] ffmpeg.rs 的 `where ffmpeg.exe` 已添加 CREATE_NO_WINDOW
- [x] video.rs 的 ffmpeg 渲染 spawn 已添加 CREATE_NO_WINDOW
- [x] video.rs 的 taskkill 已添加 CREATE_NO_WINDOW

## 进度整数显示验证
- [x] video.rs 的 `last_percent` 在 emit 前已 round 为整数

## GPU 自动检测验证
- [x] ffmpeg.rs 新增 `detect_hwaccel` 函数（运行 `ffmpeg -hwaccels`）
- [x] `get_ffmpeg_status` 的 acceleration 字段包含 GPU 信息（describe_hwaccel）
- [x] video.rs 的 `encoder_args` 在 GPU 可用时添加 `-hwaccel auto`
- [x] 渲染日志中记录使用的硬件加速器（hwaccel_info）

## 编译与测试验证
- [x] `cargo check` 通过（5.02s）
- [x] `cargo test` 全部通过（218 passed / 0 failed / 16 ignored）
- [x] `npx tsc --noEmit` 通过

## 打包与产物验证
- [x] `npx tauri build` 成功生成 NSIS 安装包（53.66 MB，2m 56s 编译完成）
- [x] 安装包已复制到 `成品` 文件夹（`C:\Users\87850\Desktop\新项目\成品\电商运营工具箱_1.0.5_x64-setup.exe`）
- [ ] 安装后启动应用，确认无 ffmpeg / Everything 弹窗
- [ ] 视频渲染进度显示为整数百分比
- [ ] FFmpeg 状态显示 GPU 加速信息（如 "GPU 加速：NVIDIA CUDA"）
