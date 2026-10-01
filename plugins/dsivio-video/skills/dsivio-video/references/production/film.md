状态：按第 3 阶段设计编写，实现合并后需核对 vocabulary

# 显式装配一部 Film

轨道完成后、背景/层级异常或装配纯动画时读。Film 汇总公共轨道，不拥有各组件私有 Style。

## 固定一个画布和时间域

导入 dsivio-video/film@1，Film 恰好收 id/canvas/timeline/appearance；appearance 引用只含 background 的 Recipe，颜色为六/八位十六进制，不存在隐式底色。至少一个空 film:Track，唯一属性 source，类型必须 VisualTrack 或 AudioTrack。

```xml
<film:Film id="movie" canvas={canvas} timeline={timeline} appearance={look.film.base}>
  <film:Track source={camera.visual}/>
  <film:Track source={voice.audio}/>
  <film:Track source={titles.track}/>
</film:Film>
```

Recipe 例子：

```xml
<?dvml using="dsivio-video/dvs@1"?>
<sheet version="1">
film.base { background: "#102030"; }
performance.base { stack-order: 0; fit: cover; clip: frame; }
typo.title { stack-order: 20; size: 64; fill: "#FFFFFF"; align: center; wrap: word; }
</sheet>
```

这些键来自第 3 阶段 canonical 设计。其他外观键先查合并后的 vocabulary，不从 CSS 随意移植。这里的 Film 公开 `.composition`，不是 `.video`。

## 查归属而非盲目换声明顺序

- 所有轨道必须在同一 Timeline 时间域，Track 身份全局唯一，不重复 source。
- 视觉按明确层级与稳定身份排序，不把 film:Track 的书写顺序当通用 z-index。
- 背景在所有画面之下，声音在采样轴相加，没有视觉层级。
- Take 的重叠、Use 的覆盖与跨轨 stacking 是不同关系；先确认问题属于谁。
- 纯动画可以零 Take，但 Timeline 必须有正总长，Film 仍需真实轨道贡献。

验收选择的 camera/voice/titles 是否真正来自本轮 Run。改标题后不能用旧最终视频覆盖新 composition，图像成功也不证明声音已装入影片。
