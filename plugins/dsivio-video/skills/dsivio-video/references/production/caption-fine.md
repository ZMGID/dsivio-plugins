# 词级精细字幕

对白字幕、角色样式、逐词高亮用本组件；标语或没有语音时钟的文字用 typography。

导入 `dsivio-video/caption-fine@1`，查询 `vocabulary dsivio-video/caption-fine@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Style

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Style identity |
| `recipe` | 是 | dsivio-video/recipe@1#Recipe；Inline caption Recipe |
| `font` | 是 | Face / Stack；Exact primary font or stack |

子元素：`Fallback`。

输出：`裸 id` — `dsivio-video/caption@1#Style`。
### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Track identity |
| `document` | 是 | dsivio-video/script@1#CaptionDocument；Script caption document |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Measured Timeline |
| `regions` | 否 | dsivio-video/caption-fine@1#RegionTimeline；Measured role-region evidence |

子元素：`Use`。

输出：`content` — `dsivio-video/caption@1#Content`, `program` — `dsivio-video/caption-fine@1#Program`, `schedule` — `dsivio-video/caption-fine@1#Schedule`, `track` — `dsivio-video/visual@1#VisualTrack`。
### Use

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Use identity, otherwise derived from declaration order. |
| `style` | 是 | dsivio-video/caption@1#Style；Shared track Style reference. |
| `role` | 否 | text；Only matching Cue role |
### Fallback

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `font` | 是 | dsivio-video/fonts@1#Face；Exact fallback face |

## Recipe / 默认值

必填 Recipe：stack-order、x、y、width、align、size、line-height、background、padding、radius、fill。x/y/width 是 0–1 画布比例；padding 是一或二个非负像素数的字符串。height 可选；anchor-x=left、anchor-y=top、block-align=center、inline-size=hug、wrap=word。karaoke=off/current/trail，karaoke-transition=step/wipe；atom-reveal=all/on-start/typewriter；active-fill 默认 #FFD54A，active-box=off/current/trail，active-box-continuity=isolated/joined。cue-enter/cue-exit、atom-enter/atom-exit、active-box-enter/exit、active-response 支持 none、fade、pop、scale、spring、bounce、elastic、stamp、tilt、zoom-blur、flip-x/y、spin、squash、stretch、slide-left/right/up/down、blur-in、wipe-left/right/up/down。对应 *-frames、lead-frames/tail-frames 默认 0；active-response-frames=6。loop=none/shake/wobble/glow-pulse/breathe/float/pulse/flicker，loop-target=cue/active-atom，loop-period-frames=12，loop-intensity=1。描边/阴影/发光/渐变用 stroke-、shadow-、glow-、gradient- 与 active- 同名键；渐变两个端点必须一起给。

## 时间与源时钟

document 必须是 Script 的 CaptionDocument，timeline 必须带匹配 Segment 的 measured word anchors。Use 缺省窗口为节目；最后匹配 role+W 的 Use 胜出，Hidden 同样参与。Cue 完整流排版；切 Use 不重置字时钟，Cue 之间不留残影。regions 可选且不是自动人脸检测：RegionTimeline={axisKey,totalFrames,tracks:[{role,frames:[{x,y,width,height}|null]}]}，比例矩形每帧测量，null 隐藏该帧。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<fine:Style id="subtitle" recipe={look.caption.base} font={font}/>
<fine:Track id="captions" document={story.caption} timeline={timeline}>
  <fine:Use style={subtitle} during="program"/>
</fine:Track>
```

## 常见错误

没有语音锚时不能把绝对文字冒充字幕；max-lines 必须同时给 max-words-per-line；Cue role 不匹配不会选中 Use；布局不能替代正式台词。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
