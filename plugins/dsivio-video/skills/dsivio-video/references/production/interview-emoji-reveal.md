# 采访答案依次揭示

答案猜测、谜题揭晓需要持久占位与依次揭示时用；不用此组件伪装人物动作。

导入 `dsivio-video/interview-emoji-reveal@1`，查询 `vocabulary dsivio-video/interview-emoji-reveal@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Style

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Style identity. |
| `recipe` | 是 | dsivio-video/recipe@1#Recipe；完整默认值见本节后。 |

输出：`裸 id` — `dsivio-video/interview-emoji-reveal@1#Style`。
### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Track identity. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Program axis. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；Canvas geometry. |
| `style` | 是 | dsivio-video/interview-emoji-reveal@1#Style；Strip Style. |
| `placeholder` | 是 | dsivio-video/media@1#Image；Nonempty placeholder image. |
| `at` | 否 | text；Complete W temporal attribute. |
| `until` | 否 | text；Complete W temporal attribute. |

子元素：`Item`。

输出：`program` — `dsivio-video/interview-emoji-reveal@1#Program`, `track` — `dsivio-video/visual@1#VisualTrack`。
### Item

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Unique Item identity. |
| `icon` | 是 | dsivio-video/media@1#Image；Nonempty answer image. |
| `preset` | 否 | boolean；Default false; presets precede every reveal. |
| `at` | 否 | text；Absolute time or Moment reference, strictly increasing inside outer. |

## Recipe / 默认值

center-x=.5、top-y=.07、slot-size=72、slot-gap=10、padding-x/y=18/14、background=#FFFDF7、border-color=#161616、border-width=4、radius=22、shadow-color=#000000B8、shadow-x/y=9/10、shadow-blur/spread=0、icon-size=48、reveal-frames=6、stack-order=66。icon-size≤slot-size。

## 时间与源时钟

Track 显式外层 W；preset 项必须在所有定时项前且不能写 at。非 preset 必须 at=绝对时间/Moment，严格递增并在窗口内。一帧揭示保留激活缩放，之后重合阶段合并。条与阴影必须在 Canvas 内；无自动音效。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<reveal:Style id="answers-style" recipe={look.reveal.base}/>
<reveal:Track id="answers" timeline={timeline} canvas={canvas} style={answers-style} placeholder={question} during="program">
  <reveal:Item id="answer" icon={answer-icon} at="30f"/>
</reveal:Track>
```

## 常见错误

必须实际提供 placeholder/icon Image；preset 与 at 互斥。过多 slot 溢出画布会报错，不偷偷缩小或裁掉。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
