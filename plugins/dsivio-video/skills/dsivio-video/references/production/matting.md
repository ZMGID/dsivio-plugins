# 抠像 / 去背景当前不可用

当前 vocabulary 没有 background-removal 或 volcengine-matting 模块，不能写相应元素、Recipe 或命令。phase4 设计 §3 明确推迟这项能力；需要主体透明素材时，导入用户已抠好的素材，不以规划中的宿主接口冒充已实现功能。

## 已支持的替代路径

- 静图：`media:Image` 必填 id/src，公开裸 id Image。推荐有真实 alpha 的 PNG。`image-transform:Alpha mode="preserve"` 保留已有 alpha，**不是**从不透明背景分离主体。
- 视频：`media:Video` 必填 id/src，公开裸 id Video；先 Normalize 到明确 Clock 与选流策略，再给 media-track。选择确实携带 alpha 的源/编码，并检查规范化后的素材，不通过普通 H.264 猜透明。
- 呈现：Image 用 media-track:Item 的 image + extent；动态媒体用 media + 不带 extent。appearance 的 opacity 只是整体透明度，不执行人物检测。

## 属性、Recipe 与时间

不存在抠像专用属性/Recipe/计费。导入遵循 media SurfaceDoc；Frame/Extent 的 width/height 是真实尺寸；影片放置须给显式 W，源动画不因遮挡而重播，见 [media-track](media-track.md)。本地 image-compose 可按 straight alpha 合成，见 [image-compose](image-compose.md)。

```xml
<media:Image id="subject" src="./assets/subject-transparent.png"/>
<space:Extent id="subject-size" width="640" height="960"/>
<media-track:Track id="subjects" timeline={timeline} canvas={canvas}>
  <media-track:Item image={subject} extent={subject-size} frame={picture}
    appearance={look.media.base} at="0f" for="60f"/>
</media-track:Track>
```

这是依赖片段；先 import media/space/media-track，定义 Timeline、Canvas、Frame 与 stack-order 明确的 Recipe。素材文件必须存在且已经透明。

## 常见错误与验收

白底 JPEG 不会因 Alpha preserve 变透明；screen-overlay:DirectionalMatte 只是几何遮盖。StillVideo 输出普通 H.264，不是保 alpha 的静图导入捷径。先在明暗两种底色上检查边缘、半透明发丝和阴影，再看影片中的放置。不要声称插件执行了去背景或请求不存在的付费服务。
