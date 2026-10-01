# 深度卡片堆

展示有历史和下一项预期的产品/论点卡片，比互不相关的入场更容易保持对象连续。

导入 `dsivio-video/deck-track@1`，查询 `vocabulary dsivio-video/deck-track@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Label

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `font` | 是 | dsivio-video/fonts@1#Stack；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `content` | 否 | dsivio-video/text@1#Text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `size` | 否 | text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `color` | 否 | text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `align` | 否 | text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `block` | 否 | text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |
| `padding` | 否 | text；size=34,color=#FFFFFF,align=center,block=end,padding=20. |

输出：`裸 id` — `dsivio-video/deck-track@1#Label`。
### DepthStack

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | literal or semantic reference；until-boundary defaults end for ranges only. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；until-boundary defaults end for ranges only. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；until-boundary defaults end for ranges only. |
| `frame` | 是 | dsivio-video/space@1#Frame；until-boundary defaults end for ranges only. |
| `appearance` | 是 | dsivio-video/recipe@1#Recipe；until-boundary defaults end for ranges only. |
| `until-boundary` | 否 | literal or semantic reference；until-boundary defaults end for ranges only. |

子元素：`Card`。

输出：`program` — `dsivio-video/deck-track@1#Program`, `track` — `dsivio-video/visual@1#VisualTrack`。
### Card

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | typed reference or literal；Complete I activation attributes, no default activation. |
| `source` | 是 | typed reference or literal；Complete I activation attributes, no default activation. |
| `extent` | 否 | typed reference or literal；Complete I activation attributes, no default activation. |
| `appearance` | 否 | dsivio-video/recipe@1#Recipe；Complete I activation attributes, no default activation. |
| `label` | 否 | dsivio-video/deck-track@1#Label；Complete I activation attributes, no default activation. |
| `boundary` | 否 | typed reference or literal；Complete I activation attributes, no default activation. |
| `instant` | 否 | typed reference or literal；Complete I activation attributes, no default activation. |

## Recipe / 默认值

appearance 继承 media fit/playback/frame/motion 键，stack-order 默认 30。visible-previous=2、visible-next=1、wrap=false、reflow-frames=8、reflow-easing=ease-in-out。playback-future=hold-head/continue，playback-past=hold-tail/continue/hide。current-{x,y,rotation,scale,opacity,stacking,brightness,contrast,saturation}；previous-/next- 同名键必须以 -step 结尾。previous-y-step=28、scale-step=.94、opacity-step=.82、brightness-step=.92、saturation-step=.86；next-y-step=-20、scale-step=.92、opacity-step=.72、brightness-step=.88、saturation-step=.78。rotation-mode 默认 alternate，可选 linear。Label 是属性而非 Recipe，size=34、color=#FFFFFF、align=center、block=end、padding=20。

## 时间与源时钟

Card 必须明确 Instant，严格递增且都在 until 之前；until 的范围引用默认 end。重排不重播源；continue 要求活跃播放 loop-start。reflow 必须容纳在激活阶段内；静图禁止 playback/trim。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<deck:DepthStack id="cards" timeline={timeline} canvas={canvas} frame={picture} appearance={look.deck.base} until="90f">
  <deck:Card id="one" source={photo} extent={photo-size} at="0f"/>
</deck:DepthStack>
```

## 常见错误

禁止 previous-brightness 等无 -step 的旧键；wrap 可见数不得让同一 Card 占两个深度。Label 正文与 content 互斥，font 必须 Stack；Card 源 extent 只用于 Image。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
