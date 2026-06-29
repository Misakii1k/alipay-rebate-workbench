# 修复 GPU 编码卡死 + 关闭程序时自动退出 Everything

## 摘要

两个问题：
1. **GPU 加速剪辑仍然无法使用，且会卡死** — 根因有 6 个，需要逐一修复
2. **每次关闭程序后自动关闭 Everything** — 当前完全无退出清理机制

## 当前状态分析

### GPU 编码问题根因（基于代码探索）

| # | 根因 | 位置 | 影响 |
|---|------|------|------|
| G1 | 编码器检测用 `-hwaccels`（列出**解码**方法），而非 `-encoders`（列出**编码器**）。`cuda` 出现不代表 `h264_nvenc` 已编译 | `video.rs:737-740` + `ffmpeg.rs:38-64` | 检测到 GPU 但实际编码器可能不可用 |
| G2 | 缺少 `-hwaccel_output_format nv12`。`-hwaccel auto` 解码后帧留在 GPU 内存（cuda 像素格式），CPU 滤镜链（scale/overlay/concat/boxblur）无法处理 | `video.rs:775-781` | 滤镜链报错，渲染失败 |
| G3 | `run_ffmpeg` 在 stderr 循环退出后，`stdout.read_to_string()`（line 612）和 `child.wait()`（line 619）**无超时阻塞**。超时检查只在 stderr 循环内（line 600），stderr 一旦关闭就绕过 | `video.rs:608-623` | 进程卡死，永不返回 |
| G4 | GPU→CPU 回退触发条件太窄，只匹配 `"error while opening encoder"` | `video.rs:1162-1165` | 其他 GPU 错误（滤镜失败、内存不足等）不触发回退 |
| G5 | 阶段标签永远显示 `"剪辑中（CPU 多线程：N 线程）"`，即使 GPU 编码中 | `video.rs:1158` | 用户无法判断是否在用 GPU |
| G6 | `detect_hwaccel` 每次渲染调用 3 次（`has_hwaccel` + `detect_hwaccel` 在 run_ffmpeg + `detect_hwaccel` 在 encoder_args），每次 spawn 一个 ffmpeg 子进程，且 `cmd.output()` 无超时 | `video.rs:522-527,737` + `ffmpeg.rs:45` | 渲染变慢，且 ffmpeg 挂起时永久阻塞 |

### Everything 退出清理问题根因

| # | 根因 | 位置 |
|---|------|------|
| E1 | Everything.exe 以 `DETACHED_PROCESS` 标志启动，脱离父进程，app 退出后继续运行 | `everything.rs:178` |
| E2 | `Child` 句柄 spawn 后立即丢弃，无法后续 kill | `everything.rs:182` |
| E3 | 代码库中**无** kill/stop Everything 的函数 | `everything.rs` 全文 |
| E4 | `lib.rs` 的 Tauri Builder 只注册了 `.setup()`，**无** `.on_window_event()`，**无** `RunEvent::Exit` 处理 | `lib.rs:39-50,114` |

## 提议变更

### 第一部分：修复 GPU 编码（video.rs + ffmpeg.rs）

#### 变更 1.1：编码器检测改用 `-encoders` 替代 `-hwaccels`

**文件**: `ffmpeg.rs`
- 新增 `pub fn detect_gpu_encoders(ffmpeg_path: &str) -> Vec<String>` 函数
  - 执行 `ffmpeg -hide_banner -encoders`
  - 解析输出，返回已编译的编码器列表（小写），如 `["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]`
  - 用 `wait_child_with_timeout` 加 10 秒超时（复用现有 `run_process` 函数，它已有 15 秒超时）
  - 实际上可以直接复用现有的 `read_ffmpeg_encoders`（`ffmpeg.rs:342`）逻辑，但把它改成同步公开函数

**文件**: `video.rs` — `encoder_args` 函数（~line 737-740）
- 将：
  ```rust
  let hwaccels = ffmpeg::detect_hwaccel(ffmpeg_path);
  let has_nvenc = hwaccels.iter().any(|h| h == "cuda");
  let has_qsv = hwaccels.iter().any(|h| h == "qsv");
  let has_amf = hwaccels.iter().any(|h| h == "amf");
  ```
- 改为：
  ```rust
  let encoders = ffmpeg::detect_gpu_encoders(ffmpeg_path);
  let has_nvenc = encoders.iter().any(|e| e == "h264_nvenc");
  let has_qsv = encoders.iter().any(|e| e == "h264_qsv");
  let has_amf = encoders.iter().any(|e| e == "h264_amf");
  ```
- **原因**: `-hwaccels` 列出解码加速方法（cuda/d3d11va/qsv），不等于编码器可用。`-encoders` 直接列出编译的编码器，可靠。

#### 变更 1.2：添加 `-hwaccel_output_format nv12`

**文件**: `video.rs` — `hwaccel_input_args` 函数（~line 775-781）
- 将：
  ```rust
  vec_into_strings(&["-hwaccel", "auto"])
  ```
- 改为：
  ```rust
  vec_into_strings(&["-hwaccel", "auto", "-hwaccel_output_format", "nv12"])
  ```
- **原因**: 不加此参数，硬件解码的帧留在 GPU 内存（cuda 像素格式），CPU 滤镜链（scale/overlay/concat/boxblur）无法处理，导致渲染失败或卡死。`nv12` 是兼容 CPU 滤镜的通用格式。

#### 变更 1.3：修复 `run_ffmpeg` 死锁

**文件**: `video.rs` — `run_ffmpeg` 函数（~line 608-623）
- 将阻塞的 `stdout.read_to_string()` 和 `child.wait()` 替换为带超时的等待
- 具体改法：
  ```rust
  // 读取 stdout（非阻塞，用 try_wait + 短超时）
  // 不再 read_to_string，因为 FFmpeg 输出主要在 stderr
  // stdout 通常为空，跳过即可

  // 等待退出（带超时，复用 ffmpeg::wait_child_with_timeout）
  let exit_status = match ffmpeg::wait_child_with_timeout_pub(&mut child, MAX_FFMPEG_RENDER_MS) {
      Ok(s) => s,
      Err(_) => {
          let _ = child.kill();
          let _ = child.wait();
          log = append_limited_log(&log, "\nFFmpeg 等待退出超时，已强制终止");
          break_exit_code = -1;
      }
  };
  ```
- 需要在 `ffmpeg.rs` 中把 `wait_child_with_timeout` 改为 `pub` 或新增公开包装函数
- **原因**: 当前 stderr 循环退出后，stdout 读取和 child.wait() 无超时，进程挂起时永久阻塞。这是"卡住"的直接原因。

#### 变更 1.4：扩大 GPU→CPU 回退触发条件

**文件**: `video.rs` — `render_video_task`（~line 1162-1165）
- 将：
  ```rust
  && result.log.to_lowercase().contains("error while opening encoder")
  ```
- 改为匹配多种 GPU 错误签名：
  ```rust
  && {
      let lower = result.log.to_lowercase();
      lower.contains("error while opening encoder")
      || lower.contains("not an nvenc capable device")
      || lower.contains("no capable devices found")
      || lower.contains("failed to create cuda")
      || lower.contains("failed to create d3d")
      || lower.contains("cannot allocate")
      || lower.contains("pixel format")
      || lower.contains("initial avcodec")
      || lower.contains("device or resource busy")
      || lower.contains("out of memory")
      || lower.contains("filter")
  }
  ```
- 同时：如果 GPU 渲染**超时**（卡死被强制终止），也触发回退。检查 `result.error` 是否包含 "超时" 或 "timed out"
- **原因**: 当前只匹配一种错误信息，其他 GPU 失败（滤镜失败、内存不足、设备不可用等）不触发回退。

#### 变更 1.5：缓存硬件加速检测结果

**文件**: `video.rs` — `render_video_task`
- 在渲染开始时调用一次 `ffmpeg::detect_gpu_encoders(ffmpeg_path)` 和 `ffmpeg::has_hwaccel(ffmpeg_path)`
- 将结果作为参数传给 `encoder_args` 和 `hwaccel_input_args`，避免在 `run_ffmpeg` 和 `encoder_args` 中重复调用
- **原因**: 当前每次渲染 spawn 3 个 ffmpeg 子进程检测硬件加速，拖慢渲染且可能挂起。

#### 变更 1.6：修正阶段标签

**文件**: `video.rs` — `render_video_task`（~line 1158）
- 将：
  ```rust
  let stage_label = format!("剪辑中（CPU 多线程：{} 线程）", cpu_threads());
  ```
- 改为根据编码器模式显示：
  ```rust
  let stage_label = match settings.video_encoder_mode.as_str() {
      "cpu" => format!("剪辑中（CPU 编码：{} 线程）", cpu_threads()),
      "gpu" => "剪辑中（GPU 硬件编码）".to_string(),
      _ => format!("剪辑中（GPU 优先，CPU {} 线程备用）", cpu_threads()),
  };
  ```
- **原因**: 当前永远显示 "CPU 多线程"，用户无法判断是否在用 GPU。

#### 变更 1.7：给 `detect_hwaccel` / `detect_gpu_encoders` 加超时

**文件**: `ffmpeg.rs`
- `detect_hwaccel` 当前用 `cmd.output()` 无超时 → 改用 `run_process`（已有 `wait_child_with_timeout`）
- 新增的 `detect_gpu_encoders` 也用 `run_process` 带 10 秒超时
- **原因**: ffmpeg 挂起时（驱动冲突、GPU 冷启动），`cmd.output()` 永久阻塞。

### 第二部分：关闭程序时自动退出 Everything（everything.rs + lib.rs）

#### 变更 2.1：新增 `stop_everything` 函数

**文件**: `everything.rs`
- 新增公开函数：
  ```rust
  /// 关闭 Everything 服务（在应用退出时调用）。
  /// 使用 taskkill /F /IM Everything.exe 强制终止所有 Everything 进程。
  pub fn stop_everything() {
      let mut cmd = Command::new("taskkill");
      cmd.args(["/F", "/IM", "Everything.exe"]);
      #[cfg(windows)]
      {
          cmd.creation_flags(CREATE_NO_WINDOW);
      }
      let _ = cmd.output();  // 等待完成，忽略结果
  }
  ```
- **原因**: 当前无任何 kill Everything 的函数。用 `taskkill /F /IM` 是最可靠的方式，能终止所有 Everything 实例（包括托盘模式）。
- **注意**: 这会终止用户系统上所有 Everything.exe 进程（包括用户自己启动的）。用户明确要求此行为。

#### 变更 2.2：注册应用退出处理器

**文件**: `lib.rs` — `run` 函数
- 将：
  ```rust
  .run(tauri::generate_context!())
  .expect("error while running tauri application");
  ```
- 改为：
  ```rust
  .build(tauri::generate_context!())
  .expect("error while building tauri application")
  .run(|_app_handle, event| {
      if let tauri::RunEvent::Exit = event {
          // 应用退出时关闭 Everything 服务
          everything::stop_everything();
      }
  });
  ```
- **原因**: 当前无退出处理器，Everything.exe 以 DETACHED_PROCESS 启动后永不退出。`RunEvent::Exit` 在应用事件循环结束时触发，是清理的最佳时机。

## 假设与决策

### 假设
1. FFmpeg 内置版本支持 `-hwaccel_output_format` 参数（FFmpeg 4.0+ 均支持）
2. Tauri 2.x 的 `RunEvent::Exit` 事件在应用退出时可靠触发
3. `taskkill /F /IM Everything.exe` 在所有目标 Windows 系统上可用

### 决策
1. **编码器检测用 `-encoders` 而非 `-hwaccels`** — 更可靠，直接反映编码器可用性
2. **`-hwaccel_output_format nv12`** — 兼容 CPU 滤镜链的通用格式，不需要额外的 hwdownload/hwupload 滤镜
3. **`taskkill /F /IM`** 而非存储 Child 句柄 — 更简单可靠，能终止所有 Everything 实例
4. **`RunEvent::Exit`** 而非 `on_window_event` — 覆盖所有退出路径（窗口关闭、进程终止等）
5. **回退触发条件包含超时** — GPU 渲染卡死被强制终止后也自动回退 CPU

## 验证步骤

### 编译验证
- `cd src-tauri; cargo check` 退出码 0
- `cd src-tauri; cargo test` 全部通过
- `cd tauri-app; npx tsc --noEmit` 退出码 0

### 功能验证（人工）
1. **GPU 编码**：设置「强制 GPU」→ 渲染一个视频 → 日志应出现 `h264_nvenc`，不再卡死，输出文件可播放
2. **CPU 编码**：设置「强制 CPU」→ 渲染 → 日志出现 `libx264`
3. **GPU 回退**：如果 GPU 不可用 → 自动回退 CPU，日志提示 "GPU 编码失败，已自动回退 CPU"
4. **阶段标签**：GPU 模式应显示 "GPU 硬件编码"，不再显示 "CPU 多线程"
5. **Everything 退出**：关闭应用 → 任务管理器中 Everything.exe 进程消失
6. **搜索功能**：重启应用后搜索功能正常（Everything 会重新静默启动）

### 打包验证
- `npx tauri build` 生成新 NSIS 安装包
- 安装包大小在 55-60 MB 区间
