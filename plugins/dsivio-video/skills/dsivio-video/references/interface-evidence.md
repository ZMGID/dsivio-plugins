# 命令与属性自检证据

本表是 Skill 的真实接口索引，不扩大支持范围。路径相对插件根；2026-10-01 已运行全量 `vocabulary --json` 与其列出的 28 个完整模块名逐项查询，所有查询 exit 0。生产页以真实 SurfaceDoc 为元素/属性权威，以 Recipe 解码实现为默认值与行为权威，phase4 设计用于确认范围与有意差异。短名（如 caption-fine）不是合法 module 参数。

## 当前 CLI 与宿主调用

| 提到的命令及 flags | 真实定义 | 核对状态 |
|---|---|---|
| node bin/dsivio-video.mjs；version / paths | bin/dsivio-video.mjs；src/cli/main.ts:38–39 | 已实现 |
| npm install | package.json；README.md | 源码依赖准备，不是项目 Build |
| check source.dvml/run.dvrun | src/cli/main.ts:40 | 旧 draft 与两个新 Run 均实际通过 |
| vocabulary 完整 module；--tag、--models、--kind | src/cli/main.ts:41 | index + 28 个模块实际查询通过；模型列表仍受 Dsivio 状态约束 |
| plan | src/cli/main.ts:42 | 两个例子 valid=true、paidNeedTotal=0 |
| build；--title、--follow、--max-wait-ms | src/cli/main.ts:43 | 两个例子 follow 到 done/complete |
| status；--watch、--max-wait-ms | src/cli/main.ts:44 | 已实现；本轮不声称额外执行 |
| builds --before；history --source/--before；inspect --output | src/cli/main.ts:46–48 | 已实现 |
| get --output/--to | src/cli/main.ts:49 | 两个 final.video 实际导出 |
| cancel --reason；runtime up/down/status/logs --lines | src/cli/main.ts:50–51 | 已实现；不保证远端取消 |
| doctor | src/cli/main.ts:52 | 本轮发现宿主未开（模型 exit 6），不影响本地工程 |
| media probe | src/cli/main.ts:53 | 两个输出实测 640×360、30 fps、3 秒 |
| media cut --start/--end/--keep/--label-time/--to | src/cli/main.ts:54 | 已实现，label-time 单视频区间 |
| media frames：at/start/end/every/around/occurrence/padding/transcript；--every-frame/--label-time/--to | src/cli/main.ts:32–33,55 | 已实现，采样方式互斥 |
| media tile：同共享 sampling；--frames/--cell/--columns/--to | src/cli/main.ts:56 | 两个例子实际执行并查看 JPEG |
| media tiles：共享 sampling；--ranges/--frames/--every-frame/--cell/--columns/--rows/--to | src/cli/main.ts:57 | 已实现 |
| media boundaries --rate/--threshold；fetch --to；prepare-fetch | src/cli/main.ts:58–60 | 候选切点；下载与检查 |
| transcribe --language/--to | src/cli/main.ts:61 | 已实现，本轮没有使用 ASR |
| setup asr/browser/fonts/raster/status；--model、--kind render/capture/all | src/cli/main.ts:62；src/cli/commands/setup.ts | 已实现；本轮查询 status，例子复用已准备资源 |
| snapshot HTML/URL 或 --studio；--at-frame、--start-frame、--end-frame-exclusive、--step-frames、--grid、--cell、--to | src/cli/main.ts:63；src/cli/commands/snapshot.ts | 已实现；不是 Studio 服务存在证据 |
| --json、--verbose、--workspace、--asset-root、--help | src/cli/main.ts:69；src/cli/options.ts | workspace/json 在全部新例子实际使用 |
| dsivio media models/status；DSIVIO_VIDEO_DSIVIO；宿主 5/6/124 | src/gateway/index.ts；src/gateway/dsivio.ts；src/tools/dsivio.ts | 当前网关，5/124 先查原任务；6 恢复主程序 |
| dsivio tools --json | src/tools/index.ts | 宿主本地工具定位，未安装新工具 |

## 已有作者语言与生成属性

| 提到的元素/属性/公开名 | 定义 file:line |
|---|---|
| 文件头 dvml 的 using | src/markup/header.ts:3–23 |
| dvml 根；import 的 as/from/source；imports 在正文前 | src/markup/parse.ts:160–205 |
| sheet 的 version=1；Recipe 前端 dsivio-video/dvs@1 | src/markup/dvs.ts:85–122；src/modules/recipe/index.ts:26–51 |
| dotted Recipe 名、rule/properties，无继承或级联 | src/modules/recipe/index.ts:5–16,28–51 |
| text:Value 的 id；裸 id Text | src/modules/text/index.ts:47–64 |
| text:Render 的 id/template/recipe；裸 id Text | src/modules/text/index.ts:67–89,122–123 |
| text:Param 的 name/value/type，text/number/boolean | src/modules/text/index.ts:98–116,133–136 |
| text:Set/text:Append 的 name/text | src/modules/text/index.ts:98,117–119,137–139 |
| text-template 根；separator、default-camera（default-*） | src/modules/text/template.ts:53–65 |
| text-template block；kind/order/slot/label；fixed/axis/variant/slot | src/modules/text/template.ts:77–104 |
| 模板 label 换行与 paragraph 分隔 | src/modules/text/render.ts:105–122 |
| media:Image/Video/Audio 的 id/src；裸 id 资源 | src/modules/media/index.ts:23–56 |
| gen:Image/Video 的 id/model/prompt | src/modules/gen/index.ts:51–55,67–72 |
| gen:Image 的 ratio/size/quality/count | src/modules/gen/index.ts:45,55,74–84 |
| gen:Video 的 duration/resolution/ratio/audio/first-frame/last-frame | src/modules/gen/index.ts:45,55–56,74–90 |
| gen:Reference 的 image/video/audio；每个恰一引用 | src/modules/gen/index.ts:58–60,97–102 |
| gen:Option 的 name/value/type，string/number/boolean/json | src/modules/gen/index.ts:103–120；src/gateway/validate.ts:7（当前拒绝） |
| .image/.video 只发布首个媒体 | src/modules/gen/index.ts:49,62,125；src/gateway/dsivio.ts:97–100 |
| dvrun 的 version；author.source；target.output | src/run/parse.ts:37–57 |
| file 的 id/type/from/media-type；value 的 id/type/from | src/run/parse.ts:40,64–75 |
| value JSON 的 type/data | src/plan/plan.ts:98–107 |
| build-record 的 id/build/output；satisfy 的 output/candidate | src/run/parse.ts:40,59–66 |

## 实时模型目录字段（不是 gen 属性）

| 提到的字段 | 定义 file:line |
|---|---|
| id/kind/known；启用检查 | src/gateway/index.ts:25–35 |
| modes | src/gateway/validate.ts:17–20 |
| durations/resolutions/ratios/sizes/qualities；customPixelSize | src/gateway/validate.ts:23–28 |
| audioToggle；firstFrame/lastFrame/lastFrameNeedsFirst | src/gateway/validate.ts:30–33 |
| maxReferenceImages/maxReferenceVideos/maxReferenceAudios | src/gateway/validate.ts:34–37 |
| referenceAudioNeedsVisual；framesExcludeReferences；localReferenceMedia | src/gateway/validate.ts:38–40 |
| maxPromptLength | src/gateway/validate.ts:41–47 |
| maxCount；defaults | src/gateway/validate.ts:49–57 |
| backend、cost、price=unknown、request/summary | src/gateway/index.ts:37–41 |
| gateway=auto/dsivio；config.json | src/gateway/index.ts:17–24 |
| task/receipt/summary | src/build/store.ts:21–33；src/cli/commands/inspect.ts:17–19 |
| DSIVIO_VIDEO_DSIVIO；Dsivio 命令定位 | src/tools/dsivio.ts:8–24 |
| DSIVIO_VIDEO_FFMPEG/FFPROBE/YT_DLP/PYTHON；工具来源顺序 | src/tools/index.ts:10–13,75–102 |
| .dsivio-video/ 项目根与 store/runtime/results 配置布局 | docs/design/phase1.md:44–47,69–79 |

## 已核对的生产接口（全部模块名以 dsivio-video/ 开头、@1 结尾）

| 模块 / 本 Skill 引用 | SurfaceDoc / 默认值与行为定义 | 核对证据 |
|---|---|---|
| script；Script、.segment/.selection/.moment/.caption/.speech/.dialogue | src/modules/script/index.ts | vocabulary 成功 |
| program；Clock frame-rate | src/modules/program/index.ts | vocabulary 成功，精确整数 / 比值 |
| time；Timeline/Take/Window/Instant、W/I、previous.end/content.end | src/modules/time/index.ts；src/timeline/temporal.ts | vocabulary 成功；新例子零 Take + end=90f |
| pipeline；Normalize/StillVideo/Transform/ExtractFrame/ExtractAudio | src/modules/pipeline/index.ts | vocabulary 成功；Transform 在对齐之前，输出 .media |
| align；SemanticTake/Adjust | src/modules/align/index.ts | vocabulary 成功，空 Segment 不调用语音 IO |
| space；Canvas/Frame/Extent/Point/Path 与锚定框 | src/modules/space/index.ts；src/space/math.ts | vocabulary 成功；Canvas/Frame 在标题例子实际构建 |
| fonts；Face/Stack/Fallback | src/modules/fonts/index.ts | vocabulary 成功；标题精确 noto-sans-sc 700 normal 实际加载 |
| performance；Style/Track/Use、.program/.visual | src/modules/performance/index.ts；src/components/performance/author.ts:17–93 | vocabulary 成功；Recipe 禁止 playback/trim/motion |
| sound；Style gain/end-gain、Track/Use、.program/.audio | src/modules/sound/index.ts；src/components/sound/author.ts | vocabulary 成功；后 Use 与 gain=0 遮罩，源相位连续 |
| typo（typography.md）；Style/Motion/Track/Mask、Area/Point/Path/P/Span/Break | src/modules/typo/index.ts；src/components/typo/author.ts:18–38 | vocabulary 成功；标题例子真实 Build / get / 看帧 |
| film；Film/Track、appearance.background、.composition | src/modules/film/index.ts | vocabulary 成功；两个例子显式装配 |
| render；Video、原片 start-frame/end-frame-exclusive、.video | src/modules/render/index.ts | vocabulary 成功；两个真实 MP4 输出，偶数画布 |
| caption；Hidden | src/modules/caption/index.ts | vocabulary 成功；Hidden 是共享 Style，无 Track |
| caption-fine；Style/Fallback/Track/Use、role/regions、.content/.program/.schedule/.track | src/modules/caption-fine/index.ts；src/components/caption-fine/style.ts:8–54；docs/design/phase4.md:40 | vocabulary 成功；Recipe 必填 / 默认和 RegionTimeline 已核对，未冒称自动检测 |
| media-track；Track/Item/Sequence/Member/Layer/Paint/Sampling/Handoff/Sound、.visual/.audio | src/modules/media-track/index.ts；src/components/media-track/author.ts；appearance.ts；motion.ts | vocabulary 成功；图像 extent、动态原生时钟、显式声音及转场合同已核对 |
| audio-track；Track/Item、trim/playback/rate/gain/fades、.audio | src/modules/audio-track/index.ts；src/components/audio-track/author.ts；types.ts | vocabulary 成功；独立规范化音频、once/loop/stretch 已核对 |
| deck-track；Label/DepthStack/Card、.track | src/modules/deck-track/index.ts；src/components/deck-track/program.ts:13–80 | vocabulary 成功；真正读取 brightness/contrast/saturation-step，无旧错误键 |
| ranking；TierBoard/Column/TopThree 与 Style/子项、.visual 与条件 .audio | src/modules/ranking/index.ts:32–99；src/components/ranking/author.ts | vocabulary 成功；子元素属性、preset 和 terminal 限制通过实际解码器核对 |
| comment-sticker；Style/Track/Sticker、.track | src/modules/comment-sticker/index.ts；docs/design/phase4.md:44 | vocabulary 成功；完整 Style 默认值列在专页，精确字体 / 短阶段合同 |
| interview-emoji-reveal；Style/Track/Item、.track | src/modules/interview-emoji-reveal/index.ts；docs/design/phase4.md:44 | vocabulary 成功；占位、preset 前缀、递增 reveal 和画布边界 |
| screen-overlay；Track 与 11 个效果、.track | src/modules/screen-overlay/index.ts；docs/design/phase4.md:45 | vocabulary 成功；所有效果参数列在专页，ColorWash/Bokeh/Flash 真实渲染 |
| image-compose；Image/Layer、.image | src/modules/image-compose/index.ts；src/components/image-compose/author.ts:8–26 | vocabulary 成功；背景透明、1–64 层、alpha-over 默认已核对 |
| image-transform；Program/Transform 与 10 个操作、.image | src/modules/image-transform/index.ts；src/components/image-transform/author.ts:9–50 | vocabulary 成功；范围、默认、编码/alpha 互斥已核对 |
| matting/background-removal 状态 | docs/design/phase4.md:29–31；vocabulary index 无对应模块 | 不可用；只能导入预抠透明媒体，不创建占位接口 |

其余 index 模块 text、recipe、media、gen、visual 同样逐个 vocabulary 查询成功；所有作者片段只用已注册模块。查询成功证明接口存在，不等同每个组件本轮都完成了真实视听渲染。专页还核对各自源码 Recipe 解码器，因为 SurfaceDoc 不完整枚举 Recipe 键。

## 实际执行与可观察范围

| 验证对象 | 已执行输出 | 限定范围 |
|---|---|---|
| 旧 authoring/examples/draft.dvrun | check + --workspace exit 0，Outputs=1、Target=prompt、Candidates/satisfactions/unresolved history=0 | 原先 CLI 阻塞已解除；无付费生成 |
| production/examples/overlay.dvrun | check exit 0；plan valid/paid=0；build bld_20261001T014942352Z_96EC010060 done complete，13/13 steps、3/3 local needs；get exit 0 | 临时项目副本，640×360 / 30 fps / 3 秒 |
| production/examples/title.dvrun | check exit 0；plan valid/paid=0；build bld_20261001T014946796Z_C449E88B83 done complete，15/15 steps、4/4 local needs；get exit 0 | 临时副本，精确字体 + 局部上移淡入；同尺寸、帧率、时长 |
| 两个最终 MP4 | media probe + media tile exit 0；read 实际 JPEG：暖黄散景 / 闪光与居中白色中文标题；额外 title --at 0,0.2,0.5 显示隐藏→灰白低位→完整白色居中 | 0.5/1.2/2.5 秒与标题入场三帧已看；不是完整播放证明 |
| 无作者声音的两个例子 | ffmpeg volumedetect exit 0，mean/max=-91 dB | 静音检测下限；未声称对白 / 混音听验 |

可复制命令、初始 plan 前沿与画面描述见 [production/examples/README.md](production/examples/README.md)。临时目录中的 `.dsivio-video`、MP4/JPEG 不进入 Skill 分发树。本轮不调用付费服务，不将设计、vocabulary 或截图当作未运行功能的证据。
