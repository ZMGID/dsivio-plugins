# 轨道与素材处理组件行为规格

## 1. 概述

本文件覆盖十八个组件包的作者接口、时间语义、呈现效果、素材处理与编辑能力。它是独立重建用的行为说明，不含原项目实现代码。来源仓库里的作者格式在本规格的示意中统一称为 `.dvml`，配方称为 `.dvs`；包示意使用 `dsivio-video/<pkg>@1`。

**总表先列出组件边界。**“本地”指组件本身不发起付费生成；输入可以来自付费生成，但那是上游的独立请求。预览图并不等于可运行的示例工程。表中“未发现”限定为本次检索的 `examples/`，不表示仓库其他地方绝无用例。

| 组件 | 用途与作者元素 | 主要输出 | 本组件执行依赖 | 已发现的使用案例 |
|---|---|---|---|---|
| caption | 字幕内容投影、按时间/角色选择样式；`Hidden` | 隐藏 Style；程序接口另有字幕投影、Use 集合 | 本地；需要已有对齐证据 | complex-explainer 的 Hidden；其余字幕工程导入公共概念 |
| caption-fine | 统一排版、逐词强调字幕；`Style/Track/Use/Fallback` | `.content/.program/.schedule/.track` | 本地浏览器排版、精确字体 | interview、podcast、ranking-football；complex-explainer 使用 Style 和项目字幕家族 |
| typography-track | 独立标题、富文本、沿路径文字及文字遮罩；`Style/Motion/Track/Mask` | Style、Motion、`.program/.track` | 本地排版/渲染 | examples 未发现；包内有 Track/Mask 预览 |
| media-track | B-roll、图层、替换序列和关联声音；`Track/Item/Sequence` 等 | `.program/.visual`；有声音才有 `.audio` | 本地；视频需先规范化 | podcast 全组；ranking-football/swap-topic；包内 preview 工程 |
| audio-track | 独立音乐与音效占位；`Track/Item` | `.program/.audio` | 本地混音、音频规范化 | interview、podcast、ranking-football、complex-explainer |
| sound | 展示 Timeline 已有声音，规则覆盖而不是额外混音；`Style/Track/Use` | `.program/.audio` | 本地 | 上述四组，minimal-author-package；semantic-composition 的项目 Style 说明 |
| performance | 展示 Timeline 已有画面，不改源时钟；`Style/Track/Use` | `.program/.visual` | 本地；已有规范化 Take | 上述四组、minimal-author-package；semantic-composition 的项目 Style 说明 |
| deck-track | 有前后景深的卡片堆；`Label/DepthStack/Card` | Label、`.program/.track` | 本地 | examples 未发现；包内 DepthStack 预览 |
| ranking | 分级表、名次列、前三席；三个 Style 和三个容器/Item | `.schedule/.program/.visual`；可选 `.events/.audio` | 本地；图标/音效为已有素材 | ranking-football 各变体，TierBoard 与 Column；TopThree 有包内预览 |
| comment-sticker | 社交评论卡；`Style/Track/Sticker` | `.program/.track` | 本地字体、头像素材 | examples 未发现；包内 Track 预览 |
| screen-overlay | 全屏闪光、纹理、遮罩等；`Track` 与十一种效果 | `.program/.track` | 本地，seed 决定随机布局 | interview 全组的 Flash；包内 Track 预览 |
| interview-emoji-reveal | 一列问号依次揭示图标；`Style/Track/Item` | `.program/.track` | 本地；图标为已有素材 | interview/reference、swap-host、swap-lang、swap-ride |
| image-compose | 按矩形叠放静态图片；`Image/Layer` | `.image`（PNG） | 本地 Raster 执行器；原实现 OpenCV/NumPy | examples 未发现；manifest 自带语法用例 |
| image-transform | 顺序图像处理；`Program/Transform` 和十种操作 | Program、`.image` | 本地 Raster 执行器；原实现 OpenCV/NumPy | examples 未发现；manifest 自带语法用例 |
| background-removal | 静态图去背景；`Background` | `.image`（透明图片） | **外部能力；是否计费由执行服务决定** | examples 未发现；README 有语法用例 |
| volcengine-matting | 人像视频抠像；`Portrait` | `.video`（尚未规范化） | **外部生成/抠像服务，原路由经 HypiHub** | examples 未发现；README/manifest 有语法用例 |
| browser-capture | 网页/本地 HTML 截图与录屏；无作者元素 | 磁盘文件、完成结果列表 | 本地 Chrome；录屏需 ffprobe；网页可需网络 | examples 未发现；README 有库和脚本用例 |
| film（轨道侧） | 选择同一 Timeline 上的同级音画轨道；`Film/Track` | `.composition` | 本地组装；自身不编码 | interview、podcast、ranking-football、complex-explainer、minimal-author-package、semantic-composition/chat |

## 2. 行为规格

### 2.1 共用记法、时间和错误

下面用 `*` 表示必填；无 `*` 的属性可省略，括号中说明默认值。`引用<T>` 是整个属性值的图引用，不能用混合字符串替代。`文本` 是非空字符串；`数` 必须有限，`整数` 必须安全整数；`色` 的具体位数限制见各组件。未列出的属性、错误引用类型、无法解析的引用、禁止的子元素及非空正文通常在作者解码阶段报错，并指出元素和属性。Recipe/Style 需要在作者编译时可读取的内联记录；不能等一次生成完成才获得它们。

**W：完整窗口属性集**，在后文写“W”即包含以下全部属性，而非只有 `during`：

| 属性 | 类型/默认 | 组合规则 |
|---|---|---|
| `during` | `"program"` 或引用<Selection/Segment>；无默认 | 整个节目或所选内容的准确区间 |
| `at`、`until` | 时间字面量或引用<Moment>；无默认 | 分别从点开始或在点结束；必须配 `for` |
| `for` | 时长；无默认 | 整数 `f/ms` 或可带小数的 `s`，如 `12f/250ms/1.5s` |
| `start`、`end` | 点表达式；无默认 | 必须成对；绝对时间或 `program.start/end`、`selection.start/end`、`segment.start/end`、`moment.cue`，可加减时长 |
| `start-source`、`end-source` | 引用<Selection/Segment/Moment>；无默认 | 分别绑定起止表达式所需的语义源 |
| `selection`、`segment`、`moment` | 各自类型引用；无默认 | 起止表达式使用该语义种类时的共享绑定 |

窗口只能选择 `during`、`at+for`、`until+for`、`start+end` 四种形状之一，不允许混搭或无用的语义绑定。一般 Item **没有**省略窗口后的自动全程默认；只有 caption-fine、sound、performance 的 Use 显式补全为全节目。区间统一左闭右开，时长换算保留精确时间，不以浮点累计代替帧/采样边界。

**I：完整瞬时属性集**：`at`（时间或引用<Moment/Selection/Segment>）、`instant`（点表达式）、`boundary`（`start/end`）、`selection/segment/moment`（相应引用）。`at` 和 `instant` 互斥；at 引用 Selection/Segment 时必须明确 boundary，**没有默认 start**，at 引用 Moment 或写绝对时间时禁止 boundary。instant 使用语义表达式时附所需绑定，不能附 boundary。Sequence/DepthStack 终点只接受必填 `until`（绝对时间或语义引用）和可选 `until-boundary`，后者在 Selection/Segment 引用时默认 end，引用 Moment 时禁止。TopThree 的 terminal 和 Emoji Item 的 at 虽复用通用解码器，却不允许 boundary/instant，因此有效输入限定绝对时间或 Moment 引用；不应声称它们支持需要 boundary 的 Selection/Segment。

所有轨道都属于一个确定 Timeline。视觉结果按帧，音频结果最终按 48 kHz 采样定位；不同 Timeline 的窗口、轨道、字幕文档等不能直接混用。组件报错不能被“自动修复”成重排事件、裁短未知语义、补猜测位置或重新生成素材。

### 2.2 caption：公共字幕内容与隐藏样式

- **元素**：`Hidden` 只有 `id*:文本`，必须空元素。输出是裸 id 引用的字幕 Style，含“无呈现”的意图，不是空字符串字幕，也不是透明度动画。本包没有独立可写的 CaptionProgram 或通用 Track 元素。
- **内容行为**：把作者 CaptionDocument 的显示单元身份连接到 Timeline 上 Take 的词级对齐。Segment、说话轮次和显式 `||` 组织完整 Cue；未放置的内容不出 Cue。显示文字、作者分隔符、读音关联、属性与角色由文档拥有；测量时间由 Timeline 拥有。不能靠平均句长虚构词时间。
- **选择行为**：有序 Use 只决定某段时间/某角色使用哪个样式，不重切 Cue，不改变完整显示单元。一个 Use 在 Cue 中途开始时，逐词时钟仍是原 Cue 的时钟。后写且匹配角色的 Use 局部替换前写 Use；Hidden 同样参与覆盖。两个独立 Track 可以同时显示字幕。
- **程序输出**：公共操作可产生完整时间化内容和有序 Use 集合；Fine 的 Track 会导出它们。它们不直接产生付费 Need，不读取供应商。
- **编辑/样式**：Hidden 无视觉配方。Cue/词的测量区间是证据，不因外观编辑改变。示例：complex-explainer 的作者文件声明 Hidden；interview、podcast、ranking-football 使用此包的公共文档/样式机制，不能仅凭 import 当作 Hidden 的实际使用。

### 2.3 caption-fine：统一流式字幕

**全部元素属性与子元素**：

| 元素 | 属性 | 子元素/输出 |
|---|---|---|
| `Style` | `id*:文本`、`recipe*:引用<Recipe>`、`font*:引用<精确字体或字体栈>` | 仅零或多个 `Fallback`；裸 id 为字幕 Style |
| `Fallback` | `font*:引用<单个精确字体>` | 空；依作者顺序附到主字体之后 |
| `Track` | `id*:文本`、`document*:引用<CaptionDocument>`、`timeline*:引用<Timeline>`、`regions:引用<RegionTimeline>`（无） | 仅 Use；输出 `.content/.program/.schedule/.track` |
| `Use` | `style*:引用<字幕Style>`、`id:文本`（容器派生序号）、`role:文本`（所有角色）、W（默认全程） | 空；Style 可以是 Hidden |

**Recipe 的完整键集合与默认关系**（必填项无默认；其余可省略）：

- 几何：`stack-order*:非负整数`；`x*/y*:0..1`；`width*:大于0且不超过1`；`height:同范围`（省略则不固定）；`anchor-x:left/center/right`（left）、`anchor-y:top/center/bottom`（top）。
- 排版：`align*:left/center/right`；`block-align:start/center/end`（center）、`direction:ltr/rtl`（ltr）、`inline-size:hug/fixed`（hug）、`wrap:word/grapheme`（word）；`size*:正数像素`、`line-height*:正数倍数`；`letter-spacing:数`（0）、`word-gap:非负数`（size×0.25）；`max-words-per-line/max-lines:正整数`（无）。`kerning:auto/normal/none`（auto）、`caps:normal/small-caps/all-small-caps`（normal）、`text-transform:none/uppercase/lowercase/capitalize`（none）。
- Cue 卡片：`background*:色`、`padding*:一或两个非负像素数的字符串`、`radius*:非负数`；`border-color:色`（透明黑）、`border-width:非负数`（0）；`cue-shadow-color:色`（黑）、`cue-shadow-opacity:0..1`（0）、`cue-shadow-x/y/spread:数`（0）、`cue-shadow-blur:非负数`（0）。
- 普通字形：`fill*:色`、`opacity:0..1`（1）；`stroke-color:色`（黑）、`stroke-width:非负数`（0）；`shadow-color:色`（黑）、`shadow-opacity:0..1`（0）、`shadow-x/y/spread:数`（0）、`shadow-blur:非负数`（0）；`glow-color:色`（白）、`glow-opacity:0..1`（0）、`glow-blur/spread:非负数`（0）；`long-shadow-color:色`（黑）、`long-shadow-opacity:0..1`（0）、`long-shadow-distance:非负数`（0）、`long-shadow-angle:数`（45）；`gradient-from/to:色`（不启用）、`gradient-angle:数`（90）。渐变一旦启用必须同时给首尾颜色。
- 活跃字形：上一组所有键均可加 `active-` 前缀，类型相同。`active-fill` 默认金黄色；其余普通绘制指标默认继承基础值，但 active 渐变没有显式配置时不自动继承基础渐变。
- 下划线：`underline:off/always`（off）、`underline-color:色`（基础 fill）、`underline-thickness:非负数`（2）、`underline-offset:非负数`（4）；`active-underline:off/current/trail`（off）、其 `color` 默认金黄、`thickness` 3、`offset` 4。
- 活跃底框：`active-box:off/current/trail`（off）、`active-box-continuity:isolated/joined`（isolated）、`active-box-background:色`（金黄）、`active-box-border-color:色`（透明黑）、`active-box-border-width:非负数`（0）、`active-box-padding:字符串`（0）、`active-box-radius:非负数`（8）；`active-box-enter/exit:一次性动作`（none）、`active-box-transition-frames:非负整数`（0）。
- 时间与动作：`lead-frames/tail-frames:非负整数`（0）、`handoff:cut/overlap`（cut）；`karaoke:off/current/trail`（off）、`karaoke-transition:step/wipe`（step）；`cue-enter/exit`、`atom-enter/exit`（none），对应 `*-frames:非负整数`（0）；`cue-enter-start-scale:非负数`（不覆写）；`atom-reveal:all/on-start/typewriter`（all）；`active-response:动作`（none）、`active-response-frames:非负整数`（6）、`active-scale:正数`（1.08）、`slide-distance:非负像素数`（24）；`loop:none/shake/wobble/glow-pulse/breathe/float/pulse/flicker`（none）、`loop-target:cue/active-atom`（cue）、`loop-period-frames:正整数`（12）、`loop-intensity:非负数`（1）。

一次性动作枚举：none、fade、pop、scale、spring、bounce、elastic、stamp、tilt、zoom-blur、flip-x、flip-y、spin、squash、stretch、slide-left/right/up/down、blur-in、wipe-left/right/up/down。颜色为六或八位十六进制；精确字体栈不可空、不可重复。

精确默认色：基础黑为 `#000000`、白为 `#FFFFFF`、透明黑为 `#00000000`，上述所有金黄为 `#FFD54A`。padding 两个数按“纵向、横向”，一个数同时用于两轴；不是 CSS 的四值属性。

**视觉与时间**：完整 Cue 按同一字体/绘制/动作规则排版，所有词不是独立自由定位角色。lead/tail 只扩大可见包络，词级时间不变。cut 先在同一角色相邻 Cue 之间消除额外包络争用，不能截断真实讲话区间；overlap 允许额外包络重叠。然后以 Use 胜出窗口裁可见性，原包络、动画起点、词时间均保留。Hidden 暂时遮掉再恢复时不重新打字或重新弹入。

current 在当前单元时间内强调，trail 从单元起点强调到 Cue 结束；step 整个单元切换，wipe 在该单元自己的讲话区间内扫过字形。on-start 逐单元出现，typewriter 在每个单元内部逐字素出现；两者与 karaoke 重着色独立。汉字通常是单个显示单位，双文本读音组保持一个完整对齐单元，不因换行限额拆碎。`word-gap` 只放大作者原有分隔符，不会因中英/数字边界自动插空格。joined 底框测量完整静止 Cue 包括未活跃后缀，把跨行/过宽词的背景合并为轮廓，半透明交叠处只画一次；Cue 动画带文字和装饰一起移动。

`max-lines` 必须配 `max-words-per-line`，控制结构计数行并在超限时报错，不承诺浏览器实际只占这么多行。`cue-enter-start-scale` 在 cue-enter=none 时无意义而报错。

regions 是已测量的数字证据，不是人脸跟踪服务：每 Cue 必须有一个角色；该角色存在轨迹时用当帧区域顶部中心替换 x/y；轨迹当帧为 null 就不画；根本没有该角色轨迹则保留作者 x/y。宽度与锚点仍属 Style；不插值、不平滑、不关联身份、不自动检测。

**编辑**：原 companion 展示 Cue 证据和 Use；允许编辑 Use 时间、样式引用、精确字体与 Recipe 控件；Cue 词时间不是可拖动的伪证据。案例见总表，interview 的三个 swap 特别展示 regions；complex-explainer 另有项目自定义单行家族，不能混同于普通 Fine Track。

### 2.4 typography-track：独立文字与文字填图

**作者元素**：

| 元素 | 全部属性 | 子元素/结果 |
|---|---|---|
| `Style` | `id*`、`recipe*:引用<Recipe>`、`font*:引用<精确字体/栈>` | Paint、Axis、Feature、Decoration；裸 id 为 Style |
| `Motion` | `id*` | ItemKeyframe、PathKeyframe、Sequence；裸 id 为 Motion |
| `Track` | `id*`、`timeline*:引用<Timeline>` | 至少一个 Point/Area/Path；`.program/.track` |
| `Point/Area/Path` | `id*`、`placement*:引用<Point/Frame/Path>`（与元素匹配）、`style*:引用<Style>`、`motion:引用<Motion>`（静止）、`content:引用<Text>`（无）、W（必选一种） | content 与正文互斥；正文为纯文本或仅 P 子元素 |
| `P` | `id:文本`（段序号）、`style:引用<Style>`（继承） | 文本、Span、Break；不可空 |
| `Span` | `id:文本`（run 序号）、`style:引用<Style>`（继承）、`language:文本`、`direction:auto/ltr/rtl`（继承） | 非空纯文本，不允许嵌套 |
| `Break` | 无 | 空，显式换行 |
| `Mask` | `id*`、`timeline*`、`text*:引用<TypographyProgram>`、`material*:引用<CompositableSurface>`、`mode:alpha/luminance`（alpha）、`fit:contain/cover/fill`（cover） | 空；`.track` |

P 或 Span 的 Style **完整替换字体及 Paint**，不是只换颜色；该 Style 的几何/层级规则不进入局部 run。作者缩进会统一去除，显式文字和 Break 顺序保留。Point 不换行、尺寸贴合文字，以锚点挂在一个点上；Area 受矩形、列数、溢出规则控制；Path 沿曲线排字，可随曲线旋转或保持直立。独立文字不读取讲话单元的时钟，W 只是其生存区间。

**Style 配方全集**：`stack-order*:整数`、`size*:正数`；`weight:1..1000整数`（400）、`font-style:normal/italic/oblique`（normal）、`line-height:正数`（1.2）、`tracking/word-spacing:数`（0）、`kerning:auto/normal/none`（auto）、`synthesis:none/weight/style/weight-style`（none）、`language:文本`（无）、`direction:auto/ltr/rtl`（auto）、`writing-mode:horizontal-tb/vertical-rl/vertical-lr`（horizontal-tb）、`baseline-shift:数`（0）、`vertical-align:baseline/super/sub`（baseline）、`tab-size:正整数`（4）、`indent/paragraph-before/paragraph-after:数`（0）、`transform:none/uppercase/lowercase/capitalize`（none）、`caps:normal/small-caps/all-small-caps`（normal）、`cjk-spacing:normal/none`（normal）、`punctuation-trim:none/start/end/adjacent/all`（none）、`fill:色`（无）；`inline-size/block-size:hug/fixed`（fixed）、`padding:1/2/4个非负数的字符串`（0）、`align:start/center/end/justify`（center）、`block-align:start/center/end`（center）、`wrap:none/word/grapheme`（word）、`overflow:visible/clip/ellipsis/shrink`（visible）、`max-lines:正整数`（无，仅 ellipsis/shrink）、`minimum-scale:数`（无，shrink 必需）、`clip:布尔`（false）、`columns:正整数`（1）、`column-gap:非负数`（0）、`metric-edge:line-box/cap-height/ink`（line-box）；`point-anchor-inline/block:start/center/end`（center）；`path-side:left/right`（left）、`path-orientation:follow/upright`（follow）、`path-start-margin/end-margin:非负数`（0）、`path-align:start/center/end`（start）、`path-reverse:布尔`（false）、`path-overflow:visible/clip`（visible）。

**全部 Paint 子元素**：每种颜色来源是 `color:色` 或一个 Linear/Radial，互斥。`Linear(angle*:数)`、`Radial(x*/y*:0..1)` 包含至少两个空 `Stop(offset*:0..1,color*:色,opacity:0..1=1)`，位置按非降顺序。

| 元素 | 专有属性；子元素 |
|---|---|
| Fill | `color` 可选；渐变 |
| Stroke | `width*:非负数`、`placement*:inside/center/outside`、color；渐变 |
| Shadow | `x*/y*:数`、`blur*:非负数`、`spread:数=0`、color；渐变 |
| Glow | `blur*:非负数`、`spread:非负数=0`、color；渐变 |
| Box | `target*:frame/content/paragraph/line/run/word/grapheme`、`continuity:isolated/joined=isolated`、`padding/radius/border-width:1/2/4数=0`、`border-color:色`（无）、`border-style:solid/dashed/dotted=solid`、color；渐变、BoxShadow、最多一个 Tail |
| BoxShadow | `color*:色`、`x/y:数=0`、`blur:非负数=0`、`spread:数=0` |
| Tail | `side*:top/right/bottom/left`、`offset*:数`、`width*/height*:非负数`、`color*:色`；空 |
| Axis | `tag*:唯一四字节可打印 OpenType 标签`、`value*:数`；空 |
| Feature | `tag*:唯一四字节标签`、`enabled*:布尔`；空 |
| Decoration | `line*:underline/overline/line-through`（同类不重复）、color 或渐变、`style:solid/double/dotted/dashed/wavy=solid`、`thickness:非负数`（无）、`offset:数`（无）、`skip-ink:布尔=true` |

必须至少有一个可见 Fill/Stroke（包括 Recipe fill）；Box joined 只支持 line/word/grapheme。边框需有颜色及非零宽度；绘制层顺序保留。

**全部 Motion 子元素**：ItemKeyframe 和 Sequence 内 Keyframe 都有 `at*`、`easing:linear/ease-in/ease-out/ease-in-out`（未覆写），以及可选数值 `x/y/scale/rotate/skew-x/skew-y/opacity/blur/clip-top/right/bottom/left`、`color:色`。至少一个动画属性；变换组中未写成员按 x/y/rotate/skew=0、scale=1，clip 组未写边为0。ItemKeyframe 的 at 是窗口内整数帧；Keyframe 的 at 是 0..1 单元进度。PathKeyframe 只有 `at*:整数帧`、`margin*:非负像素`、easing。每条动画至少两帧，帧序严格递增。

Sequence 全属性：`id*`、`unit*:paragraph/line/run/word/grapheme`、`start-index*:非负整数`、`end-index*:排他结束整数`、`duration-frames*:正整数`；`order:forward/reverse/random`（forward）、`start-frame:非负整数`（0）、`stagger-frames:非负整数`（0）、`cycles:正整数`（1）、`seed:整数`（无）。子元素只能是至少两个 Keyframe；序列 id 不重复。PathKeyframe 只允许 Path 文字使用。每单元按 start-frame、顺序、stagger、cycles 排自己的时钟，不自动对齐讲话。

**Mask 边界**：仅接受静态 Surface；每文字项必须是 Area、单个无局部 Style 的段、无 Break/富 run/Sequence；固定双轴、不换行、单列、横写、无 Decoration、不能 ellipsis/shrink。字体 weight/slant 必须匹配主精确字体，禁止 synthesis。遮罩只用字形形状，不保留 Style Fill/Stroke/Box；保留全项动画、时间与层级。其余输入明确拒绝，不能偷降级。companion 可编辑字体与 Style 配方；placement/content/motion 引用被读入但不是该 companion 声明的直接可写控件。examples 未发现完整工程，包内两个预览及 manifest 用例可作行为参考。

### 2.5 media-track：图片、视频、表面与替换序列

| 元素 | 全部属性 | 子元素 |
|---|---|---|
| Track | `id*`、`timeline*`、`canvas*:引用<Canvas>` | 至少一个 Item/Sequence |
| Item | `id`（序号派生）、`frame*:引用<Frame>`、`appearance*:引用<Recipe>`、`motion:引用<Recipe>`（静止）、`clip:引用<Path>`（无）、`image/media/surface:相应引用`（无）、`extent:引用<Extent>`（无）、`source-audio:图层id`（无）、`audio-gain:0..64数`（1，但必须有 source-audio）、W | 直接源时 Sampling/Sound；图层形式时 Paint/Layer/Sound |
| Sequence | `id`（派生）、`frame*`、`appearance*`、`motion`、`clip`、`until*`、`until-boundary:start/end`（end） | 至少两个 Member，严格相邻配对的 Handoff，零或多个 Sound |
| Member | `id`（派生）、`image/media/surface/extent`、`appearance:引用<Recipe>`（继承 Sequence）、`source-audio/audio-gain`（同 Item）、I | 直接源时 Sampling；图层形式时 Paint/Layer；无 Sound |
| Layer | `id`（派生）、`image/media/surface/extent`、`appearance:引用<Recipe>`（继承所属单元） | 仅 Sampling |
| Paint | `id`（派生）、`appearance*:引用<Recipe>` | 空 |
| Sampling | `at*:start/end/0%..100%`、`zoom:正数=1`、`x/y:像素数=0`、`rotate:角度数=0`、`easing:四种通用缓动`（未覆写） | 空 |
| Handoff | `id`（派生）、`from*:前一Member id文本`、`transition*:引用<Recipe>` | 空 |
| Sound | `id`（派生）、`source*:引用<SynchronizedMedia>`、`at:enter/exit` 或 `handoff:本Sequence的Handoff id`、`gain:0..64数=1` | 空；at/handoff 必须恰好一个 |

直接源三选一：`image` 是图片 Artifact 且必配 extent；`media` 是规范化带时钟媒体；`surface` 是可合成透明表面。后两者禁止 extent。没有直接源则用有序 Paint/Layer；两种写法不得混合。`video`、旧式 `audio` 不在允许属性集内。源声音须显式选择：直接源用 `source-audio="content"`，图层用该 Layer id；默认不带原声音。`.audio` 仅在 source-audio 或 Sound 实际被声明时导出；Film 不会自动替作者加入它。

**Appearance Recipe**：

- 拟合：`fit:contain/cover/fit-width/fit-height/native/scale-down/stretch`（contain）；`frame-x/y`、`content-x/y:对齐比例`（0.5）；`fit-offset-x/y:像素数`（0）；`fit-constraint:bounded/free`（bounded）。
- 采样：`opacity:0..1`（1）、`blur:非负数`（0）、`brightness/contrast/saturation:非负数`（1）；`playback:once-start/once-end/hold-start/hold-end/loop-start/loop-end/stretch`（once-start）；`trim-start/end:整数源帧`（完整范围，必须成对且 end 排他）。
- 外框：`stack-order*:整数`，`clip:none/frame/rounded`（frame）、`radius:非负像素`（0）、`padding:1/2/4数的字符串`（0）、`border-width:非负像素`（0）、`border-style:solid/dashed/dotted`（solid）、`border-color:色`（正宽度时必需）、`shadows:字符串`（无，分号分隔 x y blur spread color）、`frame-paint:固色或渐变字符串`（透明）。渐变为角度/中心加有序色停的显式表达。
- Layer appearance 只接受拟合和采样键；Item/Sequence 的直接源 appearance 允许加外框键。Paint appearance 只有 `paint*:固色/渐变`、`opacity:0..1=1`。未知键报错。

**Motion Recipe** 独立于 Appearance：`enter/exit:none/fade/slide/scale/pop/bounce/blur-reveal/wipe/flip/spin`（none）；启用时对应 `*-frames:正整数` 必填；`*-easing:四种缓动`（ease-in-out）、`*-direction:left/right/up/down`（slide/wipe/flip 必需）、`*-amount:数`（不覆写）、`*-origin:outside-canvas`（无，仅 slide，不能同时给 amount）。`sustain` 为逗号分隔 `float/breathe/pulse/wobble/shake/drift`、非负 amount、1..100整数 cycles 和可选 direction 的组合（无）；drift 必须 direction。此动作移动整个带边框/阴影的单元；Sampling 在拟合完成后的源矩形中心上缩放、偏移、旋转，不能当作移动目的 Frame。Sampling 必须有覆盖开始到结束的有序键帧；可故意露出背板。

**播放规则**：once-start 正常从头播，耗尽后无源画面；once-end 对齐尾端，过短窗口用源尾，过长窗口开头空；hold-start 播后定格尾，hold-end 前部定格首；loop 两种保持原速，循环相位对齐对应边；stretch 把选中源全范围覆盖窗口。静态图片禁止 playback/trim；源规范化帧率须匹配 Timeline，原速为每节目帧前进一源帧。视觉 hold 不制造“冻结音频”。

**Sequence**：Member 激活点依作者顺序严格前进；第一个激活到 until 为组寿命。下一激活点结束前一逻辑阶段。每对相邻 Member 都需一个 Handoff，即使只是 cut；from 必须按相邻顺序填写。transition Recipe 全键：`operator*:cut/crossfade/push/wipe/cover/page-turn`、`duration-frames*:非负整数`、`boundary-ratio:0..1=0.5`、`direction:left/right/up/down`（四个空间转场必需）、`audio:cut/crossfade=cut`。cut 时长只能0，其余必须正数；音频 crossfade 也需非空转场。边界前占 floor(duration×ratio) 帧，剩余在边界后；语义激活不移动。Handoff 不得越出 Sequence 包络或彼此重叠。视觉跨度按相邻转场外扩；组运动时钟不随 Member 重启。

边框/内边距缩小拟合区域，outer clip 沿外框，不保证 contain 图片自己的四角变圆；Path clip 与 Recipe clip 不得同时声明。超出尺寸的 padding、未知音频层、没有规范化声音的输入、重复身份、源帧越界均需报错。独立 Item 可以重叠，它们是同级呈现，不套 last-Use-wins。

**Sound 的准确触发**：enter 在 Item/Sequence 首帧；exit 在结束帧减 exit 动作时长的位置，没 exit 动作就在排他结束帧；handoff 在下一 Member 的逻辑激活点，而不是转场外扩起点。每次从音效头原速播，无淡入淡出，最多到 Timeline 末尾；触发点已经等于节目末尾时因可听长度为0而报错。普通 Item 不允许 handoff 音效；Sequence 的 handoff id 必须存在。source-audio 的 crossfade 则是整个 Handoff 时段，两侧声音按跨度外扩并分别淡出/淡入，和额外音效不是同一个机制。

**编辑**：原 companion 可改 Frame 的 left/top/right/bottom/x/y/width/height、图片 extent 宽高、appearance/motion Recipe、source-audio/audio-gain；Sequence/Member/Handoff 保留其时序证据。examples 中 podcast 展示 B-roll 盖画面而对白仍来自 Sound；ranking-football/swap-topic 展示独立 B-roll；本包 preview 有 `.svml/.svs/.svrun` 完整素材卡工程。

### 2.6 audio-track：独立音频占位

`Track(id*,timeline*)` 仅有至少一个空 `Item`。Item 全属性：`id:文本`（Track+四位序号）、`source*:引用<SynchronizedMedia>`、W、`trim-start/end:非负时长`（分别默认0/源末，不要求成对）、`playback:once/once-start/once-end/loop/loop-start/loop-end/stretch`（once）、`min-rate/max-rate:正数`（仅 stretch，二者必需且 min≤max≤100）、`gain:0..64`（1）、`fade-in/out:非负时长`（0f）。输出 `.program/.audio`，不产生画面。

source 必须含**显式规范化**的音频成员；最终引用 audio/wav，不接受裸视频直接抽声。裁切在源采样轴上，源长度和窗口帧边界映射到48 kHz；trim 开头不得到达源末，结束须大于开始且不越源。once 是 once-start 别名：源更短则只播实际长度，窗口余段无声；once-end 用源尾对齐目标尾；loop 连续覆盖目标，loop-end 的相位让尾端整齐对齐；stretch 播放率=裁后采样长度/窗口采样长度，越作者 bounds 报错，保持音高。

淡入淡出以实际可听区间为基准，每一个都不得长于区间；不同 Item 重叠直接交给下游混音，不互斥也不做自动 ducking。gain=0 不代表别的 Track 应当静音。companion 可写 trim、播放模式和速率上下限、gain、fade；source 是只读绑定。interview 同时用音乐床和按 Moment 触发音效；podcast/ranking-football 主要是音乐床；complex-explainer 使用单独音频轨道。

### 2.7 sound：已有 Timeline 声音的呈现规则

`Style(id*,gain:0..64=1,end-gain:0..64=gain)` 是空元素；输出 Style 和内部增益参数记录。`Track(id*,timeline*)` 仅接受空 `Use(style*:引用<SoundStyle>,id:派生,W:默认全程)`；输出 `.program/.audio`。允许空 Use 集合，结果无声；不是凭空选择一条背景音乐。

普通 Style 按 Timeline 已放置源取声，同一时间存在多个候选源时，**后声明的 Timeline 有声片段获胜**，这和 Use 顺序是两个不同层次。每 Use 的增益从窗口起到止线性插值；gain=end-gain=0 不生成可听 clip，但这个 Use 仍遮掉前面的声音。Track 再按**后写 Use 优先**裁可听性，仅改 audibility mask，保留原源位置、采样速率、目标区间和增益曲线。后规则结束后露出的旧规则继续原曲线，不重新淡入。

项目 Style 可用自有图 Fragment 接口绑定一个 Narrative Segment 的声音；该段须属于 Timeline 的 Narrative 且实际已放置；此源绑定属于 Style，不是普通 Use 增加一个 source 属性。Style 需暴露 audio，Timeline/window 作为开放输入，其余参数提前绑定。原 companion 可改 Use 窗口/Style、Style gain/end-gain。案例为四大示例组和 minimal-author-package；semantic-composition 的 sound-styles 展示自有交接 Style，而非普通 Style 多出隐含 crossfade 属性。

### 2.8 performance：已有 Timeline 画面的呈现规则

`Style(id*,frame*:引用<Frame>,appearance*:引用<Recipe>)` 空；接受 Media Appearance 的拟合、绘制、外框键，但**禁止 playback/trim-start/trim-end**；不另有 motion 属性。`Track(id*,timeline*,canvas*)` 只接受空 `Use(style*:引用<PerformanceStyle>,id:派生,W:默认全程)`；输出 `.program/.visual`，不输出音频。允许零 Use，结果无画面。

普通 Style 从 Timeline 投影已放置的画面片段。缺视觉成员的源跳过；每片段用已知源截取和原速采样，不因 Use 开始重新从视频头播放。按 Media 规则拟合到目的框。后写 Use 只覆盖局部可见性，保留源采样/动画起点；不同 Performance Track 仍独立。没有现成画面不自动生成或取代为某张头像。

项目 Style 可通过 Fragment 添加特殊重新构图/转场，开放输入为 Timeline、Canvas、window，其他绑定提前固定，输出 visual；这不是普通 Style 的未公开配方键。companion 可写所引用 Frame 的几何及 Appearance，Use 的时间与 Style；音画内容证据只读。complex-explainer 是丰富的项目 Style 用例，其余三组和 minimal-author-package 主要是普通 A-roll。

### 2.9 deck-track：DepthStack 卡片堆

`DepthStack(id*,timeline*,canvas*,frame*,appearance*:Recipe,until*,until-boundary:start/end=end)` 只接至少一个空 `Card`。Card 全属性：`id*`、`source*:引用<图片Artifact/SynchronizedMedia/CompositableSurface>`、`extent:引用<Extent>`（图片必需，其他禁止）、I、`appearance:Recipe`（继承）、`label:引用<DeckLabel>`（无）。输出 `.program/.track`，不输出卡片源声音。

`Label` 全属性：`id*`、`font*:引用<精确字体栈>`、`content:引用<Text>`（无）、`size:正数=34`、`color:色=白`、`align:start/center/end/justify=center`、`block:start/center/end=end`、`padding:非负像素=20`；正文为非空纯文本，或 content 引用时为空。输出裸 id Label。字体 weight/slant 来自主 face；标签作为卡片上的文字，随卡片姿态一起动。

**Recipe** 允许 Media 的全部拟合/采样/外框/动作键（deck stack-order 默认30），另有以下键，全部可选：

| 键组 | 类型、默认 |
|---|---|
| visible-previous/visible-next、wrap | 0..1000整数=2/1；布尔=false |
| current-x/y/rotation、scale/opacity/stacking | 有限数=0/0/0；正数=1；0..1=1；整数=0 |
| current-brightness/contrast/saturation | 非负数，均1 |
| previous-x-step/y-step/rotation-step | 数=0/28/-2.5；previous-rotation-mode:linear/alternate=alternate |
| previous-scale-step/opacity-step/stacking-step | 正数0.94、0..1值0.82、整数-1 |
| previous-brightness-step/contrast-step/saturation-step | 非负数0.92/1/0.86 |
| next-x-step/y-step/rotation-step | 数0/-20/2；next-rotation-mode=alternate |
| next-scale-step/opacity-step/stacking-step | 正数0.92、0..1值0.72、整数-1 |
| next-brightness-step/contrast-step/saturation-step | 非负数0.88/1/0.78 |
| reflow-frames/reflow-easing | 非负整数8；四种通用缓动=ease-in-out |
| playback-future/playback-past | hold-head/continue=hold-head；hold-tail/continue/hide=hold-tail |

第一张 Card 激活到 until 是整组寿命；Card 按作者顺序激活且不可同帧/倒退，until 必须晚于全部激活并在 Timeline 内。当前卡片是深度0；前后可见卡片的平移/层级随深度线性累加，scale/opacity/色调因子按深度乘幂，rotation 根据 linear 或奇偶 alternate。wrap 仅让首尾成为邻居，不重新安排激活；显示数量不能让同一卡片同时占两个深度。

第一阶段直接呈现；后续在 reflow-frames 内从上阶段姿态到本阶段姿态，旧新集合并集参与转移。重排时长不能超过该激活阶段。卡片还是同一源，不生成新图。当前卡片按 Media 采样模式播放；未来默认定格裁后第一帧，过去默认定格裁后末帧或 hide；continue 必须同时用 loop-start 活跃播放，按绝对时间相对于激活点连续循环。非当前卡片不继续 Sampling 运动。companion 暴露 Deck Recipe、Card appearance、label、时间；source/extent 为读取绑定。examples 未发现独立用例，包内有 DepthStack 预览。

### 2.10 ranking：TierBoard、Column、TopThree

**Style 元素**：`TierBoardStyle/ColumnStyle/TopThreeStyle` 均为 `id*、recipe*:Recipe、font*:精确字体或栈` 的空元素；输出裸 id Style 与 `id.sound`。容器均需 `id*、timeline*、frame*:Frame、during*:program或Selection/Segment、style*:对应Style`；TierBoard/Column 再需 `canvas*`；TopThree 再需 `terminal*:绝对时间或Moment引用`。可选 `appear-sound:规范化媒体`；TierBoard/Column 可选 `move-sound`，TopThree 禁止。注意这里容器仅接受 during，不接受完整 W；不要把通用窗口能力误扩展给所有元素。

| 子元素 | 全部属性、默认与要求 |
|---|---|
| TierItem | `id`（派生）、`tier*:文本`、`icon*:图片Artifact`、`preset:布尔=false`、`during:Selection/Segment或program`、`entry:direct/drop`、`stack:整数`（Style 层级）。preset 与 during 互斥；preset 禁止 entry；非 preset 必填 during 与 entry |
| ColumnItem | `id`（派生）、`label*:文本或Text引用`、`rank*:正整数`、`icon:图片Artifact`（无）、`preset:false`、`during`、`stack`。preset/during 互斥且必须一个 |
| TopThreeItem | `id`（派生）、`label*:文本或Text引用`、`icon:图片Artifact`（无）、I、`stack`。无 preset/rank/entry |

全部 Item 空，至少一个且 id 唯一。Column rank 唯一；标签引用先物化为准确文字。公共输出 `.schedule/.program/.visual`；有声音时增加 `.events/.audio`。

**调度/视觉**：TierBoard/Column 非 preset 的揭示窗口须在 outer 内且互不重叠；揭示结束后不是消失，而是进入 settled，保持至 outer 结束；preset 从 outer 首帧就 settled，且无音效事件。TierBoard 窗口至少2帧；预置项按作者顺序先占靠内格，其余按窗口起止时间排序，而不是 XML 子项顺序。未知 tier、单行格容纳不下图标需报错。direct 在最终格内带过冲弹入；drop 在 Canvas 上的独立解释台弹入停留，末段移动/缩小到 tier 格。

Column 按 rank 排最终位置；行号/占位底板一直存在。有 icon 时显示图标，否则用 label；一般从画面下方进入大解释台，末段缩到排名槽。揭示1帧时直接最终出现；不足 appear+move 总时长时按比例压缩并保证各至少1帧。不能用重排输入修复重叠窗口。

TopThree 最多3项，激活按时间排序决定横向席位，无需与子项顺序相同；每项从激活到下一激活/terminal 为 active stage，之后留到 outer 结束。出现时淡入/上移/缩放，当前席位边圈在该 stage 中间轻微放大再收回；已有席位保留。没有移动阶段，也没有 move-sound。

**完整 Recipe 键**（均可省略，有默认）：

- 公共文字：`font-size:正数=28`、`font-weight:整数=700`、`text-color:色=白`、`line-height:正数=1.15`；公共运动 `appear-frames:正整数=6`、`move-frames:正整数=8`、`motion-easing:四种=ease-in-out`。
- Column 接受公共文字/运动/声音及板式：`board-background=深蓝黑`、`board-border-color=半透明白`、`board-border-width:非负数=1`、`board-radius:非负数=18`、`board-shadow-x/y/blur/spread:数=0/10/24/0`、`board-shadow-color=半透明黑`；`board-stack/item-stack/stage-stack:整数=20/30/25`；`rank-colors:非空颜色数组`（金/银/橙/蓝/紫）、`padding=18`、`row-height=74`、`row-gap=10`、`icon-size=58`、`icon-radius=10`、`icon-fit:contain/cover=cover`、`stage-x/y:0..1=0.66/0.73`、`stage-size=356`。尺寸/间距均像素，尺寸须正、间距/圆角非负。
- TierBoard 不接受上述整套普通板式/文字运动键：专有 `rows:非空对象数组`（五行 s/a/b/c/d，各有唯一 id、label、color）、`label-text-color=深灰`、`label-size:比例=0.3`、`line-height=1`、`board-background=深灰`、`board-border-color=近黑`、`board-border-width=3`、`label-width:比例`（不覆写几何默认）、`stage-x/y=0.2/0.3`、`stage-size=168`、`icon-radius-ratio=0.12`、`icon-fit=cover`、`appear-frames/move-frames=8/14`、`board-stack/stage-stack/item-stack=20/25/30`。
- TopThree 接受公共文字/运动/声音键，以及公共 board-* 键集合（部分键被允许但不用于其空席圈视觉）；`slot-colors:非空色数组`（金/银/橙）、`center-x/baseline-y:比例=0.5/0.55`、`slot-gap=24`、`icon-size=104`、`icon-radius=52`、`icon-fit=cover`、`ring-width=5`、`label-gap=12`、`board-stack/item-stack=20/30`。move-frames 可以出现在配方中，但此形态不发生移动。
- 三种声音均有 `appear-gain/move-gain:0..64数=1`、`sound-fade-frames:非负整数=0`。声音参数属于 Style 的额外声音输出，不是 Item gain。

默认色的准确值：公共 text-color `#ffffff`；Column 的 board-background/border/shadow 分别 `#151821/#ffffff33/#00000066`，rank-colors 顺序为 `#facc15/#d1d5db/#fb923c/#60a5fa/#a78bfa`；TopThree 默认取前三色。TierBoard 的默认行依次 S/A/B/C/D，行色 `#EE5F52/#F0A04C/#F0C84D/#EDE356/#A6DA7B`；label-text-color `#2c2c2c`、board-background `#2b2b30`、board-border-color `#111315`。

**声音事件**：appear 在揭示/激活首帧；Tier drop 的 move 在窗口尾端对应移动起点（存在移动段才有）；Column 在按实际压缩时长算出的移动起点。move-sound 没有 drop 项或没有匹配事件时报错。输入声音必须含规范化音频；从事件起原速播，到 Timeline 末尾截断，不按 board outer 自动截断；fade 是淡入，无自动淡出。样式需可解析其 `.sound`，不接受挂不出该输出的任意 Style。

**编辑**：原 companion 可改 Frame 几何、Style Recipe/字体、Item label/rank/tier/entry/stack；icon 和音效源为读取绑定；揭示窗口和 settled 可显示为不同跨度。案例为 ranking-football/reference、reference-gpt、swap-host、swap-topic、reference-banana 两组的 TierBoard；swap-effect、swap-effect-banana、swap-effect-banana-reference-sync 用 Column。未发现完整 TopThree 工程，包内有图片预览。

### 2.11 comment-sticker：评论卡

`Style(id*,recipe*,font*:字体栈)` 空。`Track(id*,canvas*,timeline*)` 接至少一个 `Sticker`；输出 `.program/.track`。Sticker 全属性：`id*`、`frame*`、`style*`、W、`comment:文本或Text引用`（无）、`avatar:图片Artifact`（无）、`author/header/meta:文本或Text引用`（无）。正文只能是评论纯文本，会去公共缩进；comment 属性与非空正文互斥且至少一个。空/仅空白文字、错误头像类型、重复身份拒绝。

**Recipe 全键与默认**：`stack-order:整数=62`；`background=白`、`border-color=极淡黑`、`border-width=1`、`radius=28`、`padding-x/y=28/24`、`gap=18`、`rotation=-2.5`；`shadow-color=半透明黑`、`shadow-x/y/blur/spread=0/18/46/0`；`tail:布尔=true`、`tail-width/height/offset-x=42/28/58`；`avatar-fallback:none/initial=none`、`avatar-size=58`、`avatar-border-width=3`、`avatar-border-color=白`、`avatar-background=深灰`、`avatar-text-color=白`；`header-size/weight/line-height/color=24/680/1.15/灰`、`body-size/weight/line-height/color=42/850/1.16/近黑`、`body-max-lines:正整数=3`、`meta-size/weight/line-height/color=21/650/1.15/灰`；`enter:none/fade/pop/slide-pop=pop`、`enter-frames:非负整数=17`、`enter-offset-y=-180`、`enter-start-scale:正数=0.78`、`enter-rotation-delta=-4.5`、`enter-easing:通用四种或out-back=ease-out`；`exit:none/fade/fade-up=fade-up`、`exit-frames=20`、`exit-offset-y=-28`、`exit-easing=ease-in`；`hold:none/float=float`、`hold-amplitude-y=4`、`hold-rotation-amplitude=0.35`、`hold-period-frames:正整数=84`。未注明的尺寸/模糊/间距须非负，字体和头像尺寸正数，角度/偏移/spread 有限，weight 为整数，色为六/八位十六进制；avatar-background 还支持限定的背景表达。

默认色的准确值：background、avatar-border-color、avatar-text-color 均 `#ffffff`；border-color `#0000000e`、shadow-color `#0000004d`、avatar-background `#34313a`、header/meta-color `#8f8f8f`、body-color `#111111`。

Frame 高包含底部尾巴，卡片高度需减去 tail；必须留足 padding、头像列、标题、正文、meta，否则在布局时报“太窄/太矮”。标题显式 header 优先；否则有 author 就形成回复该作者的提示，没有 author 则普通评论回复提示。头像有图时圆形 cover；没图且 initial 模式及 author 存在时用去掉 @ 后首字大写；默认 none 不画头像，正文列回收其空间。

正文固定区内按词换行，超 max-lines 用省略号，不按词时钟逐字出现。整个卡按 W 首尾入/出，pop 同时缩放/旋转，slide-pop 再叠加 Y 偏移；hold 在入场结束到离场开始之间正弦浮动。它不取音频，无字幕联动；多个 Sticker 可叠。companion 可改 Frame、Style Recipe 和 comment/author/header/meta；avatar 是只读源。examples 未发现，包内有预览和 manifest 示例。

### 2.12 screen-overlay：十一种全屏覆盖

`Track(id*,canvas*,timeline*)` 至少一个效果子元素；输出 `.program/.track`。每种效果都是**空元素**，共同属性为 `id:文本`（效果种类+序号派生）、`z*:整数`、W（必选），没有 Frame、Style 或 Recipe 属性。所有效果覆盖 Canvas；不是面板，不变换下层视频，只叠自己的几何/纹理。颜色为六/八位十六进制；下表专有属性全部必填，无默认。

| 元素 | 专有属性类型/范围 | 视觉/动画 |
|---|---|---|
| Flash | color:色、intensity:0..1、attack/hold/decay:非负整数帧 | 从0到强度、保持、回0；三个时长全0则窗口内常亮 |
| ColorWash | color、opacity:0..1 | 常量色层 |
| Vignette | center-x/y:0..1、radius-x/y:正比例、softness:0..1、color、opacity:0..1 | 指定椭圆中心透明，外缘渐变色，不自动跟脸 |
| ScanLines | spacing/thickness:正像素且 thickness≤spacing、angle:数、opacity:0..1、travel:数像素 | 白色重复扫描线沿角度平移 |
| DirectionalMatte | angle、coverage/feather:0..1、color、opacity:0..1、from/to:-1..2 | 带羽化边的色遮罩沿窗口进度从 from 到 to 穿屏 |
| WhipVeil | direction:left/right/up/down、width:正像素、softness:非负像素、travel:正像素、opacity:0..1 | 白色柔带从负 travel 走到正 travel |
| GlitchVeil | bars:1..256整数、colors:逗号分隔非空色列表、opacity:0..1、travel:数、seed:非负整数 | 固定 seed 的横条位置/粗细/透明度，分别水平移动 |
| Grain | amount:0..1、size:正像素、chroma:monochrome/color、motion-rate:数像素/帧、seed | 固定种子小块颗粒，窗口内平移，不是每帧独立随机噪声 |
| LightLeak | colors、angle、softness:0..1、travel:数、intensity:0..1、seed | 带种子角度扰动的多色渐变/模糊横向漏光 |
| Bokeh | amount:0..1、min-size:正像素、max-size≥min-size、color、warmth:-1..1、drift:数、seed | 随机圆形虚焦高光，以固定种子位置、尺寸和漂移 |
| TVStatic | amount:0..1、size:正像素、scan-lines:0..1、motion-rate:数、seed | 有限噪点格加固定暗扫描线，噪点上下漂移 |

随机几何每次求值由 seed 重建，seek 不依赖上一帧状态。Grain 数量至少1并约为 amount×160；Bokeh 至少1并约为 amount×48；TVStatic 噪格最多512。因此 amount=0 并非严格空集合。Flash 配置的三段时间不自动重缩放到 W；源码生成三段节点并另添窗口结束的零透明度节点，三段总长超过窗口时仍保留越界节点。不能据此承诺“自动裁包络成功”，需独立实现明确校验，见待定问题。

companion 对所有实际效果属性及 z 声明可写，按几何/运动/颜色/效果分组。interview 四份工程使用 Moment+8帧窗口的彩色 Flash；其他效果有包内组合预览，未发现完整 examples 使用。

### 2.13 interview-emoji-reveal：答案条依次揭示

`Style(id*,recipe*)` 空；`Track(id*,timeline*,canvas*,style*,placeholder*:图片Artifact,W)` 仅至少一个空 `Item(id*,icon*:图片Artifact,preset:布尔=false,at:绝对时间或Moment引用)`。preset 与 at 互斥，非 preset 必填 at；id 不重复；所有 preset 必须在第一项需揭示 Item 之前，不能夹在后面。输出 `.program/.track`；无自动音效。

Recipe 全键/默认：`center-x/top-y:0..1=0.5/0.07`、`slot-size:正像素=72`、`slot-gap:非负像素=10`、`padding-x/y:非负像素=18/14`、`background=米白`、`border-color=近黑`、`border-width=4`、`radius=22`、`shadow-color=半透明黑`、`shadow-x/y/blur/spread=9/10/0/0`、`icon-size:正像素=48`、`reveal-frames:正整数=6`、`stack-order:整数=66`。icon-size≤slot-size；颜色六/八位十六进制。

槽位始终按作者顺序水平排列，整条宽=双侧 padding+槽位数×slot-size+间隔数×gap，锚于 Canvas 的 center-x/top-y；包括所检查阴影位移后必须落在画布内，过宽/过低报错而非自动缩小。所有非 preset 的激活必须在 outer 内且依作者顺序严格递增。

默认色准确值：background `#FFFDF7`、border-color `#161616`、shadow-color `#000000B8`。图片必须有 image/* 媒体类型及正字节数；不允许用空占位 Artifact。

preset 槽从首帧就是答案；普通槽先显示 placeholder，激活前一帧仍在，激活帧隐藏占位并亮出 icon。答案从0.72倍，约34%揭示时长到1.14倍，约68%到0.95倍，最终1倍；阶段点按整数帧并夹在窗口终点。其后一直保留至 outer 末尾。Item at 跟语义 Moment，但不通过显示词数决定速度。无对应 *-studio 包，需在保留的 Studio 中统一注册属性编辑。interview 的 reference 和三个 swap 使用此组件，音效由独立 audio-track，闪光由 screen-overlay。

### 2.14 image-compose：静态栅格合成

`Image(id*,canvas*:Canvas,background:八位RGBA色=#00000000)` 包含 `Layer(source*:图片Artifact,frame*:Frame,fit:contain/cover/stretch=contain,interpolation:nearest/linear/cubic/area/lanczos=lanczos,opacity:0..1=1)`；Layer 空且没有 id 属性。输出 `.image`，PNG，Canvas 大小。需要1..64层：当前 surface 解码允许零层，但后续 Raster 请求会明确拒绝，不能把“解码成功”当有效项目。

按子元素顺序绘制，后层在上，保留 alpha 和 opacity；目的矩形超 Canvas 部分裁掉。contain 留底板，cover 裁切，stretch 改宽高比；不支持时间、词对齐、任意图层动画、文本自动排版、生成式重设计。无 Style/Recipe 钩子，属性就是完整操作合同。需本地 Raster Need 执行器，不付费生成。examples 未发现，manifest 与 README 有 Layer 示例；无专门 studio 包。

### 2.15 image-transform：可复用顺序操作程序

`Program(id*)` 接至少一个操作，输出裸 id 的程序；`Transform(id*,source*:图片Artifact,program*:Program)` 空，输出 `.image`。操作按写入顺序作用于上一个结果，不能重排以优化而改变结果。没有 Style/Recipe，只有以下完整操作属性：

| 操作 | 属性、必填、默认和范围 |
|---|---|
| Crop | `unit:fraction/pixel=fraction`；`x*/y*/width*/height*:数`。fraction 起点0..1、尺寸>0且≤1并不越图；pixel 起点非负整数、尺寸正整数≤65535 |
| Resize | `width*/height*:正整数≤16384`、`fit:contain/cover/stretch=contain`、`interpolation:五种=lanczos`、`background:六/八位色`（无） |
| Rotate | `degrees*:90/180/270` |
| Flip | `axis:horizontal/vertical/both=horizontal` |
| Denoise | `method:nlm-ycrcb`、`luma:0..50=2`、`chroma:0..50=10`、`template-window:奇数≤31=7`、`search-window:奇数≤63=21`、`saturation-recovery:0..4=1.02`；search须更大 |
| Color | `exposure-stops:-8..8=0`、`contrast/saturation:0..4=1`、`temperature/tint:-1..1=0`、`gamma:0.1..10=1` |
| Sharpen | `amount:0..5=0.5`、`radius:0.1..20=1`、`threshold:0..255=0` |
| Blur | `sigma*:0.1..100` |
| Alpha | `mode:preserve/flatten=preserve`、`background:色`。flatten必需背景，preserve禁止背景 |
| Encode | `format:png/jpeg/webp=png`、`quality:1..100`（无）、`background:色`（无，仅jpeg）；png禁止quality |

Encode 至多一个且必须最后；没有 Encode 默认 PNG。文法意图是操作空元素，不应复现现有解码器部分操作没有逐一拒绝子节点的宽松遗漏。旋转/翻转改变像素几何，去噪使用 YCrCb 非局部均值后恢复饱和度，色彩和锐化不是付费生成。使用本地 Raster 执行器；不能凭 Node/Python 存在就认定 OpenCV 已安装。examples 未发现；源码导出一套“轻亮度/较强色度去噪再 PNG”的预制程序，但 dsivio-video 应以自有名称重写行为，不转移实现代码。

### 2.16 background-removal：静态图去背景能力

`Background(id*,source*:引用<图片BlobArtifact>)` 空，`.image` 为透明图片 Artifact。source 可以是文件或生成输出；真实请求检查 image/*、资源标识和非负大小。只支持静态图，不能把单张肖像抠图当作后续人物视频的逐帧抠像。无时长/动画/Recipe/输出格式属性，实际输出尺寸应据结果事实放置。

组件只声明一个外部去背景 Need；Provider 负责服务映射和任务生命周期，不在作者层偷偷自动调用一个模型。**外部服务是否收费没有被本包固定**。Dsivio 当前没有此能力，不能改成 `dsivio media image` 普通生成或让插件保存供应商密钥。可接受用户外部准备的透明图继续合成，但这不是宣称实现去背景。examples 未发现；无独立 studio 包。

### 2.17 volcengine-matting：人像视频抠像

`Portrait(id*,source*:引用<视频BlobArtifact>,format:WEBM/MOV=WEBM)` 空，`.video` 是透明视频原始 Artifact。作者内联文件在解码时就检查 video/*；组件输出作为引用仍会在请求验证中要求视频。source 必须恰好一个，format 最多一个；无 prompt、duration、尺寸、模型选择或 Recipe。人物轮廓逐帧保留，透明背景，用源决定时长/尺寸；结果须再规范化为可合成 Surface/媒体后进入 Track。

这是**原项目外部生成端点**，不是本地 ffmpeg 的普通裁切，原默认服务经 HypiHub。Dsivio 不支持 matting，且已决定移除该网关，因此不能保留一个表面可编译而运行时无实现的 Portrait。建议移除具体厂商元素；保留导入已有透明视频的路线，待宿主真正增加抠像能力再决定中立操作接口。examples 未发现；无可保留的专门 studio 属性界面。

### 2.18 browser-capture：项目素材捕获而非图组件

没有 DVML 元素/子元素/Style。捕获在 Build/Source 图外，输出文件之后可作为普通图片/视频导入。脚本负责网站理解、登录、交互、懒加载和选择值得展示的状态；组件只管理浏览器与捕获，不改网页内容、不给网站提供“摘要截图”默认策略。

**CLI 形状**（使用新命名示意，不声称这些命令已在插件实现）：

```text
dsivio-video capture screenshot <网址或本地HTML> --to assets/page.png [选项]
dsivio-video capture run task.mjs [浏览器选项] -- [原样脚本参数]
dsivio-video capture install-browser [浏览器版本/缓存/下载来源选项]
```

截图专有选项：`--full-page`、`--selector <可见元素>`、`--clip <x,y,width,height>` 三选至多一；`--transparent`、`--wait-for <可见元素>`、`--wait-ms <非负毫秒>`。默认捕获当前视口；页面导航等待 load，HTTP非成功响应报错。clip 起点非负、尺寸正数。支持 HTTP(S)、file URL、工作目录相对的本地文件。

浏览器选项：`--viewport WxH`（1280×720）、`--scale <正数>`（1）、`--channel chrome/chrome-beta/chrome-canary/chrome-dev`、`--browser <路径>`、`--browser-version <四段准确版本>`、`--browser-cache <目录>`、`--browser-download-base-url <HTTP(S) URL>`、`--headed`、`--timeout-ms <非负毫秒>`（上游默认，0关闭）、`--json`。managed version/cache 与明确 channel/executable 互斥；run 禁止截图专有选项。浏览器下载只有 install-browser 显式执行，capture 不自动安装或改用其他下载站。缓存按显式参数、环境变量、用户缓存目录依次选择。

**脚本/库合同**：脚本默认异步导出接收 browser/page/screenshot/record/args/log，可选导出 options；命令行显式浏览器选项覆盖脚本。普通 Node 权限，参数 `--` 后原样传递，相对输出路径按工作目录。

会话拥有一个浏览器、初始 page，可对脚本创建的其他 Page 捕获。screenshot 必填 path，其余接受 Puppeteer 截图设置及可选 selector，禁止指定 encoding；PNG/JPEG/WebP；结果尺寸从保存字节读，含设备缩放。record 必填 path，原生 MP4，Chrome153+；audio 默认不启用，fps/frameRate 为最大速率，maxWidth/maxHeight 默认视口设备像素；实际录像尺寸以 Chrome 和 ffprobe 的结果为准，不假定 screenshot 的尺寸等于视频。

stop 幂等，等待停止及磁盘写完，再发布结果；回调返回自动结束所有未停录制。文件以独占创建预留，拒绝覆盖；失败只删本次未完成文件；之前完成文件保留。最后关闭浏览器。结果含类型、绝对文件路径、捕获网址、真实宽高、格式，视频另有时长、帧率和是否含声。完成路径逐个输出，json 返回带格式版本标记的完整结果列表；脚本绕过 helper 自己写文件不进入列表，也不享受此防覆盖合同。无付费生成，网络访问成本与素材版权另行判断。

### 2.19 film：轨道接入和同级组装

`Film` 必须**恰好**有 `id*:文本、canvas*:Canvas、timeline*:Timeline、appearance*:Recipe` 四个属性；至少一个 `Track(source*:引用<VisualTrack/AudioTrack>)`，Track 属性只能 source。作者文法意图为 Track 空，不必复现当前 surface 未额外检查其正文的遗漏。输出 `.composition`，不是视频文件。

Appearance Recipe 必须恰好只有 `background*:六/八位十六进制色`，无默认；Canvas 几何和 Timeline 不进入配方。组装引用源不可重复，运行值的 Track id 也不能重复，即使分别是视觉和音频。每条轨道必须属于所选 Timeline；轨道集合规范化排序，不以 XML 顺序决定层级。视觉 stacking 在各 Present 中显式给出；音频同级混合而不是按 Track 排序压掉。

所有需要显示/听见的输出必须明确接入：media-track 的 `.visual` 与可选 `.audio`、caption 的 `.track`、ranking 的 `.visual/.audio` 等没有隐式捆绑。Film 自身不生成、不配音、不改词对齐、不规范化媒体、不渲染编码。原 film companion 只是声明 Timeline 来源和 Track source 类型，没有额外独立可编辑外观面板；具体画面/音频由各轨道 companion 提供。案例见总表。

## 3. 关键概念与数据形状

为新实现建议使用以下自有字段，不沿用来源类型定义。这里只是数据设计说明，不是复制式接口。

| 对象 | 建议字段/约束 |
|---|---|
| 字幕内容投影 | `clockKey/storyKey/captionKey`、`blocks[]`；块有 `blockKey`、`speechRange`、`timedUnits[]`；每单元连接文档身份及精确讲话区间 |
| 呈现规则 | `occurrenceKey`、`activeRange`、`styleKey`、可选 `speakerFilter`；数组位置是覆盖优先级 |
| 字幕计划 | 每块保留 `speechRange` 与 `animationRange`，另有 `visibleSlices[]`；不能通过缩短 animationRange 实现 Use 隐藏 |
| 视觉轨道 | `laneKey/clockKey`、`shows[]`；每呈现有 `activeRange`、可选 `visibleSlices`、`depthOrder/stableOrderKey`、元素树与局部动画 |
| 音频轨道 | `laneKey/clockKey`、`pieces[]`；每段有资源、`destinationSamples`、`sourceSamples`、循环相位、保音高速率、gain/envelope、可听切片 |
| Media 单元 | 目的 Frame、frame decoration、按序图层、生命周期运动；图层区分 paint/image/timed/surface，拟合和采样各自独立 |
| 替换序列 | `memberList`、准确激活点、逻辑阶段、转场外扩后的可见阶段、Handoff 区间、显式终点 |
| 卡片堆 | 卡片集合、激活点、当前索引、前后相对深度、姿态步长、重排时长；任意 seek 可以独立求状态 |
| 排名计划 | `initialItems` 与 `revealRanges/activationPoints`；每项分别存解释阶段和 settled 阶段，音效使用同一事件列表 |
| 静态图操作 | `operationList` 保留作者顺序；合成请求含画布、RGBA底色及1..64矩形图层；输出一个新图片资源 |
| 捕获结果 | `filePath/mediaKind/pageUrl/pixelWidth/pixelHeight/container`；视频额外 `seconds/fps/audioPresent`，均来自实测 |

作者 Graph 里的 Record/Component/Output、运行后的上述产品、最终 Composition 是不同阶段；预览/Inspector 应读真实计划与产物，不从屏幕重新猜语义。

## 4. 对 dsivio-video 的建议

### 必须保留

1. 保留十八项中所有纯本地呈现与图像处理的可观察合同，尤其完整属性白名单、精确时间、引用类型校验和明确错误。不把“省略必需窗口”误认为全程，不把有序规则覆盖误实现为图层加法。
2. caption、sound、performance 共享“完整原始时钟+局部 visibility/audibility mask”思想；文字、采样和增益在覆盖解除后继续而不是重启。保留 Cue/讲话单位和 Use 分离。
3. Media 的画面/原声显式分离，Sequence、Deck、Ranking 的事件时钟与最终保持时钟分离；Film 显式选同级输出，避免隐式声音和错时钟。
4. 中文/双文本分组、精确字体/回退、无跟踪证据时不猜位置。保持测量事实只读、外观参数可编辑。
5. 素材生成与轨道展示分离。上游只能走 `dsivio media`；`gen:Image/gen:Video` 必须显式 `model="provider/model-id"`，plan 查询实时 capabilities 校验合法时长/参考输入/比例等，并展示/存储准确请求。短展示窗口不等于应请求模型非法短时长，需用本地采样。
6. 捕获防覆盖、真实媒体尺寸、关闭浏览器、失败保留已完成产物。若迁到 Playwright 等库，保持合同而不是移植实现。

### 可简化

- 不必照搬一包一个 *-studio 伴生包；保留 Studio，一个统一声明表描述可写属性、配方、时间证据和轨道实体。样式编辑可能影响共享引用的多个 Use，应让界面明显显示共享关系。
- 轨道程序/不可变中间产品可以整合模块边界，但保留调度与渲染分离、输出可检查和可重现 seek。公共 Recipe 属性读取与字体检查可统一实现。
- OpenCV 环境可由自有本地实现替换，前提是逐项像素行为、alpha、拟合和编码约束有明确合同；不必引入 Runtime Profile endpoint bindings。Node22/Python3.12 已有，但图像依赖是否打包仍需决策。
- 无完整工程的 Typography/Deck/Sticker 效果需要自有行为示例，不转移原预览图或代码。仅允许的未用配方键和源码解码遗漏可在新合同中清理，不应变成兼容负担。

### 砍掉

- 删除 HypiHub 及所有供应商网关、密钥/凭证存储和 Runtime Profile 端点绑定；轨道组件不得访问这些机制。
- 删除具体厂商 `volcengine-matting` 的自动执行路径；Dsivio 目前不支持抠像，也不能以生成视频伪装抠像。background-removal 外部自动执行同样不可假装已支持；只保留导入用户已准备透明素材的可达路线，待宿主提供真实能力再定义中立操作。
- 不添加 TTS、语音服务、自动人脸跟踪、自动 ducking、供应商协议或“出错就换模型”等越界功能。现有对白/音乐文件可用 Sound/AudioTrack，本地视频可用 Performance/MediaTrack。

付费生成失败处理沿宿主退出码：5表示不确定且绝不可重新提交，3未计费拒绝，6宿主未运行；轨道消费者不私自重试生成，不自己拥有队列/幂等键的语义。插件仅持宿主任务身份和准备后的素材。

## 5. 依赖与外部程序

- 图与时间：Narrative/Script、Timeline、Temporal、Temporal Markup、Spatial、Media、Composition、精确字体、Recipe 解码；它们是本地类型/证据，不能替代真正生成结果。
- Fine/Typography/Sticker/Ranking/Overlay/Deck/Media 的视觉最终需要支持对应元素树、文字流、路径文字、遮罩和动画的渲染器。Fine joined 框另用本地浏览器测量扩展；缺后端支持需明确拒绝，不能悄悄降成普通框。
- 音视频规范化及最终混音/编码可利用宿主捆绑 ffmpeg/ffprobe，保留准确帧率和48 kHz采样定位。browser-capture 录屏本身由 Chrome 原生编码，**不**用 ffmpeg 编码。
- browser-capture 原依赖 Puppeteer Core、上游浏览器安装器、Sharp；Chrome153+原生录屏、ffprobe。安装下载、网页访问和本地脚本权限需要透明提示，与 paid generation 无关。
- Image Compose/Transform 原以 Raster 能力交给本地 OpenCV/NumPy Python 服务执行；现有 Python3.12 并不自带这些库。图片输入解码、插值、alpha和编码都是实际功能依赖。
- background-removal 需要外部图片去背景实现，原包未固定服务/价格；volcengine-matting 是外部人像视频抠像端点，经原网关。两者当前不能映射成 Dsivio 已有能力。
- 本次为静态研究，按任务要求未运行构建、测试、安装或付费请求，也未把预览图当作已验证的视觉输出。

## 6. 待定问题

1. 新作者语言是否继续支持所有允许但无效果的 TopThree board-* 键？建议在自有规范里删掉无用键，而非按原允许集合建立误导控件。
2. 背景移除/视频抠像的最终中立接口只有宿主真实提供能力后才能决定；当前需要明确“不支持自动处理”，透明素材导入仍可工作。
3. 字体和本地图像引擎的打包、字体授权、浏览器版本与获取渠道尚需产品决策。不能直接分发来源实现/图像；应独立开发且核对依赖许可证。
4. Fine 动作枚举与配方的宽广范围、复杂文字遮罩的后端拒绝边界应保持显式。新引擎若扩大遮罩能力需写新合同，不用“通用 Mask”含混承诺。
5. 原源部分 manifest 说明与实际解码存在陈旧差异（例如某些说明遗漏 until+for、混用语义绑定被描述为禁止，但共用解码支持独立端点）；本规格优先实际解码和校验。操作/Film Track 子节点未全面检查的漏洞不作为兼容要求。
6. 需要在独立实现时对短揭示、短 Flash/Sticker 窗口、转场扩展采样、零 amount 噪声、跨语言排版制作自有可运行行为场景。本次未做动态视觉复现，因此数值和规则证据来自源码/声明，不声称像素级重建已验证。
7. Deck 的前后景色调步长存在源码属性名不一致：白名单接受 `previous/next-brightness-step/contrast-step/saturation-step`，读取却查无 `-step` 的名字；无后缀写法又被白名单拒绝。因此当前自定义步长实际被忽略，前后默认因子仍生效。上文表列作者接受的键及意图默认；新实现应明确采用真正可调的步长语义，不把此遗漏重建成产品特性。

## 7. 来源

所有下列路径相对于 `/Users/zmmini/zmdata/work/dsivioplugin/`。读取仅用于理解行为，正文由独立措辞重新组织；没有转移源码、原类型声明或原文说明句。

- `packages/caption/README.md`；`packages/caption/src/surface.ts`、`manifest.ts`。
- `packages/caption-fine/README.md`；`packages/caption-fine/src/surface.ts`、`recipe.ts`、`style.ts`、`schedule.ts`、`manifest.ts`。
- `packages/typography-track/README.md`；`packages/typography-track/src/surface.ts`、`program.ts`、`manifest.ts`。
- `packages/media-track/README.md`；`packages/media-track/src/surface.ts`、`author.ts`、`motion.ts`、`sequence.ts`、`sounds.ts`、`program.ts`、`manifest.ts`。
- `packages/audio-track/src/surface.ts`、`program.ts`、`manifest.ts`。
- `packages/sound/src/surface.ts`、`program.ts`、`manifest.ts`。
- `packages/performance/src/surface.ts`、`program.ts`、`media.ts`、`manifest.ts`。
- `packages/deck-track/src/surface.ts`、`author.ts`、`program.ts`、`lower.ts`、`manifest.ts`。
- `packages/ranking/README.md`；`packages/ranking/src/surface.ts`、`style.ts`、`schedule.ts`、`render.ts`、`manifest.ts`。
- `packages/comment-sticker/src/surface.ts`、`author.ts`、`program.ts`、`manifest.ts`。
- `packages/screen-overlay/src/surface.ts`、`program.ts`、`manifest.ts`。
- `packages/interview-emoji-reveal/src/surface.ts`、`style.ts`、`program.ts`。
- `packages/image-compose/src/surface.ts`、`program.ts`、`manifest.ts`。
- `packages/image-transform/src/surface.ts`、`program.ts`、`manifest.ts`。
- `packages/background-removal/README.md`；`packages/background-removal/src/surface.ts`、`component.ts`、`program.ts`、`manifest.ts`。
- `packages/volcengine-matting/src/surface.ts`、`index.ts`。
- `packages/browser-capture/README.md`；`packages/browser-capture/src/index.ts`、`browser.ts`；`packages/video-cli/src/capture.ts`。
- `packages/film/src/surface.ts`、`program.ts`、`recipe.ts`、`manifest.ts`。
- `packages/raster/src/index.ts`、`program.ts`；`packages/spatial/src/author.ts`；`packages/temporal-markup/src/index.ts`；`packages/composition/src/schema.ts`、`track.ts`（Sequence 枚举搜索）；`packages/provider-image-opencv-local/README.md`。
- 属性编辑证据：`packages/{caption-fine,typography-track,media-track,audio-track,sound,performance,deck-track,ranking,comment-sticker,screen-overlay,film}-studio/src/index.ts`（仅检查 bindings/Inspector 声明）。
- 实际元素/导入检索：`examples/complex-explainer/productions/explainer/authors/main.svml`；`examples/interview/{reference,swap-host,swap-lang,swap-ride}.svml`；`examples/podcast/{reference,swap-app,swap-host,swap-item}.svml`；`examples/ranking-football/{reference,reference-gpt,swap-effect,swap-host,swap-topic}.svml` 及 reference-banana、reference-banana-from-swap、swap-effect-banana、swap-effect-banana-reference-sync 子目录作者文件；`examples/minimal-author-package/packages/example-component/preview/preview.svml`；`examples/semantic-composition/chat.svml` 和其中项目 performance-styles/sound-styles/responsive-explainer README。
- 预览文件存在性检索：`packages/{caption-fine,typography-track,deck-track,ranking,comment-sticker,screen-overlay,interview-emoji-reveal}/preview/`；`packages/media-track/preview/{preview.svml,recipes.svs,build.svrun}`。未执行这些工程。
