# Tauri 增强规划：ffmpeg 内置 + Everything 开箱即用 + 启动测试大模型 + 画质文案改造

> 状态：已确认决策，待执行
> 创建：2026-06-28
> 依赖：Tauri 迁移阶段 5 集成测试（进行中，updater 已修复，应用可启动）

---

## 已确认决策

| 决策点 | 选择 |
|---|---|
| Everything | 真正开箱即用（内置 Everything.exe + es.exe，启动时拉起服务） |
| 启动测试大模型 | 前端触发（App.tsx useEffect 调用 testModelConnection） |
| 默认画质 | 原画（保持 preserve，CRF 16，最高质量） |
| 画质文案改造 | 只改 UI 文案，底层 value 不变（零数据迁移） |

---

## 需求一：ffmpeg + Everything 内置，任意电脑开箱即用

### 1.1 现状问题

- `tauri-app/resources/bin/` 目录不存在，ffmpeg.exe / es.exe 都未内置
- `paths.rs` 路径解析全用相对路径（`PathBuf::from("resources")`），打包后 CWD 不固定，必然失败
- 未使用 Tauri 的 `app.path().resource_dir()` API
- 原版 Electron 用 `process.resourcesPath` + `path.join` 拼绝对路径，Tauri 版丢失了这层
- 原版只内置 es.exe，未内置 Everything.exe，依赖用户已安装服务 —— 本次要超越原版，真正开箱即用

### 1.2 二进制下载清单

| 文件 | 来源 | 体积 | 用途 |
|---|---|---|---|
| `ffmpeg.exe` | gyan.dev release essentials | ~97MB | 视频剪辑/渲染/诊断 |
| `es.exe` | voidtools.com ES 命令行客户端 | ~135KB | Everything 搜索 CLI |
| `Everything.exe` | voidtools.com Everything 便携版 | ~2MB | Everything 主程序/服务 |

全部放入 `tauri-app/resources/bin/`。

### 1.3 路径解析改造（核心）

**`paths.rs`** —— 改为绝对路径：

```rust
use tauri::{AppHandle, Manager};

pub fn get_resources_dir(app: &AppHandle) -> PathBuf {
    app.path().resource_dir()
        .unwrap_or_else(|_| PathBuf::from("resources"))
}

pub fn get_ffmpeg_path(app: &AppHandle) -> PathBuf {
    get_resources_dir(app).join("bin").join("ffmpeg.exe")
}

pub fn get_es_path(app: &AppHandle) -> PathBuf {
    get_resources_dir(app).join("bin").join("es.exe")
}

pub fn get_everything_path(app: &AppHandle) -> PathBuf {
    get_resources_dir(app).join("bin").join("Everything.exe")
}
```

**`ffmpeg.rs`** —— `bundled_ffmpeg_candidates(app)` 返回绝对路径：
1. `<resource_dir>/bin/ffmpeg.exe`（打包后）
2. `settings.ffmpegPath`（用户自定义）
3. `<exe_dir>/bin/ffmpeg.exe`（备用）

**`everything.rs`** —— `known_everything_candidates(app)` 返回绝对路径。

### 1.4 Everything 服务自动拉起

**`lib.rs` setup 钩子** 增加：

```rust
.setup(|app| {
    log::init_logger();
    paths::ensure_app_config_dir()?;

    // 自动拉起 Everything 服务（后台，不阻塞）
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = everything::ensure_everything_running(&app_handle).await {
            tracing::warn!("启动 Everything 服务失败: {}", e);
        }
    });

    Ok(())
})
```

**`everything.rs` 新增 `ensure_everything_running`**：

```rust
/// 确保 Everything 服务在后台运行。
/// 便携模式下以独立实例启动，避免与用户已安装的 Everything 冲突。
pub async fn ensure_everything_running(app: &AppHandle) -> Result<(), String> {
    // 1. 检查 Everything 进程是否已运行（通过 es.exe 测试）
    let es_path = paths::get_es_path(app);
    if test_everything_available(&es_path).await {
        return Ok(());  // 已运行，无需重复启动
    }

    // 2. 启动 Everything.exe 便携模式
    let everything_path = paths::get_everything_path(app);
    if !everything_path.exists() {
        return Err(format!("Everything.exe 不存在: {}", everything_path.display()));
    }

    // 便携模式参数：-instance 指定独立实例，避免与用户安装版冲突
    std::process::Command::new(&everything_path)
        .args(["-instance", "rebate-workbench"])
        .creation_flags(0x00000008)  // DETACHED_PROCESS
        .spawn()
        .map_err(|e| format!("启动 Everything 失败: {}", e))?;

    // 3. 等待服务就绪（轮询 es.exe，最多 15 秒）
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if test_everything_available(&es_path).await {
            return Ok(());
        }
    }
    Err("Everything 服务启动超时（15秒）".to_string())
}
```

### 1.5 命令签名变更

以下命令增加 `app: AppHandle` 参数（Tauri 自动注入，前端无感）：
- `ffmpeg::ffmpeg_status` / `ffmpeg_diagnose` / `ffmpeg_auto_fix`
- `video::video_scan_library` / `video_render_task`
- `everything::everything_test`

### 1.6 涉及文件

| 文件 | 改动 |
|---|---|
| `tauri-app/resources/bin/ffmpeg.exe` | 新增（下载） |
| `tauri-app/resources/bin/es.exe` | 新增（下载） |
| `tauri-app/resources/bin/Everything.exe` | 新增（下载） |
| `tauri-app/src-tauri/src/paths.rs` | 核心改造：resource_dir 绝对路径 + 新增 get_everything_path |
| `tauri-app/src-tauri/src/ffmpeg.rs` | 候选路径改绝对路径，透传 AppHandle |
| `tauri-app/src-tauri/src/everything.rs` | es.exe 路径改绝对路径 + 新增 ensure_everything_running |
| `tauri-app/src-tauri/src/video.rs` | 透传 AppHandle |
| `tauri-app/src-tauri/src/lib.rs` | setup 增加拉起 Everything 服务 |

### 1.7 风险

- Everything.exe 首次启动建立索引需扫描全盘，可能耗时 10-60 秒（取决于磁盘大小）
- 便携模式无需安装，但访问 NTFS USN Journal 需要管理员权限 —— 可能触发 UAC 提权
- 安装包体积增加：ffmpeg ~97MB + Everything ~2MB（NSIS 压缩后约 40-50MB 增量）

---

## 需求二：启动时自动测试大模型连接

### 2.1 方案：前端触发

在 `App.tsx` 启动 `useEffect` 中追加自动测试：

```typescript
const autoTestTriggered = useRef(false);

useEffect(() => {
  if (autoTestTriggered.current) return;
  autoTestTriggered.current = true;

  alipayWorkbench.loadSettings().then((loaded) => {
    const normalized = normalizeSettings(loaded);
    setSettings(normalized);
    setSettingsLoaded(true);

    // 启动时自动测试大模型连接
    const activeProfile = getActiveApiProfile(normalized);
    if (normalized.aiEnabled && activeProfile.apiKey) {
      setModelStatus({ state: "testing", detail: "启动时自动测试中…" });
      alipayWorkbench.testModelConnection(normalized)
        .then(setModelStatus)
        .catch(() => setModelStatus({ state: "failed", detail: "启动测试失败" }));
    } else {
      setModelStatus({ state: "unknown", detail: "未配置 API Key，请在设置中填写" });
    }
  });
}, []);
```

### 2.2 设计要点

- **空 key 短路**：api_key 为空时不发请求，显示"未配置"
- **AI 禁用短路**：ai_enabled = false 时跳过
- **不阻塞 UI**：`.then()` 异步链式
- **StrictMode 防护**：useRef 标记避免双调用
- **浏览器预览兼容**：main.tsx mock 返回 failed，自动兼容

### 2.3 涉及文件

| 文件 | 改动 |
|---|---|
| `tauri-app/src/App.tsx` | 启动 useEffect 追加自动测试（约 +10 行） |

---

## 需求三：画质文案改为"原画/超清/高清"

### 3.1 方案：只改 UI 文案，底层 value 不变

| value（不变） | 原文案 | 新文案 | FFmpeg 参数（不变） |
|---|---|---|---|
| `preserve` | 保真优先 | **原画** | libx264, slow, CRF 16 |
| `high` | 高清优先 | **超清** | libx264, medium, CRF 18 |
| `balanced` | 标准 | **高清** | libx264, veryfast, CRF 20 |

默认值保持 `preserve`（原画）。

### 3.2 改动点

仅改 `VideoWorkbench.tsx` 的 3 个 `<option>` 显示文案：

```tsx
<select value={settings.videoQualityMode} onChange={...}>
  <option value="preserve">原画</option>
  <option value="high">超清</option>
  <option value="balanced">高清</option>
</select>
```

零数据迁移，旧配置文件直接兼容。

### 3.3 涉及文件

| 文件 | 改动 |
|---|---|
| `tauri-app/src/VideoWorkbench.tsx` | 3 个 option 文案 |

---

## 执行顺序

1. **先打标签锁定当前状态**：`git tag v-tauri-stage5`（保证可回滚）
2. **需求三（画质文案）** —— 最简单，5 分钟
3. **需求二（启动测试大模型）** —— 简单，10 分钟
4. **需求一（ffmpeg + Everything 内置）**：
   - 4a. 下载三个二进制到 `resources/bin/`
   - 4b. 改造 `paths.rs`（resource_dir 绝对路径）
   - 4c. 改造 `ffmpeg.rs` / `everything.rs`（候选路径 + ensure_everything_running）
   - 4d. 改造 `video.rs`（透传 AppHandle）
   - 4e. 改造 `lib.rs`（setup 拉起 Everything）
   - 4f. 编译验证（cargo check + cargo test）
   - 4g. 启动应用验证（ffmpeg_status / ffmpeg_diagnose / everything_test）

## 验证清单

- [ ] cargo check 通过
- [ ] cargo test 全部通过（233 单元测试）
- [ ] npx tsc 类型检查通过
- [ ] vite build 构建成功
- [ ] npx tauri dev 启动应用
- [ ] 视频剪辑模块：FFmpeg 状态显示"可用"，诊断 9 项全通过
- [ ] 收评助手模块：Everything 测试返回"已就绪"
- [ ] 顶部状态徽章：启动后自动显示大模型连接状态
- [ ] 视频渲染工具条：画质下拉显示"原画/超清/高清"
- [ ] 干净环境验证（可选）：在未装 ffmpeg/Everything 的电脑上安装 NSIS 包，全部功能可用

## 回滚保障

- `git tag v-tauri-stage5` 锁定当前可运行状态（执行前）
- 每个需求独立 commit，可单独 revert
- 物理备份 `新项目-electron-backup/` + Git 分支 `legacy/electron` 保留
