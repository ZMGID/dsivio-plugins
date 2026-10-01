# 独立音频放置

音乐床、效果、已有旁白在节目中独立摆放；只投影 Timeline 原声则用 sound。

导入 `dsivio-video/audio-track@1`，查询 `vocabulary dsivio-video/audio-track@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Identity. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Target program. |

子元素：`Item`。

输出：`program` — `dsivio-video/audio-track@1#Program`, `audio` — `dsivio-video/visual@1#AudioTrack`。
### Item

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；id |
| `source` | 是 | dsivio-video/pipeline@1#SynchronizedMedia；source |
| `at` | 否 | text；at |
| `until` | 否 | text；until |
| `trim-start` | 否 | text；trim-start |
| `trim-end` | 否 | text；trim-end |
| `playback` | 否 | text；playback |
| `min-rate` | 否 | text；min-rate |
| `max-rate` | 否 | text；max-rate |
| `gain` | 否 | text；gain |
| `fade-in` | 否 | text；fade-in |
| `fade-out` | 否 | text；fade-out |

## Recipe / 默认值

没有 Recipe。Item playback 默认 once，可选 once/once-start/once-end/loop/loop-start/loop-end/stretch；gain=1（0–64），fade-in/out="0f"；trim-start="0f"、trim-end=源末尾。stretch 必填 min-rate 和 max-rate。

## 时间与源时钟

每 Item 显式 W；source 是有声 SynchronizedMedia，需先 Normalize。once/loop 可按任一边对齐，stretch 保持音高，播放原生相位。fade 在实际可听区间内，不在空白尾部；音轨相加。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<audio-track:Track id="music" timeline={timeline}>
  <audio-track:Item source={bed.media} during="program" playback="loop" gain="0.12" fade-in="6f" fade-out="6f"/>
</audio-track:Track>
```

## 常见错误

不能直接 source={raw-audio}；min/max-rate 缺一不可，实际 stretch 率须在范围内。fade 总长不能超可听寿命，不自动 ducking。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
