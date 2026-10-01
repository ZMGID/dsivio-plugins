# 累计榜单

比较结果应持续留在画面时用 TierBoard/Column/TopThree；只是标题序号就用 typography。

导入 `dsivio-video/ranking@1`，查询 `vocabulary dsivio-video/ranking@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### TierBoardStyle

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；id |
| `recipe` | 是 | dsivio-video/recipe@1#Recipe；recipe |
| `font` | 是 | Face / Stack；font |

输出：`裸 id` — `dsivio-video/ranking@1#TierBoardStyle`, `sound` — `dsivio-video/ranking@1#SoundStyle`。
### TierBoard

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text or typed reference；id |
| `timeline` | 是 | text or typed reference；timeline |
| `frame` | 是 | text or typed reference；frame |
| `style` | 是 | text or typed reference；style |
| `canvas` | 是 | text or typed reference；canvas |
| `appear-sound` | 否 | text or typed reference；appear-sound |
| `move-sound` | 否 | text or typed reference；move-sound |

子元素：`TierItem`。

输出：`schedule` — `dsivio-video/ranking@1#Schedule`, `program` — `dsivio-video/ranking@1#Program`, `visual` — `dsivio-video/visual@1#VisualTrack`, `events` — `dsivio-video/ranking@1#Events`, `audio` — `dsivio-video/visual@1#AudioTrack`。
### ColumnStyle

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；id |
| `recipe` | 是 | dsivio-video/recipe@1#Recipe；recipe |
| `font` | 是 | Face / Stack；font |

输出：`裸 id` — `dsivio-video/ranking@1#ColumnStyle`, `sound` — `dsivio-video/ranking@1#SoundStyle`。
### Column

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text or typed reference；id |
| `timeline` | 是 | text or typed reference；timeline |
| `frame` | 是 | text or typed reference；frame |
| `style` | 是 | text or typed reference；style |
| `canvas` | 是 | text or typed reference；canvas |
| `appear-sound` | 否 | text or typed reference；appear-sound |
| `move-sound` | 否 | text or typed reference；move-sound |

子元素：`ColumnItem`。

输出：`schedule` — `dsivio-video/ranking@1#Schedule`, `program` — `dsivio-video/ranking@1#Program`, `visual` — `dsivio-video/visual@1#VisualTrack`, `events` — `dsivio-video/ranking@1#Events`, `audio` — `dsivio-video/visual@1#AudioTrack`。
### TopThreeStyle

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；id |
| `recipe` | 是 | dsivio-video/recipe@1#Recipe；recipe |
| `font` | 是 | Face / Stack；font |

输出：`裸 id` — `dsivio-video/ranking@1#TopThreeStyle`, `sound` — `dsivio-video/ranking@1#SoundStyle`。
### TopThree

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text or typed reference；id |
| `timeline` | 是 | text or typed reference；timeline |
| `frame` | 是 | text or typed reference；frame |
| `style` | 是 | text or typed reference；style |
| `terminal` | 是 | absolute time / Moment；terminal |
| `appear-sound` | 否 | text or typed reference；appear-sound |

子元素：`TopThreeItem`。

输出：`schedule` — `dsivio-video/ranking@1#Schedule`, `program` — `dsivio-video/ranking@1#Program`, `visual` — `dsivio-video/visual@1#VisualTrack`, `events` — `dsivio-video/ranking@1#Events`, `audio` — `dsivio-video/visual@1#AudioTrack`。

## Recipe / 默认值

Style 的 recipe/font 必填，三种 Style 不能互换。Column/TopThree：font-size=28、font-weight=700、text-color=#ffffff、line-height=1.15、appear-frames=6、move-frames=8、motion-easing=ease-in-out；board-background、board-border-color/width、board-radius、board-shadow-{x,y,blur,spread,color}、board-stack/item-stack 可调。Column：rank-colors、padding=18、row-height=74、row-gap=10、icon-size=58、icon-radius=10、icon-fit=cover、stage-x=.66/stage-y=.73/stage-size=356、stage-stack。TopThree：slot-colors、center-x=.5、baseline-y=.55、slot-gap=24、icon-size=104、icon-radius=52、icon-fit=cover、ring-width=5、label-gap=12。TierBoard：rows=[{id,label,color}]（默认 s/a/b/c/d）、label-text-color、label-size=.3、label-width 可选、line-height=1、board-background/border-color/border-width、stage-x=.2/stage-y=.3/stage-size=168、icon-radius-ratio=.12、icon-fit=cover、appear-frames=8、move-frames=14、board-stack=20、stage-stack=40、item-stack=30、motion-easing。共用 appear-gain=1、move-gain=1、sound-fade-frames=0。

## 时间与源时钟

外层 during 必填 program/Segment/Selection；TierItem 非 preset 必须 during、entry=direct/drop、tier 与 icon；ColumnItem 必须 label/rank，非 preset 必须 during。preset=true 禁止 during/entry。TopThreeItem 按 Instant 激活；terminal 只接受绝对时间或 Moment。声音只在绑定时发布 .audio/events；Film 显式装声音。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<ranking:ColumnStyle id="board-style" recipe={look.ranking.column} font={font}/>
<ranking:Column id="board" timeline={timeline} canvas={canvas} frame={picture} during="program" style={board-style}>
  <ranking:ColumnItem id="first" label="可靠性" rank="1" preset="true"/>
</ranking:Column>
```

## 常见错误

别猜 ranking:Track；TierItem/ColumnItem/TopThreeItem 是容器子元素。TopThree 没有 canvas 属性且 terminal 不接受 Segment/Selection。重复 rank/tier 错误归属或窗口太短会破坏重排，需看 schedule。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
