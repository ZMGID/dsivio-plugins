# 由整体观看进入时间证据

参考视频或平台链接影响创作时读。分析结论写入 [analysis-note](analysis-note.md)，不要把采样命令输出当导演判断。

## 先取得真实素材

```sh
dsivio-video media prepare-fetch
dsivio-video media fetch https://example.com/reference --to assets/reference.mp4
dsivio-video media probe assets/reference.mp4
```

URL 只是形状示例，替换为用户实际链接。probe 后确认时长、尺寸、FPS、画面/音频流。完整看一遍并听声音，先记结构、关系与未知，再用采样回答具体问题。

## 从稀到密采样

| 问题 | 取证方式 | 不能证明什么 |
|---|---|---|
| 全局结构、人物与场景 | tile 等距概览 | 抽帧不能证明完整动作或声音 |
| 一段画面随台词变化 | transcript-labelled tiles 与 --around | 识别文本不自动成为正式台词 |
| 短转场、细微状态变化 | 限定范围 frames/tiles，再加密到逐帧 | 某一个漂亮静帧不证明运动连续 |
| 可能的剪接点 | boundaries 后查看两侧帧与音频 | 阈值分数不证明真实切镜或叙事边界 |

```sh
dsivio-video media tile assets/reference.mp4 --frames 12 --columns 4 --cell 400 --to notes/overview.jpg
dsivio-video transcribe assets/reference.mp4 --language zh --to notes/reference.transcript.json
dsivio-video media tiles assets/reference.mp4 --every 1 --transcript notes/reference.transcript.json --columns 4 --rows 3 --to notes/labelled-grids
dsivio-video media tile assets/reference.mp4 --around "先看这里" --occurrence 1 --padding 0.6 --transcript notes/reference.transcript.json --every 0.2 --to notes/phrase.jpg
dsivio-video media frames assets/reference.mp4 --at 1,2,3 --label-time --to notes/keyframes
dsivio-video media tiles assets/reference.mp4 --start 2 --end 3 --every-frame --to notes/transition
dsivio-video media boundaries assets/reference.mp4 --rate 4 --threshold 0.35
```

秒数例子仅适用于足够长且包含该语句的源片，按 probe 与 transcript 替换。--around 需要 transcript；重复短语用 occurrence 明确选第几次，padding 保留语句两侧状态。--around 不能混用 start/end，--at 不能混用范围采样；--every-frame 不与 at/every/frames 混用。语句缺测时间就补人工观察，不虚构时间。

分段资料很多时可用 `media tiles ... --ranges notes/ranges.json --to notes/range-grids`；ranges 的 JSON 结构先按当前实现核对，不猜字段。

## 保留源时间再截研究片段

```sh
dsivio-video media cut assets/reference.mp4 --keep 1:3 --keep 5:7 --to notes/excerpts.mp4
```

--keep 按顺序拼接所选源范围；也可单段 --start/--end，但不混用。--label-time 只允许单个视频区间，用于保留源时间定位；不要把它加在多段拼接上。范围在真实时长内且不重叠，用新路径防止覆盖。截取只服务研究，仍需回原片检查上下文。

记录对象内容、空间位置、进入/变化/持续/离开、对应说话与声响，以及它如何引导注意。目标片按自己的台词与表演重建这些功能，别直接复制参考秒数。
