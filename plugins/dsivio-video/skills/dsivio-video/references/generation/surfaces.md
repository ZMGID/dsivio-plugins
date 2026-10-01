# 声明 gen:Image 与 gen:Video

写生成节点或读 plan 拒绝原因时读。先查询 [models](models.md)，再读图像/视频导演页。

导入 `dsivio-video/gen@1`，引用素材导入 `dsivio-video/media@1`，提示文本导入 `dsivio-video/text@1`。

| 元素 | 属性 | 约束 |
|---|---|---|
| gen:Image、gen:Video | id、model、prompt | 全部必填；model 为非空字面量完整 id；prompt 为非空字面量或 Text 引用 |
| gen:Image | ratio、size、quality、count | 可选；count 为正安全整数；其余字面量由实时能力校验 |
| gen:Video | duration、resolution、ratio、audio | 可选；duration 为正安全整数秒；audio 只能 true/false |
| gen:Video | first-frame、last-frame | 可选 Image 引用；查首尾帧与组合限制 |
| gen:Image 内 gen:Reference | image | 空元素且恰一个 Image 引用 |
| gen:Video 内 gen:Reference | image 或 video 或 audio | 空元素且恰一个对应类型引用；同类别声明顺序保留 |
| gen:Video 内 gen:Option | name、value、type 可选 | 解析器接收 string/number/boolean/json，默认 string；当前 Dsivio 在 plan 拒绝所有模型额外选项，勿使用 |

只有首个生成媒体发布为 `.image`/`.video`；count>1 不会自动产生可引用的全部变体端口，不为批量挑选盲目多付费。

## 一个有边界的请求关系

以下片段不是默认模型配置。先将 `provider/enabled-image`、`provider/enabled-video` 替换为目录真实 id，核对各参数，并取得费用许可。

```xml
<media:Image id="product" src="./assets/product.png"/>
<text:Value id="direction">桌边陶杯，保留参考的杯形与釉色，晨光，近景。</text:Value>
<gen:Image id="hero" model="provider/enabled-image" prompt={direction}>
  <gen:Reference image={product}/>
</gen:Image>
<gen:Video id="shot" model="provider/enabled-video" prompt="杯中热气轻轻上升，固定机位。"
  first-frame={hero.image} duration="5" resolution="720p" ratio="9:16" audio="false"/>
```

media:Image/Video/Audio 以 id、src 接纳文件，src 按所在 Source 解析；不能把普通路径字符串直接当 Image 引用。首帧是开场画面，普通 Reference 是条件素材，不保证它会占满某个镜头。

未知属性或重复属性、错误引用类型、非法子节点均应修作者表达；不靠 Option 逃过能力校验。prompt 过长时删掉互相冲突和低价值要求，别仅机械截断关键对白。
