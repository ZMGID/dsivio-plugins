# 已有 Timeline 声音呈现

保留现有对白相位、按内容窗口改增益；独立音乐与音效另用 audio-track。

导入 `dsivio-video/sound@1`，查询 `vocabulary dsivio-video/sound@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Style

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Shared Style name. |
| `gain` | 否 | number 0..64；Gain at window start. |
| `end-gain` | 否 | number 0..64；Gain at window end. |

输出：`裸 id` — `dsivio-video/sound@1#Style`。
### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Track identity. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Program axis. |

子元素：`Use`。

输出：`program` — `dsivio-video/sound@1#Program`, `audio` — `dsivio-video/visual@1#AudioTrack`。
### Use

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Use identity, otherwise derived from declaration order. |
| `style` | 是 | dsivio-video/sound@1#Style；Shared track Style reference. |

## Recipe / 默认值

没有 Recipe。Style gain 默认 1、end-gain 默认 gain；范围 0–64。

## 时间与源时钟

Use 缺省全节目，零 Use 静音。后声明有声 Take 先胜出，再由后 Use 决定增益；gain=0 仍遮罩之前 Use。线性增益按整个 Use 窗口计算。每个放置只有一个 48 kHz 样本起点，拆 Use 不重播；不同轨道相加，无自动 ducking 或响度标准化。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<sound:Style id="voice-style" gain="1"/>
<sound:Track id="voice" timeline={timeline}>
  <sound:Use style={voice-style} during="program"/>
</sound:Track>
```

## 常见错误

不要把浏览器 video 静音视作交付静音；不要期待视觉遮挡自动压低声音；重复接独立音轨会导致加倍。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
