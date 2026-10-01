# 字幕隐藏与显示身份

当某段应保留词时钟却不显示字幕时用 Hidden；真正排版与高亮由 caption-fine 完成。

导入 `dsivio-video/caption@1`，查询 `vocabulary dsivio-video/caption@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Hidden

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Style identity |

输出：`裸 id` — `dsivio-video/caption@1#Style`。

## Recipe / 默认值

没有 Recipe。Hidden 只收 id；其类型是共享 caption Style，不产出轨道。

## 时间与源时钟

Hidden 参与后声明匹配 Use 优先级。恢复显示沿用 Cue/词的原有时钟，不重新播放。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<caption:Hidden id="quiet"/>
<!-- 在 caption-fine:Track 内 -->
<fine:Use style={quiet} at="30f" for="15f"/>
```

## 常见错误

不要编造 caption:Track 或 caption:Style；把 Hidden 当文字内容、拿 quiet.track 接 Film 都是错误。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
