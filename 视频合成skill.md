---
name: 视频合成
description: 视频合成工具。用户说"开始剪辑"时，从提供图片视频合成文件夹找最新匹配的图片作为封面图，图片名即搜索关键词去E:\A1素材视频\找视频，合成：封面图(1帧) + 视频(模糊填充至图片比例)，输出到Videos文件夹。找不到对应颜色时优先用黑色素材，其次选日期最新的。当用户说"开始剪辑"、"做视频"、"合成视频"、"剪视频"、"封面加视频"等时触发。
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ffmpeg *)
  - Bash(ffprobe *)
  - Bash(ls *)
  - Bash(python *)
  - Bash(find *)
  - Glob
---

# 视频合成

将封面图和视频合成为最终视频。封面图作为第1帧，后面拼接视频，视频画面用模糊背景填充至与图片相同的比例。

## 文件路径

- 用户图片目录：`C:\Users\Administrator\Desktop\提供图片视频合成\`（用户把图片放这里，图片名即输出文件名）
- 视频库：`E:\A1素材视频\`
- 输出位置：`C:\Users\Administrator\Videos\`（文件名=图片名，含后缀.mp4）

## 处理流程

### 第1步：用户说"开始剪辑"

用户说"开始剪辑 XXX"（XXX可能是模糊描述，如"百叶灰"、"天丝317黑"等）。

立即去 `C:\Users\Administrator\Desktop\提供图片视频合成\` 查找：
1. 按修改时间排序，最新的图片排前面
2. 按用户说的关键词模糊匹配文件名
3. 选出最匹配的那张图片
4. 将找到的图片展示给用户确认

用户确认后，图片的文件名（不含后缀）就是输出文件名，同时也是搜索视频的关键词。

### 第2步：搜索匹配视频

图片名即关键词（如"百叶317灰"），在 `E:\A1素材视频\` 中递归搜索匹配的视频。

支持的视频格式：`.mp4` `.mov` `.avi` `.mkv` `.webm`

搜索策略：
- 优先搜索与输出文件名+颜色匹配的视频（如输出名"百叶317灰"，搜含"百叶317"和"灰"的）
- **如果找不到对应颜色**，优先使用**黑色**素材（文件名含"黑"的）
- 其次选择**日期最新**的视频（按文件名中的日期编号，如 Y4.15 > Y3.28）
- 如果文件名中包含数字编号（如"NC103"），也搜索文件夹名

将搜索结果列出，让用户确认或选择。

### 第3步：获取图片尺寸

用 ffprobe 获取图片的宽高：
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 图片路径
```

### 第4步：FFmpeg 合成

使用 FFmpeg 执行固定效果：

```
图片(原比例1帧) → 拼接 → 视频(模糊填充至图片比例)
```

核心命令结构：
```bash
ffmpeg -i 图片.jpg -i 视频.mp4 \
  -filter_complex "
    [0:v]scale=W:H,setsar=1,format=yuv420p[img];
    aevalsrc=0:d=0.04:s=44100:c=stereo[img_a];
    [1:v]split[orig][bg];
    [bg]scale=W:H:force_original_aspect_ratio=increase,crop=W:H,boxblur=20[blurred];
    [orig]scale=W:H:force_original_aspect_ratio=decrease[fg];
    [blurred][fg]overlay=(W-w)/2:(H-h)/2[filled];
    [img][img_a][filled][1:a]concat=n=2:v=1:a=1[outv][outa]
  " \
  -map [outv] -map [outa] -movflags +faststart "C:\Users\Administrator\Videos\输出文件名.mp4"
```

**注意：必须用 `concat=n=2:v=1:a=1` 同时拼接视频和音频，再用 `-map [outv] -map [outa]` 映射两个流。** 封面图没有音轨，需要用 `aevalsrc=0` 生成一段静音音频（0.04秒=1帧）再 concat。只 `-map [a]` 会导致输出视频没有声音。

其中 W、H 为图片的宽和高。

### 第5步：输出结果

输出文件保存到 `C:\Users\Administrator\Videos\`，文件名为图片文件名（不含后缀）+ `.mp4`。
告诉用户文件位置和基本信息（分辨率、时长等）。

## 注意点

- 如果提供图片视频合成文件夹中有多张匹配的图片，选最新的那张，然后让用户确认
- 如果用户描述很模糊，列出所有可能匹配的图片让用户选
- 如果搜索到多个视频，必须列出来让用户选择，不要自作主张
- 封面图保持原比例显示，不拉伸变形
- 视频画面居中，模糊背景填充
- 如果视频库中没找到匹配的视频，告知用户并建议检查关键词
- 图片和视频文件可能包含中文路径或空格，FFmpeg 命令中要处理好引号
