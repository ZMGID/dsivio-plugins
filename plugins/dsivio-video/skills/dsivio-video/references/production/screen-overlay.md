# 全屏叠层

短促强调、遮挡交接、质感和曝光气氛；它不修改底层素材也不替代真实镜头运动。

导入 `dsivio-video/screen-overlay@1`，查询 `vocabulary dsivio-video/screen-overlay@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Track identity. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；Complete canvas geometry. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Program axis. |

子元素：`Flash`, `ColorWash`, `Vignette`, `ScanLines`, `DirectionalMatte`, `WhipVeil`, `GlitchVeil`, `Grain`, `LightLeak`, `Bokeh`, `TVStatic`。

输出：`program` — `dsivio-video/screen-overlay@1#Program`, `track` — `dsivio-video/visual@1#VisualTrack`。
### Flash

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `color` | 是 | color；{"kind":"color"} |
| `intensity` | 是 | number；{"kind":"number","min":0,"max":1} |
| `attack` | 是 | number；{"kind":"number","min":0,"integer":true} |
| `hold` | 是 | number；{"kind":"number","min":0,"integer":true} |
| `decay` | 是 | number；{"kind":"number","min":0,"integer":true} |
### ColorWash

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `color` | 是 | color；{"kind":"color"} |
| `opacity` | 是 | number；{"kind":"number","min":0,"max":1} |
### Vignette

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `center-x` | 是 | number；{"kind":"number","min":0,"max":1} |
| `center-y` | 是 | number；{"kind":"number","min":0,"max":1} |
| `radius-x` | 是 | number；{"kind":"number","positive":true} |
| `radius-y` | 是 | number；{"kind":"number","positive":true} |
| `softness` | 是 | number；{"kind":"number","min":0,"max":1} |
| `color` | 是 | color；{"kind":"color"} |
| `opacity` | 是 | number；{"kind":"number","min":0,"max":1} |
### ScanLines

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `spacing` | 是 | number；{"kind":"number","positive":true} |
| `thickness` | 是 | number；{"kind":"number","positive":true} |
| `angle` | 是 | number；{"kind":"number"} |
| `opacity` | 是 | number；{"kind":"number","min":0,"max":1} |
| `travel` | 是 | number；{"kind":"number"} |
### DirectionalMatte

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `angle` | 是 | number；{"kind":"number"} |
| `coverage` | 是 | number；{"kind":"number","min":0,"max":1} |
| `feather` | 是 | number；{"kind":"number","min":0,"max":1} |
| `color` | 是 | color；{"kind":"color"} |
| `opacity` | 是 | number；{"kind":"number","min":0,"max":1} |
| `from` | 是 | number；{"kind":"number","min":-1,"max":2} |
| `to` | 是 | number；{"kind":"number","min":-1,"max":2} |
### WhipVeil

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `direction` | 是 | choice；{"kind":"choice","values":["left","right","up","down"]} |
| `width` | 是 | number；{"kind":"number","positive":true} |
| `softness` | 是 | number；{"kind":"number","min":0} |
| `travel` | 是 | number；{"kind":"number","positive":true} |
| `opacity` | 是 | number；{"kind":"number","min":0,"max":1} |
### GlitchVeil

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `bars` | 是 | number；{"kind":"number","min":1,"max":256,"integer":true} |
| `colors` | 是 | colors；{"kind":"colors"} |
| `opacity` | 是 | number；{"kind":"number","min":0,"max":1} |
| `travel` | 是 | number；{"kind":"number"} |
| `seed` | 是 | number；{"kind":"number","min":0,"integer":true} |
### Grain

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `amount` | 是 | number；{"kind":"number","min":0,"max":1} |
| `size` | 是 | number；{"kind":"number","positive":true} |
| `chroma` | 是 | choice；{"kind":"choice","values":["monochrome","color"]} |
| `motion-rate` | 是 | number；{"kind":"number"} |
| `seed` | 是 | number；{"kind":"number","min":0,"integer":true} |
### LightLeak

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `colors` | 是 | colors；{"kind":"colors"} |
| `angle` | 是 | number；{"kind":"number"} |
| `softness` | 是 | number；{"kind":"number","min":0,"max":1} |
| `travel` | 是 | number；{"kind":"number"} |
| `intensity` | 是 | number；{"kind":"number","min":0,"max":1} |
| `seed` | 是 | number；{"kind":"number","min":0,"integer":true} |
### Bokeh

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `amount` | 是 | number；{"kind":"number","min":0,"max":1} |
| `min-size` | 是 | number；{"kind":"number","positive":true} |
| `max-size` | 是 | number；{"kind":"number","positive":true} |
| `color` | 是 | color；{"kind":"color"} |
| `warmth` | 是 | number；{"kind":"number","min":-1,"max":1} |
| `drift` | 是 | number；{"kind":"number"} |
| `seed` | 是 | number；{"kind":"number","min":0,"integer":true} |
### TVStatic

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 否 | text；Defaults to effect kind and declaration number. |
| `z` | 是 | safe integer；Visual stack layer. |
| `at` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `until` | 否 | time literal or typed semantic/window reference；Required explicit W: during, at+for, until+for, start+end or shared window. |
| `amount` | 是 | number；{"kind":"number","min":0,"max":1} |
| `size` | 是 | number；{"kind":"number","positive":true} |
| `scan-lines` | 是 | number；{"kind":"number","min":0,"max":1} |
| `motion-rate` | 是 | number；{"kind":"number"} |
| `seed` | 是 | number；{"kind":"number","min":0,"integer":true} |

## Recipe / 默认值

不使用 Recipe。所有效果属性都显式必填，z 为安全整数；完整参数表见下方。Grain/TVStatic 使用 128×128 循环噪声格，size 保持作者的格子尺寸；seed 固定且逐帧确定。

## 时间与源时钟

每效果显式 W，多个效果按 z 与声明顺序叠加。Flash 的 attack/hold/decay 是非负整数帧，须覆盖寿命；截图可 seek 直接复现，不依赖历史播放。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<overlay:Track id="effects" canvas={canvas} timeline={timeline}>
  <overlay:ColorWash z="40" at="0f" for="30f" color="#236C9C" opacity="0.25"/>
</overlay:Track>
```

## 常见错误

不是 overlay:Style；参数没有隐式默认，漏 color/seed/尺寸都会拒绝。DirectionalMatte 是几何覆盖，不是人物抠像。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
