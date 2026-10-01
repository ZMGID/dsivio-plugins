# 按内容归属选择三种基础轨道

呈现 Timeline 的画面/声音或独立文字时读。Timeline 不会自动送画面和声音进入 Film，必须明确选择贡献。

| 模块 | 作者结构 | 公共产物 | 负责什么 |
|---|---|---|---|
| dsivio-video/performance@1 | Style/Track/Use | .program、.visual | Timeline 已有画面的原速呈现与视框 |
| dsivio-video/sound@1 | Style/Track/Use | .program、.audio | Timeline 已有声音的增益与覆盖 |
| dsivio-video/typo@1 | Style/Track/Area 等 | .program、.track | 独立文字，不冒充词级字幕 |

## 保持现有表演的源位置

performance:Style 收 id/frame/appearance，frame 引用 Frame，appearance 引用 Recipe。Track 收 id/timeline/canvas，Use 收可选 id、style 与窗口。零 Use 合法但不会显示素材；给缺省窗口的 Use 才表示全节目呈现。

```xml
<performance:Style id="view" frame={picture} appearance={look.performance.base}/>
<performance:Track id="camera" timeline={timeline} canvas={canvas}>
  <performance:Use style={view} during="program"/>
</performance:Track>
```

picture 可用 space:Frame 定义：id/within/left/top/right/bottom，长度带 px/%；right/bottom 是右/下边位置，不是 inset。画布用 space:Canvas 的 id/width/height 正整数。改变视框不改变原媒体播放位置，窗口开启不从第一帧重播；没有画面成员的 Take 跳过，不伪造黑视频或头像。

## 声音有自己的选择与优先级

```xml
<sound:Style id="spoken" gain="1" end-gain="1"/>
<sound:Track id="voice" timeline={timeline}>
  <sound:Use style={spoken} during="program"/>
</sound:Track>
```

Style 的 gain/end-gain 在 0…64；end-gain 默认同 gain，Use 完整窗口内线性变化。后声明有声 Take 优先，然后后声明 Use 优先；静音也会遮掉前 Use。不同 Sound Track 最终混音相加，没有隐式 ducking/响度标准化。切画面不必切声音；浏览器预览的视频元素静音不代表最终影片无声。

## 将精确文字留给独立 Typography

```xml
<fonts:Face id="title-face" family="noto-sans-sc" weight="700" style="normal"/>
<fonts:Stack id="title-font" font={title-face}/>
<typo:Style id="headline" recipe={look.typo.title} font={title-font}/>
<typo:Track id="titles" timeline={timeline}>
  <typo:Area id="title" placement={title-box} style={headline}
    during={story.selection.claim}>把空间留给重点</typo:Area>
</typo:Track>
```

此片段依赖真实定义的 title-box 与 claim Selection。Face 必填 id/family/weight/style；Stack 必填 id/font，可选 emoji，Fallback 引用精确 font。setup fonts 明确准备资源，不默认系统字体。

typo:Style 必填 id/recipe/font；Track 必填 id/timeline；Area 必填 id/placement/style 与窗口，motion/content 可选，content 引用 Text 与正文互斥。Point/Area/Path 分别引用对应空间对象；正文可用 P/Span/Break，但精确富文本/Motion 接口需查询 vocabulary，别猜新属性。Recipe weight/font-style 若指定必须与主 Face 一致，不能通过合成字体掩盖缺字节。

## 核对实际贡献

performance 公开 .visual，sound 公开 .audio，typo 公开 .track；不要互换端口。独立文字不是词级字幕。详见 [performance](performance.md)、[sound](sound.md)、[typography](typography.md)；字幕用 [caption-fine](caption-fine.md)，覆盖素材用 [media-track](media-track.md)，配乐用 [audio-track](audio-track.md)。其他专用组件由 Skill 路由，不把普通文字冒充排名或贴纸。
