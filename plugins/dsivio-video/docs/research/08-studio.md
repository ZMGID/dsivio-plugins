# Studio：交互预览、源文件编辑与时间戳评审

## 1. 概述

Studio 是围绕一个明确 Run 的本地网页创作界面，不是传统非线性剪辑工程，也不是项目目录浏览器。它读取 Run 选择的 Author Graph、Candidate 和素材，沿目标追溯一个 Film 及其 Timeline，计算用于显示的 Composition 与组件领域投影。界面提供两个顶层页面：**Studio**（源码、画面、时间线、属性、任务与产物）和 **Comments**（同一画面的评审与时间戳留言）。

浏览器预览不生成 MP4、不提交导出 Build、不自动进行收费生成。预览和真正渲染共享编译后的画面描述，但预览通过浏览器即时播放；导出通过 Run 的完整执行与渲染链得到文件。评论、源文件、Build Result 分属三种独立存储，不应混为 Studio 数据库。

本文件以源码及参考说明归纳行为，未运行构建、测试或安装，也未启动浏览器实测。下面的 CLI 示例已换成 dsivio-video 词汇；带 Runtime Profile 的选项描述的是原系统行为，不表示建议保留该架构。

## 2. 行为规格

### 2.1 启动、项目边界与会话生命周期

等价命令形状：

```text
dsivio-video studio --run runs/main.dvrun
  [--port 5179] [--workspace <项目目录>] [--package-root <包解析目录>]
  [--runtime <旧系统运行配置>] [--locale-pack <语言包>]...
dsivio-video studio --check-locale <语言包> [--package-root <目录>]
dsivio-video studio --help
```

- 普通启动必须提供非空 `--run`，不接受位置参数。参数按“标志、值”成对解析；未知标志、缺值、值又以 `--` 开头都会报错。可先写一个独立 `--`。除语言包外，重复选项取最后一个值；语言包允许多次追加。
- 调用目录优先取启动环境的 `INIT_CWD`，否则取当前工作目录。Run、显式 Runtime、workspace、package-root 的相对路径均从调用目录解析；指定 workspace 不会改变其他参数的相对路径基准。
- 未指定 workspace 时，从调用目录向上找最近的 `package.json` 确定项目；没有则以调用目录为项目。包解析根默认等于项目根。
- 原系统未显式指定 Runtime 时，只读取本项目 `.hypit/runtime` 的选择，不向父项目找运行配置。显式 Runtime 仅影响当前会话。没有 Runtime 时仍可浏览已存 Result；只要显示闭包无需外部执行，也能看 Source 和画面。
- 先加载领域包、官方与项目 Companion、Result/运行时接口，读取并预检 Run，再启动 Vite。Vite 不读取项目自己的配置文件，网页根在工具的 Studio 包中；资源读取允许项目、包解析根、工具发行根与 Studio 根。
- 默认请求端口 **5179**；`--port` 必须是正的安全整数。端口占用时允许 Vite 改用空闲端口，不设置严格端口失败。因此以实际打印的 URL 为准，不能拼死固定端口。
- 启动输出项目、绝对 Run 路径、运行配置及选择来源；必要时还输出不同的包解析根。监听完成后打印网页 URL 和直接进入 `#comments` 的 URL。终止对应进程关闭 Studio，不取消已经提交的 Build。
- 同一个项目、同一个 Run 的编辑复用已有进程。领域包代码、Companion 激活、新增包导入、Runtime 或 Result 仓库选择是在启动时载入的；这些改变要求重启服务器，刷新浏览器不够。

**可启动的 Run：**目标必须能追溯到当前 Author Graph 中一个 Film 或由它产生的 Render，并找到唯一、可解析的 Timeline 时间源。没有目标、纯图片生成目标、多个不同 Film、无法追溯 Film、Render 被不透明媒体 Candidate 替代而失去当前 Film 关系，均不能当作可编辑 Film 会话。纯动画 Timeline 可以没有 Take 和语词；不要求先有语音。

### 2.2 编译内容、热更新与错误状态

1. 将 Run 与 Author/Recipe 导入闭包一起重新编译，不能新 Author Graph 配旧 Run Plan。
2. 从 Film 提取被引用的视觉/音频 Track、时间源，以及 Companion 明确要求的同 Surface 支撑输出。只执行这个显示闭包，不执行最终编码目标。
3. 使用 Run 已选择的 Candidate；需要显示的 inline 领域值可直接使用。其余可由确定性 Producer 推导。原系统仅允许 Runtime 明确批准的、可抛弃的瞬时 Need 执行；Studio 不看价格猜测安全性，不拿 Provider handler，也不直接接触凭证。
4. 显示闭包有未满足 Need 时，错误列出准确 capability；Producer 的失败信息透传。时间源必须是 inline Timeline，Film 必须产生 inline Composition。任何画面或音频 Resource 不能供应，直接失败，不能画空洞或假图。
5. 同一编译结果产生会话快照、可导出的画面文档、无交互 shim 的 HTML、附带交互 shim/音频的预览 HTML，以及实际可服务的资源映射。

监听 Run 与已载入的 Author/Recipe 文件，按目录订阅文件系统事件；修改以 **80 毫秒**合并。每次分配递增版本，只发布最新请求的结果，过时编译完成不得覆盖较新的快照。浏览器通过 Vite WebSocket 收到快照或编译失败消息，替换时间线与 iframe 内容，不靠定时轮询。

编译失败给出错误文本、版本，能够定位时还给源码范围。界面可保留上次成功画面供定位，但它不是当前源码的有效导出。抓帧路由在重编译尚未完成时返回 HTTP 409；更新失败时返回 500 和失败原因，而不是把旧画面冒充最新。

### 2.3 页面与面板清单

| 页面/面板 | 展示与操作 | 持久化边界 |
| --- | --- | --- |
| 顶栏 | 当前 Author 文件名、保存/错误状态、语言与主题、Studio/Comments 页签；`#comments` 直接进入评审 | 界面偏好，不改作品内容 |
| Source 库及代码区 | 精确 Run、主 Author、导入的 Author/Recipe 文件；选文件、语法与行号、换行显示、读/编辑模式、选中对象源码范围、当前发声词关联 | 仅保存当前选中的源文件 |
| 中央 Preview | Film 合成画面、播放/暂停、静音、逐帧前后、进度与时间；Studio 中选择可识别视觉对象、重叠对象右键菜单与选择轮廓 | 选择、播放头不写 Source |
| 右侧 Inspector | 未选对象时显示项目、Canvas、时长/帧率/帧数、Run 目标/Candidate 数；选对象时显示 Companion 提供的属性/事实 | 只有拥有真实编辑端点的字段可写 |
| 下方 Timeline | Program 时间尺、语义带、组件轨道、材料缩略图/分镜/波形、播放头、缩放/平移、支持的移动与裁边 | 有授权的时间手势写拥有该事实的源文件 |
| Tasks 库 | 每 Build 一张卡；全部/进行中/已结束过滤；运行进度、保存 Result 阶段、失败/取消/需处理状态、来源 Run、完整错误与复制 | 查询面板，不改 Run/Build 状态 |
| Artifacts 库 | 全部/视频/图片/音频分类；项目或选中 Build 的顶层文件 Output；来源详情、媒体预览、显示名编辑 | 预览不选 Candidate；重命名只写 Result 的展示字段 |
| Comments | 放大的同一合成播放器、右侧留言、开放/完成过滤、时间定位、编辑/完成/重开/删除、输入框 | 写项目 `FEEDBACK.json`，不写视频源文件 |

Source、Tasks、Artifacts 共用库区外壳，但各自拥有工具条和操作。库区不是扫描输出目录形成的资产管理器：没有 Studio 工程清单、私有数据库或按目录猜测项目结构。

库切换进入时加载；Tasks 再进入保留已有列表和选择。显式 Refresh 取新快照，列表滚动到底追加较旧 Result；没有库轮询。刷新失败保留上次列表并显示错误。选中任务产生会话内任务上下文，切换页签仍保留，可从任务跳到它的媒体、回任务、清除上下文。

媒体库只展示声明 MIME 为图像、视频、音频的顶层文件 Output，进行中 Build 已发布的文件也可见；Composite Output 保持原结构，不拆内部 Resource 充当独立资产。转发 Output 解析到真实文件所有者，同一所有者文件合并卡片并保留来源；高亮 Output 优先排序，不排除其他媒体。卡片是固定尺寸方形缩略图区，按原比例容纳素材；名称最多两行，随侧栏宽度分配列数。视频帧缩略图、音频波形由浏览器展示，按进入可视区懒加载，不另造 Result 文件。

点击媒体暂停 Composition，中央切到文件。图片没有 transport；视频/音频可播放、静音、按秒拖动，前后按钮跳五秒。返回 Composition 恢复原合成播放头；在合成时间线选择或定位也回合成。此操作不写 Run，不改变 Candidate。媒体名双击或 F2 编辑，Enter/失焦保存、Escape 取消；失败保留输入及原因。只有结束、失败或取消的 Result 可以修改该准确 Output 的显示名，进行中不能改；Output 标识、媒体文件、其他 Build 同文件的名称不变。

布局边界可拖拽并记忆尺寸：Source 宽、Inspector 宽、Timeline 高、Comments 宽。语言内置英语与简体中文，首次跟随浏览器偏好、之后记住选择；切换保留播放头、选择、评论草稿。只翻译应用界面，不翻译作者文本、Companion 自有名称和原始诊断。额外语言为显式 JSON 包，检查缺失/未知消息与变量；缺翻译回退英语，修改语言包需重启。

### 2.4 播放引擎与渲染的区别

Composition 编译为 HyperFrames 画面文档，材质 URL 由服务器根据 Resource 映射。预览是原始画布大小的 iframe，再按容器缩放；HyperFrames 负责布局、层叠、裁切与动画，Studio 只驱动绝对 Program 帧。

- 播放使用浏览器动画帧回调，以经过的真实时间和有理数帧率换算整数 Program 帧；到末帧停止，从末帧重新播放回到起点。暂停/定位会让动画落到指定帧。
- 离散定位等待媒体 seek 解码完成；按确切源帧坐标取帧中点，避免变速时浮点中点跨到下一帧。零速 hold 固定解码帧、保持视频暂停。连续播放让原生解码器走自己的时钟，偏离约 80 毫秒才校正，不每个刷新都重新 seek。
- 视觉视频元素固定静音。合成声音来自 Film 选择的 AudioTrack，不来自视频播放器附带音轨。AudioClip 的源区间、变速、循环相位、固定增益、绝对 48kHz sample 增益包络、可听范围与淡入淡出由独立 Web Audio 增益节点相乘。支持超过 1 的增益；暂停定位不播声音。
- 原生浏览器连续播放不是逐帧编码证据。构图与语义来自共同编译结果，但最终导出仍需检查编码文件、解码兼容及声音。
- Comments 的画面点击播放/暂停，不选对象；进度条悬停用一个懒创建、静音的独立预览实例显示候选帧，不移动主播放头，不写缩略图，离开评审释放实例。

全局 Space 切播放；左右方向键或逗号/句号逐帧，Shift 变十帧，Home/End 到首/末帧，Escape 清选择。输入框和 Inspector 控件聚焦时暂停这些 transport 快捷键。

### 2.5 Timeline 与时间编辑

Timeline 的完整范围来自 Timeline 本身，不因某个展示对象较长而自动扩展。Take 的放置与完整长度是参照事实，不由时间线随意裁改。尺始终显示 Program 时间；有已放置 Segment 时增加 Segment、Word、Selection/Moment 带，无语词 Segment 仍显示。是否省略空词/标记带以整个作品判断，不随可视窗口或播放头闪烁；无 Segment 时仅保留普通时间尺。整个尺区在轨道垂直滚动时固定。

每条声明的 lane 保持一行，不为重叠项目自动增行。实体按层次绘制，同层按投影顺序；选中临时抬高编辑显示，不写 Film 层级。语义带按声明顺序，播放高亮只换颜色。右键重叠区域列出被覆盖对象。一个作者实体可有不连续的展示区间，联动选中但不合并区间。独立子 lane 与同轨道内部 band 是不同结构。

支持适配全片、缩小、放大、底部窗口控制；带 Ctrl/Meta/Alt 的滚轮绕指针缩放，Shift 或横向滚轮平移，普通竖向滚动轨道。Segment 双击聚焦其范围。空白拖动定位、点击实体选择；实体边缘优先寻找有授权的裁边手柄，中部寻找移动手柄。不能因为有矩形就默认允许编辑。

时间手势由已执行图中准确 Instant/Window 及消费边的授权决定：

| 作者时间形式 | 支持的反向编辑 |
| --- | --- |
| 共享 Selection/Moment | 写 Script 的准确锚点，所有消费者重编译后一起跟随；无逆操作则只读 |
| 直接 `during` 引用 Selection | 移动按不同帧位置构成的语义停靠点推进两端，同步推进停靠点数不保证帧时长不变 |
| `at/for` | 移动事件，并可裁尾端时长 |
| `until/for` | 移动事件，并可裁首端时长 |
| Instant 引用加偏移 | 只改偏移；裸引用视为隐含零偏移 |
| `start/end` | 各裁边改对应表达式，移动按同一个帧差移动两端 |
| 固定/派生且没有支持的逆映射 | 展示事实，但不开放手势 |

改出的钟值和偏移使用当前 ProgramSpace 帧率的帧单位。共享标记不是按屏幕范围、属性名字或运行时 ID 前缀猜出来的。同帧有多个锚点时 Inspector 显示精确锚点身份，只在已声明手柄支持时允许选择另一个同帧锚点。Script 写回保留无关正文、空白与词属性，不以显示出来的词列表重建原文。

### 2.6 各组件编辑器与页面

这些不是十二套独立网页。每个 Companion 把领域值投影为通用实体、材料、轨道和 Inspector 字段；应用统一绘制控件。Where/When/How 是导航域，不是领域功能限制。下表中页名为源系统字段分组名称；实际字段只在端点能够解析时出现，存在引用的地方不是自动替换引用值。

| Companion | 实体与材料呈现 | 属性页与可编辑事实 |
| --- | --- | --- |
| audio-track-studio | 48px 音频 lane，Clip 窗口、源名、波形 | When：Playback（once/once-start/once-end/loop/loop-start/loop-end/stretch 及伸缩最小/最大速率；stretch 两界必填）、Trim（首尾，保留 ms/s/f）、Fade（首尾同单位）；How：Mix，Gain 百分比，范围 0–6400%。Playback 多个作者属性作为一个 record 原子写回 |
| caption-fine-studio | 36px Cue 内容区，编号及真实 CaptionDocument 词文；15px Uses 内部带显示所用 Style；Cue 范围只读，Use 拥有时间授权 | Style 独立参数 Companion。Where：Placement/Region（层次与区域/锚点）、Flow（对齐、行数、换行、方向、行高、间距）；How：Text（字体/大小、kerning、大小写）、Paint（普通/活动字填充、渐变、描边、阴影、长阴影、发光）、Cue Box（底板边框内距圆角/阴影）、Decoration（下划线、活动字框）；When：Cue（前后延展、handoff、整句进出）、Token（karaoke、atom 进出/reveal、活动框过渡/响应/缩放）、Loop（对象、周期、强度）。Uses 的 Style 引用引入拥有者控件，不能把字幕显示文本误当可编辑 Script |
| comment-sticker-studio | 52px 评论贴纸 lane；有头像时加装饰图，正文作内容层；**不是 Comments 评审文件** | Where：Frame（坐标/尺寸，% 或 px）、Layout（层叠、卡片内距/间隙/圆角、尾巴、头像、三段文字布局）；How：Appearance（底色/边框/旋转/阴影、尾巴/头像回退与颜色、各段字重/颜色）、Copy（正文多行、作者、header、meta）；When：Motion（入场、退场、持续摆动） |
| deck-track-studio | 52px 卡片 lane，卡片激活到下一卡片激活或 terminal；标题取 label 文本，卡片引用自己的 appearance，可映射多个渲染部分 | Where：Depth（前后可见张数、wrap、当前及前后位移/缩放/旋转/层次步进）、Frame（层次、clip/radius/padding、fit 与偏移/约束）；How：Appearance（当前及前后透明度/图像调整、边框、阴影、底板；原分组还把 playback/trim 及未来/过去播放放这里）、Label（文本）；When：Motion（reflow、入场、持续、退场）。source/extent 不因能读到就开放修改 |
| film-studio | 识别 Film 的 Composition 输出；准确声明 Timeline 输入和子 Track 的 source 引用及视觉/音频类型 | 是会话边界解释器，不提供 Film 专属属性页，不替代通用项目事实 Inspector |
| media-track-studio | 视觉 76px、音频 48px；Item 和 Sequence 整体占用区间；图重复、视频分镜、音频波形；Sequence 材料预览取首成员；Surface 源不假造文件预览 | 视觉 Where：Placement、Size（Frame 及源 Extent）、Fit、Frame/Geometry/Stacking；How：Image（opacity/blur/brightness/contrast/saturation）、Frame/Paint（边框/阴影/底板）、Audio/Gain；When：Playback、Enter、Sustain、Exit、Boundary（until-boundary start/end）。音频投影仅共有 Audio Gain/Until Boundary Inspector；source-audio 虽声明可写，不因此自动显示控件 |
| performance-studio | 60px 视觉内容区来自 Timeline 放置的视频分镜，15px Uses 带表示演出呈现；内容 Segment/范围只读，Use 的 Window 可按授权调 | Use 选 Style 拥有者的参数 Companion。Where：Frame 及媒体式 Fit/Size/Placement；How：媒体外观/边框等。保留 Timeline 原播放钟，明确排除媒体 appearance 中 playback/trim 字段，不用 Use 改媒体时钟 |
| ranking-studio | column/tier/top-three；80px Board lane 和 40px Reveals/Activations 子 lane；Board 只拥有背景渲染部分，子项拥有自己的部分；音效独立 48px 波形 lane | Board Where：Frame、Layout（板内距、行/列/格间距、图标、领奖台）、Stage、Stacking；How：Board（tier rows、rank/slot 色表、底板/阴影/图标）、Text、Labels；When：Motion（appear/move 时长、easing）。column 子项 Item（label/rank）及 Stacking；tier 子项 Item（tier）、Entrance（direct/drop）、Stacking；top-three 子项 Item（label）、Stacking。音效 How：Sound（appear/move gain），When：Sound（淡入帧数及只读触发事件）。音效时机跟视觉事件，不能拖成独立任意事件；声音参数共享 Style |
| screen-overlay-studio | 52px 覆盖效果 lane，标题按效果种类，Window 血缘决定时间手柄 | Where：Geometry（center/radius、尺寸、min/max size、z）；When：Motion（attack/hold/decay、travel/from/to、motion-rate/drift）；How：Color（单色/色表）和 Effect（强度、不透明度、softness、spacing、thickness、angle、coverage、feather、bars、seed、amount、warmth、scan-lines 等）。方向有 left/right/up/down 选项，chroma 为 monochrome/color |
| script-studio | 解析原始 Script Surface，记录正文/Segment/词/Selection/Moment 源码范围；投影到语义带，按公共身份及 anchors 对应帧 | 无通用 Script 参数页；标记编辑走领域解析器的锚点修改。Segment 选中目前 Inspector 无额外字段，Selection/Moment 显示锚点。缺帧锚点的对象省略，Segment/Word 的可视范围至少一帧；非正长 Selection 不显示 |
| sound-studio | 48px Timeline 原音频波形区和15px Uses 带；内容 Segment/范围只读，Use 的 Window 控制呈现区间 | Style 参数 Companion 在 How/Sound 编辑起始 gain 与 end-gain，0–6400%；默认 gain=1，未显式写 end-gain 时跟随 authored gain。增益在 Use 区间内线性变化。多个 Use 共享同 Style |
| typography-track-studio | 48px 文字 lane，真实富文本抽出纯文本摘要作为内容层；时间来自 Item Window | Where：Layout/Stacking、Area（区域、padding、对齐/换行/overflow/max-lines/minimum-scale/clip、columns/gap）、Point（点锚）、Path（侧、方向、起止 margin、对齐、reverse/overflow）；How：Typography（字体、大小/字重/字形、行高/字距/词距、kerning、语言、方向/writing-mode、baseline/vertical-align、tab/indent、段前后、大小写、CJK/标点/metric-edge）、Paint（fill）。placement/content/motion 是引用事实，不声明独立编辑页 |

通用数值显示须可逆：例如作者 0.78 显示 78%，修改后除以 100 写回；带 `%`/`px` 的长度只保留已有单位并修改幅值，不自动换算物理尺寸。空数值不是零。颜色可用文本/选择器与建议色，选项保留真实标量值与展示标签区别。字体选项只是已有字体的展示与 family 参数，不下载字体、不换掉本地字体文件引用。

list/record 按领域 schema 编辑本地草稿，完整有效并结束编辑后作为一个值提交；缺必填项时显示补全提示，不写半成品。列表可增删及上下排序，遵守数量限制；带区分模式的对象可换模式。数值使用不自旋的文本输入，滚轮滚动不能改源文件；select 使用应用自己的可键盘操作菜单。

### 2.7 编辑究竟写什么

| 操作 | 写入与失败语义 |
| --- | --- |
| Source 编辑 | 480ms 输入防抖自动保存，Cmd/Ctrl+S 立即保存；PUT 当前文件全文与版本。保存后重新编译；**自由源码保存即使编译失败也保留该源码**，以便继续修复，不采用结构化字段的编译回滚规则 |
| Inspector 字段 | POST 字段实体/属性身份、新值与版本，解析准确 `.dvml` 属性或 `.dvs` Recipe 属性范围，用语言序列化器生成替换；校验作者值后写入并编译。编译失败还原原文件并重编译，HTTP 422 |
| Timeline 手势 | POST 实体、手势、目标帧/锚点与版本，沿真实 temporal authority 改 Script 标记、钟表达式或准确参数；与字段调整同样事务和失败回滚 |
| 标记/实体选择、播放、缩放、文件预览 | 不改 Source、Run、Candidate、Result |
| 产物名称 | 写指定 Result Output 的展示名，不改其身份与文件 |
| Comments 操作 | 只改项目评论文件，独立于视频编译 |

服务端只接受项目内且属于已加载源码闭包的文件，不允许任意路径/绝对补丁路径/目录逃逸。范围为 UTF-16 偏移；每次替换核对版本、原始片段、范围界限及补丁不重叠，按逆偏移应用。事务进行中、正在发布编译、待更新版本均拒绝陈旧写入，通常 HTTP 409。同一参数为空操作不制造版本。共享 Frame/Recipe/Style 的修改真实影响所有消费者；没有复制成“当前选中对象专属值”。未作者化的合法默认值第一次修改才在拥有者文件插入属性/Recipe 属性。

一组属性可作为一个 record 修改，只替换声明成员，省略的组成员删除，无关属性、引用、子内容保持；组内已有引用不伪装为可写标量。HTTP 写接口检查 Host 为 localhost/127.0.0.1/[::1]、Origin 同源和 Fetch Site，跨源请求拒绝 403；不能把它当公网协作服务器。

### 2.8 抓帧与静态画面检查

Studio UI 本身没有已实现的“导出当前帧”按钮，也没有自动生成帧序列。评论输入的“捕获当前帧”是捕获**时间**，不存 PNG。现有等价能力在独立 snapshot CLI：

```text
dsivio-video snapshot --studio http://localhost:5179/ --at-frame 0,42,120 --to review/frames
```

另可输入编译后 HTML 文件/URL，或给起始帧、结束排除帧、步长；可加 grid 列×行及 cell，cell 默认 480、至少 32，且要求 grid。帧按原 Program 钟零起算，不能把时间线可见窗口的起点当零；范围必须满足 `0 <= start < end <= frameCount`。

从 Studio 抓帧读取当前编译画面文档，只下载所选帧涉及的 Resource；不带交互播放 shim 和音频。也提供无 shim 的画面 HTML 路由用于查看。原系统交给当前 Runtime 的 render-frames 能力执行一次请求，不创建 Build。输出原分辨率 PNG，以九位补零帧号命名；可输出分页 JPG 网格、原帧号和秒数信息。目标目录已存在即拒绝，先临时生成完整结果，再将整目录发布，失败不留下半套最终目录。

### 2.9 评论数据、并发与 Agent 协作

原系统规范文件是 workspace 根的 `FEEDBACK.json`，第一次保存才创建；缺文件解释为空评论。根对象必须有 `comments` 数组，可保留项目扩展字段。同文件容纳多个 Run，网页仅显示当前 Run。

| 原文件字段 | 规则 |
| --- | --- |
| `id` | 非空字符串；整个文件唯一，编辑保持身份 |
| `run` | 非空字符串；UI 保存当前 Run 的 workspace 相对路径，路径分隔符统一 `/`；编辑不能改所属 Run |
| `at` | 有限、非负秒数，可含小数；校验没有“必须小于片长”的限制 |
| `text` | 非空字符串，允许多行；内容不绑定对象或语义标记 |
| `resolved` | 可省略，省略视为未完成；有值必须 boolean |

列表按时间排序，`#1/#2` 按该 Run 在原数组中的提交顺序产生；过滤、改时间不改编号，删除会收紧编号，`id` 始终稳定。点击正文或时间定位保存的秒数；视频变化后同一时间可能出现另一件事，不能偷偷追随新语义时机。

聚焦输入框暂停画面并捕获当前时间，点时间 chip 可重新取时；写作期间草稿时间固定。Enter 发送/保存，Shift+Enter 或 Alt+Enter 换行，IME 确认不触发发送。可编辑、完成、重开、删除，点外部清选中不丢编辑。表情和绘图按钮目前不工作，不应列为已交付功能。

每次操作重新读磁盘，保留其他 Run 留言与扩展字段。修改/删除携带显示时的整条旧评论，与最新内容深比较；变化则 409，草稿留在浏览器。新增拒绝重复身份。进程内串行保存，用唯一临时文件、保存前再次比较原文件文本、重命名发布。手工 JSON 无效、重复 ID 或字段无效时显示错误，不覆写无效文件。文件系统事件通知浏览器重新读评论，不轮询、不重编译视频。

**Agent 目前没有通知通道。**发送只落盘；用户要求处理评审后，Agent 读取最新文件、按当前 Run 筛选开放项，以 ID 识别而不是显示编号。结合评论文字、保存时间和当时作品判断意图，再修改真正拥有该事实的 Source/Recipe/组件/素材，检查受影响段落和衔接后设 `resolved=true`。写前再读文件，保留数组顺序、扩展字段与他人新留言。评论保留评审对话；已确定创意和进度可另记项目的方向/进度资料，但这不是 Studio 自动执行。

### 2.10 studio-adapter 契约

Adapter 是边界协议，不是 UI 插件执行环境。领域计算不导入 Studio；官方发行选择明确的 Companion 集合，项目 Source 闭包选中的组件可以附带 Companion host facet，应用启动时合成不可变 registry。不扫描 node_modules，不通过 Runtime Profile 再选一套 UI，也不让第三方覆盖官方组件身份。

- **Track 解释器：**按完整版本化输出 Type、模块身份与 Surface 匹配；声明 family、有限 icon/tone、lane 高度、可选内部 band/附属 lane、支撑输出和源端点白名单。可省略领域投影而使用通用终端实体。family 不变 CSS 选择器，组件不得注入任意 DOM/CSS。
- **投影输入：**准确 Track 值、输出与 Candidate 来源、作者元素/子元素及输入引用、渲染 spans、已解析支撑值、执行图的 temporal lineage、语义 Timeline、通用回退方法。支撑值必须是同 Surface 公开输出；引用领域值按准确作者输入与完整 Type 取，不按熟悉数据形状扫描。
- **投影输出：**稳定编辑实体身份、作者身份、半开帧区间、编辑绘制顺序、标题与有序文本/材料层、准确源码范围、可选渲染部分身份、共享选择组、每实体实际参数引用、只读事实、时间血缘及 lane 或 band。材料描述为 Resource 或版本化 Surface，不是 Studio HTTP URL；运输和时码由应用负责。
- **画面选择：**将实际 render parts 映到编辑实体；一项可对应入场、稳定等多个部分。永久可见范围与编辑激活/揭示区间不同，不能为了保持可选而拉长编辑区间。选中不改画面层次。
- **字段双重声明：**源 binding 只说明可达端点/读写权限/嵌套 reference 或 Recipe 路径；Inspector 另选显式字段及导航位置，未选择 binding 不展示。无 edit endpoint 的值只读。控件仅 text/number/boolean/select/color/list/record，完整领域 schema 才是值合法性权威。
- **参数拥有者：**被引用 Style 可提供自己的 parameter Companion，消费方明确引入，再按实际模块/Surface 匹配；多个 Use 共享同一对象，Use 保有自己 Window。没对应参数 Companion 时仅显示消费方声明的事实。
- **Film 解释器：**声明准确 Film 输出类型、时间源属性与类型、子 Track 的来源属性与允许 Track 类型。
- **Script 解释器：**负责观察原始 Surface、投影语义对象，以及锚点调整；Studio 不需认识领域 Narrative 内部表示。
- **时间血缘：**从真正执行的 Track 依赖闭包找 Instant/Window 及直接消费边，按领域公共身份和具体消费输入关联。无匹配只读，一个匹配使用，多个匹配报歧义，不拿帧重合或数组序号猜关系。

## 3. 关键概念与数据形状

以下是供 dsivio-video 实现讨论的**自有命名**，不是原系统类型复刻：

| 自有数据块 | 建议字段与含义 |
| --- | --- |
| 会话 `viewRevision` | `entryRun`、`sourceUnits`、`clock`、`lanes`、`semanticRows`、`pictureDocument`；全部属于同一次编译 |
| 编辑对象 | `editorKey` 稳定 UI 身份；`authorKey` 作者身份；`frameFrom/frameUntil` 半开区间；`paintRank` 编辑层级；`pictureParts` 画面部分；`sourceSlice` 源定位；`parameterOwners` 真正参数拥有者 |
| 源端点 | `fileName` 项目相对路径、`utf16From/utf16Until`、`expectedText`、`authorLanguage`、`canonicalSchema`、`canWrite`；偏移与文本来自同一源码版本 |
| 属性展示 | `fieldKey`、`navigationDomain`、`pageKey`、`sectionKey`、`widgetKind`、`displayScale`、`acceptedSuffixes`、`authorValue`、可选 `writeEndpoint` |
| 时间授权 | `originKind` 区分语义、参数、固定；`originKey`、`boundaryKind`、`consumerPort` 与实际解析区间；用于导出可用手势而非臆测 |
| 编辑请求 | `expectedViewRevision`、`editorKey`、操作类别及新的规范值/目标帧/锚点；服务端重新查权威端点，不接受客户端任意文件补丁 |
| 评论等价设计 | 若保留原文件兼容，遵循上节五字段；若另立协议，可命名 `noteKey/runFile/second/body/done`，必须明确迁移与 Agent 读写约定，不把两种形状混存 |

Run 决定选料与闭包，Timeline 决定完整时间范围，Film 决定合成成员，Companion 决定什么可选与可解释，真实源端点决定什么能改。矩形长度、画面持续可见长度、音频源长度及作者控制区间不能当作同一事实。

## 4. 对 dsivio-video 的建议

### 必须保留

- 明确 `--run`、唯一 Film/Timeline 会话、共编译版本、失败状态和当前画面抓帧；不通过预览暗中生成或收费。
- 共享画面/时间线/源码/属性身份；字段展示与编辑授权分离；确切范围、原文校验、陈旧版本拒绝和结构化修改回滚。
- Comments 的项目文件与 Agent 可读性、多 Run 隔离、稳定 ID、时间不悄悄重定位、外部编辑与冲突保护；发送不应伪称已通知 Agent。
- 浏览器与导出用同一 Composition 画面语义；素材视频静音、AudioTrack 独立负责声音，定位与变速遵循帧/sample 钟。
- 通用的组件呈现契约，保留公开领域投影、有限控件与项目组件扩展能力。

### 可简化

- 将官方 Companion 与对应领域模块 colocate，或集中成 Studio 的内置声明表；保留边界，但不保留十二个重复发布的 `*-studio` 包。项目组件仍可显式贡献自有展示。
- 用 Dsivio 已有任务/媒体接口映射 Tasks 和 Artifacts，避免复制任务队列；插件的 Run/Build/Output 元数据负责作品引用。宿主仅付费生成任务状态与插件 Build 聚合状态需要区分。
- 本地抓帧直接使用统一本地画面渲染路径，不为了截图另设 Runtime Profile/Endpoint 绑定。英语、简体中文与有限主题可内置，额外语言包不必作为首要能力。

### 砍掉

- HypiHub、gateway Provider、插件凭证仓库、S3/Lambda 存储和 Runtime Profile Endpoint 选择；Studio 不持密钥，不讲厂商协议。
- 专门组件 Studio 重复包的发布结构；不是砍组件编辑能力。
- 未实现的表情/绘图占位按钮和“发送即触发 Agent”的暗示。

模型元素使用 `gen:Image`/`gen:Video` 与必填 `model="provider/model-id"`。Studio 应显示计划时来自 `dsivio media models` 的实时能力校验、计划内确切请求和已存 Build 请求；付费执行只经 `dsivio media`。源码改 prompt 或 model 不自动提交生成。宿主目前没有 TTS、speech、matting，Studio 不能以界面操作掩盖这些缺口；已有音频文件与本地 AudioTrack 编辑仍成立。

### 桌面承载方式候选（仅列选项，不作选择）

1. 独立 localhost 网页，由 `dsivio-video studio --run ...` 启动，Dsivio 只提供打开链接入口。
2. Dsivio 内嵌页/WebView，载入插件的本地会话网页。
3. Dsivio 内嵌静态前端，通过宿主受控桥接调用插件会话服务。
4. 同一前端支持独立网页与 Dsivio 内嵌两种入口。

## 5. 依赖与外部程序

原 Studio 服务器使用 Node 文件系统监听、临时文件/重命名、HTTP 中间件和 **Vite 8.2.2**；浏览器使用 iframe、原生媒体解码、动画帧回调、ResizeObserver、Web Audio。关键内部依赖为 Author/Run 编译器、领域包/Producers、ProgramSpace/Timeline/Composition、HyperFrames 编译与材料化、源语言序列化、包激活、Result 仓库及只读运行控制。

没有证据表明普通播放必需调用 ffmpeg；缩略图/波形主要是浏览器呈现。抓帧及网格拼图是独立本地渲染/媒体路径，不是普通播放器的每帧开销。dsivio-video 可依赖宿主捆绑 Node 22.23、ffmpeg、ffprobe；收费生成唯一入口为运行中的 Dsivio 的 `dsivio media`。Vite 与 HyperFrames 等网页依赖是否随插件打包，需要单独确认；不要以 Python/yt-dlp 存在就推定 Studio 会使用它们。

## 6. 待定问题

- 上述桌面承载方式尚未选择；原本的同源 localhost 写保护在 WebView/宿主桥接下如何等价实现，需要按最终入口定协议。
- 评论沿用 `FEEDBACK.json` 五字段还是制定自有版本化格式；如何让 Dsivio Agent 得知新评论，尚无原系统已实现通知机制可照搬。
- 宿主生成任务到插件 Run/Build/Output 的映射、媒体显示名保存位置和 finished Result 分页能力，需对应宿主接口确定，不能拿 `dsivio media status` 当作完整 Build 仓库。
- 本地网页渲染器/抓帧浏览器如何随插件部署；同一机器实际字体、解码器和最终编码一致性仍需后续实测。
- 新组件新增字段时是否保留“显式字段表缺失即 Companion 加载失败”的策略，以及首批开放哪些 Inspector 字段，需要产品决定；本规格不能把领域所有可编译字段都自动变成编辑器。
- 现成音频可预览和编辑，但语义词时序、配音生成与抠像不属于宿主今日能力；应由相关研究确定明确本地替代或暂不可执行边界。

## 7. 来源

以下路径均相对 `/Users/zmmini/zmdata/work/dsivioplugin/`，内容仅用于理解行为，本文件没有复制其实现或类型定义。

- `packages/studio/README.md`、`INSPECTOR.md`、`package.json`、`start.ts`
- `packages/studio/src/{compile,session,execute,programme,server,studio-preflight,feedback,feedback-store,feedback-server,mutation-origin}.ts`
- `packages/studio/src/preview/{render,runtime-shim}.ts`
- `packages/studio/src/ui/{main,code,stage,timeline}.ts`
- `packages/studio-adapter/README.md`、`packages/studio-adapter/src/index.ts`
- `packages/audio-track-studio/src/index.ts`
- `packages/caption-fine-studio/src/{index,activation}.ts`
- `packages/comment-sticker-studio/src/index.ts`
- `packages/deck-track-studio/src/index.ts`
- `packages/film-studio/src/index.ts`
- `packages/media-track-studio/src/index.ts`
- `packages/performance-studio/src/index.ts`
- `packages/ranking-studio/src/index.ts`
- `packages/screen-overlay-studio/src/index.ts`
- `packages/script-studio/src/{index,projection}.ts`
- `packages/sound-studio/src/index.ts`
- `packages/typography-track-studio/src/index.ts`
- `packages/video-cli/src/{cli,snapshot,studio-distribution}.ts`；`index.ts` 中相关导出检索
- `skills/hypit/references/production/studio.md`
- `skills/hypit/references/creation/project-files.md`、`docs/quickstart/preview.md`、`docs/zh/quickstart/preview.md` 的评论相关检索结果
