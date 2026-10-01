# 第 2 阶段设计：素材工具与转写

对应 hypit 的 `media`、`media-execution`、`yt-dlp`、`whisperx` / `provider-whisperx-local`、`transcribe` 命令。行为以 [research/06](../research/06-media-tooling.md) §2.1–2.8、§2.10 和 [research/03](../research/03-timeline-speech.md) §2.8（转写服务）为准。`capture` 与 `snapshot` 依赖浏览器，放到第 3 阶段与渲染一起做。

## 1. 结构

```text
src/tools/        types.ts（契约）index.ts（定位 + 运行外部程序）
src/media/        probe.ts cut.ts sample.ts（采样规则）frames.ts grid.ts（拼图与标签）boundaries.ts fetch.ts
                  transcript-types.ts（契约）transcript.ts（读取与校验）
src/asr/          本地转写服务的安装、启停、调用
services/asr/     Python 服务（WhisperX，本地 HTTP），代码只有这一份
src/cli/commands/ media/*.ts transcribe.ts setup.ts（命令与参数已在 main.ts 注册）
```

依赖方向不变：`cli → media/asr → tools → core`。`media` 不依赖 build；这些命令是即时的，不建 Build。

## 2. 外部程序（`src/tools`）

- 查找顺序：
  1. 环境变量 `DSIVIO_VIDEO_FFMPEG` / `_FFPROBE` / `_YT_DLP` / `_PYTHON`；
  2. Dsivio 内置运行时：`dsivio tools --json`，Dsivio 没在运行也能回答；
  3. PATH；
  4. 插件自管安装目录 `~/.dsivio-video/tools/<程序名>`。
- `dsivio` 命令的定位只有一处：`src/tools/dsivio.ts`，网关、doctor、paths 都用它。Windows 的 `dsivio.cmd` 会解析出真正的可执行文件，以便不经 shell 启动。
- 找不到时报 `TOOL_NOT_FOUND`，hint 给出环境变量名和安装方式。命令执行中从不临时下载。
- `runTool(工具名 | 已定位工具 | 绝对路径, args, options)`：
  - 不经 shell，stdin 默认关闭；只继承 PATH 及平台必需变量。
  - 默认超时 10 分钟，stdout 上限 256 MiB；可用 `onStdoutChunk` 流式读取并关闭收集（大量原始帧时用）。
  - 失败时报错：非零退出 `TOOL_FAILED`（带 stderr 末尾 8000 字符）、超时 `TOOL_TIMEOUT`、超出 stdout 上限 `TOOL_OUTPUT_LIMIT`。
  - 被取消报 `ABORTED`。
- `doctor`、`paths`、`setup status` 列出每个程序的路径、版本和来源。

## 3. 媒体命令

形态和参数已在 `src/cli/main.ts` 注册，行为按 research/06：
- `probe`、`cut`（含 `--keep` 拼接、`--label-time`）、`frames`、`tile`、`tiles`（含 `--ranges`、`--every-frame`）、`boundaries`、`fetch`、`prepare-fetch`。
- 输出不覆盖已有目标（`src/media/publish.ts` 是唯一负责人）：
  - 文件：先写同目录临时文件，再用硬链接发布。
  - 目录：先独占创建目标目录，再把暂存内容移进去；失败时删除自己创建的目标。目录内容是逐个出现的，不是一次性原子出现。
- `cut --label-time` 的时间标签用内建 5×7 点阵数字（放大 3 倍）逐帧生成 RGBA 原始流，由 ffmpeg 叠加在 (8,8)，不依赖字体。
- 拼图和转写标签用 `sharp` 渲染。它是插件的第一个运行时依赖（预编译二进制，带文字排版）。
- `prepare-fetch` 只检查找到的下载器能运行，报告其版本和路径；不建虚拟环境，也不强制某个版本（Dsivio 内置的是 2026.08.19）。

## 4. 转写

- 文档格式见 `src/media/transcript-types.ts`（`dsivio-video.transcript/1`）。缺测时间不写字段，不写 0。
- 网关能力 `transcribe`：
  - Dsivio 后端：等 Dsivio 提供 `dsivio media transcribe` 之后接入。
  - 本地后端：插件自己管理的 ASR 服务。
  - `transcribe` 命令先问 Dsivio 有没有这个能力，没有就用本地后端；两者都没有时报 `TRANSCRIBE_UNAVAILABLE`，并提示 `dsivio-video setup asr`。
- 本地 ASR 服务（`services/asr`）：
  - Python + WhisperX 3.8.6（要求 Python ≥3.10、<3.14），本地 HTTP 服务。协议 `dsivio-video.asr/1`，服务版本 0.1.0。接口：`GET /health`、`POST /transcribe {audio_path, language}`。
  - 默认 `small` 模型，CPU int8，batch 8；客户端每次核对协议、版本和这些配置，不一致就失败。
  - 一次只跑一个推理，忙时返回 503 BUSY；只读允许目录内的 16 kHz 单声道 WAV。
  - 推理时只读本地缓存，缺资源报 `RESOURCE_NOT_PREPARED`。
- `dsivio-video setup asr [--model small]`：
  - 用找到的 Python（优先 Dsivio 内置的 3.12）在 `~/.dsivio-video/asr/<服务版本>/` 建虚拟环境，按 `services/asr/requirements.txt` 安装固定版本依赖。
  - 下载模型、英文和中文的对齐权重以及 NLTK 数据。首次约 8 分钟，之后十几秒完成检查。
  - 锁文件在 macOS arm64 上实测过；Linux 和 Windows 尚未实测。
- `transcribe` 按需在随机回环端口启动服务（`~/.dsivio-video/asr/run.json` 记录），空闲后服务自行退出。
- 已知：中文 `small` 模型常输出繁体字（例如「今天我們來…」），与脚本的简体不一致。第 3 阶段对齐时需要按繁简等价匹配，不能要求字面相同。
- 将来在 Dsivio 模式下，由 Dsivio 用同一份 `services/asr` 代码安装和托管服务；插件只调用 `dsivio media transcribe`。

## 5. Dsivio 侧（本阶段）

- `dsivio tools [--json]`：在应用初始化前处理，输出内置运行时里 ffmpeg、ffprobe、yt-dlp、python、node 的绝对路径，不需要 Dsivio 在运行。
- 比例问题已查明，不在 Dsivio：Dsivio 对 1K + 9:16 正确地发出了 864×1536（`image_providers.rs`）；xAI 视频请求也带了 `aspect_ratio`。实际服务这两个模型的是中转 ybw-ai.com（Sub2API），它忽略尺寸参数（上游 issue Wei-Shaw/sub2api#3302）。Dsivio 只加了请求映射的回归测试，没有为特定中转域名写特判。
