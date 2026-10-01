状态：按第 3 阶段设计编写，实现合并后需核对 vocabulary

# 渲染并检查实际成片

交付全片/区间、查布局或验收时读。资源准备归 [local-tools](../environment/local-tools.md)，提交规则归 [builds](../authoring/builds.md)。

## 用同一 Composition 导出

导入 dsivio-video/render@1。render:Video 必填 id/composition/timeline，可选成对 start-frame/end-frame-exclusive，空元素；默认完整节目，公开 `.video` 为 MP4，不是 HTML。

```xml
<render:Video id="final" composition={movie.composition} timeline={timeline}/>
<render:Video id="detail" composition={movie.composition} timeline={timeline}
  start-frame="30" end-frame-exclusive="90"/>
```

区间是原片整数帧半开范围，必须在节目内且非空；不要把秒数写进帧属性。两者使用同一时间域，区间只改变导出范围，不从第一帧重新运行故事。H.264 渲染要求偶数画布宽高，奇数尺寸在解析请求时拒绝，不静默补边。

Run Target 选 final.video 或 detail.video。用已有媒体和 Take 的 build-record/satisfy 只重做本地贡献与编码；本地渲染不增加网关生成能力。

## 分开静帧和真实播放

有已编译 Composition HTML 或真实 HTTP(S) Composition 页面时用 snapshot；普通网页截图不是 Composition snapshot。snapshot 是即时命令，不新建付费 Build，不隐式安装浏览器。

```sh
dsivio-video snapshot compiled.html --at-frame 0,24,48 --grid 3x1 --cell 480 --to notes/layout-v1
dsivio-video snapshot compiled.html --start-frame 12 --end-frame-exclusive 72 --step-frames 6 --to notes/motion-v1
dsivio-video snapshot --studio http://localhost:3000 --at-frame 24 --to notes/studio-frame
```

路径/URL 是形状示例，必须替换为确实存在的 Composition；不能因 snapshot 有 --studio 就宣称当前已经有 Studio 服务。帧列表严格递增且在总长内，与范围/step 互斥。--cell 只在 --grid 存在时使用。输出使用新目录。

已导出的真实影片再执行：

```sh
dsivio-video media probe exports/final-v1.mp4
dsivio-video media tile exports/final-v1.mp4 --frames 12 --columns 4 --to notes/final-v1-grid.jpg
```

网格查全局，单帧查字形/位置，连续采样查前中后状态与交接。MP4 必须另行实际播放并听音频；snapshot/探流不证明对白正确或混音合格。

## 写验收结论

- [ ] 正在检查本轮所选 Output 与实际导出文件。
- [ ] 内容事实、人物表演、动作连续及风格符合 Brief/Treatment。
- [ ] 文字清晰、主次明确、进入/停留/离开足够读懂。
- [ ] 台词、原声与其他声音正确，切画面没有意外打断声音。
- [ ] 文件尺寸、时长、开头/结尾及目标发布要求满足。
- [ ] 记录看过/听过的文件、范围与问题；工程资源可继续编辑。

发现问题先找负责的 Source/Recipe/Run 或素材；修后看受影响范围，再回看整体。无运行环境时说明未验收的真实缺口，不能用设计例子或截图宣称成片完成。
