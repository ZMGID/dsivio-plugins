# 模型端口、创作套件与 Dsivio 能力差距

## 1. 概述

本规格覆盖指定的图像、视频、语音、抠像模型包及 WhisperX 的端口层；同时核对 Dsivio 当前媒体 CLI、实际参数反序列化和能力目录。文中的原模型名、元素局部名和端口名用于识别研究事实，不是建议复制这些模型包。新插件统一使用 `gen:Image` / `gen:Video`，必须明确写 `model="供应商/模型ID"`，以运行中 Dsivio 返回的能力校验，不能从模型昵称推断接口。

原系统将模型语义与服务实现分开：模型包描述输入、约束及产物；生成调用输出有序媒体集合；作者元素通常只发布第一项为 `<id>.image`、`<id>.video` 或语音资源。参考文件始终是图中的 Artifact 边，不放进提示词模板或标量草稿。模型包不持有账户、服务 URL、队列或重试逻辑。dsivio-video 应保留这种分层，但付费执行只能通过 `dsivio media`；不迁入原系统的网关、凭证及 Runtime Profile endpoint bindings。

**关键差距**：`--options-json` 不是任意厂商参数通道。CLI 虽会合并 JSON，但当前云图和视频结构均拒绝未知字段。`outputFormat`、`nsfwCheck`、`webSearch`、`seed` 等不能因为有这个参数就宣称可用。图像扩展字段与视频扩展字段均须由 Dsivio 真实支持和公开描述。

## 2. 行为规格

### 2.1 通用输入、输出与错误规则

下表的“必”表示最终模型请求必须给一个值；“可”表示省略有语义，不能用空数组或擅自补值代替。标量每个端口最多一个值。`Text(N)` 指非空字符串，上限按原实现 JavaScript 字符串长度计算；没有 N 表示包未声明固定上限，不代表服务无限制。媒体端口使用 BlobArtifact，须有相应 `image/`、`video/` 或 `audio/` MIME。引用必须是完整值引用，不能是字符串拼接。`id` 是作者标识，不是模型端口。

- 元素拒绝未知属性、错误类型、缺失必填、枚举外值、非整数或越界数值、错误子元素、非允许的正文、无法解析的引用以及超量参考。
- 媒体引用的已知作者记录可在编译时校验 MIME；生产结果尚未就绪时保留依赖边，取得产物后再校验实际请求，不能省去该检查。
- 原请求内部以端口数组表达值；即使端口可选，一旦出现至少要有一个值。`false` 仍算“出现”，所以互斥规则按字段存在判断，不是只在开关为 true 时判断。
- 文本、媒体边可以后接入草稿；草稿通过不意味着最终请求全部必填已齐全。
- 下列图像模型公开输出均为 `image: BlobArtifact`，视频模型均为 `video: BlobArtifact`，底层分别返回有序生成图像集/视频集。第一项投影不是“模型永远只返回一项”的保证。
- 错误应带元素/模型、端口或参考下标、实际值及允许值/数量，作者定位信息应保留。新插件不可静默删除不支持字段、换模型、降分辨率或改变安全策略。

### 2.2 Seedance：四个精确变体

元素为 `TextVideo`、`FrameVideo`、`ReferenceVideo`，四个变体共享这些形状。作者 model 选择接受 standard/fast/mini/2.5 或各完整模型名。新插件不保留这些别名作为执行模型 ID。

| 模型端口 | 类型、必填及取值 |
| --- | --- |
| prompt | 必，Text；2/fast/mini 上限 20,000，2.5 上限 30,000 |
| referenceImage | 可，图像 0–9；2.5 为 0–30 |
| referenceVideo | 可，视频 0–3；2.5 为 0–10 |
| referenceAudio | 可，音频 0–3；2.5 为 0–10 |
| firstFrame / lastFrame | 各可，图像 0–1 |
| resolution | 必；2 为 480p/720p/1080p/4k；fast、mini 为 480p/720p；2.5 为 480p/720p/1080p |
| aspectRatio | 必；1:1、4:3、3:4、16:9、9:16、21:9、adaptive |
| duration | 必；2/fast/mini 为整数 4–15 秒；2.5 为 -1（自动）或整数 4–30 秒 |
| generateAudio / webSearch | 各必，布尔 |
| 视觉项的 personReference | 每个 referenceImage/referenceVideo/firstFrame/lastFrame 项必带布尔元数据；音频不允许带 |

作者形状和最终端口必填有区别：所有元素必有 `id/model/prompt/duration`；`resolution` 默认 720p，`aspect-ratio` 默认 9:16，`generate-audio` 默认 false；只有 `TextVideo` 暴露 `web-search`，默认 false，其余形状也组装 false。

- `TextVideo` 无子元素和正文。
- `FrameVideo` 必有 `first-frame` 和 `first-frame-person-reference`；尾帧可选，但提供尾帧必须同时给 `last-frame-person-reference`。只有尾帧元数据没有尾帧是错误。无子元素和正文。
- `ReferenceVideo` 至少一个空 `Reference` 子元素；每项恰选 image/video/audio 之一，视觉项必须显式写 person-reference，音频项不得写。同种参考顺序有意义。
- 首帧模式与任一种普通参考模式互斥；尾帧依赖首帧。2/fast/mini 的音频参考还须有图像或视频参考，普通参考总数不超过 12。2.5 不声明这两条限制，允许单独音频参考，也没有该共享总数限制。
- 参考音频为 audio/mp4 或 audio/x-m4a 时显式失败，需先转换；原包建议 WAV/MP3。这不是要求自动转换，也不证明所有其他音频 MIME 都受服务支持。
- **cameraFixed、seed 不在所读 Seedance 模型端口内，也不在其元素属性中**。镜头固定是 kit 的文字方向，不等同结构化 cameraFixed 请求；不得把二者混为一谈。若产品希望暴露这些 API 参数，须独立新增宿主能力，不能称为原包已有行为。

### 2.3 图像模型

所有下列参考子元素都是空 `Reference image={...}`，不得夹杂正文。表中 B 表示布尔，I 表示整数。

| 包/模型及元素 | 端口（类型、必填、允许值） | 附加行为 |
| --- | --- | --- |
| seedream / seedream-5-lite；TextImage、ReferenceImage | prompt 必 Text(3000)；aspectRatio 必，1:1/4:3/3:4/16:9/9:16/2:3/3:2/21:9；quality 必 basic/high/ultra；outputFormat 必 png/jpeg；nsfwCheck 必 B；images 可图像 0–14 | 作者除 id/prompt 外必须显式写 aspect-ratio/quality/output-format/nsfw-check。basic 对应 2K、high 对应 3K、ultra 对应 4K，不是通用低中高质量映射。TextImage 不接受参考；ReferenceImage 必须 1–14 项 |
| gpt-image / gpt-image-2；Image | prompt 必 Text(20000)；aspectRatio 必 auto/1:1/3:2/2:3/4:3/3:4/16:9/9:16/2:1/1:2/3:1/1:3/21:9/9:21/5:4/4:5；resolution 必 1K/2K/4K；background 可 transparent/opaque/auto；images 可图像 0–16 | 无参考也能调用。独立 clean 子模块的 Image 使用相同端口，但生成后有独立去噪 Need；公开 image 为处理后图，不把处理隐藏在付费生成里 |
| nano-banana / nano-banana-2；Image | prompt 必 Text(20000)；images 可图像 0–14；aspectRatio 必 auto/1:1/2:3/3:2/1:4/4:1/3:4/4:3/4:5/5:4/1:8/8:1/9:16/16:9/21:9；resolution 必 1K/2K/4K；outputFormat 必 png/jpg | 作者所有标量显式填写；这里是 jpg，不是 Seedream 的 jpeg |
| nano-banana / nano-banana-pro；ProImage | prompt 必 Text(10000)；images 可图像 0–8；aspectRatio 必，为上一行去掉 1:4/4:1/1:8/8:1；resolution 必 1K/2K/4K；outputFormat 必 png/jpg | 不是通过一个模糊 pro 开关选择服务，模型身份是独立的 |
| wan / wan-2.7-image；Image | prompt 必 Text(5000)；images 可图像 0–9；resolution 可 1K/2K；count 可 I 1–12；imageSet/extendedReasoning/watermark 各可 B；seed 可 I 0–2147483647 | **该包是图像模型，不是 Wan 视频模型**；没有 aspectRatio。参考存在时继承最后一张的形状，否则按模型档位的固有形状输出 |
| wan / wan-2.7-image-pro；ProImage | 同上，resolution 增加 4K | imageSet 与 extendedReasoning 按存在性互斥；count 是产图上限，故事图组实际数量由模型决定 |

Wan 注释说明普通生成至多四张、连贯图组至多十二张；但所读端口和 decoder 只验证 count 在 1–12，没有按 imageSet 条件施加“普通最多四张”。不能把注释当成已实施的条件验证。排除内容放提示词，包没有独立负向提示词端口。

### 2.4 其他视频模型

| 包/模型及元素 | 全部模型端口 |
| --- | --- |
| grok-imagine / grok-imagine-video；Video | prompt 必 Text(5000)；aspectRatio 必 2:3/3:2/1:1/16:9/9:16；resolution 必 480p/720p/1080p；duration 必 I 6–30 秒；images 可图像 0–7 |
| grok-imagine / grok-imagine-video-1.5-preview；PreviewVideo | prompt 必 Text(4096)；aspectRatio 必，上一行加 auto；resolution 必 480p/720p/1080p；duration 必 I 1–15 秒；images 可图像 0–7 |
| minimax-h3 / minimax-h3；TextVideo、FrameVideo、ReferenceVideo | prompt 必 Text(7000)；duration 必 I 4–15 秒；resolution 可 768P/2K；aspectRatio 可 21:9/16:9/4:3/1:1/3:4/9:16；referenceImage 可图像 0–9、referenceVideo 可视频 0–3、referenceAudio 可音频 0–3；firstFrame/lastFrame 各可图像 0–1 |
| pixverse / pixverse-v6；Video、ReferenceVideo | prompt 必 Text(5000)；firstFrame/lastFrame 各可图像 0–1；referenceImage 可图像 0–10；referenceVideo 可视频 0–2；duration 条件必填 I 1–15 秒；quality 必 540p/720p；aspectRatio 可 16:9/4:3/1:1/3:4/9:16/2:3/3:2/21:9/auto；generateAudio/multiClip 各可 B；seed 可 I 0–2147483647 |
| pixverse / pixverse-c1；Video、ReferenceVideo | 与 V6 相同的共同端口，但 referenceImage 上限 7；没有 referenceVideo/multiClip/seed；aspectRatio 没有 auto |

Grok 两种元素必写 id/prompt/duration/resolution/aspect-ratio；可有 0–7 个图像 Reference，不接受其他正文。原包不提供音频开关、首尾帧或视频编辑端口；宿主能做更多不代表原模型包已经暴露。

MiniMax 的 TextVideo 无媒体；FrameVideo 至少一个首帧或尾帧，允许仅尾帧，不允许 aspect-ratio，画幅取自输入图。ReferenceVideo 至少一个参考，每项 image/video/audio 三选一；音频必须有视觉参考，三个类别合计最多 12。任一首尾帧都与普通参考、aspectRatio 互斥。原包 resolution 可省略，而宿主原生 H3 目录要求具体分辨率，计划应显示 Dsivio 解析后的默认值。

PixVerse 的 Video 支持纯文本、首帧、首尾帧；必写 id/model/prompt/duration/quality，无子元素。ReferenceVideo 必写 id/model/prompt/quality，至少一个 image 或 video Reference；存在视频参考就不得写 duration，否则 duration 必填。作者 model 接受 v6/c1 或完整模型名。C1 写 seed、multi-clip 或视频参考会在作者位置拒绝。

- 尾帧依赖首帧；首帧与 aspectRatio、referenceImage 互斥。
- V6 的 multiClip 与尾帧或图像参考互斥，即使显式 false 也算出现；ReferenceVideo 形状本来就不开放 multi-clip。
- 视频参考与 duration 互斥；注释声明两段参考视频合计最多 15 秒，但所读 surface/validator 没有读取媒体时长验证此上限。
- PixVerse quality 实际是尺寸档位，可映射宿主视频 resolution，不能误传图像 `--quality`。对白、语言和声音方向在 prompt；没有独立 voice/language/dialogue 端口。

### 2.5 语音设计、克隆与时间轴

| 包/模型；元素 | 全部端口 | 作者映射及公开输出 |
| --- | --- | --- |
| mimo-speech / mimo-v2.5-tts-voicedesign；VoiceDesign | text 必 Text；voiceDescription 必 Text | id/speech 必填；speech 引用要说出的 Text，正文是必填声音描述。输出 reference: 音频 BlobArtifact |
| mimo-speech / mimo-v2.5-tts-voiceclone；VoiceClone | text 必 Text；instruction 可 Text；voiceReference 必音频 1 项 | id/speech/voice 必填；正文是可选表现指令。输出 audio: 音频 BlobArtifact |
| fishaudio-speech / voice-design-1；VoiceDesign | text 必 Text；voiceDescription 必 Text | 与 MiMo 设计形状相同，输出 reference |
| fishaudio-speech / voice-clone；VoiceClone | text 必 Text；voiceReference 必音频 1 项 | id/speech/voice 必填，不接受正文输入，输出 audio；没有 instruction |
| elevenlabs-speech / eleven_ttv_v3；VoiceDesign | text 必 Text(1000)；voiceDescription 必 Text(1000) | id/speech 必填、正文描述必填，输出 reference；没有 VoiceClone 元素 |

三家底层均返回有序生成音频集，作者元素发布第一项。声音设计结果只是普通音频资源，不是持久 voice-id；可以喂给克隆，也可以作为接受音频参考的视频模型的输入。MiMo/Fish 未声明固定字符上限。ElevenLabs 文档要求示范文本 100–1000 字符、描述 20–1000 字符；本地端口只落实上限，下限由服务执行，不能声称作者层已验证这些下限。设计元素正文去掉首尾空行、公共缩进及行尾空白，不接受子元素。

**音频进入 Timeline 的两个明确途径**：

1. 语义表演：音频 Blob → Normalize（不选视频流，选音频，跨度以音频为准，并绑定 Clock）→ 标准 SynchronizedMedia → 对应 Script 单个 Segment 的 WhisperX SemanticTake → Timeline 组装。之后字幕、Selection、Moment 依赖的是这段真实音频的词帧证据，不是 TTS 文本猜测时长。
2. 独立声音层：Normalize 后的音频放入 AudioTrack Item，以整个节目、Segment/Selection、Moment+时长或显式起止窗口定位，使用明确 gain/fade/trim/playback；它不自动获得对白语义，也不会为了填窗口自动循环或拉伸。表演音频与独立声音可以同时存在。

仅为了给视频参考提供声线时，音频不用先成为 SemanticTake；传普通音频 Artifact 即可。`dsivio media --audio` 只是视频是否带声音，**不是 TTS 或声线克隆服务**。Dsivio 今日无 speech kind，插件不得自行接上述厂商生成语音。

### 2.6 抠像与 WhisperX（仅端口级）

**volcengine-matting / matte-portrait-video，Portrait**：必填 `source` 为一个视频 BlobArtifact；可选 `format` 仅 WEBM/MOV，作者省略时服务映射为 WEBM。id/source 必填，无提示词、duration、resolution；输出 video，为带透明通道的处理结果，时间和尺寸由输入决定。输出仍应 Normalize 后再参与轨道。若保留表演音频并对齐 Script，可作 A-roll；不取声音则可作 MediaTrack 覆盖层。抠像不决定图层位置或时间轴角色。原本地 Transform 会生成不透明 MP4，所以需要裁剪/变速时先处理再抠像；不能误以为所有视频转换都保留 alpha。

**whisperx，SemanticTake**：不是媒体生成模型。作者端口如下：

| 输入/输出 | 类型和约束 |
| --- | --- |
| id | 必，作者标识 |
| narrative | 必，完整 Narrative 引用 |
| segment | 必，属于作者叙事的一段 Excerpt 引用，仅单个 Segment |
| media | 必，已规范化 SynchronizedMedia；含词片段需可取得音频 |
| language | 含词片段必填；无词片段必须省略。小写 2–3 字母，排除 und；不解释 auto、zh-CN 或语言中文名称 |
| take | 输出 SemanticTake，含规范化媒体、作者词身份和局部帧锚点 |

底层 alignment Need 输入 evidence（标准 SpeechEvidenceAudio）和 language，输出 AlignedTranscriptEvidence。所需实际数据是音频 Artifact、样本帧数、显式语言；不暴露识别权重 URL、ASR 型号或硬件设置作为作者端口。证据必须为 audio/wav、16kHz 单声道 PCM s16 WAV；sampleFrames 是正的安全整数，data 块字节数必须为 sampleFrames 的两倍，截断或不符合格式的 WAV 显式失败，执行方不得再悄悄规范化一次。本地确定性对齐再把服务词时间与作者 Segment 结合。空 Segment 不调用 WhisperX，也不提取证据音频，直接把首尾 Anchor 对应到准备媒体的帧边界。这里不做整片一次识别。语言支持由执行服务决定，不由正则校验保证；错误不能自动切语言或识别模型。时间轴采用作者 Script 的显示文字，不能拿识别标点或简繁转换替换作者文案。

### 2.7 Recipe kits

kits 是纯文本创作材料：固定方向、Recipe 选择轴和 Text 插槽按顺序拼装成 Text；不是新模型、Provider 或隐藏执行节点。先用 text:Render 得到提示词，再传给通用生成元素。修改 Recipe 不会创建参考媒体、估算时长、抠像或真的剪辑。媒体顺序、人物元数据、时长及声音开关仍显式写在生成节点上。

| kit | 提供的方向和输入 |
| --- | --- |
| seedance-kits speaker-v1 | 单人手机口播；图 1 对应人物与场景，音频 1 对应声线。dialogue 必填，action 可选；控制构图稳定、镜头、剪辑节奏、表现、手势 |
| broll-v1 | 静默视觉小故事；story 必填；参考按作者顺序说明角色。控制素材风格、故事形态、剪辑语言、摄影语言、运动幅度 |
| podcast-v1 | 两个固定人物机位及两路对应声音；dialogue 必填，action 可选；按 A/B 说话顺序切机位，反应镜头里的听众不说对方台词 |
| call-v1 | 两张视频通话视图，A/B 在主窗口和小窗的位置互换；两路声音对应 A/B；两个窗口都是活动画面。dialogue 必填，action 可选；方向轴同 podcast，但维护界面几何 |
| street-interview-v1 | 三张完整机位：采访者、嘉宾、双人；两路对应声音；采访者始终持麦克风。dialogue 必填，action 可选；限定只在给定三机位内变化，不发明第四机位 |
| motion-reference-v1 | 图 1 保人物、视频 1 转移身体动作；不要求转移原镜头语言。direction 可选，无 Recipe 选择轴 |
| camera-reference-v1 | 图 1 保人物、视频 1 转移构图/镜头/摄影节奏；不要求复制原人物动作。direction 可选，无 Recipe 选择轴 |
| gpt-image-kits phone-ugc-v1 | 手机真实拍摄单帧质感，背景可辨、自然纹理和照明，避免过度处理；shot 必填，person/setting 可选；无选择轴。输出 Text，不自动使用 clean 后处理 |

精确的 Recipe 选择域（星号表示省略时默认）：

- speaker：composition-stability = flexible-ugc/soft-locked*/strict-locked；camera-motion = none*/subtle-punch-in-return；edit-rhythm = continuous-take*/pause-trim-jump-cuts；performance = natural-explainer*/high-energy-ugc/calm-authority/reactive-playful；gesture = restrained/compact/natural*/expressive。
- broll：material-mode = practical-real*/screen-demo/product-beauty/proof-capture/stylized-vfx；story-shape = single-moment*/reaction-beat/process-demo/before-after/montage-sequence；edit-language = continuous-shot*/jump-cut-beats/match-cut-montage/insert-cutaway；camera-language = reference-locked*/selfie-vlog/handheld-follow/push-reveal/product-macro；motion-intensity = micro/readable*/lively/impact。
- podcast/call：framing = locked-view*/soft-push-in/emphasis-closeup；edit-language = speaker-cuts*/reaction-cuts；pacing = measured/compact*/rapid-banter/varied-emphasis；performance = natural-banter*/high-energy/calm-expert/playful-skeptic；reaction = subtle-listening/active-listening*/skeptical-reacts/big-reacts；gesture 同 speaker。
- street-interview：framing = locked-scene/soft-handheld*/subject-push；pacing = measured/compact*/rapid-qna/varied-emphasis；performance = natural-street*/high-energy/calm-expert/playful-skeptic；reaction = subtle/active*/big；gesture 同 speaker。

原套件建议普通剪辑口播主动选择 pause-trim-jump-cuts，而模板默认仍是 continuous-take；应区别创作建议和缺省行为。声音台词保留 Script 对话顺序，action 是方向而不是重写全文；一个短交谈 Segment 可以一次生成，不必每句一条 Take。多个口播 Take 可复用相同人物/场景/声线，不强制上一条尾帧串联下一条。

### 2.8 定价记录

所有指定模型包及两组 kits 均未给出固定金额、货币或可信的请求总价公式。不得编造“每秒多少钱”或从不同服务的售价推导模型固有价格。

| 覆盖对象 | 能确认的定价行为 |
| --- | --- |
| seedance 四变体、seedream、gpt-image、nano-banana 两变体、grok 两变体、minimax-h3、pixverse 两变体、wan 两变体 | 原模型包不定价；所读网关适配器按实际映射后的模型读取当前服务价格文档，保留来源和原始数据，不自行计算总额 |
| mimo 两操作、fish 两操作、elevenlabs 设计、matting | 同样按实际服务模型读取动态价格资料；speech 返回多个预览不能被作者第一项投影误判为只产一份或只收一份费用 |
| whisperx | 远程服务按其选择的 transcription 模型查价格；本地部署有计算/资源成本，但端口包无金额声明 |
| seedance-kits、gpt-image-kits | 文本渲染本身没有付费模型调用；选择 kit 不包含媒体生成或后处理费用 |
| GPT clean | 除图像生成外有单独处理 Need；不得声称“清理已包含在生成价里” |

Dsivio 当前 models/任务输出没有公开统一报价契约。新插件应标记“价格未知”，不显示零价；若未来宿主提供报价，需同时附币种、计费单位/条件、有效时间、来源、估算/实际标记，并把 plan 时的报价快照存入 Build。付费前所见请求必须包括实际 model、分辨率、时长、声音及参考，不能只显示模板名称。

### 2.9 与 Dsivio 的逐端口差距表

“已支持”指已有可验证能力及标准通道，并不保证用户已启用该精确模型，也不保证全部原取值可用。每次必须检查 live models 中的实际 `供应商/模型ID`。表内“需 Dsivio 扩展”的字段/参数都是建议，当前不可调用；“不支持”指今日无对应操作，不能拿现有生图/生视频伪装。

| 原端口（模型范围） | 当前 Dsivio 能力 → CLI | 状态及所需变更 |
| --- | --- | --- |
| prompt（全部图/视频） | 视频 maxPromptLength；图像无提示词上限字段 → --prompt/--prompt-file | 视频已支持；图像需 Dsivio 扩展 textLimits.prompt → 仍用 --prompt-file；不得用固定模型代码补图像限制 |
| aspectRatio（Seedance/Grok/MiniMax/PixVerse） | ratios → video --ratio | 已支持允许域；尚缺“帧模式不可填 ratio”等完整跨字段规则描述，见下文 |
| aspectRatio（Seedream/GPT/Nano） | ratios → image --ratio | 已支持通道；Seedream 专属允许域未公开、GPT 某些宽比超宿主域须拒绝；完整覆盖需 Dsivio 扩展对应模型 ratios，不换算成别的值 |
| resolution（Seedance/Grok/MiniMax） | resolutions → video --resolution | 已支持；只接受该 live 域 |
| resolution（GPT/Nano/Wan 图像） | sizes/customPixelSize → image --size | GPT/Nano 已支持档位；Wan 图像精确能力需 Dsivio 扩展 sizes/模型识别，保留 --size；不能误映射目录内 Wan 视频 |
| duration（视频，非自动） | durations → --duration | 已支持离散时长；Grok 原包 6–30/1080p 不等于宿主基础 Grok 1–15/480p、720p，超出部分需要实际宿主路由扩展，不能仅放宽客户端验证 |
| duration=-1（Seedance 2.5） | 当前无自动时长；输入是无符号整数 | 需 Dsivio 扩展 durationPolicy.allowAuto → --duration auto；不得传负值或把 auto 改为默认 5 秒 |
| referenceImage / images（图像生成） | maxReferenceImages → image --ref（可重复） | 已支持通道；各模型限额不同，当前默认/路由限额不保证达到原包 14/16/9 项 |
| referenceImage / images（视频） | maxReferenceImages → video --ref | 已支持，且参考顺序须保留 |
| referenceVideo | maxReferenceVideos/localReferenceMedia → --ref-video | 已支持有该能力的路由；本地文件支持 false 时不能偷偷上传到插件自建云存储 |
| referenceAudio | maxReferenceAudios/referenceAudioNeedsVisual/localReferenceMedia → --ref-audio | 已支持有该能力的路由；视频参考音频不是独立语音生成 |
| firstFrame / lastFrame | firstFrame/lastFrame/lastFrameNeedsFirst/framesExcludeReferences → --first-frame/--last-frame | 已支持；只尾帧需读取 lastFrameNeedsFirst，而不是照共享文档一律要求首帧 |
| personReference（Seedance 视觉媒体项） | 当前无逐项元数据 | 需 Dsivio 扩展 referenceItemFields.personPresent、帧项同类描述 → --references-json（每项含角色/资源/人物布尔）；不能从 --ref 路径推断人物 |
| Seedance referenceAudio MIME 禁 m4a | localReferenceMedia 仅描述传输，不描述 MIME | 需 Dsivio 扩展 inputs.audio.acceptedMime/rejectedMime → 仍用 --ref-audio，plan 明确报格式错误 |
| generateAudio（Seedance/PixVerse） | audioToggle → --audio 为 true；false 可通过 --options-json '{"generateAudio":false}' | 已支持布尔输入；false 不可仅省略，因为省略与服务默认可能不同；建议增 --no-audio |
| webSearch（Seedance） | 无字段，无输入 | 需 Dsivio 扩展 webSearchToggle → --web-search/--no-web-search；显式 false 也不能当前直接塞进 options-json |
| cameraFixed（特别核对，原 Seedance 包无此端口） | 无字段，无输入 | 需 Dsivio 扩展 cameraFixedToggle → --camera-fixed/--no-camera-fixed；须先证实所选模型和连接支持，kit 的固定镜头文字不是此参数 |
| seed（PixVerse V6/Wan；Seedance 包无） | 无字段，无输入 | 需 Dsivio 扩展 seedRange → --seed；0 是有效值，不得以 truthy 判定丢弃 |
| quality（Seedream basic/high/ultra） | qualities → image --quality，但 Seedream 路由没有公开这组域 | 需 Dsivio 扩展该模型 qualities、对应 2K/3K/4K 语义及宿主发送映射 → --quality；不能映射 basic 为 low 或 high 为 GPT high |
| outputFormat（Seedream png/jpeg） | 无字段，无输入 | 需 Dsivio 扩展 outputFormats → --output-format；改文件扩展名或事后转码不等价于模型输出格式 |
| nsfwCheck（Seedream） | 无字段，无输入 | 需 Dsivio 扩展 safetyCheckToggle → --nsfw-check/--no-nsfw-check；不可默默强制/关闭，也不能用提示词代替 |
| background（GPT） | 无字段，无输入 | 需 Dsivio 扩展 backgroundModes → --background；透明背景不等于后续抠像 |
| outputFormat（Nano png/jpg） | 无字段，无输入 | 需 Dsivio 扩展 outputFormats → --output-format；需保留模型接受 jpg 的拼写和实际 MIME |
| quality（PixVerse 540p/720p） | 视频 resolutions → --resolution | 字段通道已支持；精确模型需 Dsivio 扩展目录和路由（当前无 PixVerse 条目），不能给 video 传 --quality |
| multiClip（PixVerse V6） | 无字段，无输入 | 需 Dsivio 扩展 multiClipToggle → --multi-clip/--no-multi-clip，兼带互斥规则 |
| count（Wan 普通模式 ≤4） | maxCount → image --n | 已支持数量通道，但仅同义的“确切数量”场景；Wan 精确路由能力需补齐 |
| count（Wan 图组上限 ≤12） | maxCount；统一图像 options 另有 n≤4 校验 | 需 Dsivio 扩展 countSemantics/maxCountByMode → --count-limit；不能用 --n 12 绕过当前校验或保证返回十二张 |
| imageSet（Wan） | 无字段，无输入 | 需 Dsivio 扩展 imageSetToggle → --image-set/--no-image-set |
| extendedReasoning（Wan） | 无字段，无输入 | 需 Dsivio 扩展 reasoningToggle → --extended-reasoning/--no-extended-reasoning，明确与 imageSet 的存在性互斥 |
| watermark（Wan） | 无字段，无输入 | 需 Dsivio 扩展 watermarkToggle → --watermark/--no-watermark |
| text（所有 speech） | 无 speech kind | 不支持；若宿主决定扩展，新增 speech 操作、textLimits → dsivio media speech --text-file，不能把文本传 image prompt 假装支持 |
| voiceDescription（三家设计） | 无语音能力 | 不支持；未来 voiceDesign/textLimits.voiceDescription → speech --voice-description-file |
| instruction（MiMo clone） | 无语音能力 | 不支持；未来 deliveryInstruction → speech --instruction-file |
| voiceReference（MiMo/Fish clone） | --ref-audio 仅是视频引用 | 不支持；未来 voiceClone/referenceVoiceLimit → speech --voice-ref，不复用视频命令 |
| source（Portrait 抠像） | 无 matting 操作 | 不支持；未来 portraitMatting/sourceVideo → dsivio media matting --input-video |
| format（Portrait WEBM/MOV） | 无透明视频格式能力 | 不支持；未来 mattingOutputFormats/alphaOutput → matting --output-format |
| narrative/segment/media（WhisperX 作者端口） | 属插件叙事和准备媒体，不属付费生成 CLI | 不支持用 media 生成接口承载；插件保留本地作者对象，未来执行边只发送证据音频 |
| evidence/audio/sampleFrames/language（WhisperX 执行端口） | 无 transcription/alignment kind | 不支持；若宿主承接则 alignment/audioInput/languages → dsivio media align --audio-file --language；本地识别属独立非生成程序决策 |

此外必须描述以下“端口组合”差距：视频能力已含尾帧依赖首帧、首尾帧排除普通参考、音频参考需要视觉三个规则，但没有 Seedance/MiniMax 共享总参考数 12、MiniMax/PixVerse 的帧与比例互斥、PixVerse 视频参考代替时长、multiClip 互斥、Wan 两开关互斥等通用规则。这些须由宿主提供可机读 constraints，而非插件分散硬编码。

宿主模型身份也不等同原包：目录明确有 Seedance 2/fast/2.5 的日期版本 ID，没有 mini；没有 PixVerse 条目；Grok 1.5 使用无 preview 后缀的 ID。MiniMax-H3 的宿主参考允许 audio-only，而原包要求视觉同伴；其 maxPromptLength=0 被能力输出过滤为未知，不代表无限。模型的能力取决于用户所选连接协议，Dsivio 输出是模型域与协议域的交集。不得只看 `videoModelCatalog.json` 就宣称用户当前能提交。

### 2.10 插件计划及 CLI 形状

现有可用调用示例只使用宿主已实现参数：

```sh
dsivio media models --kind video
dsivio media video --model connection/doubao-seedance-2-5-260628 \
  --prompt-file shot.txt --duration 8 --resolution 720p --ratio 9:16 \
  --ref scene.png --ref-audio voice.wav --audio \
  --source dsivio-video --idempotency-key project-build-node --out .dsivio-video/assets
```

例子不是证明该连接已启用，也不承诺本地 voice.wav 被该协议接受；plan 必须先读 localReferenceMedia。需要人物项元数据等尚未落地的字段时，当前应在 plan 报错，而不是执行上面删减后的请求。

计划流程：解析显式模型 → 查询 live capabilities → 求出所有标量/参考、应用宿主公开默认值 → 校验域/组合/媒体限制 → 展示完整已解析请求及未知成本 → Build 保存模型 ID、能力快照、请求和 Artifact 身份 → 提交同一节点的稳定幂等键。模型目录变化不应偷偷改变已有 Build 请求；应重新计划，报告变化。

stdout 是单行任务 JSON；实际产物从 outputs 的本地 path/MIME 收集，按顺序保留所有项再做作者主项投影。退出码 0 成功或 no-wait 已提交；2 未提交的参数/模型错误；3 明确未收费拒绝；4 已提交后失败；5 提交不确定，禁止再次提交；6 应用不可达；124 任务仍运行，继续 wait 同一 ID。不能因 CLI 等待超时生成新候选付费调用。status/wait 不触发新生成，--resume 是同回执复查，不是重新生成。

## 3. 关键概念与数据形状

### 3.1 建议的通用宿主能力 JSON

以下是**新契约建议**，不是现有输出或原系统类型定义。采用我们自己的字段命名，插件只解释有限的类型/条件运算，不包含厂商协议知识。通过 `dsivio media models` 的每个模型公开；输入规范和宿主实际验证必须从同一描述生成。

```json
{
  "descriptionVersion": 1,
  "identity": "connection/model-id",
  "operation": "video",
  "factsRevision": "2026-10-01-1",
  "factsComplete": true,
  "arguments": {
    "promptText": {
      "dataType": "string", "required": true,
      "lengthUnit": "unicodeCodePoint", "minLength": 1, "maxLength": 30000,
      "transport": {"flag": "--prompt-file", "encoding": "utf8-file"}
    },
    "durationSeconds": {
      "dataType": "integer", "required": true,
      "allowed": [4, 5, 6, 7, 8],
      "specialValues": ["auto"], "defaultValue": 5,
      "transport": {"flag": "--duration", "encoding": "scalar"}
    },
    "audioEnabled": {
      "dataType": "boolean", "required": true, "defaultValue": false,
      "transport": {"optionKey": "generateAudio", "encoding": "options-json"}
    },
    "referencePictures": {
      "dataType": "mediaList", "required": false, "minCount": 1, "maxCount": 30,
      "mimePatterns": ["image/*"],
      "locations": ["file", "https"],
      "entryAttributes": {
        "personPresent": {"dataType": "boolean", "required": true}
      },
      "transport": {"optionKey": "references", "encoding": "media-items-json"}
    },
    "openingPicture": {
      "dataType": "mediaList", "required": false, "minCount": 1, "maxCount": 1,
      "mimePatterns": ["image/*"], "locations": ["file", "https"],
      "entryAttributes": {"personPresent": {"dataType": "boolean", "required": true}},
      "transport": {"optionKey": "openingPicture", "encoding": "media-items-json"}
    },
    "closingPicture": {
      "dataType": "mediaList", "required": false, "minCount": 1, "maxCount": 1,
      "mimePatterns": ["image/*"], "locations": ["file", "https"],
      "entryAttributes": {"personPresent": {"dataType": "boolean", "required": true}},
      "transport": {"optionKey": "closingPicture", "encoding": "media-items-json"}
    },
    "referenceMovies": {
      "dataType": "mediaList", "required": false, "minCount": 1, "maxCount": 3,
      "mimePatterns": ["video/*"], "locations": ["https"],
      "entryAttributes": {"personPresent": {"dataType": "boolean", "required": true}},
      "transport": {"optionKey": "referenceMovies", "encoding": "media-items-json"}
    },
    "referenceSounds": {
      "dataType": "mediaList", "required": false, "minCount": 1, "maxCount": 3,
      "mimePatterns": ["audio/wav", "audio/mpeg"], "locations": ["https"],
      "transport": {"optionKey": "referenceSounds", "encoding": "media-items-json"}
    }
  },
  "constraints": [
    {
      "check": "excludeTogether",
      "arguments": ["openingPicture", "referencePictures"],
      "presenceMode": "provided"
    },
    {
      "when": {"provided": "closingPicture"},
      "check": "require", "arguments": ["openingPicture"]
    },
    {
      "check": "weightedCountAtMost", "limit": 12,
      "weights": {"referencePictures": 1, "referenceMovies": 1, "referenceSounds": 1}
    }
  ],
  "products": {
    "mediaKind": "video", "ordered": true,
    "countMeaning": "serviceChosen", "minCount": 1, "maxCount": 1,
    "mimeTypes": ["video/mp4"], "hasAlpha": false
  },
  "billingInfo": null
}
```

示例是一个自洽的虚构模型描述，用来展示字段形状，不能当作真实 Seedance 的允许域或当前宿主 transport。真实描述的 constraint 引用必须全部在 arguments 内声明。建议补充以下通用构件，使所有本研究端口都能表达：

- 字符串、布尔、整数/小数、枚举、mediaList；范围与离散值并存时规定联合语义；未知不能用 0 或空列表伪装无限。
- 媒体限制支持文件大小、宽高、时长、多个项总时长、MIME 白名单/禁表、本地与 URL 位置、项级属性；first/last frame 也是媒体端口，不另写模型分支。
- 条件只允许 provided、equals、all/any/not 等有界操作；动作包括 required、excludeTogether、count/weightedCountAtMost、durationTotalAtMost、restrictAllowed。存在性与 true 值两种互斥须显式区分，覆盖原包 false 也占用的情况。
- 普通 count 与图组 ceiling 的不同请求/输出语义；透明视频输出的 alpha/container 与音频集合的多预览都须描述，不能只写一个 result MIME。
- 默认值和“由输入推导”的规则，例如首帧/最后一张参考决定画幅、视频参考决定时长；派生规则不能伪装成一个固定默认值。
- transport 表达标准 flag 或宿主规范 optionKey；只告诉插件如何调用 Dsivio，绝不包含厂商 URL、密钥或 wire 字段。options-json 字段只接受当前模型声明的 key，宿主也做同样校验。
- 报错使用稳定 code、argumentPath、ruleId、actual、expected、message；plan 显示人类信息，Build 存结构化诊断。
- 未实现的输入不公开为能力。若只有部分知识，factsComplete=false，逐项说明可确定的输入；未知模型不能为了兼容而接受任意参数。
- billingInfo 若存在，应标记币种、单位、影响参数、来源、有效期；没有则 null，最终收费由 Dsivio 任务事实负责。

### 3.2 插件应保存的自己的结构

- **CapabilitySnapshot**：descriptionVersion、modelIdentity、factsRevision、观察时间及能力原文摘要/内容散列；不保存账户配置或协议鉴权。
- **ResolvedGeneration**：kind、modelIdentity、resolvedArguments、orderedReferences（Artifact 标识、角色、项属性）、产品选择策略、请求散列；用户写的 false/0 与省略必须区分。
- **SubmissionLink**：Build/Need 对应的 dsivioTaskId、幂等键、提交状态和 outputs。服务回执归宿主，插件不能自行轮询厂商。
- **VoiceSample / SpeechOutput**：当前只作为作者或导入媒体的角色标签，不是新增可执行的 paid speech 伪能力。
- **SemanticTake**：规范化媒体与作者词/局部帧证据；不要把 TTS 输入文本直接当作精准 word timestamps。

## 4. 对 dsivio-video 的建议

### 必须保留

1. 模型身份显式、请求可检查且 Build 可重现；以实时有效连接能力而不是论文/网关宣传域作为计划依据。
2. 普通 Artifact 参考边、顺序、角色及项级元数据；普通参考和首尾帧模式不能混淆。
3. 省略/false/0 的区别、条件必填、跨端口互斥与共享配额；完整输出集合和明确主项选择。
4. kits 的“提示词结构与显式执行分开”；用自行创作的中文方向说明和原创模板实现同类工作流，不复用原句或翻译粘贴其提示词。
5. 真正音频 → Normalize → 单 Segment 语义对齐 → Timeline 的边界；语音参考不强制变成 semantic take。
6. 透明通道生命周期、显式后处理；声线、固定镜头等自然语言指令不伪装成结构化已支持参数。

### 可简化

- 不重建每个模型独立模块/三种元素；通用 gen 元素借助宿主描述确定模式、界面及验证。作者语法可使用统一 Reference，但不能减少原本区分的语义。
- kits 只保留需求明确的内容组织（单人、双人、街访、B-roll、参考动作/摄影、手机照片），不要求复刻包内部文本块编号。
- GPT 去噪作为可选本地处理，独立节点及产物；不强制通用 Image 全部经过该操作。
- Live capability 暂只具旧字段时，建立宿主字段通用适配层，缺失字段严格报不支持；不为每个模型加“知道但宿主没说”的旁路。

### 砍掉

HypiHub、所有 gateway Provider 包、凭证库、S3/Lambda store、重复的组件 studio 包、Runtime Profile endpoint bindings。原模型专属厂商协议、账户 availability、定价读取 API 也不迁入插件。

今日 TTS/声音设计/声音克隆及 paid matting 不可用，应在计划阶段完整列出缺失操作；不得生成一个无实现节点或让插件用私藏密钥补齐。可接收用户合法提供的音频和 alpha 视频继续后续工作。WhisperX 本地部署是否保留是独立决策；Python 3.12 已打包不表示模型权重和 WhisperX 已安装。

## 5. 依赖与外部程序

- 原端口层主要依赖 generation、model-kit、markup、text、artifact；语义对齐还依赖 narrative、speech、speech-evidence、media-pipeline、speech-alignment。它们描述的是领域边界，不要求复制原实现。
- 新付费路径仅依赖运行中的 Dsivio 和 `dsivio media`。`models` 只列启用并仍在模型列表内的可用项；默认优先级不用于替代作者 explicit model。
- Node 22.23 可直接执行支持类型擦除的 TypeScript；媒体探测/转换由 ffprobe/ffmpeg；转换要保留实际 MIME、音频及 alpha，不能只改扩展名。
- WhisperX 执行服务另需兼容的 Python 依赖、识别及对齐权重、可用语言资源和硬件；本任务只研究端口，不声称宿主已经具备这些部署条件。
- kits 只生成文本，不需要额外生成服务；音频时长测量是创作时辅助，不是 TTS 定价或词时间证据。
- 本研究未运行构建、测试、安装、付费生成或远程报价请求；结论来自下列文件的静态契约和实现对照。

## 6. 待定问题

1. 宿主是否采用通用参数描述替代图/视频两套固定能力字段？必须同步实际路由、serde 接收、校验和 CLI，不能只扩展 models JSON。
2. Seedream 5 Lite、Wan 2.7 图像、PixVerse 以及 Seedance mini 是否由宿主正式接入？应按实际供应商/模型 ID 决定，不建立原网关名到日期模型的隐式别名。
3. personReference 的宿主传输与 live 能力如何定义？未落实前不能声称 ReferenceVideo 与原包完整等价。
4. 结构化 webSearch/cameraFixed/seed、outputFormat/nsfwCheck/background 是否需要覆盖？字段实际可用性及安全开关权限要宿主证实；无法实施的请求保持失败，不能静默降级。
5. 自动时长、继承参考视频时长、故事图组数量上限如何表达并存入 resolved request？原包的注释与实施差异不应直接当成新契约。
6. 原包与宿主事实冲突时如何展示迁移诊断？建议标出“原模型语义”和“当前连接允许”两列；执行只遵守后者，作者要求超域必须明确修订。
7. 是否增加宿主 speech/matting/alignment 操作？今日的“不支持”不是批准插件自行接厂商。若不增加，应允许导入产物完成非生成步骤，并明确不可生成这些产物。
8. 报价和实际收费是否由 Dsivio 公开？未有统一契约时只能未知；不能把单图投影、候选数量或文本估算等同收费数量。
9. 字符上限单位采用 UTF-16、Unicode code point 还是服务定义？新描述必须写明，不能中文和 emoji 输入出现不可解释的边界差异。

## 7. 来源

原项目根目录：`/Users/zmmini/zmdata/work/dsivioplugin`。下列均为实际读取的文件；这里只列路径，不转载其源码或提示词原句。

- `packages/seedance/src/index.ts`、`surface.ts`、`validation.ts`。
- `packages/seedream/src/index.ts`、`surface.ts`。
- `packages/gpt-image/src/index.ts`、`surface.ts`。
- `packages/nano-banana/src/index.ts`、`surface.ts`。
- `packages/grok-imagine/src/index.ts`。
- `packages/minimax-h3/src/index.ts`、`surface.ts`。
- `packages/pixverse/src/index.ts`、`surface.ts`、`validation.ts`。
- `packages/wan/src/index.ts`、`surface.ts`。
- `packages/mimo-speech/src/index.ts`、`surface.ts`、`fragment.ts`、`README.md`。
- `packages/fishaudio-speech/src/index.ts`、`surface.ts`。
- `packages/elevenlabs-speech/src/index.ts`、`surface.ts`。
- `packages/volcengine-matting/src/index.ts`、`README.md`。
- `packages/whisperx/src/manifest.ts`、`surface.ts`、`types.ts`、`evidence.ts`、`README.md`。
- `packages/seedance-kits/README.md`；`kits/` 下的 `speaker-v1.svs`、`broll-v1.svs`、`podcast-v1.svs`、`call-v1.svs`、`street-interview-v1.svs`、`motion-reference-v1.svs`、`camera-reference-v1.svs`。
- `packages/gpt-image-kits/kits/phone-ugc-v1.svs`。
- `packages/generation/src/ports.ts`、`request.ts`；`packages/media-pipeline/README.md`；`packages/audio-track/README.md`。
- `packages/provider-hypihub/src/provider.ts` 的 pricingModel/pricingReader 部分；模型路由名称另检索 `src/mapping.ts` 与 `README.md`，未调用该服务。

宿主根目录：`/Users/zmmini/zmdata/work/Dsivio`。

- `src/data/videoModelCatalog.json` 的协议及相关模型条目（verifiedAt 为 2026-09-21）。
- `src-tauri/src/media_generation/video_providers.rs`：VideoCapabilities、VideoInput、能力与目录求交。
- `src-tauri/src/media_generation/image_providers.rs`：ImageCapabilities、图像能力与输入验证、已知图像字段发送处理。
- `src-tauri/src/media_generation/cli.rs`：ModelEntry、build_submit、额外字段合并、任务和退出码契约。
- `src-tauri/src/media_generation.rs`：MediaImageOptions、video_input、image_arguments；证明云路径拒绝未知 options 及图像 n≤4。
- `src-tauri/resources/plugins/_shared/dsivio.md`：插件边界、CLI 及生命周期说明；表中与代码有差异之处以真实输入结构为依据。
