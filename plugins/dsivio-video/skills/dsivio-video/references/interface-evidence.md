# 命令与属性自检证据

本表是本 Skill 与参考中的接口索引，不是扩大支持范围的授权。路径相对插件根；行号为编写时读取版本。第 3 阶段条目以设计为权威，实现合并后核对 vocabulary 与命令帮助。表内同格列出的每个命令/属性均由对应定义覆盖。

## 当前 CLI 与宿主调用

| 提到的命令及 flags | 定义 file:line | 状态 |
|---|---|---|
| dsivio-video；node bin/dsivio-video.mjs | package.json:8–12；bin/dsivio-video.mjs:1–16 | 已有 |
| npm install | README.md:28–34；package.json:18–28 | 源码依赖准备 |
| version | src/cli/main.ts:35 | 已有 |
| paths | src/cli/main.ts:36 | 已有 |
| check source.dvml/run.dvrun | src/cli/main.ts:37 | 已有 |
| vocabulary module；--models、--kind image/video | src/cli/main.ts:38 | 已有 |
| plan run.dvrun | src/cli/main.ts:39 | 已有 |
| build run.dvrun；--title、--follow、--max-wait-ms | src/cli/main.ts:40 | 已有 |
| status id；--watch、--max-wait-ms | src/cli/main.ts:41 | 已有 |
| builds；--before | src/cli/main.ts:43 | 已有 |
| history output；--source、--before | src/cli/main.ts:44 | 已有 |
| inspect id；--output | src/cli/main.ts:45；src/cli/commands/inspect.ts:12–19 | 已有 |
| get id；--output、--to | src/cli/main.ts:46 | 已有 |
| cancel id；--reason | src/cli/main.ts:47；docs/design/phase1.md:77 | 本地停止，不保证远端取消 |
| runtime up/down/status/logs；--lines | src/cli/main.ts:48 | 已有 |
| doctor | src/cli/main.ts:49 | 已有 |
| media probe file | src/cli/main.ts:50 | 已有 |
| media cut；--start、--end、--keep、--label-time、--to | src/cli/main.ts:51；src/media/cut.ts:62–73 | --label-time 只允许单个视频区间 |
| media frames；--at、--start、--end、--every、--every-frame、--around、--occurrence、--padding、--transcript、--label-time、--to | src/cli/main.ts:31,52；src/media/sample.ts:26–63 | 已有，采样模式互斥 |
| media tile；--at、--start、--end、--every、--around、--occurrence、--padding、--transcript、--frames、--cell、--columns、--to | src/cli/main.ts:31,53 | 已有 |
| media tiles；同上采样 flags，加 --every-frame、--ranges、--rows | src/cli/main.ts:31,54；src/media/sample.ts:86–111 | 已有 |
| media boundaries；--rate、--threshold | src/cli/main.ts:55 | 只给候选边界 |
| media fetch URL；--to | src/cli/main.ts:56 | 已有 |
| media prepare-fetch | src/cli/main.ts:57 | 检查，不隐式更新 |
| transcribe file；--language、--to | src/cli/main.ts:58 | 已有 |
| setup asr/status；--model | src/cli/main.ts:59；src/cli/commands/setup.ts:10–20；src/asr/install.ts:48–65 | 已有 |
| --json、--verbose、--workspace、--asset-root、--help | src/cli/main.ts:62,69–81 | 通用选项 |
| dsivio media models；--kind image/video | src/gateway/index.ts:25 | 当前实际宿主调用 |
| dsivio media status TASK_ID | src/gateway/dsivio.ts:89–100 | 当前实际宿主调用 |
| dsivio tools --json | docs/design/phase2.md:20–24,67 | 本地捆绑工具查询合同 |
| 宿主退出码 0/2/3/4/5/6/124 | docs/research/07-skill-and-references.md:253；src/gateway/dsivio.ts:78–96 | 5 禁重提；6 恢复主程序；宿主码不等于插件码 |
| setup browser；--kind render/capture/all | docs/design/phase3.md:208–214 | 第 3 阶段设计 |
| setup fonts | docs/design/phase3.md:218–231 | 第 3 阶段设计 |
| snapshot HTML/URL；--at-frame、--start-frame、--end-frame-exclusive、--step-frames、--grid、--cell、--to、--studio | docs/design/phase3.md:233–248 | 第 3 阶段设计 |

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

## 第 3 阶段作者合同

| 提到的元素/属性/公开端口 | 定义 file:line |
|---|---|
| script:Script 的 id；Narrative、.segment/.selection/.moment/.caption/.speech/.dialogue | docs/design/phase3.md:34,52 |
| program:Clock 的 id/frame-rate | docs/design/phase3.md:35,53 |
| space:Canvas 的 id/width/height；space:Frame 的 id/within/left/top/right/bottom | docs/design/phase3.md:36,54,91 |
| pipeline:Normalize 的 id/source/clock/frame-rate/recipe/video/audio/span-authority；.media | docs/design/phase3.md:37,55,81–85 |
| pipeline:StillVideo | docs/design/phase3.md:37,56 |
| pipeline:Transform 的 id/source；Trim.start-frame/end-frame-exclusive；Retime.speed/preserve-pitch | docs/design/phase3.md:56,87 |
| align:SemanticTake 的 id/narrative/segment/media/language；.take | docs/design/phase3.md:38,57,71–75 |
| time:Timeline 的 id/clock/frame-rate/end；time:Take 的 id/source/at | docs/design/phase3.md:39,58,77 |
| 0f、90f、previous.end、content.end | docs/design/phase3.md:58,77,343–345 |
| f/ms/s；program.start/end、segment.start/end、selection.start/end、moment.cue；during、at/for、until/for、start/end | docs/design/phase3.md:79 |
| performance:Style 的 id/frame/appearance；Track 的 id/timeline/canvas；Use 的 id/style/窗口 | docs/design/phase3.md:42,102,354–356 |
| sound:Style 的 id/gain/end-gain；Track 的 id/timeline；Use 的 id/style/窗口 | docs/design/phase3.md:41,101,350–352 |
| fonts:Face 的 id/family/weight/style；Stack 的 id/font/emoji；Fallback.font | docs/design/phase3.md:40,59,218–231 |
| typo:Style 的 id/recipe/font；Track 的 id/timeline；Area/Point/Path 的 id/placement/style/motion/content/窗口；P/Span/Break | docs/design/phase3.md:43,103,358–361 |
| .program、performance .visual、sound .audio、typo .track | docs/design/phase3.md:41–43,105 |
| film:Film 的 id/canvas/timeline/appearance；film:Track 的 source；.composition | docs/design/phase3.md:45,60 |
| render:Video 的 id/composition/timeline/start-frame/end-frame-exclusive；.video | docs/design/phase3.md:46,61 |
| Film Recipe background | docs/design/phase3.md:60,293 |
| performance Recipe stack-order/fit/clip | docs/design/phase3.md:294 |
| typo Recipe stack-order/size/fill/align/wrap | docs/design/phase3.md:295 |
| typo Recipe weight/font-style 与精确 Face 一致 | docs/design/phase3.md:103 |
| 偶数渲染宽高；区间原片 seek | docs/design/phase3.md:173 |

## 已执行的限定验证

直接运行文档配套 .dvml/.dvs/.dvrun 的真实 parser、compileTemplate、text renderer 与 Run parser，得到目标 prompt：

```text
桌边一只暖色陶杯，晨光从左后方进入。

镜头：
近景，固定机位
```

Run Target 为 prompt，全程无付费请求。此限定验证证明文本模板与 Run 示例的实际行为，不声称完整第 3 阶段 CLI、渲染或视听验收。生产接口合并后还需按真实 vocabulary 核对，并运行对应制作与观看场景。
