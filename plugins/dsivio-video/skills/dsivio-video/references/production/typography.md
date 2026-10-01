# 独立文字、路径文字与静态文字遮罩

没有测量词时钟的标题、精确事实、标注用 Typography；对白字幕读 [caption-fine](caption-fine.md)。导入 `dsivio-video/typo@1`，查询 `vocabulary dsivio-video/typo@1 --json`。本页据 SurfaceDoc、实现和 phase4 共同文字规则核对。

## 元素与属性

| 元素 | 必填 | 可选 / 子元素 | 输出 |
|---|---|---|---|
| Style | id、recipe、font（Face 或 Stack） | Fill/Stroke/Shadow/Glow/Box/Axis/Feature/Decoration | 裸 id Style |
| Motion | id | ItemKeyframe、PathKeyframe、Sequence | 裸 id Motion |
| Track | id、timeline | Point/Area/Path | .program、.track |
| Point/Area/Path | id、placement、style、显式 W | motion、content；正文 P/Span/Break | Track 子项，无单独终端 |
| Mask | id、timeline、text、material | mode、fit | .track |

placement 分别引用 space Point/Frame/Path。content 是 Text 引用，与非空正文互斥。Mask.text 是 Typography Program，material 是 Surface；只支持静态纯 Area 字形布局，不支持运动或复杂流排版。Mask mode 默认 alpha，可选 alpha/luminance，fit 默认 cover，可选 contain/cover/fill。

## Recipe 与默认值

必填 `stack-order`（安全整数）、`size`；填色 `fill` 或 Style 的显式 Paint。`weight` / `font-style` 若声明必须与主 Face 一致。

- 字形：line-height=1.2、tracking=0、word-spacing=0、kerning=auto、synthesis=none、language 可选、direction=auto、writing-mode=horizontal-tb、baseline-shift=0、vertical-align=baseline、tab-size=4。
- 段落：indent=0、paragraph-before/after=0、transform=none、caps=normal、cjk-spacing=normal、punctuation-trim=none。
- 布局：inline-size/block-size=fixed、padding=0（一/二/四个数）、align/block-align=center、wrap=word、overflow=visible、max-lines/minimum-scale 可选、clip=false、columns=1、column-gap=0、metric-edge=line-box。
- Point：point-anchor-inline/block=center。
- Path：path-side=left、path-orientation=follow、path-start-margin/end-margin=0、path-align=start、path-reverse=false、path-overflow=visible。

Style 的复杂 Paint、富文本与 Sequence 属性按 vocabulary 指示再读实际作者模块；不要把 CSS 属性直接塞进 Recipe。

## 时间与运动

Item 必须显式 W，采用 [timeline](timeline.md) 的半开窗口。Motion ItemKeyframe 的 at 是局部整数帧，不是节目 at：可写 x/y/scale/rotate/skew-x/skew-y/opacity/blur/clip-top/right/bottom/left、easing。PathKeyframe 收 at/margin/easing。所有运动按帧求值，直接 seek 可重现。字体通过 setup fonts 准备；只用精确静态 Face，不合成。

## 最小片段

```xml
<typo:Style id="headline" recipe={look.typo.title} font={font}/>
<typo:Motion id="rise">
  <typo:ItemKeyframe at="0" opacity="0" y="24"/>
  <typo:ItemKeyframe at="12" opacity="1" y="0" easing="ease-out"/>
</typo:Motion>
<typo:Track id="titles" timeline={timeline}>
  <typo:Area id="title" placement={title-box} style={headline} motion={rise} during="program">把空间留给重点</typo:Area>
</typo:Track>
```

先声明 Timeline、Frame、font 与 Recipe。可直接运行 [examples/title.dvrun](examples/title.dvrun)。Film 接 titles.track，而不是 titles.program。

## 常见错误

字体 weight 冲突、未准备字形、content 与正文并存、Area 错传 Point、缺 W、局部动画帧写成 12f、跨轨 stack-order 冲突。排版溢出先调整实际字形/安全框/阅读时间，不通过合成或无声删词修复。
