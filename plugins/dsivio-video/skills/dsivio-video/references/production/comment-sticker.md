# 评论贴纸

将真实引用或明确创作的评论作为视觉卡片；不把虚构内容冒充用户评价。

导入 `dsivio-video/comment-sticker@1`，查询 `vocabulary dsivio-video/comment-sticker@1 --json`。本页据 SurfaceDoc、实现与 phase4 设计核对；示例所用引用须预先声明，W 见 timeline。完整工程见 [examples](examples/README.md)。

## 元素与属性

### Style

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Style identity. |
| `recipe` | 是 | dsivio-video/recipe@1#Recipe；完整默认值见本节后。 |
| `font` | 是 | dsivio-video/fonts@1#Stack；Exact font Stack; all supplied faces retain their real weights. |

输出：`裸 id` — `dsivio-video/comment-sticker@1#Style`。

Keys and defaults: stack-order=62, background="#ffffff", border-color="#0000000e", border-width=1, radius=28, padding-x=28, padding-y=24, gap=18, rotation=-2.5, shadow-color="#0000004d", shadow-x=0, shadow-y=18, shadow-blur=46, shadow-spread=0, tail=true, tail-width=42, tail-height=28, tail-offset-x=58, avatar-fallback="none", avatar-size=58, avatar-border-width=3, avatar-border-color="#ffffff", avatar-background="#34313a", avatar-text-color="#ffffff", header-size=24, header-weight=680, header-line-height=1.15, header-color="#8f8f8f", body-size=42, body-weight=850, body-line-height=1.16, body-color="#111111", body-max-lines=3, meta-size=21, meta-weight=650, meta-line-height=1.15, meta-color="#8f8f8f", enter="pop", enter-frames=17, enter-offset-y=-180, enter-start-scale=0.78, enter-rotation-delta=-4.5, enter-easing="ease-out", exit="fade-up", exit-frames=20, exit-offset-y=-28, exit-easing="ease-in", hold="float", hold-amplitude-y=4, hold-rotation-amplitude=0.35, hold-period-frames=84. Short animation phases clamp to the card lifetime; hold only runs between entry and exit.
### Track

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Track identity. |
| `timeline` | 是 | dsivio-video/time@1#Timeline；Program axis. |
| `canvas` | 是 | dsivio-video/space@1#Canvas；Canvas geometry. |

子元素：`Sticker`。

输出：`program` — `dsivio-video/comment-sticker@1#Program`, `track` — `dsivio-video/visual@1#VisualTrack`。
### Sticker

| 属性 | 必填 | 类型 / 约束 |
|---|---|---|
| `id` | 是 | text；Unique card id. |
| `frame` | 是 | dsivio-video/space@1#Frame；Frame including tail. |
| `style` | 是 | dsivio-video/comment-sticker@1#Style；Comment Style. |
| `comment` | 否 | text；Nonempty literal or Text reference. |
| `author` | 否 | text；Nonempty literal or Text reference. |
| `header` | 否 | text；Nonempty literal or Text reference. |
| `meta` | 否 | text；Nonempty literal or Text reference. |
| `avatar` | 否 | dsivio-video/media@1#Image；Optional image source. |

## Recipe / 默认值

Recipe 的完整默认键见下方 Style.recipe；默认 stack-order=62、radius=28、padding-x/y=28/24、tail=true、rotation=-2.5。header/body/meta 字重意图 680/850/650 四舍五入到 700/900/700，然后从提供的同 family 精确 Face 选取；不合成、不回落系统字体。

## 时间与源时钟

Sticker 显式 W，frame 包含尾巴；Track 至少一张卡。短动画阶段夹在寿命内；进场、float 状态逐帧确定，无音频。

W 的形式与语义绑定见 [timeline](timeline.md)。只用本页实际列出的时间属性，不给不支持共享 Window 的元素添加 window。

## 最小依赖片段

```xml
<comment:Style id="card-style" recipe={look.comment.base} font={font}/>
<comment:Track id="comments" timeline={timeline} canvas={canvas}>
  <comment:Sticker id="reply" frame={picture} style={card-style} author="观众" at="12f" for="60f">这一步终于看懂了</comment:Sticker>
</comment:Track>
```

## 常见错误

comment 属性与正文互斥；字体必须 Stack，不能只传 Face。avatar 只是可选 Image；尾巴/阴影必须留在预期安全区。

Film 只接终端 VisualTrack/AudioTrack；`.program`、`.schedule`、Style 和 Image 都不是 Film Track。
