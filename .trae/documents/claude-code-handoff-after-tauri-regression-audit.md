# Claude Code Handoff: Tauri 迁移后回归审查与修复

## 接手背景

项目刚完成从 Electron 架构到 Tauri 架构的迁移。迁移后已经可以构建，但用户反馈实际功能里还有很多不可用或有问题的地方。当前任务不是恢复旧架构，而是在 Tauri 版本中全面对齐迁移前正式版的可用效果。

当前 Tauri 工作目录：

```text
C:\Users\87850\Desktop\新项目\tauri-app
```

迁移前稳定基线：

```text
v-electron-final
legacy/electron
C:\Users\87850\Desktop\新项目\electron
```

## 重要红线

- 标题优化功能已经被用户明确清除，不需要恢复。
- 不要恢复 `TitleOptimizer.tsx`、`titleOptimizer.ts`、`titleKeywordData.ts`，也不要重新加入标题优化入口、设置项或 API。
- 如果旧文档仍提到标题优化，只把它当作历史信息，不作为本轮目标。
- 工作树已有大量脏改，不能 `git reset --hard`，不能回滚不属于你的改动。

## 当前已知状态

已做过的基础验证：

```powershell
cd C:\Users\87850\Desktop\新项目\tauri-app
npm run build
```

结果：通过。

```powershell
cd C:\Users\87850\Desktop\新项目\tauri-app\src-tauri
cargo check
```

结果：通过，仅有 warnings。

注意：这只证明构建和 Rust 静态检查可过，不证明功能完整可用。

## 最近保留的一处小修复

Tauri 原生拖放路径处理已经补上，用于修复 WebView 下拖入文件时拿不到真实本地路径的问题。

涉及文件：

```text
tauri-app/src/lib/tauri-bridge.ts
tauri-app/src/VideoWorkbench.tsx
tauri-app/src/main.tsx
```

核对点：

- `tauri-bridge.ts` 中应有 `consumeRecentDropPaths`。
- `VideoWorkbench.tsx` 的上传/拖放区域应优先消费 Tauri 最近拖放路径。
- `main.tsx` 的浏览器 mock 需包含对应方法，避免 web 预览报错。

## Claude Code 首要任务

先做完整的迁移回归审查，再修复。不要只看能否编译，要按正式版实际使用路径逐项走通。

### 1. API 对齐审查

对比：

```text
electron/preload.ts
tauri-app/src/lib/tauri-bridge.ts
tauri-app/src-tauri/src/lib.rs
```

要求：

- 前端所有 `window.alipayWorkbench` 调用在 Tauri bridge 中都有等价实现。
- Tauri 后端所有 command 都已在 `invoke_handler` 注册。
- 参数、返回值、错误语义尽量对齐 Electron 正式版。
- 浏览器 mock 不应掩盖 Tauri 缺失 API。

### 2. 支付宝返款主流程

按正式版效果验证并修复：

- 导入 Excel/表格数据。
- 识别姓名、账号、金额、备注。
- 云端 AI 校验或识别流程可用。
- 预览和导出 Excel 可用。
- 导出的模板、列、格式与正式版一致。
- 中文路径、桌面路径、含空格路径可用。

### 3. 视频批量剪辑

按正式版效果验证并修复：

- 视频库扫描可用。
- 文件选择、文件夹选择、拖放都可用。
- 模板渲染可启动、可取消、可输出可播放视频。
- 进度、日志、错误提示准确。
- GPU/CPU 编码模式设置可保存、可读取。
- GPU 失败或超时后应能回退 CPU。
- 日志应能看出真实 encoder：`h264_nvenc`、`h264_qsv`、`h264_amf` 或 `libx264`。

### 4. 收评助手

按正式版效果验证并修复：

- 图片根目录扫描可用。
- 缩略图正常展示。
- 本地图片搜索可用。
- AI 文案生成可用。
- 拖入文件/图片路径可识别。
- 中文关键词、单字数字、混合关键词均可搜索。

### 5. 评价返款对比

按正式版效果验证并修复：

- 名单导入可用。
- 匹配逻辑可用。
- 去重逻辑可用。
- 差异标记与提醒弹窗可用。
- 导出/复制结果可用。

### 6. 设置与持久化

按正式版效果验证并修复：

- API 配置保存、重启后仍在。
- 文件路径保存、重启后仍在。
- 视频编码器模式保存、重启后仍在。
- 设置文件结构与前端类型一致。
- 不应出现旧标题优化相关设置恢复。

## Everything 搜索专项

用户之前要求回到经典 Everything 模型：

- 使用 `es.exe`。
- 不自动接管、强杀或关闭用户自己的 Everything，除非用户另有明确要求。
- Everything 不可用时，`review.rs` / `video.rs` 应该 walkdir 降级。
- 测试中文、单数字、英文、混合关键词。

重点检查：

```text
tauri-app/src-tauri/src/everything.rs
tauri-app/src-tauri/src/review.rs
tauri-app/src-tauri/src/video.rs
tauri-app/src-tauri/src/security.rs
.trae/specs/revert-to-classic-everything-search/
```

## FFmpeg/GPU 专项

重点检查：

```text
tauri-app/src-tauri/src/ffmpeg.rs
tauri-app/src-tauri/src/video.rs
.trae/documents/fix-gpu-encoding-and-everything-cleanup.md
```

要求：

- 检测编码器应基于 `ffmpeg -encoders`，不是只看 `-hwaccels`。
- 硬件编码不可用时要明确回退 CPU。
- 渲染等待、取消、超时不能卡死。
- 日志要包含足够信息用于判断实际编码器。

注意：旧 GPU/Everything 文档在终端里可能显示乱码，以本 handoff 的要求为准，再结合源码核对。

## 建议验证命令

```powershell
cd C:\Users\87850\Desktop\新项目\tauri-app
npm run build
```

```powershell
cd C:\Users\87850\Desktop\新项目\tauri-app\src-tauri
cargo check
cargo test
```

可选最终打包：

```powershell
cd C:\Users\87850\Desktop\新项目\tauri-app
npm run tauri:build
```

如果打包完成，还要安装/运行产物并检查资源是否随包可用：

```text
ffmpeg.exe
es.exe
Excel 模板
WebView2 相关配置
```

## 建议工作顺序

1. 先运行 `git status --short` 和 `git diff --stat`，确认当前脏改范围。
2. 阅读本 handoff，然后阅读 `TRANSFER.md`、`.trae/specs/comprehensive-testing/spec.md`、`.trae/specs/revert-to-classic-everything-search/spec.md`。
3. 做 API parity 表：Electron preload 方法、Tauri bridge 方法、Rust command 注册三列对齐。
4. 先补缺失 bridge/command，再逐模块跑真实用户流程。
5. 每修一个模块都跑 `npm run build` 和 `cargo check`，高风险后端改动再跑 `cargo test`。
6. 最后做一次桌面应用人工验收，确认正式版核心功能都能用。

## 交接给 Claude Code 的一句话

请在 Tauri 版本中继续完成迁移后的完整回归审查和功能修复，以 `v-electron-final` / `legacy/electron` 的正式版可用效果为基线；标题优化已经明确移除，不要恢复。
