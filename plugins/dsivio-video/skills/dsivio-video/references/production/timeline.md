# 在同一个整数帧时钟上组织时间

装配已接受媒体、安排语义事件或纯动画时读。制作贡献归 [tracks](tracks.md)，终端装配归 [film](film.md)。

## 分开内容、素材与放置

| 元素/输出 | 职责 | 不承担 |
|---|---|---|
| script:Script，裸 id | Narrative 与正式台词；id 为唯一必填属性 | 模型、帧数、外观 |
| program:Clock，裸 id | frame-rate 为整数或整数比值，如 30、30000/1001 | 小数 FPS |
| pipeline:Normalize，.media | 将 Video/Audio 变成同一时钟的 SynchronizedMedia | 静图直接当动态媒体 |
| align:SemanticTake，.take | 将指定 Narrative Segment 与已准备媒体关联 | Timeline 放置或后期外观 |
| time:Timeline，裸 id | 放置全部 Take，确定节目总长 | 自动输出画面/声音轨道 |

## 先规范媒体，再建立 Take

Normalize 必填 id/source；clock 与 frame-rate 恰一个。策略选 recipe 或完整 video/audio/span-authority 三项恰一个。含画面以 video 为时长权威；audio=default 需要真实音频，无声片明确 audio=none；静图先 StillVideo。

```xml
<pipeline:Normalize id="prepared" source={shot.video} clock={clock}
  video="primary-moving" audio="none" span-authority="video"/>
<align:SemanticTake id="take" narrative={story} segment={story.segment.silent}
  media={prepared.media}/>
<time:Timeline id="timeline" clock={clock} end="content.end">
  <time:Take id="opening" source={take.take} at="0f"/>
</time:Timeline>
```

这是依赖片段，先声明/import 对应模块、clock、story 的空 silent 段和 shot.video。带词段 SemanticTake 必填 language（如 zh）；可选 model 指定实际目录中的 transcribe 模型，省略为 `local/whisperx-small`。需要云转写时显式选择已启用的模型，后端与描述在 plan 时冻结，执行失败不换成本地模型。空段不调用对齐，不添加无用 language/model。CLI transcript 是分析证据，不是精确对齐 Evidence；未测到的词边界不会变成伪造的精确时间。

需要裁切或变速时在 SemanticTake 前使用 pipeline:Transform 的 Trim/Retime：id/source 必填；Trim 用局部整数 start-frame/end-frame-exclusive，Retime 用正整数或整数比值 speed，preserve-pitch 固定 true。别将已对齐 Take 改长短。

## 精确放置

Timeline 的 id 必填，clock/frame-rate 恰一个，end 可选；至少一个 Take 或显式正 end。Take 的 source 引用 SemanticTake，id/at 可选；首个省略 at 为 0f，之后为 previous.end。全部 Take 必须同 Narrative/Clock；段和语义锚不能重复放置。

content.end 是最大结束位置，不是最后声明的 Take 结束。显式 end 必须包住全部素材，允许空白；纯动画可没有 Take，但必须给正 end，例如 `end="90f"`。

## 让语义决定位置，让时钟决定展开

时间单位用 f/ms/s，不用裸数。语义定位使用 program.start/end、segment.start/end、selection.start/end、moment.cue；只允许加减一个带单位时长。窗口 W 采用 `during="program"` 或 Segment/Selection、`at`+`for`、`until`+`for`、`start`+`end` 中恰一种；支持共享 Window 的组件也可只写 `window={shared}`。语义边表达式须给实际使用的 `selection`/`segment`/`moment` 或 `start-source`/`end-source` 引用，不保留无用绑定。量化后窗口必须非空且在节目内，不静默夹到边界。

`time:Window` 必填 id/timeline 及显式 W，公开裸 id。`time:Instant` 必填 id/timeline，使用 at（Segment/Selection 必须给 boundary=start/end）或 instant 表达式及使用的绑定；公开裸 id。W 是半开区间，端点按精确有理数运算后 half-up 量化；Take 放置则必须本来就落在整数帧。组件的 `at` 是节目轴，Trim 是源局部轴，动画 keyframe 是组件局部帧，不混用。

源参考秒数定位分析证据；目标事件依据目标台词或目标动作重建。恢复、snapshot 或区间渲染直接寻帧必须得到相同状态，不依赖从第一帧播放积累。
