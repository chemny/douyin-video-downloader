---
name: douyin-video-downloader
description: Collect and download Douyin videos, cover images, direct music audio, and user-page video lists using a local Node.js CLI and SQLite. Use this skill when the user wants to parse a Douyin share link, inspect video quality or cover candidates, download MP4 video, download direct Douyin music audio, collect public creator post metadata, export JSON/CSV, or batch download videos, covers, and audio from a local collection database.
version: 0.2.0
metadata:
  openclaw:
    emoji: 🎵
---

# douyin-video-downloader Skill

本 skill 是一个本地 Node.js 抖音视频与直接音频下载工具。

## 功能

- 获取抖音视频信息
- 列出可用视频清晰度/码率候选
- 按指定清晰度下载 MP4
- 下载视频时同步下载封面图，默认选择中档尺寸
- 支持单独下载封面图
- 下载抖音音乐详情接口暴露的直接音频文件
- 从采集库批量下载直接音频
- 用本地 SQLite 采集库记录用户、列表页、视频、统计和音乐信息
- 自动打开用户主页并复用本地浏览器登录态采集列表
- 从采集库导出 JSON/CSV，或按批次下载库里的视频
- 默认尽量使用无水印播放地址

## 使用方法

先确定 `{SKILL_DIR}` 为本 `SKILL.md` 所在目录。

### 查看视频信息、清晰度和封面候选

```bash
node {SKILL_DIR}/douyin-video.js info "抖音分享链接" --cover-size medium
```

### 下载默认清晰度

```bash
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" -o ./videos
```

默认选择 `best`，即脚本能识别到的最高质量候选。

视频下载会同时下载封面图，并把视频、封面和 metadata 路径都写入 metadata JSON。

### 指定清晰度下载

```bash
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" --quality best -o ./videos
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" --quality 720p -o ./videos
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" --quality 0 -o ./videos
```

`--quality` 支持：

- `best`：最高质量
- `lowest`：最低质量
- `720p` / `1080p` 这类清晰度标签
- 数字序号：使用 `info` 输出中的候选序号
- `ratio`、`format`、`gear_name` 等候选标签的部分匹配

### 指定封面尺寸下载

```bash
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" --cover-size medium -o ./videos
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" --cover-size origin -o ./videos
node {SKILL_DIR}/douyin-video.js download "抖音分享链接" --cover-size 0 -o ./videos
node {SKILL_DIR}/douyin-video.js cover "抖音分享链接" --cover-size medium -o ./videos
```

`--cover-size` 支持：

- `medium`：默认，中档尺寸
- `small`：较小封面候选
- `large` / `best`：按返回宽高选择较大封面
- `origin`：原始封面字段
- `raw`：原始/未处理封面字段
- `dynamic` / `animated`：动态封面候选
- `gaussian` / `blur`：模糊封面候选
- 数字序号：使用 `info` 输出中的封面候选序号
- `none`：不下载封面

### 下载直接音频

```bash
node {SKILL_DIR}/douyin-video.js audio "抖音分享链接" -o ./audios
```

`audio` 命令会先解析视频对应的 `music.mid/id`，再请求抖音音乐详情接口获取 `music.play_url` 并下载原始音频文件。没有直接音频地址时会报错，不会从 MP4 中抽取音频。

视频、封面和音频命令会合并写入同一个 metadata JSON，不会因为后执行音频而覆盖之前的视频或封面文件路径。

### 创建 SQLite 采集库

```bash
node {SKILL_DIR}/douyin-video.js db-init --db ./douyin_collection.sqlite
```

采集库包含：

- `users`：用户资料
- `crawl_pages`：每次列表页接口响应
- `videos`：视频标题、链接、封面、时长、发布时间等
- `video_stats`：点赞、评论、收藏、转发、播放、下载等统计字段
- `music`：音乐 ID、标题、作者、时长、直接音频地址等
- `video_downloads`：后续批量下载的成功/失败状态、文件路径和错误信息
- `media_downloads`：音频等媒体文件的成功/失败状态、文件路径和错误信息

### 导入用户视频列表接口 JSON

用户主页列表通常需要登录态和抖音 Web 签名参数。先用浏览器打开用户主页并登录，再把 `/aweme/v1/web/aweme/post/` 接口响应体保存成 JSON 文件，然后导入：

```bash
node {SKILL_DIR}/douyin-video.js db-import-post-json \
  --db ./douyin_collection.sqlite \
  --input ./post_1036.json \
  --limit 100
```

默认规则：同一个用户列表只采集前 100 条视频信息。可以重复导入多个分页 JSON；同一个 `aweme_id` 会覆盖更新，不会重复插入；达到 100 条后继续导入分页只记录列表页响应，不再插入新视频。

采集完成后，必须告知用户已经抓取完毕，并询问是否开始下载。不能在采集完成后自动下载全部视频。

### 自动采集用户主页

```bash
node {SKILL_DIR}/douyin-video.js collect-user "抖音用户主页 URL" \
  --db ./douyin_collection.sqlite \
  -o ./collection \
  --account default \
  --limit 100
```

`collect-user` 会：

- 使用固定浏览器 profile；指定 `--account` 时使用 `~/.agents/douyin-video-downloader/accounts/<account>/browser-profile`
- 优先复用已有登录态；如果 `sessionid` / `sid_guard` 有效，就直接抓取
- 如果登录态不可用，打开浏览器并提示用户扫码登录
- 等用户登录后继续抓取 `/aweme/v1/web/aweme/post/`
- 保存原始接口 JSON、导入 SQLite，并导出 JSON/CSV
- 采集完成后只提示完成，不自动下载

### 检查登录状态

```bash
node {SKILL_DIR}/douyin-video.js check-login --account default
```

`check-login` 会打开或复用账号对应的浏览器 profile，并检查抖音登录 cookie 是否可用。登录有效时返回 0；未登录时返回 2，并提示用户在打开的浏览器里扫码登录。这个命令只检查登录状态，不采集、不下载。

可选参数：

```bash
--account default
--browser-session douyin-video-downloader
--profile-dir ~/.agents/douyin-video-downloader/browser-profile
--login-timeout 180
--reuse-session
```

`--account` 是推荐的账号隔离方式。没有指定 `--profile-dir` 时，账号名会自动映射到独立 browser profile；没有指定 `--browser-session` 时，账号名也会用于生成稳定 session 名称。`--browser-session` 会被规范为较短的安全名称，避免 Playwright CLI socket 路径过长。已有登录浏览器 session 时，可以加 `--reuse-session` 直接复用，不重新打开浏览器。

如果本机没有 Playwright CLI 运行环境，命令会提示安装依赖，不会自动安装。

### 导出采集库

```bash
node {SKILL_DIR}/douyin-video.js db-export --db ./douyin_collection.sqlite -o ./videos.json
node {SKILL_DIR}/douyin-video.js db-export --db ./douyin_collection.sqlite -o ./videos.csv --format csv
```

### 从采集库按批下载视频

```bash
node {SKILL_DIR}/douyin-video.js db-download-batch \
  --db ./douyin_collection.sqlite \
  -o ./videos \
  --quality best \
  --cover-size medium \
  --delay-seconds 5 \
  --confirm-every 10 \
  --download-limit 100
```

批量下载按采集库里的列表页地址顺序处理：第一个网址下载完成后，至少等待 5 秒，再打开第二个网址。下载地址、封面和 metadata 优先从 SQLite 中保存的列表接口 `raw_json` 生成，只有缺少原始数据时才回退到重新解析视频页。每个视频下载时默认同步下载中档封面，可用 `--cover-size` 选择其他封面尺寸。每成功下载 10 个视频后必须询问用户是否继续；用户确认继续后，才能继续下载。`--download-limit` 是本次命令的总下载上限。已成功下载的视频会记录在 `video_downloads` 表中，后续同一清晰度会跳过。

### 从采集库批量下载音频

```bash
node {SKILL_DIR}/douyin-video.js db-download-audio-batch \
  --db ./douyin_collection.sqlite \
  -o ./audios \
  --delay-seconds 5 \
  --download-limit 100
```

批量音频下载优先使用采集库 `music.play_url` 中的直接音频地址，不从视频抽取音频。下载状态记录在 `media_downloads` 表中；已成功下载的音频会跳过。每条音频之间至少等待 5 秒，`--download-limit` 是本次命令的总下载上限。

## 注意

- 下载和采集能力依赖抖音页面结构、Web 接口和 CDN 地址规则，平台调整后可能需要更新解析逻辑。
- 用户主页列表接口通常需要登录浏览器上下文；本 skill 不包含登录绕过逻辑。
- 音频下载只使用抖音音乐详情接口返回的直接音频地址，不会用 ffmpeg 从视频中抽取。
- 列表采集和视频下载是两个独立步骤；没有用户确认时，不执行批量下载。
- 下载进度默认每 5% 输出一次；需要更安静时可以加 `--quiet`。
