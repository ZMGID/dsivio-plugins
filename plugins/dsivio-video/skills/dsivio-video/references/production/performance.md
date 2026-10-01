# 已有 Timeline 画面呈现

为 A-roll 调整视框、覆盖与外观，而不改声音或源播放。

导入 `dsivio-video/performance@1`，查询 `vocabulary dsivio-video/performance@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Style

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Shared Style identity. |
| `frame` | 是 | dsivio-video/space@1#Frame；Canvas-space target frame. |
| `appearance` | 是 | dsivio-video/recipe@1#Recipe；Static complete Appearance Recipe. Padding is 1/2/4 numbers; shadows are x y blur spread color separated by semicolons. Paint: #RRGGBB[AA], linear(angle; offset color, ...) or radial(x y; offset color, ...). |

输出：`裸 id` — `dsivio-video/performance@1#Style`。
### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Track identity. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Program axis. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；Canvas geometry. |

子元素：`Use`。

输出：`program` — `dsivio-video/performance@1#Program`, `visual` — `dsivio-video/visual@1#VisualTrack`。
### Use

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Use identity, otherwise derived from declaration order. |
| `style` | 是 | dsivio-video/performance@1#Style；Shared track Style reference. |

## Recipe / 默认值

Appearance 必填 stack-order；fit 默认 contain，可选 cover/fit-width/fit-height/native/scale-down/stretch。frame-x/y、content-x/y 默认 .5；fit-offset-x/y=0，fit-constraint=bounded/free。opacity=1、blur=0、brightness/contrast/saturation=1；clip=frame/none/rounded、radius=0、padding="0"（一/二/四个数）。border-width/style/color、shadows、frame-paint 可选；shadows 为 "x y blur spread color; ..."；frame-paint 支持六/八位颜色及 linear/radial。禁止 playback、trim 和 motion。

## 时间与源时钟

Use 缺省全节目；零 Use 无画面。后 Use 覆盖前 Use，不重置 Take 的源时钟；无画面 Take 跳过。Frame 必须归同 Canvas，所有贡献在同 Timeline。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<performance:Style id="view" frame={picture} appearance={look.performance.base}/>
<performance:Track id="camera" timeline={timeline} canvas={canvas}>
  <performance:Use style={view} during="program"/>
</performance:Track>
```

## 常见错误

不能用 appearance 拉长表演；Fit 只管几何。声音须另接 sound.audio；重叠 Use、重叠 Take、跨轨层级不是同一个优先级。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
