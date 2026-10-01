# Phase 6：媒体网关、独立后端与 Dsivio 市场集成

## 0. 范围、证据与最终决策

本文是**设计，不是已实现功能或运行验收报告**。`H/` 指 `/Users/zmmini/zmdata/work/Dsivio/`，`P/` 指本插件根目录；所有宿主事实的 `H/文件:行` 均是此次读取的源码定位。厂商公开 API 用链接引用，不能由「供应商配置存在」推导用户已经拥有相应产品权限。没有读取 hypit 源码。依照 `H/AGENTS.md:1–5`，先读统一规范及相关 ADR；新增职责留在既有领域，不建立平行设置、任务或安装状态（`H/docs/engineering-standards.md:9–12,39–52,68–81`）。

本阶段确定以下交付：

1. Dsivio 承接 `speech`、`transcribe`、受控模型参数与 `cancel`；云语音首批 **MiniMax、OpenAI**，云 ASR 首批 **OpenAI whisper-1**。Volcengine 的 Ark 配置不是 Doubao Voice 配置，本阶段不冒充已接入该语音产品。
2. Dsivio 模式本地 WhisperX **由 App 安装、监督、排队与停止**；推理服务代码只维护 `P/services/asr` 一份，发行时复制同 revision 的快照，不由插件启动第二个服务。首次实际需要自动安装，设置也可手动安装；`plan` 不联网安装。
3. 独立后端首批 **MiniMax、Google Gemini**：两家各有公开的图像、视频、语音 API。独立模式才读取用户的 key；不能让 Dsivio 模式偷偷改为直连。
4. 静态去背景与人像视频抠像**明确延期**。本文确定中立契约、错误及开启条件，但不发布无实现的可执行能力，不恢复 HypiHub。导入透明素材路线继续可用。
5. 市场增加独立 `dsivio-video` 条目、安全 `subdir` 选择；市场安装 Skill，首次 setup 部署 CLI/npm 依赖。保留 bundled npm 的 JS 入口，使用 bundled Node，不要求用户安装系统 Node/npm。
6. Hypit 原条目、独立项目及配置全部保留。

架构依据：ADR 0009 已规定 App 内媒体生成只有一套实现、CLI 是运行中 App 的无密钥客户端、App 关闭退出 6、不确定付费提交不重交（`H/docs/adr/0009-media-generation-has-one-implementation.md:3–18`）。独立后端是另一种明确选择的产品运行模式，不是这条 App 边界内的第二实现；新增 ADR 0010 在 §8 写明该边界。插件架构已规定 plan 选定后端并存入 Build（`P/docs/architecture.md:105–143`）。

## 1. 现状核对：不能把未来命令当作已有能力

| 已核对事实 | 证据 | 本阶段改动负责人 |
|---|---|---|
| `MediaKind` 只有 image/video；任务状态只有 running/succeeded/failed；输出是 path/mime | `H/src-tauri/src/media_generation.rs:21–84` | `media_generation.rs` 扩 kind/result/cancel 状态，迁移消费者 |
| CLI 操作只有 Models/Submit/Status，命令只有 models/image/video/status/wait；Submit 有 options map，但外层拒绝未知字段 | `H/src-tauri/src/media_generation/cli.rs:42–79,950–1009` | `media_generation/cli.rs` |
| cloud 图片输入只有 size/aspect_ratio/quality/n，拒绝未知字段；n 还有 1–4 的公共校验 | `H/src-tauri/src/media_generation.rs:85–98,500–508` | 参数描述校验代替固定公共限制 |
| `VideoInput` 拒绝未知字段，duration 是 u32；prepare 前会重新 serde、再归一化 options | `H/src-tauri/src/media_generation/video_providers.rs:167–192`；`H/src-tauri/src/media_generation.rs:634–641` | 参数接收、校验、prepare 同批修改，不能只改 models JSON |
| 视频能力为模型目录与所选连接协议的交集；图像能力来自实际 route | `H/src-tauri/src/media_generation/video_providers.rs:108–139`；`H/src-tauri/src/media_generation/image_providers.rs:1550–1603` | 沿用既有路由负责人生成通用 description |
| 媒体设置目前仅两个有序模型池，第一项默认；候选来自已启用 provider/model | `H/src/settings/tabs/MediaCreationTab.tsx:21–33,83–95`；`H/src-tauri/src/settings.rs:1101–1120` | `settings.rs`、`MediaCreationTab.tsx`、`mediaModelPools.ts` |
| API keys/baseUrl/modelOverrides/代理已有通用配置；聊天 apiFormat 不代表 speech 协议；普通 API key 当前明文存 settings.json | `H/src-tauri/src/settings.rs:170–285,3038–3043` | 复用 provider 凭证，新增明确 speech/transcribe 协议配置；不虚称已有 Keychain |
| MiniMax Token Plan、MiniMax H3/Hailuo、OpenAI、Doubao Ark 已有预设/目录，且 URL 属不同产品 | `H/src/settings/providerPresets.ts:52–55,68–72`；`H/src/data/videoModelCatalog.json:5–48,1111–1137` | 模型详情明确媒体产品地址/协议；不从聊天地址猜 TTS |
| App task 统一写 media-tasks/task.json，已有 active claim 和原子写；CLI 幂等按 origin 查记录并序列化提交 | `H/src-tauri/src/media_generation.rs:123–175,660–685`；`H/src-tauri/src/media_generation/cli.rs:235–280` | 继续一个任务 owner，增加请求散列及取消控制 |
| 下载同源才附 key，手动跟随跳转、禁止 HTTPS 降级、512 MiB 限制与 part 原子提交 | `H/src-tauri/src/media_generation/artifacts.rs:6–86,113–150` | 音频扩展也使用此模块，不另写下载器 |

新字段经既有生成契约同步到 `H/src/generated/mediaGeneration.ts`，前端只调用带类型 adapter；已有注册/adapter 位于 `H/src-tauri/src/lib.rs:524–526`、`H/src/api/tauri.ts:1820–1824`。设置持久化仍经过 `H/src-tauri/src/commands.rs:177–255` 的版本/CAS 流程，不由媒体设置页直接写文件。

## 2. 通用模型参数：描述与实际接收同时落地

### 2.1 models 输出

精确 CLI：

```text
dsivio media models [--kind image|video|speech|transcribe|matting] [--json]
```

沿用 JSON 数组输出；`--json` 是显式声明，不改变 JSON 形状。无 kind 列出所有已启用且实际可执行的模型。`matting` 在延期期间返回 `[]`，不是编造 provider。保留现有 `id/providerId/providerName/model/default/known/capabilities` 字段给已有调用者，但 **description 是新权威**；旧 capabilities 由同一 description 投影生成，不能继续维护两套目录。现有 ModelEntry 和可用性过滤在 `H/src-tauri/src/media_generation/cli.rs:283–370`；不能借新描述绕过媒体池。

采用 research/09 §3.1 的结构，但真实参数采用稳定规范名，不使用虚构模型的示例允许域：

```json
{
  "id": "openai/gpt-4o-mini-tts",
  "providerId": "openai",
  "providerName": "OpenAI",
  "model": "gpt-4o-mini-tts",
  "kind": "speech",
  "default": true,
  "known": true,
  "capabilities": null,
  "description": {
    "descriptionVersion": 1,
    "identity": "openai/gpt-4o-mini-tts",
    "operation": "speech",
    "factsRevision": "sha256:description-content-hash",
    "factsComplete": true,
    "arguments": {
      "mode": {"dataType": "string", "required": true, "allowed": ["tts"], "defaultValue": "tts", "transport": {"optionKey": "mode", "encoding": "options-json"}},
      "text": {"dataType": "string", "required": true, "minLength": 1, "maxLength": 4096, "lengthUnit": "unicodeCodePoint", "transport": {"flag": "--text-file", "encoding": "utf8-file"}},
      "voice": {"dataType": "string", "required": true, "transport": {"flag": "--voice", "encoding": "scalar"}},
      "speed": {"dataType": "number", "required": false, "minimum": 0.25, "maximum": 4, "defaultValue": 1, "transport": {"optionKey": "speed", "encoding": "options-json"}},
      "outputFormat": {"dataType": "string", "required": true, "allowed": ["mp3", "opus", "aac", "flac", "wav"], "defaultValue": "wav", "transport": {"flag": "--output-format", "encoding": "scalar"}},
      "instruction": {"dataType": "string", "required": false, "transport": {"flag": "--instruction-file", "encoding": "utf8-file"}}
    },
    "constraints": [],
    "products": {"mediaKind": "audio", "ordered": true, "countMeaning": "exact", "minCount": 1, "maxCount": 1, "mimeTypes": ["audio/mpeg", "audio/ogg", "audio/aac", "audio/flac", "audio/wav"], "hasAlpha": false},
    "lifecycle": {"submission": "synchronous", "remoteCancel": "unsupported"},
    "billingInfo": null
  }
}
```

这是拟定契约实例，不是当前 CLI 输出。speech 的 kind 是操作名，products.mediaKind 是媒体 MIME 类别。raw pcm 不作为首批可交付格式：无容器/采样信息的文件不是插件 Audio Artifact；不能偷偷给 pcm 请求包装 WAV。`voice` 的系统音色域来自适配器公开枚举，用户 clone voice ID 另按 provider 归属校验；上述缩写实例不展开全部音色。字符上限若官方未说明计数方式，适配器须保守校验并标记 `factsComplete:false` / `unknownFacts:["text.lengthUnit"]`，不能把代码点计数声称为厂商事实；本地规范单位始终显式，厂商仍可拒绝。

**描述字段的实施规则**：

- dataType 只允许 string/boolean/integer/number/mediaList。`allowed` 与数值范围取**并集**，`specialValues` 是独立允许的字面量，例如 duration `"auto"`；不允许任意 JSON Schema 或执行代码。required/default 的含义按参数存在性，不用 truthy；false/0 保留。
- mediaList 项为 `{ "source": "/abs/a.png", "attributes": {"personPresent": false} }`。在插件里 source 是 ResourceRef/Pending，到了 CLI 才物化为绝对路径/允许的 HTTPS URL。描述含 minCount/maxCount、mimePatterns、rejectedMime、locations、maxBytes、尺寸/时长范围、entryAttributes。不存在的大小上限省略，不能用 0 代表无限。
- constraints `{ruleId,when?,check,arguments,presenceMode?,limit?,weights?,allowed?}`；when 仅 provided/equals/all/any/not，check 仅 require/excludeTogether/countAtMost/weightedCountAtMost/durationTotalAtMost/restrictAllowed。未知操作、悬空参数引用、循环 default/derive 使 description 无效。存在性互斥以用户提供项判定，补默认不能误触发；需要按 true 判定则明确 `presenceMode:"truthy"`。
- `defaultValue` 是真实默认；输入导出值用有限 `derivedFrom`（`imageAspectRatio`、`videoDuration`）而非脚本。无法确定的派生值在 plan 保留 Pending 并在执行前按实际探测校验，禁止自动猜时长。
- transport 只有公共 flag/optionKey/编码，不含 vendor URL、wire 字段、鉴权。每个 optionKey 唯一。`factsRevision` 是规范描述的内容散列，不是可变随手字符串。
- `billingInfo` 默认 null；有事实才给 currency/unit/conditions/source/validAt/estimated。plan 价格未知不能显示 0。
- errors 统一 `{code,argumentPath,ruleId,actual,expected,message}`；参数错误发生在付费前。CLI stderr 给人类信息，stdout 给结构化错误对象，保留原退出码 2/3/4/5/6/124 语义（已有定义 `H/src-tauri/src/media_generation/cli.rs:18–33`）。

### 2.2 请求确实接受参数，不再经过丢字段的 serde 关卡

共同提交 flag：`--model <provider/model>`、`--options-json '<object>'`、`--options-file <JSON文件>`、`--description-revision <hash>`、`--idempotency-key <key>`、`--source <name>`、`--no-wait`、`--timeout <非负秒>`、`--out <目录>`、`--json`。JSON/file 二选一；规范 flag 与 options 同一个键重复时报错，不能后者覆盖前者。通用参数一律通过 options，不为每个厂商追加无穷 flag；已存在的图/视频 flag 保留，增加 `--no-audio`（与 `--audio` 互斥）与 `--duration auto`（仅 description 允许时）。现有 JSON 合并会拒绝重复键，这条行为保留（`H/src-tauri/src/media_generation/cli.rs:739–749`）。

新增 wire 字段只有 `descriptionRevision`，其余沿用 Submit 的已知字段。例如：

```json
{"op":"submit","kind":"image","model":"openai/gpt-image-2","prompt":"一朵花","images":[],"options":{"background":"transparent","outputFormat":"png"},"descriptionRevision":"sha256:...","source":"dsivio-video","idempotencyKey":"build/node"}
```

transport 中 token 仍由 CLI 内部加入，不出现在命令/日志。**外层 Submit、MediaRequest 继续 deny_unknown_fields**：顶层 `apiKey`、`baseUrl`、`headers`、拼错字段仍非法。只取消 `MediaImageOptions` 和 `VideoInput` 的未知参数阻塞，具体做法：

1. 在新的 `H/src-tauri/src/media_generation/model_parameters.rs` 维护描述类型、有限规则解释器及 `validate_and_resolve(provider,model,kind,args)`。所有入口先把公共参数与扩展参数规范化成一个 map，并以实际 route description 校验；revision 不匹配返回 `MODEL_DESCRIPTION_CHANGED`，不提交。
2. `MediaImageOptions` / `VideoInput` 增加 `#[serde(flatten)] extra: BTreeMap<String,Value>`，移除**这两个内部参数结构**的 deny_unknown_fields；typed 公共字段仍做基本类型校验。duration 改为明确 `Seconds(u32)|Auto` 的非歧义 JSON union。输入转换不得因 round-trip 丢掉 extra。
3. `start`、图片 `image_arguments`、视频 `video_input/prepare`、video preview，以及对话/工作台/工作流入口都调用同一个验证器。未声明参数即 `MODEL_ARGUMENT_UNSUPPORTED`；未知模型只允许已知基本 prompt 路线，其描述标记不完整，不接受 arbitrary extras。
4. extra **不是直接 merge 到 vendor body**。图/视频适配器各自白名单映射已实现字段，例如 OpenAI 图像 `background → background`、`outputFormat → output_format`，JSON 和 multipart edit 路径一起改；缺 route 映射就不公开该能力。不能允许模型参数覆盖 model/auth/URL/请求头，也不能把 nsfwCheck 映成虚假安全开关。
5. 标准已有限制迁入描述：如图片 n≤4 保持适用的现有路线约束，而不是统一强制阻止新 MiniMax n≤9。模型/协议求交仍在现有 image/video route owner；它们生成 description，旧 capabilities 从 description 投影。参数规则不再由 CLI、UI 和 provider 各维护一套。
6. 同批改变所有真实消费者及生成 TS 契约；不另留 old/new executor。首批新增参数实证至少覆盖 OpenAI 图像 background/outputFormat、MiniMax 图像 seed=0（独立后端）、speech speed/instruction。其余 research/09 差距逐路由公开已实现部分，不能宣称整张原模型表全部可执行。

所属 ADR：§8 ADR 0010 的「描述与输入」条款。设置 UI：模型详情展示实际参数和不完整事实；媒体页不新增任意原始 vendor JSON 输入，普通用户控件由 descriptor 生成，选 false 与默认分开。测试：未知/拼错键、body 保留 false/0、重复 alias、auto 时长、条件存在性、共享配额、description 更新拒交、已知 route 无映射拒交；真实付费调用检查服务产物格式，而非只断言 mock 转发。

## 3. Dsivio speech：TTS 与参考音频克隆

### 3.1 供应商范围与配置

| 提供方 | 当前宿主确实拥有的配置入口 | 本阶段真实适配 |
|---|---|---|
| MiniMax | 通用 apiKeys；Token Plan 与 H3/Hailuo 预设，产品不同（§1 证据） | 显式 `speechProtocol:"minimax_tts"` 与服务 `speechBaseUrl`；pay-as-you-go key 验证，不默认借 Token Plan key。TTS + 参考音频克隆后 TTS |
| OpenAI | OpenAI 预设 + 通用 apiKeys（§1） | `speechProtocol:"openai_tts"`，TTS；已创建且本账户合法的 custom voice ID 可用于 TTS。**本阶段不发布 OpenAI 样本上传克隆操作**：其 eligible customer、consent/sample 流程不等于任意 key 都能克隆 |
| Volcengine/Doubao | 已有 Ark/Seedance bearer endpoint（§1） | 暂不实现 Doubao Voice TTS/ASR；openspeech 的产品凭证、resourceId 与 Ark 分离，不把 Ark key 自动转发到 openspeech。设置明确「Ark 不代表语音已配置」 |
| Google、其他 | 通用 provider 配置可承载连接，但当前 kind 没有 speech（§1） | 不凭供应商名猜能力；Gemini 首批仅独立后端的明确适配器 |

`H/src-tauri/src/settings.rs` 的 `ModelProvider.model_overrides` 实际值类型是 `ModelInfo`（`:245,389–411`）；在该类型增加 speechProtocol/transcribeProtocol/speechBaseUrl 等非敏感配置，仍引用同一 providerId/key owner。`workbenchMedia` 增加 `speechModels`、`transcribeModels`，保持有序默认；本地 whisperx 是专用内置 provider，不需要假 API key。语音产品必须显式启用并加入媒体池；连接检测失败不写成模型已可用。

公开依据：

- [MiniMax TTS](https://platform.minimax.io/docs/api-reference/speech-t2a-http)：`POST /v1/t2a_v2`，bearer，`model/text/voice_setting/audio_setting`，非流式 hex；HTTP 200 也检查 `base_resp.status_code`。
- [MiniMax voice clone](https://platform.minimax.io/docs/api-reference/voice-cloning-clone) 和 [指南](https://platform.minimax.io/docs/guides/speech-voice-clone)：上传 purpose=voice_clone 后 clone；mp3/m4a/wav、10秒–5分钟、≤20MB；自定义 voice_id 8–256 字符，不能复用同名；克隆后必须 TTS 才算实际语音产物。API 概览说明未使用临时声音 7 天删除，不能永久缓存有效性（[API overview](https://platform.minimax.io/docs/api-reference/api-overview)）。
- [OpenAI speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)：`POST /v1/audio/speech`，input≤4096，voice/instructions/response_format/speed；tts-1/tts-1-hd 不支持 instructions；[custom voices](https://developers.openai.com/api/docs/guides/custom-voices) 要求许可与本人同意录音，不能把一个 reference 文件直接当作 custom voice。

### 3.2 精确 CLI 与 JSON

```text
dsivio media speech --model <provider/model> --mode tts|clone
  (--text <UTF-8文本> | --text-file <文件或->)
  [--voice <系统或既有voice-id>]
  [--voice-ref <本地音频>] [--consent-attestation <确认文本文件>]
  [--instruction <文本> | --instruction-file <文件>]
  [--output-format wav|mp3|flac|opus|aac]
  [共同提交flags]
```

默认 mode=tts；tts 必须 voice，禁止 voice-ref；clone 必须且只允许一个 voice-ref、必须用户同意声明，不可同时 voice。clone 仅在 MiniMax descriptor 宣告时可用。consent-attestation 文件存用户授权的文字声明，不是伪造厂商要求的真人同意录音；若以后加入 OpenAI clone，必须另加 consent-recording/consent-id 端口并单独验收。text 原样保留，校验非空但不擅自重写说话文本。`--text-file -` 仅该字段消费 stdin，不能多个字段同时取 stdin。

```json
{"op":"submit","kind":"speech","model":"minimax/speech-2.8-hd","prompt":"","images":[],"options":{"mode":"clone","text":"欢迎来到我们的节目。","voiceReference":[{"source":"/abs/voice.wav","attributes":{}}],"consentAttestation":"/abs/authorized.txt","outputFormat":"wav","speed":1},"source":"dsivio-video","idempotencyKey":"build/voice","descriptionRevision":"sha256:..."}
```

统一返回任务（stdout 无 key）：

```json
{"id":"uuid","providerId":"minimax","model":"speech-2.8-hd","kind":"speech","status":"succeeded","createdAt":"ISO8601","error":null,"remoteId":null,"outputs":[{"path":"/app_data/media-tasks/uuid/audio.wav","mime":"audio/wav"}],"canResume":false,"origin":"cli/dsivio-video/...","prompt":"","result":null,"requestHash":"sha256:...","cancellation":null}
```

同步 vendor API 也进入异步 App task；`--no-wait` 在安全记录落盘后立即返回 taskId，CLI 不因长音频/clone 等到 120 秒传输上限才返回（现有连接超时 `H/src-tauri/src/media_generation/cli.rs:834–848`）。默认 CLI 等待 speech 600 秒。`--out` 复制全部 outputs，数组顺序不变；image/video 当前复制逻辑 `H/src-tauri/src/media_generation/cli.rs:880–898` 可复用。

MiniMax clone 是同一个 speech task 的多步状态机：`pending-upload → uploaded(fileId) → cloned(voiceId) → synthesized → downloaded`。各阶段持久化；voiceId 用 task UUID 确定性生成 `Dv<uuid_without_hyphens>`，不是每次重试生成新 ID。不得使用 preview text 再 TTS 两次付费；clone 请求省略 preview text，之后只发一次 TTS。保存 upload/clone/TTS 的确定回执及不确定状态；某步结果不确定不继续猜、不重交该步。声音 ID 是 provider 私有持久资源，`voices.rs` 记录引用、授权声明散列、有效期/使用状态；公共产物仍是 Audio，不能承诺永久 voice-id，也不能把敏感样本或 base64 写进任务日志。已有合法声音的复用通过明确 `--voice`，不从相同文件默默推定永久复用。

### 3.3 归属、UI、测试、ADR

- `H/src-tauri/src/media_generation.rs`：speech task 生命周期、幂等记录、终态；`speech_providers.rs`（新增）：MiniMax/OpenAI 请求与 response 解码；`voices.rs`（新增）：clone 子步骤与声音引用；`artifacts.rs`：音频 MIME/signature 验证、原子落盘；`cli.rs`：flags/IPC，不读 key。
- `H/src-tauri/src/settings.rs`、`src/settings/providerPresets.ts`：真实语音模型/协议候选；`src/settings/tabs/MediaCreationTab.tsx` 增语音池、声音列表/试音与授权提示。`SettingsShell.tsx` 当前只传 pool 回调（`H/src/settings/SettingsShell.tsx:1210`），扩带类型动作；复用全局 Button、Input/Select/Toggle，不复制控件（规范 `H/docs/engineering-standards.md:27–31`）。
- `H/src/api/tauri.ts`、`src-tauri/src/lib.rs`：list voices、delete local voice reference、connection check 的类型化入口。删除本地引用不伪称已经删除 vendor 声音，远程删 voice 仅适配器明确支持时提供。
- 测试覆盖 HTTP 200 内业务错误、音频 MIME 假冒、clone 上传成功后中断、同键并发、文本/样本变更幂等冲突、expired voice、拒绝不支持的 instruction、授权缺失、同源下载。真实 MiniMax TTS + clone、OpenAI TTS 必须试听并 ffprobe；再 Normalize→SemanticTake，不用 TTS 文案估时长。
- ADR：§8「speech」条款，明确凭证/授权及多步不确定提交。

## 4. Dsivio transcribe：本地 WhisperX 与配置后的云 ASR

### 4.1 命令与结果

```text
dsivio media transcribe <本地标准WAV>
  --language <小写2–3字母，排除auto/und>
  [--model local/whisperx-small|<provider/model>]
  [--sample-frames <正安全整数>]
  [--timestamps word|segment] [共同提交flags]
dsivio media asr status [--json]
dsivio media asr install [--model small] [--language en] [--language zh] [--json]
dsivio media asr stop [--json]
```

transcribe 默认 word；标准输入为 WAV 16kHz/mono/PCM s16，data 长度必须恰好 sampleFrames×2；没给 sample-frames 时从合法 WAV 读取。App 不偷偷再转换。一般用户给 MP3/视频由 `dsivio-video transcribe` 原有提取步骤处理；SemanticTake 已有标准证据直接传，不重复提取。audio 路径 CLI 绝对化、App 拷贝到该 task 的专用证据目录后再返回受理，插件临时目录可在最终任务完成/取消后清理。

```json
{"op":"submit","kind":"transcribe","model":"local/whisperx-small","prompt":"","images":[],"options":{"audioFile":"/abs/evidence.wav","language":"zh","sampleFrames":32000,"timestamps":"word"},"source":"dsivio-video","idempotencyKey":"build/evidence","descriptionRevision":"sha256:..."}
```

完成仍返回 MediaTask，`kind:"transcribe"`，outputs 是 application/json 证据文件，`result` 为以下（大小超限制则 result=null，仅输出证据路径）：

```json
{"schema":"dsivio.media.transcript/1","language":"zh","sampleRate":16000,"sampleFrames":32000,"engine":{"backend":"local","model":"small","protocol":"dsivio-video.asr/1","serviceVersion":"0.2.0","whisperxVersion":"3.8.6"},"segments":[{"text":"今天","start":0.1,"end":0.8,"words":[{"text":"今","start":0.1,"end":0.3,"score":0.9},{"text":"天"}]}]}
```

词时间/score 可缺省；保留未对齐词，不插值、不补伪造 timestamp。已有插件 AsrReply 是 language/segments/words，可由该结果无损解码（`P/src/asr/client.ts:5–8`）。CLI 默认等 600 秒；超时 124 携带 taskId，用户继续 wait，不是失败重提。stdout 一直是任务对象，`--json` 不切为旧 raw transcript；修改插件两个消费入口，不维持两种 output 契约。

安装控制不等待一个可能持续30分钟的回环响应。新增 IPC `{"op":"asrstatus"}`、`{"op":"asrinstall","model":"small","languages":["en","zh"]}`、`{"op":"asrstop"}`（沿用现有Op小写tag）；install立即返回安装操作状态，CLI退出0表示已开始/复用，不表示ready，脚本再查asr status。状态形状：

```json
{"operationId":"uuid","state":"installing","installationId":null,"serviceVersion":"0.2.0","model":"small","languages":["en","zh"],"progress":{"stage":"dependencies","message":"正在安装固定版本依赖"},"error":null,"runtime":{"state":"stopped","pid":null,"activeTaskId":null}}
```

status读同一状态；同配置并发install返回同operationId，配置不同且正在安装返回 `ASR_INSTALL_CONFLICT`/退出2。asr stop只停空闲服务，返回 `{"outcome":"confirmed","runtime":{"state":"stopped","pid":null,"activeTaskId":null}}`；busy返回 `ASR_BUSY`/退出2，给出需cancel的taskId，不能停止其他任务以伪装安装成功。设置的安装取消调用新类型化 `cancel_local_asr_install(operationId)`，取消仅影响对应operation；不是向未知进程发kill。transcribe.result内联上限3MiB，完整Reply仍须小于现有4MiB回环上限（`H/src-tauri/src/media_generation/cli.rs:36`），其余证据只通过outputs JSON文件交付，不能让MAX_LINE截断后被误判为可重提。

### 4.2 locate、install 与 supervise 的唯一归属

当前插件 `install.ts` 固定协议 dsivio-video.asr/1、service 0.2.0、WhisperX 3.8.6，默认 small/en/zh/cpu/int8/batch=8；先 venv、pip、prepare 后写 config；已装但未启动时按需启动；尚未自动安装（`P/src/asr/install.ts:9–77`、`P/src/asr/service.ts:61–63`）。当前 server 只有回环 HTTP、根路径验证、离线模型推理、单推理锁和 300 秒空闲退出；它不是 App 已有的一项服务（`P/services/asr/server.py:34–86,118–144,166–253`）。

**选择 App 原生监督，而非设置页调用插件 detached 服务**：

1. 发行同步新增 `H/scripts/sync-dsivio-video-asr.mjs`（构建用）从固定插件 release revision 的 `services/asr/{server.py,prepare.py,requirements.txt}` 和 manifest 拷贝至 `H/src-tauri/resources/dsivio-video-asr/<serviceVersion>/`。manifest 记录插件 revision、源文件 SHA256、协议/WhisperX 版本。插件是唯一源码 owner，Host 副本是发行资源；不让两个仓库各自修 Python。手动安装不要求先完成市场 setup，也不扫描任意项目目录执行 Python。
2. `H/src-tauri/src/media_generation/local_asr.rs`（新增）独占安装状态与 child handle；用 `media_runtime` 的公开 Python 工具定位，不硬编码开发路径。现有工具定位仅检查 bundled 文件且可重定位，尚无 WhisperX installer（`H/src-tauri/src/media_runtime/runtime.rs:32–65,74–113`）。无兼容 Python 时明确失败，不偷偷用 PATH 全局 pip。
3. 数据：`<app_data>/media-services/whisperx/<serviceVersion>/<installationId>/{venv,cache,config.json}`；`active.json` 指向已验证安装；run/锁/日志 0600，父目录 0700。安装状态 `{state:notInstalled|installing|ready|failed, installationId,serviceVersion,model,languages,progress,error}` 由 local_asr 持有，不塞进设置草稿；设置仅存 desiredModel、languages、autoInstall=true 等意图。
4. 手动按钮和首次 transcribe 共用 `ensure_installed(config)` 单航班：版本/源 SHA 匹配→新 staging venv→`bundledPython -m venv`→`venvPython -m pip install --disable-pip-version-check -r requirements.txt`→`prepare.py --model small --languages en zh --cache <cache>`→真实 health/短音频自检→停止空闲旧服务→原子 active 切换。失败保留上一可用环境，不在正在推理的 venv 原地 pip。ASR/对齐/NLTK 下载只在安装/添加语言动作发生；推理设置 offline，断网不下载。依赖采用插件固定 requirements；发行资源 manifest 校验防篡改，不声称当前 requirements 已有 wheel/model hashes。
5. 首次实际本地 task 进入 installing，设置显示下载进度；不是在 plan 或每次启动 App 就装。autoInstall=false 时返回 `ASR_INSTALL_REQUIRED` 并给设置入口/`dsivio media asr install`。manual install 新语言仍同一流程。App 安装操作最长 30 分钟/子进程，取消安装清 staging、不切 active；当前 CLI wait 600 秒超时不取消后台安装。
6. App child 由 tokio Child handle 持有，启动 `server.py --port 0 --model small --device cpu --compute int8 --batch-size 8 --cache <active/cache> --allow-root <app_data证据目录> --token-file <私有nonce文件>`；现有服务固定监听127.0.0.1，不添加任意host开关（`P/services/asr/server.py:229–250`）。本阶段新增token-file参数和stdout JSON ready通知 `{port,pid,protocol,serviceVersion}`。所有 health/transcribe/shutdown 请求验证 nonce，拒绝带非本地 Host/浏览器 Origin，run 信息原子发布。不能仅靠 PID 或 health 版本等于某值就接管进程；不复用插件 ~/.dsivio-video/asr/run.json。
7. 生命周期 `stopped→starting→ready→busy→ready→stopping`；startup 120 秒，一次健康探测确认版本/model/config；App 队列串行喂单推理服务，避免 BUSY 后盲重试。退出通知绑定 child generation，迟到 exit 不清掉新进程；App 退出停止其拥有的 child，空闲 300 秒停止；崩溃使当前 task 显式失败，未来 task 可按需重新启动，不无限重启/重新识别。本地 cancel 正在推理时停止受监督 child、确认退出才 cancelled；排队任务不受影响。绝不 kill 只从磁盘读来的不可信 PID。
8. 安装进度与进程状态用媒体领域的类型化命令/event；借鉴而不并入 ONNX manager。已有 ONNX 安装/校验在 `H/src-tauri/src/offline_models.rs:449–465,639–669,1098–1143`，已有 OCR 的迟到 exit/按需启动/停止在 `H/src-tauri/src/macos_ocr.rs:132–218,270–291`。它们提供模式，不证明 ASR 已部署。

服务 Python 改动（token、ready 通知、受监督停止）仍只改 `P/services/asr/server.py`；`P/src/asr` 在 standalone 使用同协议。Host 不调用插件 JS 的 detached startAsr，也不共享安装目录，保证两个模式不会争 child/venv。

### 4.3 云选项、settings 与测试

首批 OpenAI `whisper-1`：`POST /v1/audio/transcriptions` multipart，`file/model/language/response_format=verbose_json/timestamp_granularities[]=word`（[官方契约](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)）。云输入受厂商大小限制；公开 descriptor 固定该模型允许上传域。gpt-4o-transcribe 等不得仅因为能转文字就公布 wordAlignment=true。结果转成同一 transcript JSON，缺时间保持缺省。默认本地，只有用户在媒体池明确选择/作者显式指定云模型才上传；本地安装失败**不自动转云收费/泄露音频**。Volcengine 云 ASR 暂不进入可用列表，Ark 凭证不足以启用语音识别。

归属：`local_asr.rs` 管本地资源生命周期；`transcribe_providers.rs`（新增）管 OpenAI 解码；`media_generation.rs` 管 task 队列/产物/状态；`cli.rs` 管 transcribe/asr 子命令；`artifacts.rs` 负责 JSON 证据原子提交；`settings.rs` 增 `localAsr:{model:"small",languages:["en","zh"],autoInstall:true}`（默认/迁移归后端）。新增 commands `get_local_asr_status/install_local_asr/stop_local_asr` 在领域模块定义、`lib.rs` 注册、`api/tauri.ts` 暴露。settings MediaCreationTab 增「本地逐字转写」区：未装/安装进度/模型与语言/手动安装、重试、停止、默认自动安装开关；另有云转写池并显示上传/费用提示。不能裸 invoke，不能在组件写 pip 命令。

测试/实机：没有缓存的首个 task 实际自动装→真实中文/英文录音 words→第二次断网命中缓存；手动安装同一配置不重装；手动与自动并发单安装；安装失败不破坏旧环境；取消安装/推理/退出 App 后无孤儿；bad WAV/sampleFrames/MIME、缺语言、坏 health/nonce/Origin；缺词时间不伪造；启动 generation 迟到事件；云 whisper-1 真实付费录音，与本地选择分离。ADR：§8「本地服务与 ASR」条款。

## 5. cancel 与抠像边界

### 5.1 精确取消契约

```text
dsivio media cancel <task-id> [--timeout <秒，默认30>] [--json]
```

IPC `{op:"cancel",id:"uuid"}`；无 resubmit、无删除任务或产物。返回：

```json
{"id":"uuid","outcome":"confirmed","scope":"local","charged":"no","task":{"id":"uuid","kind":"transcribe","status":"cancelled","outputs":[],"canResume":false}}
```

outcome=`confirmed|requested|unsupported|too-late`；scope=`local|remote|none`；charged=`no|maybe|yes|unknown`（yes 只能有实际证据）。cancel 命令成功交互退出 0，即使 unsupported/too-late，也须读 outcome；参数/连接错误仍 2/6。wait/status 遇 cancelled 退出 **7**（新增稳定退出码），不可当成功或可重提。`MediaTask` 增 `cancellation:{requestedAt,scope,outcome,confirmedAt?}`，`MediaStatus` 增 cancelled；requested 期间仍 running。不能仅 abort HTTP 就宣称停止了云端生成。

- 提交前本地队列取消：confirmed/no；正在本地 WhisperX：监督 child 退出后 confirmed/no。
- 同步云 speech/image：若请求未发则本地 confirmed；已发通常 unsupported/maybe，保留任务/回执与后续查询，不谎称退款。
- 视频异步：descriptor.lifecycle.remoteCancel 仅适配器有真实无歧义取消 API 时 enabled。MiniMax 的 [DELETE API](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete) 在 queued 时取消、终态时**删除记录**，存在 query→DELETE 竞态；因此本阶段不把它公布为安全 remoteCancel（unsupported），避免取消按钮删除已完成回执。未来 provider 若提供原子状态条件取消才能开启；不是靠先查 queued 保证安全。
- 不支持远程取消不停止 App 的收据保存/必要查询，但插件 Build 停止消费后续产物；用户可在任务列表查看真实状态。too-late 保留成功产物。重复 cancel 幂等，取消终态不能被迟到成功覆盖。

owner：`media_generation.rs` 增 per-task control/CAS，provider 模块实现明确 `cancel` 结果，cli 增 Op::Cancel；`H/src/chat/workbench/MediaTaskList.tsx` 目前任何非running/nonsucceeded都显示失败（`:21–25`），同批增 cancelled/取消按钮；`api/tauri.ts` 增 cancelMediaTask。工作流现有 cancel 只停后续而保留已提交媒体任务（`H/src-tauri/src/generation_workflow/mod.rs:188–193,310–314`），**维持该语义**，不隐式改成全远程 cancel；显式媒体取消才调用新入口。新增 kind 的 UI 图标/文案及 exhaustiveness 一起迁移，不让 speech 显示「生成视频」。

测试：排队/发出请求边界、取消完成竞态、重复取消、App重启读取 cancellation、迟到结果、unsupported/too-late、无远程 DELETE 副作用；实机取消本地任务证明 child 退出，再提交能正常工作。ADR：§8「取消事实」条款。

### 5.2 background removal / portrait matting：延期，不做假接口

research/05 §2.16 静态图要求真透明 image；§2.17 人像视频要求 WEBM/MOV alpha、尺寸/时长来自源，原端点经已移除网关；普通 image 生成、ffmpeg 裁切、改扩展名都不等价。宿主当前 MediaKind/CLI 无此操作（§1 证据）。[remove.bg 公共 API](https://www.remove.bg/api) 有 `POST https://api.remove.bg/v1.0/removebg`、X-Api-Key、image_file，**只证明静态图服务**，其 key 不属于现有生成 provider 凭证事实；不能把它当视频方案。没有在本阶段确认可用的直连人像视频 API/授权/alpha 回执，因此作明确延期决定。

未来能力的确定形状（**不作为本阶段已上线命令/可执行 capability**）：

```text
dsivio media matting --model <provider/model> --mode image|portrait
  (--input-image <文件> | --input-video <文件>)
  --output-format png|webm|mov [共同提交flags]
```

`options={mode,source:[{source,attributes:{}}],outputFormat}`，image 只 PNG alpha，portrait 仅 WEBM/MOV；description products 包含 hasAlpha=true、container/codec 的已验证允许域。返回标准 matting MediaTask、alpha 产物，而不是 mask 与不透明视频混淆。未来归 `matting_providers.rs` + 既有 lifecycle/artifacts；settings 增 mattingModels 和产品凭证/透明输出说明。测试必须实际 alpha checkerboard 合成、ffprobe/pixel 验证、源时长尺寸保持、音频保留策略明确、无假 MP4。

本阶段 `models --kind matting → []`；调用未发布的 matting 命令明确 `MEDIA_OPERATION_UNAVAILABLE`/退出2，插件在 plan 指出能力缺失，不生成假已解析 Need。`gateway/matting` 的请求/返回契约见下一节，但只有真正 provider 交付后才注册可执行能力。支持导入 PNG/alpha WEBM/MOV 继续制作；不保留一个假「已完成」抠像元素。ADR：§8「抠像延期」条款。

## 6. 插件侧 clean cutover

### 6.1 网关能力与作者元素

| 能力 | request / returns | 本阶段执行 |
|---|---|---|
| gateway/speech | `{model,mode,text,voice?,voiceReference?,instruction?,options,capabilitySnapshot,backend}` → `media@1#Audio` | Dsivio / standalone；异步 task，全部输出记录，作者 `.audio` 显式取第一项 |
| gateway/transcribe | `{audio:SpeechAudio,language,model,timestamps,capabilitySnapshot,backend}` → `pipelineTypes.evidence` | Dsivio 默认本地/显式云，standalone 本地 WhisperX；秒→整数样本的现有 evidenceFromReply 转换 |
| gateway/matting | `{model,mode,source,outputFormat,options,...}` → 带 `mediaKind:image|video` 的私有 MattingResult | 契约预留但延期，不注册假 executor；真 provider 交付时分别投影 Image/Video |

`P/src/gateway/index.ts` 现在只注册 image/video 且 gateway 只接受 auto/dsivio（`:11–38`），扩展 backend 决策/描述读取；`request.ts`、`validate.ts` 采用 §2 模型参数解释器，不能在作者模块写模型名分支。

`gen:Speech` 同一 `dsivio-video/gen@1` 模块：

```xml
<gen:Speech id="narration" model="minimax/speech-2.8-hd"
  mode="tts" text={scriptText} voice="Chinese_Female_Emotional" output-format="wav">
  <gen:Option name="speed" type="number" value="1"/>
</gen:Speech>
<gen:Speech id="cloned" model="minimax/speech-2.8-hd"
  mode="clone" text={scriptText} voice-ref={authorizedVoice}
  consent-attestation="assets/voice-consent.txt" output-format="wav"/>
```

text 必填 Text 引用或非空 literal（literal 变私有 Text）；model 显式；voice-ref 必须 Audio 的整值引用；consent-attestation 是项目内明确文件，纳入输入资源散列，不能让源码中的布尔 true 代替真实用户授权。instruction 同样 Text/literal。元素无正文/任意子元素；Option 是明确 scalar/json 参数、重复名报错，媒体不得塞到 JSON 字符串，必须保留图依赖。tts/clone 的必填互斥由 live descriptor校验，输出 `${id}.audio`；没有独立凭证/厂商 URL 作者属性。示例 voice ID 需实际模型能力验证，不是跨厂商通用音色。

语音产物进入 Timeline：Audio→Normalize（真实时长）→单 Segment SemanticTake→Timeline；或独立 AudioTrack。禁止把 TTS 输入文案当 word timestamps。voice reference 用于视频无需自动 SemanticTake。

### 6.2 两条 transcribe 路线必须同时迁移

当前 CLI 已先试 Dsivio，但把任意退出2视为可回退（`P/src/cli/commands/transcribe.ts:85–103`）；pipeline 直接 transcribeLocal（`P/src/pipeline/capabilities.ts:60–65`），producer 发 `local/align`（`P/src/modules/align/index.ts:31`）。本阶段：

1. 增 `src/asr/backend.ts` 作为共享后端选择/结果解码入口（CLI与gateway两个真实调用者），由 config/backend snapshot 决策，不是另建任务状态机。
2. producer 的 evidence Need 改 `gateway/transcribe`，删 localCapabilities 中 align 执行分支与本地直调用，不留 local/align alias。evidenceFromReply 仍负责样本边界与未对齐数据，不改成四位小数 CLI transcript。
3. CLI transcribe 仍提取并发布现有 transcript document，但从 MediaTask.result/JSON output 取证据；暂存音频生命周期到任务完成/取消，不提前删除正在读取的文件。业务失败、坏结果、任意退出2不得触发 fallback。
4. auto 只有 App 不可达（退出6/command ENOENT）才在 **plan/CLI进入执行前** 选 standalone；App 可达但未实现 transcribe 时明确缺能力，旧版本不偷偷启动插件本地服务。`gateway:dsivio` 强制模式永不 fallback；已选后端的 Build 在 App 关闭时等待，不换后端。
5. `setup asr` 在 dsivio 模式调用 `dsivio media asr install`；standalone 才使用插件 installAsr/startAsr。`doctor/setup status` 显示实际 owner/install状态，不通过 config 文件存在假称推理已 ready。

### 6.3 模型 options 与取消

`GEN_OPTION_UNSUPPORTED` 当前在 `P/src/gateway/validate.ts:7` 和 `dsivio.ts:55` blanket 拒绝，gen 仅 Video 支持 Option（`P/src/modules/gen/index.ts:60,103–120`）。新 contract 落地后删除两处 blanket 和相关假限制文案；Image/Video/Speech 均接受 Option，先 description 校验，未知键仍 `MODEL_ARGUMENT_UNSUPPORTED`。旧宿主无 description 时只允许旧公共参数，options 精确报「宿主描述不可用」，不是随意透传。executor 将公共 flag 及所有 options 一次规范化，只发送一个 options-file，避免 audio=false 与其他 options 各生成重复 --options-json。已解析请求存 description hash、请求 hash、参考顺序/项属性、后端/provider identity；执行前 Pending 物化再检媒体，规范参数或能力变化要求 replan。

`dsivioExecutor` 增 cancel 调 `dsivio media cancel`，映射 confirmed/requested/unsupported/too-late；core AsyncExecutor 已有该接口（`P/src/core/capability.ts:56–64`）。不能仅 kill CLI submit 推定未扣费；保留目前不确定提交保护（`P/src/gateway/dsivio.ts:33–35,78–85`）。适配 cancelled 的 PollResult，worker 不继续将取消任务发布成结果。

主要 owned files：`src/gateway/{index,request,validate,dsivio}.ts`、新 `description.ts/backend.ts`、`src/modules/gen/index.ts`、`src/modules/align/index.ts`、`src/pipeline/capabilities.ts`、`src/asr/{backend,install,service,client}.ts`、`src/cli/commands/{transcribe,setup,doctor,vocabulary}.ts`、既有 build worker/类型；测试就近更新真实语义，不保存只断言 source/wiring 的测试。对应技能/README/architecture/research「当前不可用」说明在实现提交同步更新，不把历史研究静态核对日期改成新实测。

## 7. Standalone：Claude Code / Codex 不依赖运行中 Dsivio

### 7.1 配置与首批两家

项目 `.dsivio-video/config.json`：

```json
{"gateway":"standalone","asr":{"backend":"local","model":"small","languages":["en","zh"]}}
```

`gateway:auto|dsivio|standalone`。auto 在 plan 用一次无付费 App models 探测：连接成功→Dsivio；不可达→standalone；业务错误/鉴权/缺模型不 fallback。选择按整个 Build 固定，不按每个失败节点混换。

用户 `~/.dsivio-video/gateway.json`（示例不放实际 key）：

```json
{"schemaVersion":1,"providers":[{"id":"minimax","adapter":"minimax","baseUrl":"https://api.minimax.io","apiKeyEnv":"MINIMAX_API_KEY","enabledModels":["image-01","MiniMax-H3","speech-2.8-hd"]},{"id":"google","adapter":"gemini","baseUrl":"https://generativelanguage.googleapis.com/v1beta","apiKeyEnv":"GEMINI_API_KEY","enabledModels":["gemini-3.1-flash-image","veo-3.1-generate-preview","gemini-3.8-flash-tts"]}]}
```

同对象允许 `apiKey` 明文（env 指向存在且非空时优先，空 env 明确配置错误，不悄悄换另一把）；默认没有文件时 env key 存在才启用相应 adapter 的已验证模型集合。provider id 是本地 connection identity，不是厂商品牌昵称；两个账户给不同 id。Gemini 模型以此次公开文档的明确 ID 为候选，不自动跟随 latest，模型退休/403 明确报错，禁止代换。

选择两家而非万能聚合网关：

| Adapter | image | video | speech | 理由/限制 |
|---|---|---|---|---|
| MiniMax | image-01；`POST /v1/image_generation` | MiniMax-H3；`POST /v2/video_generation`，`GET /v2/query/video_generation/{id}` | speech-2.8-hd；`POST /v1/t2a_v2`；clone `/v1/files/upload`→`/v1/voice_clone`→TTS | 同一官方 pay-as-you-go 产品族，支持真实 voice clone，补中文声线/参考媒体；Token Plan key 不适用 |
| Gemini | gemini-3.1-flash-image；`POST /v1beta/interactions`，input text/image，取 output image | veo-3.1-generate-preview；`models/{id}:predictLongRunning`→GET operation→视频下载 | gemini-3.8-flash-tts；`models/{id}:generateContent`，text/speech_metadata、responseModalities=AUDIO、speechConfig.voiceConfig.voice | 一个官方 API key 覆盖三类，原生图像参考和视频；初期仅系统 voice TTS，不对音频引用声称克隆 |

官方依据：[MiniMax image](https://platform.minimax.io/docs/api-reference/image-generation-t2i)、[image reference](https://platform.minimax.io/docs/api-reference/image-generation-i2i)、[video create](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[query](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)；[Gemini image](https://ai.google.dev/gemini-api/docs/image-generation)、[Veo](https://ai.google.dev/gemini-api/docs/veo)、[Gemini TTS REST](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)。OpenAI 虽有 image/TTS，公开 [Sora guide](https://developers.openai.com/api/docs/guides/video-generation) 已写 Videos API/Sora2 于 2026-09-24 停用；**不选其作为覆盖三类的首批独立供应商**。Dsivio 内 OpenAI TTS 设计不依赖 Sora。Volcengine 图/视频/语音的不同产品认证成本更高，待明确新增 Voice 配置后接，不从 Ark 猜 key。

首批 descriptor 只公开已实现 route 的参数：MiniMax image prompt≤1500、n 1–9、aspectRatio/width/height/seed/promptOptimizer，width/height 512–2048/8倍数、与 ratio 的 precedence 必须显示，不 silently 改请求；video H3 resolution 768P/2K、duration 4–15、参考/帧互斥及源媒体限制按官方 contract；Gemini 每个明确模型独立描述，Veo 原生音频不能虚称有关闭开关，TTS 仅 input text，不接受 reference audio。尚未实现的高阶（视频延长、多说话人、声音设计）不进入描述，但普通 image/video/TTS/本地 transcribe 是本阶段完整路径。

Gemini 音频须读实际返回 MIME：返回 WAV 则保存 WAV；若具体模型返回裸 PCM，只有 API 元数据明确 sampleRate/channels/encoding 时按公开接口归一化为 WAV 并在请求/产物声明此适配，不能凭扩展名猜。raw 字节/音频大小与 result metadata 矛盾即失败。

### 7.2 与 Dsivio 相同的模型描述与 plan

新增 `P/src/gateway/standalone.ts`、`providers/{minimax,gemini}.ts`、`description.ts`。adapter 实现 `{describe,submit,poll,cancel}`，直连协议只在这里；module/plan 不知道 URL/header。providers 返回 §2 同一形状 description，transport 依然是规范 flag/optionKey（便于展示/复用），不是 vendor wire 参数。密钥存在只能说明 configured，descriptor 标记 availability，不在 plan 做付费探测。

plan 不启动 Dsivio：读取配置→选 backend→读取 adapter 版本化描述→解析 explicit connection/model→验证参数/默认/媒体探测与组合→展示 backend、参数、引用顺序、未知价格、云上传提示→Build 保存规范请求/descriptor hash/adapter version。凭证是否缺失、模型是否启用在 plan 就失败；网络权限/余额无法本地保证，执行时保留准确 vendor 错误。Pending 媒体只延后必须实际文件才能确定的约束，其余立即检验。`vocabulary models` 使用该入口，不能仍硬调用 Dsivio。

本地 ASR 的 standalone model 为 `local/whisperx-small`，descriptor 与 Dsivio 本地服务一致；插件自己 ensureInstalled/installAsr + service，同一 Python源码、不同用户数据目录，原生工具按 env→Dsivio tools（若可用）→PATH→managed 查找。首次识别自动安装受配置控制，明确下载进度；plan 不安装。显式 standalone 云 ASR 不在首批范围，不借 Gemini 音频理解冒充逐词对齐。

### 7.3 异步、幂等、不确定提交

沿用 Build worker/SQLite 命令身份，不另写守护进程和轮询框架。增加账户级提交账本 `~/.dsivio-video/gateway/tasks.sqlite`（目录0700/文件0600），唯一键 `(providerId,idempotencyKey)`；记录 requestHash、adapterVersion、stage、taskId/remoteId、outputs、createdAt/acceptedAt、submissionState/cancellation，不含 key。跨进程 SQLite transaction/CAS 只允许一个 owner 从 prepared→submitting；**在发网络前 durable commit submitting**。共享 key 不同请求 hash 返回 `IDEMPOTENCY_CONFLICT`，不能返回另一张图。

- synchronous image/TTS：先提交账本，再发一次请求→原子存产物→success，统一 AsyncExecutor handle 指向本地taskId；poll 只读状态，不能重发。断在「厂商可能收到了、尚未本地成功记录」则 uncertain；无查询 API 时输出人工核对信息，绝不声称 exactly-once 可恢复。
- async video：保存 receipt 后 query only，poll 节奏10秒、遵守 Retry-After；429/5xx 的**查询**可有限退避，提交不自动重试；MiniMax超过7天收据查询窗口/URL过期显式失败、保留证据，不能重新生成。Gemini保存 operation name，禁止从 prompt 搜列表猜自己的 task。
- POST 未确认明确拒绝（4xx、排除408/429，且厂商业务码明确未受理）→rejected，可用户修正后用新稳定操作键/请求；其余传输错误/5xx/坏JSON→uncertain。如果 adapter 有官方幂等能力才发送对应 header，不能自行编造「X-Idempotency-Key 就保证去重」。
- crash/restart：未发 prepared 可继续；submitting 无receipt 不重发；accepted 有receipt继续查；成功文件按SHA存在可直接发布；不确定的 clone 各子阶段同 §3，不能只给最终TTS幂等。
- cancel 使用 §5 outcome，不将 abort fetch 当 confirmed remote；pending local ASR 真实 child退出可 confirmed。账号级账本是唯一 gateway提交状态，Build只存 SubmissionLink，不在两个库分别写remote状态；CLI worker crash后的 owner失效仍遵守uncertain。

### 7.4 安全

- 默认 env；明文文件可用但如实告知不是加密。目录0700、文件0600/Windows仅当前用户ACL，拒绝 symlink、非普通文件、POSIX组/其他可读；写新文件用0600临时文件+atomic rename，不把 key 写项目config/源码/git、Build/plan/产物/日志。迁移权限不默默chmod别人的文件，错误给明确修复方式。
- adapter key只在HTTP进程内用；下载 manual redirects，同源才附 key/Google header、HTTPS不得降级、无URL凭证、大小上限/part提交、检查真实MIME。key不放querystring，error过滤Authorization/API key及signed URL。
- 首批只允许两个官方HTTPS origins及明确区域地址枚举；不支持任意项目baseUrl重定向到内网。自定义网关是后续独立产品能力，不在本阶段借通用配置开SSRF口。
- 子进程（ASR/npm/ffmpeg）最小env、无shell拼接、不继承云端key；provider/sample授权隐私提示，声线样本仅显式clone上传；不自动训练/克隆无授权人物。
- 环境变量优先仍不让 config apiKey 出现在 plan；adapter版本变更模型事实时 replan，不以热更新描述改变已批准付费请求。

测试：无Dsivio可计划/执行、env与file优先/权限、账户隔离/并发同键、不同hash冲突、false/0/specialValues、已发无receipt不重交、恢复原receipt、signedURL脱敏/跨域无key、云解码拒绝错误MIME；两家各一次真实图像/视频/TTS、MiniMax授权clone、standalone真实WhisperX，无App也完成合成。用户已批准测试费用，不能只用mock声明供应商完成；记录实际usage/账单事实，价格未知保持未知。

## 8. Dsivio ADR 0010 草案（实施时新增）

拟落盘 `H/docs/adr/0010-media-gateway-describes-models-and-owns-local-asr.md`；当前 ADR 列表到0009，实施前若编号已占用用下一个编号，标题与决策不变。

> # 媒体网关描述真实参数，并拥有本地转写生命周期
>
> **状态：接受（随本阶段实现提交）。**
>
> ## 背景
> ADR0009已确定App媒体生成只有一套实现，CLI是本机客户端。图片/视频的固定输入与能力表尚不能表达语音、逐字转写、扩展参数及取消。本地WhisperX有安装、模型准备、队列和进程生命周期，不能散落到设置页、插件与CLI各自监督。
>
> ## 决策
> 1. **描述与输入**：media_generation是App唯一媒体任务负责人。models为每个有效连接/模型公开版本化参数描述；校验、默认与实际可发送参数来自同一route描述。外层请求继续拒绝未知字段，内部参数以已声明key白名单接受；不允许任意vendor body透传。CLI、页面、对话和工作流走同一校验。能力变化要求重新计划。
> 2. **Speech**：首批MiniMax TTS/授权样本clone→TTS、OpenAI TTS进入同一task生命周期。凭证由App持有，模型协议/产品地址显式配置；聊天/视频key不推定有语音权限。clone子步骤持久化，结果不确定不重交；OpenAI样本clone、声音设计与Volcengine语音不在本次实现范围。音频输出必须验证真实格式。
> 3. **本地服务与ASR**：App owns WhisperX的安装、队列、child、关闭和取消。源码唯一在dsivio-video/services/asr，Host发行复制同revision/hash的资源快照。手动安装与首次真实需要共用单航班入口，plan不安装；只在准备阶段下载，推理离线。安装失败不替换旧环境，不自动改为云端。首批云ASR仅显式启用的OpenAI whisper-1。
> 4. **取消事实**：取消返回confirmed/requested/unsupported/too-late，并分local/remote与费用事实。abort客户端不代表远程取消/退款。取消不删除回执或产物，迟到结果不能覆盖confirmed cancelled。存在取消/删除混合竞态的接口不公布remote cancel。
> 5. **抠像延期**：静态去背景与人像视频alpha输出必须有真实provider/产品权限/验证才公开；本次不发布无执行者的matting能力。导入透明素材不是生成抠像完成。
> 6. **插件边界**：Dsivio模式插件不读App key、不直连厂商、不启动第二套本地ASR。standalone是用户明确选择的无App模式，在插件侧使用用户自有env/私有文件key；不能作为一个已选Dsivio Build的执行失败fallback。backend在plan固定。
>
> ## 后果与验收
> 任务/状态只有一个App owner，设置保存沿用既有CAS；描述新增参数时必须同时实现输入校验和route编码。新增语音/ASR/取消状态的已有调用者与任务UI同批迁移。实机证明本地自动/手动安装、退出/取消清理；真实付费图/视频/语音与云ASR证明产物，不用mock替代。用户自有明文key的安全限制如实说明，不声称加密。
>
> ## 对ADR0009的关系
> 扩展其能力与任务终态，不改变App内单一实现、CLI无密钥和不确定提交不重交原则。standalone不读取App设置，因此不是0009范围内的平行协议实现；旧CLI公共flags保留，旧能力输出从新description投影，不另维护旧参数校验器。

## 9. Dsivio 市场：subdir、首次 setup、项目隔离

### 9.1 真实安装边界与 catalog entry

当前市场 `load_market_catalog` 读取 `resources/plugins/catalog.json`，不是远端 packages/catalog.json（`H/src-tauri/src/market.rs:188–192,1153–1169`）。内置catalog形状 `{categories,plugins}`，没有schemaVersion；CatalogPlugin支持repository/revision/skills/unpack/requiredFiles/setup/project/projectPrompt，但无subdir（`H/src-tauri/src/market.rs:57–105`）。内置安装只解Skill，不执行npm，不存在PostInstall hook（`H/src-tauri/src/market.rs:1442–1499`；`H/docs/agents/plugin-hooks.md:63–74,108–114`）。所以「市场已安装」不等于CLI/node_modules就绪。

在 `H/src-tauri/resources/plugins/catalog.json` 的 plugins 数组**追加**：

```json
{
  "id": "dsivio-video",
  "name": "Dsivio Video",
  "skillId": "dsivio-video",
  "summary": "Agent 驱动的参考视频复刻、分镜生成与成片合成",
  "welcome": "可以从参考视频、素材或脚本开始制作视频。",
  "inputHint": "描述要制作的视频，或提供参考视频路径",
  "startPrompt": "先检查 Dsivio Video 环境与当前项目，再按我的目标规划视频；付费生成前显示完整请求。",
  "setup": "dsivio-video-setup/SKILL.md",
  "project": {"name": "Dsivio Video", "dir": "DsivioVideo"},
  "projectPrompt": "dsivio-video-setup/project-prompt.md",
  "icon": "dsivio-video-setup/icon.svg",
  "iconPath": "icon.svg",
  "repository": "ZMGID/dsivio-plugins",
  "revision": "${DSIVIO_VIDEO_RELEASE_COMMIT}",
  "subdir": "plugins/dsivio-video",
  "categoryIds": ["videos"],
  "skills": ["dsivio-video"],
  "unpack": "skills"
}
```

`${DSIVIO_VIDEO_RELEASE_COMMIT}` 是**发布构建输入，不是可落盘占位值**：提交完插件本阶段源码后，发布步骤解析实际40hex commit，把catalog、setup内release常量、ASR source manifest同时生成到同一个commit；校验禁止 `${...}`、main/latest/branch进入发布catalog。设计时不能声称尚未提交的本地实现已存在于某个SHA。没有额外 presetPluginId，不把此Skill包装成需要不存在CLI-catalog条目的预设插件；icon新建真实资源，读取/展示路径依照现有manifest（`H/src-tauri/src/market.rs:158–183,487–499`）。

### 9.2 subdir 的精确代码变更

只改内置市场owner `H/src-tauri/src/market.rs`，不修改普通包解压器来解决内置路径。现有 `unpack_built_in_skills` 剥 ZIP 顶层仓库目录后选择 skills/<name> 或 repo root，限制30MiB/2000文件、拒绝危险路径/symlink（`:1316–1359`）。

1. `CatalogPlugin`（`:69–105`）加 `#[serde(default)] subdir: Option<String>`；`BuiltIn`（`:23–55` 范围）加同字段；`load_catalog_from`（`:142–183`）先 `validate_subdir` 后赋入。None=repo root；Some不能空，不 normalize 危险段。
2. validator：拒绝起止 `/`、空段、`.`/`..`、`\\`、`:`、NUL、绝对路径/平台prefix。只接受 `/` 分隔普通components。现有 `catalog_text` 校验不足以直接复用，因为未拒绝冒号（`:109–114`）。
3. `unpack_built_in_skills` 在现有仓库第一段剥离之后、unpack分支之前插入以下语义：

```rust
// Proposed additions inside unpack_built_in_skills:
// before the existing for index loop:
let subdir_prefix = item.subdir.as_ref().map(|s| format!("{s}/"));
// after obtaining archive_path inside that loop:
validate_archive_relative_path(archive_path)?;
if file.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
    return Err("Skill 压缩包包含不安全路径".into());
}
let scoped_path = match subdir_prefix.as_deref() {
    None => archive_path,
    Some(prefix) => match archive_path.strip_prefix(prefix) {
        Some(rest) if !rest.is_empty() => rest,
        _ => continue,
    },
};
// Existing root/skills selection now uses scoped_path, not archive_path.
```

Unix mode 检查与现有ZIP symlink检查相同；prefix在函数入口计算一次，不每文件allocate。必须是 `subdir + '/'` 的边界匹配，不能选中 plugins/dsivio-video-evil。directory项不会成为文件；selected路径再校验、`stage.join(selected)` 必须在stage内；保持总大小/文件数量/Skill存在与requiredFiles检查。ZIP原路径的坏段先拒绝，不能因为不在subdir就跳过安全检查。必要目录存在通过最终有效Skill文件证明，不把一个空目录当安装成功。
4. skills模式输出 `~/.kivio/skills/dsivio-video/{SKILL.md,references,...}`，不复制P/package.json/src/services；不误用root模式，因为它还要求 `<skillId>/SKILL.md`（`:1350–1353`），插件root当前不是Skill目录。runtime由setup部署，避免扩大市场包协议。
5. tests在market.rs现有测试模块：subdir+skills/root各正确映射、缺目录/缺SKILL失败、前缀兄弟不误选、遍历/Windowsprefix/NUL/反斜杠/symlink拒绝、未给subdir的Hypit完全保持、limits及失败rollback。安装器已有mutation_lock与备份回滚，继续沿用（`:1147–1173,1442–1519`）。

### 9.3 bundled Node/npm 的必须改动

当前 tools 有node/python/ffmpeg/ffprobe/yt-dlp、没有npm（`H/src-tauri/src/media_runtime/runtime.rs:32–64`）；打包Node路径为Windows node/node.exe、其他node/bin/node（`:16–20`）。构建器虽用bundled Node执行npm-cli.js，发行时**删除整个npm模块树**（`H/scripts/build-video-runtime.mjs:60–68,97–104`）。不能在setup中假设它存在。

选择正式保留npm JS，不依赖系统npm：

- `H/scripts/build-video-runtime.mjs:101` 不再删除整个node/lib/node_modules（Windows node/node_modules）；仅保留其npm及依赖、删除corepack等非必需发行项；仍删除npm/npx/corepack shell launcher，只用Node绝对路径执行npm-cli.js。runtime manifest记录npm版本。修改现有构建fingerprint，使旧缓存不会跳过资源刷新。
- `H/src-tauri/src/media_runtime/runtime.rs` 增 npm JS资源路径：Windows `node/node_modules/npm/bin/npm-cli.js`，其他 `node/lib/node_modules/npm/bin/npm-cli.js`；`dsivio tools --json` 返回 `tools.npm` 绝对路径，文档明确它是脚本，应 `tools.node tools.npm ...`，不是可执行二进制。现有tools离线可用，不需要App打开（`H/src-tauri/src/media_runtime/cli.rs:1–2,23–38`）。
- `H/scripts/verify-video-runtime.mjs` 增 relocation 后 `node npm --version` 和仅本地依赖加载smoke；不把网上npm install混进每次运行App。打包平台事实目前versions仅darwin-arm64/win32-x64，其他平台构建器拒绝（`H/scripts/video-runtime/versions.json:1–9`；`H/scripts/build-video-runtime.mjs:13–16`），本阶段实机先验收这两平台，不以market五平台manifest声称都有bundled runtime。
- 新插件不依赖只对旧builtin:dsvideo注入的DSVIDEO环境；目前注入受PACKAGE_ID/source限定（`H/src-tauri/src/media_runtime/runtime.rs:120–163`；`H/src-tauri/src/plugins/packages.rs:389–390`）。通过公开tools定位即可，不扩大全局PATH/写系统symlink。

### 9.4 setup Skill 与项目提示词的具体内容

新增 Host资源 `H/src-tauri/resources/plugins/dsivio-video-setup/{SKILL.md,project-prompt.md,icon.svg}`。setup frontmatter 至少含 `name: dsivio-video-setup`、明确description、`kivio-market-managed: true`。市场setup id自动为 `<id>-setup`，托管标记控制更新/删除，description尾部 `[setup completed once]` 是已有成功marker（`H/src-tauri/src/market.rs:243–261,329–386,446–451`）；**只在全部步骤实测成功后**按既有机制标记，不在npm失败时标完成。引用 `references/dsivio.md` 使共享CLI文档自动装入setup（`:115–120,367–371`）。

setup按以下确定步骤，不伪造Install hook：

1. 读取当前project root、`dsivio tools --json`，定位bundled Node/npm/ffmpeg/ffprobe/Python。检查Node≥22.18（插件P/package.json:11–13）。缺bundled npm提示升级此版Dsivio，不切到未知system Node。
2. 以catalog同步的release commit从ZMGID/dsivio-plugins下载快照，只抽 `plugins/dsivio-video/`；对路径/symlink作同类安全校验。在项目 **`.dsivio-video-plugin/releases/<commit>`** 部署CLI源码及package-lock/services，临时目录成功后rename；不覆盖用户 `.dsivio-video/` 构建数据或hypit目录。`active.json` 原子记录commit/root/node/lockHash，由setup管理；升版失败保留旧release。
3. cwd=release root，通过spawn无shell执行：
   `"<tools.node>" "<tools.npm>" install --omit=dev --no-audit --no-fund`。
   把bundled Node目录前置到该子进程PATH，保证依赖postinstall使用同一Node，保留native optional依赖，不能 `--ignore-scripts` 后虚称sharp可用。以发布package-lock为准，安装后若lock改变或实际依赖版本不匹配则失败，不擅自升级。安装的是P/package.json production deps，包括HyperFrames、Puppeteer/core、sharp（`:18–24`），不是只安装CLI空wrapper。
4. 使用这个Node和`bin/dsivio-video.mjs`，实际 `doctor --json`；按需要显式 `setup browser`/fonts/raster，验证native依赖、最小snapshot/短片出文件。ASR不在市场安装阶段下载，settings可manual，首次transcribe由App自动安装。仅检查config存在不算ready。
5. 项目内创建确定入口/说明，Agent始终以active.json中Node+bin绝对路径启动，worker沿用process.execPath；不要求全局npm link、不修改系统PATH。入口由setup实现可重复更新，用户项目内容不覆盖。错误输出保留失败阶段与日志路径，不留一个假“已就绪”。
6. mark setup completed，再让通用market流程使用主dsivio-video Skill。当前首次setup→主Skill路由来自catalog且已有通用流程，无需改Chat协调者（`H/src/chat/market/types.ts:1,31–32,79–88`；`H/src/chat/Chat.tsx:2514–2538`）。

`project-prompt.md` 内容要明确：仅这个项目使用dsivio-video；查active.json及公开tools；DVML/DVS/DVRUN与资源/输出放项目内；先check/plan再build，完整付费参数/未知价格可见，用户已批准的测试预算可执行但不授权无限重试；默认gateway=dsivio，App关闭等待/给打开提示，若用户在外部CLI明确standalone才使用自有key；逐词字幕必须真实ASR证据；遇不确定收据查询不重提；不读settings.json/key；不要求覆盖hypit runtime。项目prompt只匹配该项目名且启用已安装条目（`H/src-tauri/src/market.rs:280–293`），进入chat project context已有入口（`H/src-tauri/src/chat/commands/catalog.rs:47–62`；`H/src-tauri/src/chat/agent/prepare.rs:268–272`）。

### 9.5 Hypit 共存

现catalog保留 `id/skillId:hypit`、project Hypit、repo hypit-ai/hypit与自己的setup/prompt（`H/src-tauri/resources/plugins/catalog.json:8–25`）；其runtime/profile属于自己的工作目录（`H/src-tauri/resources/plugins/hypit-setup/SKILL.md:11–21`；`H/src-tauri/resources/plugins/hypit-setup/project-prompt.md:1–8`）。新条目使用独立id/Skill/setup/project/root，启停/卸载不得改Hypit及用户素材。现卸载只删匹配market owner的Skill、并不删除专属项目（`H/src-tauri/src/market.rs:1521–1547`），继续保留该行为；CLI源码runtime在项目内，卸载Skill也不能自动递归删除用户项目。共用只有宿主tools/media，不能把全局prompt变成「所有视频必须优先dsivio-video」。

## 10. Work packages、顺序与真实验收

下面owned files是实施边界，不是本次已经编辑。同一`media_generation.rs/settings.rs/cli.rs`由一个Host媒体集成owner合并，避免各能力分别创建任务规则；新Python协议由插件owner修改，Host只同步发行快照。

| 包 | Repo/owned files | 前置 | 必须看见的验收 |
|---|---|---|---|
| W1 模型描述与接收 | H media_generation/model_parameters.rs、media_generation.rs、image_providers.rs、video_providers.rs、cli.rs、src/data/*Catalog、generated契约；ADR0010 | 无 | 实际CLI公布description；真实OpenAI图像background/PNG，false/0留存，unsupported付费前失败；旧图/视频路径仍真实生成 |
| W2 Speech | H speech_providers.rs、voices.rs、artifacts.rs、settings.rs/presets/media池、MediaCreationTab/adapter/lib注册 | W1 | MiniMax TTS和授权clone、OpenAI TTS付费→本地可试听音频；中断clone不重复扣费；未授权样本拒交 |
| W3 本地/云ASR | P services/asr；H local_asr.rs、transcribe_providers.rs、发行sync资源、settings/UI/adapter/lib；P src/asr的standalone协议适配 | W1；Python协议先于Host资源同步 | 空缓存自动安装与manual安装同owner；中文/英文真实录音逐词；断网复用、关App/取消无孤儿；whisper-1真实上传识别 |
| W4 Cancel | H media_generation.rs/cli/provider取消、MediaTaskList/adapter/generated、原工作流语义测试 | W1，W2/W3完成相应task路径 | 本地running取消确认child退出；太晚/unsupported显式，云abort不称退款；重复cancel与迟到结果 |
| W5 插件cutover | P gateway/index/request/validate/dsivio/description/backend、modules/gen、modules/align、pipeline/capabilities、asr/backend、CLI transcribe/setup/doctor/vocabulary、build消费者与技能文档 | W1–W4公共contract固定 | gen:Speech→Normalize→SemanticTake→字幕时间线→成片；CLI及pipeline都走Dsivio；options不再blanket拒绝；关闭App不换已选后端 |
| W6 Standalone | P gateway/standalone/providers、共享description、账本、ASR install/service、config及文档 | W1 description固定；可与W2/W3并行，集成前协议一致 | 无App环境两家各图像/视频/TTS付费真实产物、MiniMaxclone、ASR→成片；同键并发只提交一次、结果不确定不重交，key不泄漏 |
| W7 市场与Node/npm | H market.rs、resources/plugins/catalog/setup/prompt/icon、media_runtime/runtime/cli、scripts/build/verify runtime；P发布release及Skill | subdir/npm可独立；最终catalog与ASR同步需要W5/W6发布commit | 干净用户、无系统Node/npm，市场装→首次setup npm→CLI短片；Darwin-arm64及Windows-x64；失败回滚；与Hypit双装/各自启停/卸载 |
| W8 集成验收与发布 | 两repo各自owner更新既有README/architecture/CLI共享文档、ADR、发布记录 | W1–W7 | 下列真实端到端矩阵全部通过，明确延期matting，不宣传未实现供应商 |

**顺序**：先冻结W1规范JSON与新的task.result/cancelled契约，Host W2/W3/W4和插件W6可并行；W5在契约固定后迁移全部调用者；W7代码可先做，但catalog commit/ASR快照在插件实现发布后一起固定。项目级lint/typecheck/全套tests由集成owner在全部落地后跑一次，各包只跑自己的behavior测试/真实smoke，不在并发中跑项目全套。

**付费真实运行矩阵（用户已批准成本）**：

- Dsivio：实际已启用image/video各一次；OpenAI image透明PNG参数一次；MiniMax speech TTS+本人授权voice clone，OpenAI TTS；OpenAI whisper-1短录音。保存taskId、receipt、requestHash、descriptor hash、产物SHA/MIME、ffprobe与实际试听/画面，usage有则记录，无真实账单就不编造费用。
- 独立：MiniMax image-01、H3最短允许视频、speech；Gemini精确image/Veo最短允许视频/TTS；只用public API、不使用假代理。无Dsivio执行含真实ASR的短片并实际播放。
- 本地：干净安装、手动与首次自动、中文/英文、离线复用、模型/语言变更、取消与App退出、服务失配/崩溃。证明服务进程停止/新task可再启动，不只断言某个方法被调用。
- 生命周期：并发同键、请求hash冲突、已受理后杀CLI/worker再启动继续同receipt、submitted结果不确定停止重交、timeout继续wait、取消太晚/不支持仍保留回执。
- 市场/UI：干净用户无system Node/npm完成依赖与短片；安装失败不标setup成功、重试/升版保持旧runtime；settings显示真实进度、手动安装及暗/亮主题控件；subdir安全恶意ZIP；Hypit与新插件项目提示词隔离、独立启停卸载。
- 抠像：本阶段仅验证导入透明图/视频合成不丢alpha；**不把这项算作matting paid generation通过**。

发布门槛不是“已有377个测试仍绿”：新增接口必须由真实CLI/桌面surface/产物证明。权限或供应商产品未开通属于验收前置，报告明确账户/接口/失败事实，不能用mock把该供应商标成完成。本文设计本身只做静态文档与引用核验，不声称已执行上述安装、付费或UI验收。
