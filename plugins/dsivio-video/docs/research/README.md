# hypit 调研（净室规格）

这些文件描述 hypit 的行为，用于让 dsivio-video 在功能和流程上与之对齐。写代码的人只读这里，不读 hypit 源码；这里不含 hypit 的代码或原文。词汇已换成 dsivio-video 的：`.dvml` / `.dvs` / `.dvrun`、CLI `dsivio-video`、结果目录 `.dsivio-video/`。

| 文件 | 范围 |
|---|---|
| [01-markup-source.md](01-markup-source.md) | 标记语言、import、引用、Script 行内标记、`.dvs` 配方、展开成作品图、`check`、`vocabulary`、工作区边界 |
| [02-plan-build-runtime.md](02-plan-build-runtime.md) | `.dvrun`、Target/Candidate、规划与剪枝、构建定义、Worker 与 SQLite、异步生成与回执、结果目录、`plan`/`build`/`status`/`inspect`/`get`/`history`/`cancel` |
| [03-timeline-speech.md](03-timeline-speech.md) | Script 与转写对齐成语义 Take、Timeline 与锚点、帧运算、Normalize、`measure`、`transcribe` 与 WhisperX 服务 |
| [04-composition-render.md](04-composition-render.md) | 画布与 Frame、Film 分层、Visual IR、转成 HyperFrames HTML、Chrome 渲染、48 kHz 混音与合成、`snapshot`、字体 |
| [05-tracks-components.md](05-tracks-components.md) | 18 个组件（字幕、文字、画面、声音、表演、排行榜、贴纸、抠像等）的元素、属性、输出和时序规则 |
| [06-media-tooling.md](06-media-tooling.md) | `media probe/cut/frames/tile/tiles/boundaries/fetch`、`capture`、OpenCV 服务、yt-dlp，以及对应到 Dsivio 内置运行时 |
| [07-skill-and-references.md](07-skill-and-references.md) | Skill 结构、角色与硬规则、64 篇参考文档逐篇说明、示例工程、写作格式、我们的参考目录建议 |
| [08-studio.md](08-studio.md) | Studio 启动、页面与面板、写回源文件、评论、组件编辑器契约、在 Dsivio 中的承载选项 |
| [09-models-and-dsivio-gap.md](09-models-and-dsivio-gap.md) | hypit 各模型的参数表、语音模型、与 `dsivio media` 的逐项差距、通用模型能力描述建议 |

每篇第 6 节是待定问题，架构定稿前需要逐条决定。
