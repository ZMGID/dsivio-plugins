# 第 4 阶段设计：其余组件

对应 hypit 的 caption、caption-fine、media-track、audio-track、deck-track、ranking、comment-sticker、screen-overlay、interview-emoji-reveal、image-compose、image-transform。行为以 [research/05](../research/05-tracks-components.md) 对应小节为准，栅格执行以 [research/06 §2.13](../research/06-media-tooling.md) 为准。

## 1. 共同做法

- 每个组件照第 3 阶段 sound / performance / typo 的结构写：
  - `src/components/<名>/{author,program,lower,validate}.ts`
  - `src/modules/<名>/index.ts`
  - 同目录测试。
- 组件只产出第 3 阶段的终端类型：`visual@1#VisualTrack` / `#AudioTrack` / `#Surface`，或 `media@1#Image`。Film 和渲染器不认识任何具体组件。
- 时间窗口一律用 `src/timeline/temporal.ts` 与 `modules/time` 导出的 `decodeWindowAttributes` / `publishWindow`；摆放一律用 `src/space/math.ts`；文字一律降为 IR 的 text / text-flow，由 `src/render/text-runtime.ts` 排版。组件内不重写时间、空间或文字规则。
- 身份通过 `key: time#ConsumerKey` 端口传入，由 `timeline/identity.ts` 生成。
- 动画：结构关键帧只用 opacity / transform / filter / backdrop-filter / clip-path。需要逐帧计算的效果用内置可信 `program` 节点，每帧只由「数据 + 帧号」决定。
- 注册：各包把 ModuleDef 和能力交给集成者（主会话），由它统一加进 `src/modules/index.ts`。

## 2. 工作包

| 包 | 组件 | 说明 |
|---|---|---|
| Captions | caption、caption-fine | 字幕内容来自 Script 的 CaptionDocument，时间来自 SemanticTake 的词锚点；逐词高亮、Cue 切分、样式 |
| MediaTrack | media-track、audio-track | 图片/视频/Surface 的摆放与替换序列、进出场、音效；独立音频占位 |
| Deck | deck-track | DepthStack 卡片堆 |
| Ranking | ranking | TierBoard、Column、TopThree |
| Stickers | comment-sticker、interview-emoji-reveal | 评论卡；答案条依次揭示 |
| Overlay | screen-overlay | 十一种全屏覆盖 |
| Raster | image-compose、image-transform | 纯数据请求 + 本地执行器 `local/raster`。执行器是我们自己写的 Python OpenCV 程序（`services/raster`），由 `dsivio-video setup raster` 在 `~/.dsivio-video/raster/` 建环境（Python 3.12 重新锁定依赖）；单次短进程、无常驻服务 |

## 3. 推迟的部分

- background-removal、volcengine-matting：需要宿主提供抠像 / 去背景能力。按架构由 Dsivio 网关提供（第 6 阶段）；本阶段只支持把已经抠好的透明素材作为 `media:Image` / `media:Video` 导入，经 Normalize 后保持透明。
- browser-capture 的项目素材捕获已在第 3 阶段的 `capture` 命令实现。

## 4. 实现记录

共 27 个模块注册在 `src/modules/index.ts`；全部测试 377 个通过。每个组件都在 Film 里叠在导入素材上，用真实渲染器抓帧并人工看过。

| 组件 | 实现要点与有意差异 |
|---|---|
| caption / caption-fine | 字幕内容来自 Script 的 CaptionDocument（Cue 带 `role`，取自所属 Turn），时间来自对齐后的词锚点；Hidden 遮罩、逐字卡拉 OK（step / wipe）、打字机、下划线、独立或连成一片的高亮底、24 种入场动作和循环；Cue 之间无残影，遮罩恢复后不从头播。角色区域 `caption-fine@1#RegionTimeline = { axisKey, totalFrames, tracks: [{ role, frames: (FractionRect \| null)[] }] }`，`FractionRect = { x, y, width, height }` 是画布的 0–1 比例；因为 Track 没有画布端口，降为百分比定位。 |
| media-track / audio-track | 图片、视频、Surface 的摆放与替换序列，cut / crossfade / push / wipe / cover / page-turn 转场，进出场与音效；同一 Track 的画面与声音分别输出 `…/visual`、`…/audio` 两个终端轨道，可同时接进 Film。audio-track 的循环和变速保持音高（实测 440 Hz）。 |
| deck-track | DepthStack 卡片堆。research 记录的源实现缺陷（`*-step` 键被接受却读错键）按建议合同修正：`brightness-step` / `contrast-step` / `saturation-step` 真正生效，不带 `-step` 的键拒绝。 |
| ranking | TierBoard、Column、TopThree；TopThree 的 terminal 只接受绝对时间或 Moment（共享 `decodeInstantAttributes` 的 `allow` 限制）。 |
| comment-sticker / interview-emoji-reveal | 规格默认字重 680/850/650 按「四舍五入到 100」取 700/900/700 的精确字形，不合成字重；过短的动画阶段夹在寿命内。 |
| screen-overlay | 全部 11 种全屏覆盖；Grain / TVStatic 用 128×128 循环噪声格，保持作者给定的格子尺寸；随机由固定 seed 决定，按帧号即可复现。 |
| image-compose / image-transform | 能力 `local/raster`，执行器 `services/raster/raster.py`（OpenCV + NumPy，单次短进程）。`dsivio-video setup raster` 在 `~/.dsivio-video/raster/1.0.0/venv` 用找到的 Python 3.12 安装 numpy 2.2.6、opencv-python-headless 4.12.0.88；PyPI 上 macOS arm64/x64、Windows 32/64、Linux x64/arm64 都有轮子，Windows ARM64 没有 OpenCV 轮子。alpha-over 像素实测与公式一致。 |

共享层随本阶段的改动：
- `time` 模块新增 `decodeInstantAttributes(element, ctx, { allow })` / `publishInstant`；显式 `time:Window` 必须写时间形式（`TIME_WINDOW_FORM_REQUIRED`）。
- 文字运行时：遮罩与旋转、缩放的祖先下按局部坐标排版，省略号落在最后一行，按整词换行；暴露 `window.__dvText.rectangleUnion` 给字幕连片高亮复用；静态字体拒绝任何合成。
- 渲染页面：所有文字挂载完成后才执行 program 的 setup；每次 seek 先应用动画，再定位文字，再绘制 program。
- 字体策略：只用精确的静态字形（100 级字重），不合成。
