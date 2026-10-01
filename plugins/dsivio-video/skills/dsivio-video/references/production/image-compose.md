# 本地透明图层合成

在交付前将现有图片叠成可复用资产；需要影片内可编辑运动则用 media-track。

导入 `dsivio-video/image-compose@1`，查询 `vocabulary dsivio-video/image-compose@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Image

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Output identity. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；Pixel canvas. |
| `background` | 否 | #RRGGBBAA；Straight alpha backdrop. |

子元素：`Layer`。

输出：`image` — `dsivio-video/media@1#Image`。
### Layer

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `source` | 是 | dsivio-video/media@1#Image；Image bytes. |
| `frame` | 是 | dsivio-video/space@1#Frame；Frame on the same canvas. |
| `fit` | 否 | contain / cover / stretch；Image fit. |
| `interpolation` | 否 | nearest / linear / cubic / area / lanczos；Resampling. |
| `opacity` | 否 | 0..1；Multiply source alpha. |

## Recipe / 默认值

没有 Recipe。Image background 默认 #00000000；Layer fit=contain、interpolation=lanczos、opacity=1。可选 cover/stretch 和 nearest/linear/cubic/area/lanczos；opacity 0–1。

## 时间与源时钟

静态像素操作，没有 Timeline/W。1–64 层按声明顺序 alpha-over，后层覆盖前层；Frame 同 Canvas，越界像素裁切。输出 .image 为 Canvas 尺寸 PNG，straight alpha。本地执行需要 setup raster。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<compose:Image id="poster" canvas={canvas} background="#00000000">
  <compose:Layer source={photo} frame={picture} fit="contain"/>
</compose:Image>
```

## 常见错误

只接受 Image，不接受视频、字幕或 CSS 层。不得把六位颜色当八位 background 合同；合成不自动抠背景。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
