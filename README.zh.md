# douyin-video-downloader

[English](./README.md) | 中文

## 项目简介

面向创作者和内容研究者的 Agent Skill，把抖音视频、封面、直接音乐音频和创作者作品列表保存为可复用的本地文件。内置 Node.js 命令行工具与 SQLite 采集流程，Agent 可以查看链接信息、保存选定媒体，或先采集账号作品，再询问你下载哪些内容。

## 效果预览

![工作流程示意图：抖音链接生成本地视频、封面和直接音频；创作者主页先生成 SQLite 采集库及 JSON 或 CSV，再经确认批量下载](./assets/workflow.svg)

## 核心功能

| 能力 | 它能帮你做什么 |
|---|---|
| 单条视频下载 | 选择清晰度保存 MP4，并按需下载封面。 |
| 创作者主页采集 | 自动翻页，把作品信息存入 SQLite，导出 JSON 或 CSV。 |
| 确认后批量下载 | 从采集库下载选定的视频、封面或直接音频。 |
| 封面与直接音频 | 单独保存封面，或下载抖音提供的音乐地址，不从视频抽取音频。 |
| 传输校验与重试 | 检查 HTTP 传输完整性、非空文件和声明长度；对临时故障重试，保护已有文件。 |

## 安装

### 配置要求

通过 Agent 客户端安装和调用。单链接任务需要 Node.js 和网络访问，采集相关工具可在首次需要时准备。

| 项目 | 要求 |
|---|---|
| Agent 客户端 | Codex 或 Claude Code；已在 Codex 使用，尚未在本环境实测 Claude Code。 |
| 运行环境 | Node.js 18 或更高版本。 |
| 网络 | 能访问抖音页面和媒体地址。 |
| 采集数据库 | 数据库操作需要 SQLite 命令行工具。 |
| 浏览器采集 | 需要兼容的 Playwright CLI 包装器；必要时使用有效本地登录态。 |

已在 macOS 本地测试。Windows 路径与命令启动逻辑经过审查，但本环境未做原生 Windows 运行测试。浏览器采集需要适配对应系统的包装器。具体配置见[运行要求](./docs/runtime-requirements.md)。

### 快速安装

对 Agent 说：

```text
帮我安装 https://github.com/chemny/douyin-video-downloader，检查并补齐核心运行环境，再验证安装完成且能加载使用。浏览器采集工具等我需要采集时再准备。
```

Agent 应反馈安装位置、入口是否就绪，以及缺少的工具或权限。

## 快速开始

把抖音分享链接交给 Agent：

```text
帮我下载这个抖音视频和封面，告诉我文件保存在哪里：{抖音链接}
```

结果包括本地媒体文件和元数据 JSON。需要选择清晰度时，可以先让 Agent 查看候选信息。

## 使用示例

### 先采集账号作品，再决定下载范围

```text
采集这个抖音账号最多 100 条作品，导出 CSV，先不要下载视频：{创作者主页链接}
```

采集优先复用本地登录态，按游标顺序翻页并逐页保存。默认上限 100 条；`--limit 0` 不限制作品数，但仍有 1,000 页安全上限。分页异常或停滞时停止，后续页失败也会导出已保存结果。

### 从采集库选择批量下载

```text
先给我看采集到的作品，我确认一批，再按 1080p 下载视频和封面。
```

批量下载需要确认；每条至少间隔五秒，每成功下载十条视频询问是否继续。成功记录写入数据库，后续运行可跳过已完成项目。

### 单独保存封面或直接音乐音频

```text
帮我保存这个链接的原尺寸封面和直接音乐音频：{抖音链接}
```

直接音频依赖抖音音乐信息中提供的音频地址，不会从视频抽取音频。

### 直接使用命令行

```bash
node douyin-video.js info "https://v.douyin.com/example/"
node douyin-video.js download "https://v.douyin.com/example/" -o ./videos --quality best --cover-size medium
```

完整命令和选项见[命令契约](./docs/cli-contract.md)、[浏览器登录](./docs/browser-login.md)和[批量下载指南](./docs/batch-download.md)。

## 工作原理

- `SKILL.md` 说明 Agent 何时调用工具，以及哪些操作需要确认。
- `douyin-video.js` 解析链接、协调浏览器采集、保存 SQLite 数据并提供命令行入口。
- `lib/collect-pages.js` 检查分页衔接、数量上限和重复结果。
- `lib/reliable-download.js` 使用临时文件处理视频、封面和直接音频，最多尝试四次。
- `scripts/examples/` 提供 Shell 与 PowerShell 示例；`tests/` 覆盖离线回归，冒烟和发布检查验证包结构。

核心命令行代码随包提供。浏览器采集另需外部 Playwright 包装器，单链接下载和已有数据库操作不依赖该包装器。SQLite 流程需要 SQLite 命令行工具。

传输校验通过后才改为最终文件名；失败保留已有正式文件。重试从头开始，不提供跨进程断点续传、媒体解码检查或源站哈希验证。没有 Content-Length 时，HTTP 流结束不代表源站媒体本身一定完整。

采集保留原始响应，并导出 JSON 或 CSV。单条下载把视频、封面和音频路径合并写入 `*_metadata.json`。登录配置、数据库和媒体留在本地。遵守平台访问和版权规则，不绕过登录或验证。

## 目录结构

```text
douyin-video-downloader/
├── SKILL.md                      # Agent 使用说明
├── douyin-video.js               # 命令行入口
├── lib/
│   ├── collect-pages.js          # 分页辅助模块
│   └── reliable-download.js      # 传输校验与重试
├── docs/                         # 配置、命令、数据库及排错文档
├── scripts/
│   ├── examples/                 # Shell 与 PowerShell 示例
│   ├── smoke-test.mjs            # 包结构冒烟检查
│   └── publish-check.mjs          # 发布检查
├── tests/hardening.test.js       # 离线回归测试
├── assets/workflow.svg           # 工作流程示意图
├── README.md
├── README.zh.md
├── package.json
├── CHANGELOG.md
├── SECURITY.md
└── LICENSE
```

进一步阅读：[Agent 调用流程](./docs/agent-bootstrap.md)、[运行要求](./docs/runtime-requirements.md)、[命令契约](./docs/cli-contract.md)、[浏览器登录](./docs/browser-login.md)、[数据库](./docs/database.md)、[批量下载](./docs/batch-download.md)、[排错](./docs/troubleshooting.md)、[安全说明](./SECURITY.md)和[变更记录](./CHANGELOG.md)。

## 许可

项目代码采用 [MIT 许可](./LICENSE)。该许可不授予下载的第三方视频、音乐或图片的使用权。

## 关于我

项目维护于 [chemny/douyin-video-downloader](https://github.com/chemny/douyin-video-downloader)。可通过 [GitHub Issues](https://github.com/chemny/douyin-video-downloader/issues)反馈可复现的问题或改进建议。
