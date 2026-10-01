# 本地图像变换

裁切、尺寸、降噪、调色、锐化、透明通道与编码组成可复用 Program；不发生成请求。

导入 `dsivio-video/image-transform@1`，查询 `vocabulary dsivio-video/image-transform@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Program

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Program name. |

子元素：`Crop`, `Resize`, `Rotate`, `Flip`, `Denoise`, `Color`, `Sharpen`, `Blur`, `Alpha`, `Encode`。

输出：`裸 id` — `dsivio-video/image-transform@1#Program`。
### Transform

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Output identity. |
| `source` | 是 | dsivio-video/media@1#Image；Existing image. |
| `program` | 是 | dsivio-video/image-transform@1#Program；Ordered operations. |

输出：`image` — `dsivio-video/media@1#Image`。
### Crop

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `unit` | 否 | fraction / pixel；Raster unit. |
| `x` | 是 | fraction 0..1 or nonnegative pixel integer；Raster x. |
| `y` | 是 | fraction 0..1 or nonnegative pixel integer；Raster y. |
| `width` | 是 | fraction >0..1 or pixel integer 1..65535；Raster width. |
| `height` | 是 | fraction >0..1 or pixel integer 1..65535；Raster height. |
### Resize

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `width` | 是 | integer 1..16384；Raster width. |
| `height` | 是 | integer 1..16384；Raster height. |
| `fit` | 否 | contain / cover / stretch；Raster fit. |
| `interpolation` | 否 | nearest / linear / cubic / area / lanczos；Raster interpolation. |
| `background` | 否 | #RRGGBB or #RRGGBBAA；Raster background. |
### Rotate

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `degrees` | 是 | 90 / 180 / 270；Raster degrees. |
### Flip

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `axis` | 否 | horizontal / vertical / both；Raster axis. |
### Denoise

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `method` | 否 | nlm-ycrcb；Raster method. |
| `luma` | 否 | 0..50；Raster luma. |
| `chroma` | 否 | 0..50；Raster chroma. |
| `template-window` | 否 | odd integer 1..31；Raster template-window. |
| `search-window` | 否 | odd integer 1..63, greater than template；Raster search-window. |
| `saturation-recovery` | 否 | 0..4；Raster saturation-recovery. |
### Color

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `exposure-stops` | 否 | -8..8；Raster exposure-stops. |
| `contrast` | 否 | 0..4；Raster contrast. |
| `saturation` | 否 | 0..4；Raster saturation. |
| `temperature` | 否 | -1..1；Raster temperature. |
| `tint` | 否 | -1..1；Raster tint. |
| `gamma` | 否 | 0.1..10；Raster gamma. |
### Sharpen

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `amount` | 否 | 0..5；Raster amount. |
| `radius` | 否 | 0.1..20；Raster radius. |
| `threshold` | 否 | 0..255；Raster threshold. |
### Blur

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `sigma` | 是 | 0.1..100；Raster sigma. |
### Alpha

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `mode` | 否 | preserve / flatten；Raster mode. |
| `background` | 否 | #RRGGBB or #RRGGBBAA; required for flatten, forbidden for preserve；Raster background. |
### Encode

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `format` | 否 | png / jpeg / webp；Raster format. |
| `quality` | 否 | integer 1..100; forbidden for PNG; JPEG/WebP executor default 95；Raster quality. |
| `background` | 否 | #RRGGBB or #RRGGBBAA; JPEG only, required when input has alpha；Raster background. |

## Recipe / 默认值

没有 Recipe；属性直接写在操作元素。Crop unit=fraction；Resize fit=contain、interpolation=lanczos；Flip axis=horizontal；Denoise method=nlm-ycrcb/luma=2/chroma=10/template-window=7/search-window=21/saturation-recovery=1.02；Color exposure-stops=0/contrast=1/saturation=1/temperature=0/tint=0/gamma=1；Sharpen amount=.5/radius=1/threshold=0；Alpha mode=preserve；Encode format=png，JPEG/WebP quality 缺省 95。完整范围见属性表。

## 时间与源时钟

静态操作没有时间窗口。Program 按声明顺序执行；Transform source 是 Image，输出 .image 默认 PNG，最后 Encode 可选 JPEG/WebP。Crop 基于当前操作尺寸，不是原图永久坐标。需要 setup raster。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<transform:Program id="thumbnail">
  <transform:Resize width="640" height="360" fit="cover"/>
  <transform:Sharpen amount="0.5"/>
</transform:Program>
<transform:Transform id="thumb" source={photo} program={thumbnail}/>
```

## 常见错误

Rotate 只接受 90/180/270。Encode 必须最后，PNG 禁止 quality；Alpha flatten 必填 background/preserve 禁止 background；有 alpha 编 JPEG 必须声明 background。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
