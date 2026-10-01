# 独立媒体与替换序列

用于 B-roll、贴图、Surface、蒙太奇和明确的转场，不必把素材伪装成对白 Take。

导入 `dsivio-video/media-track@1`，查询 `vocabulary dsivio-video/media-track@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Item

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `frame` | 是 | dsivio-video/space@1#Frame；frame |
| `appearance` | 是 | dsivio-video/recipe@1#Recipe；appearance |
| `motion` | 否 | dsivio-video/recipe@1#Recipe；motion |
| `clip` | 否 | dsivio-video/space@1#Path；clip |
| `image` | 否 | dsivio-video/media@1#Image；image |
| `media` | 否 | dsivio-video/pipeline@1#SynchronizedMedia；media |
| `surface` | 否 | dsivio-video/visual@1#Surface；surface |
| `extent` | 否 | dsivio-video/space@1#Extent；extent |
| `source-audio` | 否 | text；source-audio |
| `audio-gain` | 否 | text；audio-gain |
| `at` | 否 | text；at |
| `until` | 否 | text；until |
### Sequence

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `frame` | 是 | dsivio-video/space@1#Frame；frame |
| `appearance` | 是 | dsivio-video/recipe@1#Recipe；appearance |
| `motion` | 否 | dsivio-video/recipe@1#Recipe；motion |
| `clip` | 否 | dsivio-video/space@1#Path；clip |
| `until` | 是 | text；until |
| `until-boundary` | 否 | text；until-boundary |
### Member

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `image` | 否 | dsivio-video/media@1#Image；image |
| `media` | 否 | dsivio-video/pipeline@1#SynchronizedMedia；media |
| `surface` | 否 | dsivio-video/visual@1#Surface；surface |
| `extent` | 否 | dsivio-video/space@1#Extent；extent |
| `appearance` | 否 | dsivio-video/recipe@1#Recipe；appearance |
| `source-audio` | 否 | text；source-audio |
| `audio-gain` | 否 | text；audio-gain |
| `at` | 否 | text；at |
| `instant` | 否 | text；instant |
| `boundary` | 否 | text；boundary |
### Layer

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `image` | 否 | dsivio-video/media@1#Image；image |
| `media` | 否 | dsivio-video/pipeline@1#SynchronizedMedia；media |
| `surface` | 否 | dsivio-video/visual@1#Surface；surface |
| `extent` | 否 | dsivio-video/space@1#Extent；extent |
| `appearance` | 否 | dsivio-video/recipe@1#Recipe；appearance |
### Paint

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `appearance` | 是 | dsivio-video/recipe@1#Recipe；appearance |
### Sampling

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `at` | 是 | text；at |
| `zoom` | 否 | text；zoom |
| `x` | 否 | text；x |
| `y` | 否 | text；y |
| `rotate` | 否 | text；rotate |
| `easing` | 否 | text；easing |
### Handoff

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `from` | 是 | text；from |
| `transition` | 是 | dsivio-video/recipe@1#Recipe；transition |
### Sound

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `source` | 是 | dsivio-video/pipeline@1#SynchronizedMedia；source |
| `at` | 否 | text；at |
| `handoff` | 否 | text；handoff |
| `gain` | 否 | text；gain |
### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Identity. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Program clock. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；Placement canvas. |

子元素：`Item`, `Sequence`。

输出：`program` — `dsivio-video/media-track@1#Program`, `visual` — `dsivio-video/visual@1#VisualTrack`, `audio` — `dsivio-video/visual@1#AudioTrack`。

## Recipe / 默认值

appearance 采用 performance 的全部键（必填 stack-order）加 playback=once-start/once-end/hold-start/hold-end/loop-start/loop-end/stretch；缺省 once-start。trim-start/trim-end 是成对源整数帧。Layer 只收 fit/anchors/offset/constraint/opacity/blur/brightness/contrast/saturation/playback/trim；不收外框键。motion 是独立 Recipe：enter/exit=none/fade/slide/scale/pop/bounce/blur-reveal/wipe/flip/spin；*-frames、*-easing、*-direction、*-amount、*-origin，sustain="float 8 2" 等。slide/wipe/flip 需 direction；outside-canvas 仅 slide 且不能带 amount。Handoff.transition：operator=cut/crossfade/push/wipe/cover/page-turn、duration-frames、boundary-ratio（默认 .5）、direction、audio。

Handoff 的 audio 默认 cut，可选 cut/crossfade；from 指前一相邻 Member 的 id。source-audio 不是布尔开关：直接 media 源写 `source-audio="content"`，Layer 形式写实际 normalized-media 层的 id；audio-gain 默认 1（0–64），不声明 source-audio 时禁止 audio-gain。Sound.source 是有声 SynchronizedMedia，`at="enter"` / `at="exit"` 或 `handoff="交接id"` 恰选一个；Item 不支持 handoff 触发。

## 时间与源时钟

Item 必须显式 W；Sequence 从第一个 Member 的 Instant 到 until，各 Member 激活递增。动态素材相位由激活点决定，切遮挡不重播。进出场总长不得超过寿命。Sampling 从 start 到 end（或 0%–100%）严格递增。source-audio 显式声明才输出原声；Sound 用 at 或 handoff 恰一触发。Film 必须分别接 .visual 与 .audio。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<media-track:Track id="cutaways" timeline={timeline} canvas={canvas}>
  <media-track:Item id="product" image={photo} extent={photo-size} frame={picture}
    appearance={look.media.base} at="0f" for="60f"/>
</media-track:Track>
```

## 常见错误

每个源恰选 image/media/surface；image 必须 extent，其他源禁止 extent。静图禁止 playback/trim；无音频媒体禁止声明源音频。Path clip 与 appearance clip 冲突；不能以末帧冻结掩盖 once-start 素材太短。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
