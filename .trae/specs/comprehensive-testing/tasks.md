# 全面检测任务清单

## 阶段一：编译与静态检查（自动）

### Task 1.1 - Rust 编译检查
- 命令：`cd src-tauri; cargo check`
- 期望：退出码 0，允许 warning，无 error
- 实际状态：✅ 已通过（11 个 warning，无 error）

### Task 1.2 - Rust 单元测试
- 命令：`cd src-tauri; cargo test`
- 期望：所有非 ignored 测试通过
- 实际状态：✅ 已通过（226 passed, 16 ignored）

### Task 1.3 - TypeScript 类型检查
- 命令：`cd tauri-app; npx tsc --noEmit`
- 期望：退出码 0，无类型错误
- 实际状态：✅ 已通过

### Task 1.4 - 关键单测验证（中文搜索修复）
- 测试：`security::tests::test_sanitize_everything_query_keeps_chinese_chars`
- 期望：`sanitize_everything_query("红色产品 123") == "红色产品 123"`
- 实际状态：✅ 已通过

## 阶段二：前端 UI 行为（人工）

### Task 2.1 - 启动应用
- 命令：`cd tauri-app; npx tauri dev`
- 期望：应用窗口正常显示，标题栏「应用启动：电商运营工具箱 v1.0.5」
- 验证方法：观察主窗口

### Task 2.2 - 窗口控制按钮验证
- 操作：依次点击标题栏右侧三个按钮
  - 点击「最小化」→ 窗口最小化到任务栏
  - 点击「最大化/还原」→ 窗口在最大化和原始尺寸间切换
  - 点击「关闭」→ 窗口关闭，应用退出
- 期望：三个按钮都有响应，无卡死
- 风险点：CSS `-webkit-app-region: no-drag` 修复后应生效

### Task 2.3 - 设置页编码器下拉框
- 操作：进入「设置」→「视频批量剪辑」
- 期望：在「默认输出画质」下方出现「视频编码器」下拉框
- 选项验证：
  - 「自动（GPU 优先）」（value=auto）
  - 「强制 GPU」（value=gpu）
  - 「强制 CPU」（value=cpu）
- 期望：下拉框可选择且选择后立即保存（看底部「已自动保存 HH:MM:SS」）

### Task 2.4 - 编码器设置持久化
- 操作：选择「强制 GPU」→ 关闭应用 → 重新启动 → 进入设置页
- 期望：下拉框仍显示「强制 GPU」
- 验证方法：检查 `%APPDATA%\com.ecommerce-ops.toolbox\app_settings.json` 中 `videoEncoderMode` 字段为 `"gpu"`

## 阶段三：后端命令验证（人工 + 自动）

### Task 3.1 - Everything 服务检测
- 命令调用：`everything_test`
- 期望：返回 `{ success: true }` 或类似布尔值
- 验证方法：在收评助手或搜索相关功能中触发

### Task 3.2 - Everything 静默启动验证
- 操作：执行一次文件搜索（如收评助手搜索图片）
- 期望：
  - 任务管理器中可见 `Everything.exe` 进程
  - 全程无 Everything GUI 窗口弹出
  - 无控制台黑窗一闪而过
- 风险点：未加 `CREATE_NO_WINDOW` 或 `-hide` 参数会弹窗

### Task 3.3 - 中文关键词搜索
- 操作：在收评助手中搜索中文关键词（如「红色产品」、「夏季女装」）
- 期望：能返回文件名包含该关键词的文件
- 风险点：`sanitize_everything_query` 正则修复前会清空中文字符

### Task 3.4 - 英文关键词搜索
- 操作：搜索英文关键词（如「red」、「summer」）
- 期望：能返回匹配文件
- 对比：与中文搜索结果数量合理

### Task 3.5 - 混合关键词搜索
- 操作：搜索中英混合（如「红色 red」）
- 期望：空格分隔的多关键词都能命中

## 阶段四：视频剪辑 GPU 验证（人工）

### Task 4.1 - GPU 检测显示
- 操作：进入视频剪辑模块，查看 FFmpeg 状态
- 期望：状态栏显示「GPU 加速：NVIDIA CUDA」（或 QSV / AMF，取决于硬件）

### Task 4.2 - GPU 编码渲染（强制 GPU）
- 操作：设置「编码器」=「强制 GPU」→ 添加一个渲染任务 → 开始渲染
- 期望：
  - 渲染日志中出现 `-c:v h264_nvenc`（或 h264_qsv / h264_amf）
  - 渲染速度比 CPU 快
  - 输出文件可正常播放
- 风险点：`encoder_args` 修复前硬编码 `libx264`

### Task 4.3 - CPU 编码渲染（强制 CPU）
- 操作：设置「编码器」=「强制 CPU」→ 添加一个渲染任务 → 开始渲染
- 期望：
  - 渲染日志中出现 `-c:v libx264`
  - 渲染速度较慢但稳定
  - 输出文件可正常播放

### Task 4.4 - 自动模式渲染
- 操作：设置「编码器」=「自动（GPU 优先）」→ 渲染
- 期望：有 GPU 时使用 GPU 编码器，无 GPU 时回退 libx264

## 阶段五：模块功能回归（人工）

### Task 5.1 - 支付宝返款模块
- 验证点：
  - 导入：粘贴金额+备注文本能正确解析
  - 录入：自动读取剪切板、AI 识别账号姓名
  - 预览：表格显示所有行，重复项黄色高亮
  - 导出：能生成 Excel 文件

### Task 5.2 - 视频批量剪辑模块
- 验证点：
  - 视频库扫描：能扫描指定文件夹下所有视频
  - 模板选择：bos-template / video-slice 可切换
  - 渲染任务：能添加、渲染、查看进度
  - 进度显示：百分比显示为整数（非小数）

### Task 5.3 - 收评助手模块
- 验证点：
  - 图片搜索：能搜索本地图片
  - 文件夹展开：搜索结果文件夹可展开查看内部图片
  - AI 生成：能调用大模型生成评价文案

### Task 5.4 - 评价返款对比模块
- 验证点：
  - 名单导入：能导入 Excel/CSV
  - 匹配：自动匹配评价与返款
  - 差异标红：未匹配项红色高亮

### Task 5.5 - 设置模块
- 验证点：
  - API 配置：能保存 API Key、Base URL
  - 文件路径：能选择视频库、输出、收评根目录
  - 主题切换：深色/浅色切换正常
  - 字号切换：small/normal/large 切换正常

## 阶段六：打包验证（自动 + 人工）

### Task 6.1 - 构建 NSIS 安装包
- 命令：`cd tauri-app; npx tauri build`
- 期望：生成 `src-tauri/target/release/bundle/nsis/*.exe`
- 验证：文件大小在 55-60 MB 区间

### Task 6.2 - 安装包内容验证
- 操作：检查 NSIS 安装包内嵌资源
- 期望包含：
  - 主程序 `电商运营工具箱.exe`
  - `resources/bin/Everything.exe`
  - `resources/bin/es.exe`
  - `resources/bin/ffmpeg.exe`
  - WebView2 bootstrapper（嵌入）

### Task 6.3 - 全新电脑安装测试（可选，需新环境）
- 操作：在无 Rust / Node / WebView2 的全新 Windows 电脑上安装
- 期望：
  - 安装过程无报错
  - 自动安装 WebView2 Runtime
  - 启动后所有功能正常
  - 无任何 DLL 缺失错误

## 阶段七：回归与边界（人工）

### Task 7.1 - 无 GPU 环境验证
- 操作：在无独立显卡的设备上运行（或设置编码器=auto）
- 期望：自动回退到 libx264 软件编码

### Task 7.2 - 编码器模式非法值
- 操作：手动修改 `app_settings.json` 中 `videoEncoderMode` 为非法值（如 `"unknown"`）
- 期望：`normalizeVideoEncoderMode` 回退为 `"auto"`

### Task 7.3 - 旧设置文件兼容
- 操作：使用不含 `videoEncoderMode` 字段的旧 `app_settings.json`
- 期望：应用启动后默认填入 `"auto"`，不报错

### Task 7.4 - 空搜索关键词
- 操作：搜索框留空，点击搜索
- 期望：不崩溃，返回空结果或提示

### Task 7.5 - 超长搜索关键词
- 操作：输入超过 200 字符的关键词
- 期望：`sanitize_everything_query` 截断到 200 字符，不崩溃
