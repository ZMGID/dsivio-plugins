# 声明 gen:Image、gen:Video 与 gen:Speech

写生成节点或读 plan 拒绝原因时读。先查询 [models](models.md)，再读图像/视频导演页。

导入 `dsivio-video/gen@1`，引用素材导入 `dsivio-video/media@1`，提示文本导入 `dsivio-video/text@1`。

| 元素 | 属性 | 约束 |
|---|---|---|
| gen:Image、gen:Video | id、model、prompt | 全部必填；model 为非空字面量完整 id；prompt 为非空字面量或 Text 引用 |
| gen:Image | ratio、size、quality、count | 可选；count 为正安全整数；其余字面量由实时能力校验 |
| gen:Video | duration、resolution、ratio、audio | 可选；duration 为正安全整数秒或描述明确允许的 auto；audio 只能 true/false |
| gen:Video | first-frame、last-frame | 可选 Image 引用；查首尾帧与组合限制 |
| gen:Image 内 gen:Reference | image | 空元素且恰一个 Image 引用 |
| gen:Video 内 gen:Reference | image 或 video 或 audio | 空元素且恰一个对应类型引用；同类别声明顺序保留 |
| gen:Image / gen:Video / gen:Speech 内 gen:Option | name、value、type 可选 | 接收 string/number/boolean/json，默认 string；只允许 live description 声明且 route 已实现的参数，未知键付费前拒绝 |
| gen:Speech | id、model、text、mode、voice、voice-ref、consent-attestation、instruction、output-format | id/model/text 必填；text/instruction 为 Text 引用或 literal；tts 使用明确 voice，clone 使用 Audio voice-ref 与项目内真实同意文件，互斥/格式由描述校验 |

只有首个生成媒体发布为 `.image`/`.video`/`.audio`；所有产物仍记录在任务中。count>1 不会自动产生可引用的全部变体端口，不为批量挑选盲目多付费。Speech 必须以真实音频时长和 ASR 证据进入时间线，不能从 TTS 文案估计词时间。

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

## 语音进入同一作品图

查询 speech 模型与音色事实后，显式声明 `gen:Speech`。例如 MiniMax [官方音色表](https://platform.minimax.io/docs/faq/system-voice-id) 中的 `English_expressive_narrator` 仍需对应产品 key 与模型已启用；这不是跨供应商通用 voice。以下模型 id 必须替换为实际目录返回值：

```xml
<text:Value id="narrationText">今天我们来介绍这件作品。</text:Value>
<gen:Speech id="narration" model="provider/enabled-speech"
  mode="tts" text={narrationText} voice="目录确认的音色ID" output-format="wav">
  <gen:Option name="speed" type="number" value="1"/>
</gen:Speech>
```

克隆使用 `voice-ref={authorizedAudio}` 与 `consent-attestation="assets/voice-consent.txt"`，只能在描述支持 clone 且用户确实授权时使用；同意文件作为输入资源参与请求身份。已知 upload/clone 回执按原任务继续，不重做结果不确定的付费步骤。再将 `.audio` 送入 Normalize→SemanticTake→Timeline，或直接用于 AudioTrack。

