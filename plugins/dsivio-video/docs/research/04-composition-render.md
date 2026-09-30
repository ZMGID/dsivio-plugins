# 04 — 空间、Composition 与本地渲染行为规格

## 1. 概述

本切片描述从空间布局、终端视觉/音频轨道到影片文件的链路：Canvas/Frame → 各组件的 Track → Film/Composition → HyperFrames HTML → 浏览器逐帧截图 → 无声视频；音频另行在 48 kHz 样本域混合，最后封装为 MP4。Snapshot 复用逐帧渲染器，但只交付 PNG，不先渲染整段视频。

这是基于源码的行为研究，不是实现代码。下文使用 dsivio-video 的文件名和包名，数据形状使用重新设计的字段名；“原行为”表示已读取源码中存在的规则，“建议”表示新插件应作的设计选择。本次没有执行构建、测试、安装或实际影片渲染，不能将源码审阅当作运行证明。Clock 的作者语法不在本篇范围；只描述 Composition 所需的 ProgramSpace 身份及帧/样本边界。

## 2. 行为规格

### 2.1 Canvas、Frame 与内容摆放

**Canvas** 只接受 `id、width、height`，必须为空元素。宽高为正安全整数；坐标原点为左上，x 向右、y 向下，像素为正方形。没有画布背景、帧率或时长属性；这些分别归 Film 外观和 Timeline。Frame 允许浮点位置/尺寸，位置必须有限，宽高严格大于零。

**Frame** 必须提供 `id、within、left、top、right、bottom`。`within` 必须引用 Canvas 或已计算的 Frame，不能引用普通图片。Canvas 先转为原点 `(0,0)`、尺寸等于画布的父矩形。长度语法只接受显式 `px` 或 `%`，可带正负号及小数；裸数字不成立。

设父矩形为 `(X,Y,W,H)`；横向长度换算为 `px→原值，p%→W×p/100`，纵向对应 H。结果为：

- 左上点：`x = X + left；y = Y + top`。
- 尺寸：`w = right − left；h = bottom − top`，其中四个边先在各自轴上换算。
- **right/bottom 是相对父矩形起点的边坐标，不是距右/下边的内边距。** `left=10%、right=90%` 得到 80% 父宽。
- `within` 改变百分比基准，也累加父矩形原点。它不是自动裁剪命令；负位置和越出父框不自动拒绝，只有无穷、零宽高或反向边会失败。

例如在 1000×600 Canvas 内先取 `[10%,20%,90%,80%]`，得到 `(100,120,800,360)`；再在它之内取 `[25%,0%,75%,100%]`，得到 `(300,120,400,360)`。

**AnchoredFrame** 必须提供 `within、x、y、width、height、anchor`，另可提供像素数值 `offset-x/y`，默认 0。九个锚点是上/中/下与左/中/右的组合，其中正中称 `center`。将锚点转换成 `(a,b)∈{0,0.5,1}²` 后：`x = X + 指定x − w×a + offset-x`，y 同理。`AspectFrame` 只能提供 width/height 中恰好一个，另提供 `aspect`，其值为 IntrinsicExtent 引用或正的“宽/高”比例；先推算另一个尺寸，再套同一锚点算法。所有这些元素拒绝未知属性和实际子内容。

**ContentFit** 将内容固有尺寸 `(Iw,Ih)` 摆入 Frame。默认 contain、框和内容双方锚点都为 `(0.5,0.5)`、偏移 0、bounded。比例分别为 contain 取两轴比例最小值，cover 取最大值，fit-width/height 取指定轴比例，native 为 1，scale-down 为 `min(1,contain)`，stretch 独立填满两轴。内容位置为“框原点 + 框尺寸×框锚点 − 内容尺寸×内容锚点 + 像素偏移”。双方锚点必须在 `[0,1]`；bounded 将位置夹在“框起点”和“框终点减内容尺寸”之间，无论内容比框大还是小；free 不夹取。它输出内容矩形，不隐含输出裁剪遮罩。

**两个坐标系不能混淆：** SpatialFrame 的位置是累计后的 Canvas 坐标；Visual IR 子元素的 CSS 位置却相对其父元素。如果组件先算出 Canvas 坐标再嵌入父盒子，必须减去父原点，否则会重复偏移。

### 2.2 ProgramSpace、Composition 与 Film

ProgramSpace 绑定一条影片时间轴：非空身份、正有限时长、正安全整数构成的有理帧率。`时长×帧率` 必须距整数不超过 `1e−7`，总帧数至少为 1。空间布局与该时间轴分别输入，不能在样式中偷偷改变它们。

帧边界转音频样本边界按整数有理运算取最近整数，正半值向上：`boundary(f)=round-half-up(f×48000×fps分母/fps分子)`。区间样本数为 `boundary(end)−boundary(start)`，不要分别对浮点时长取整。允许最后一个边界等于总帧数；实际帧索引不能等于总帧数。

Composition 包含影片身份、画布宽高、底色和视觉/音频 Track 的集合。宽高为正安全整数，底色为六位或八位十六进制颜色。Track 身份在整个 Composition 中唯一，所有 Track 必须绑定同一个 ProgramSpace。

`film:Film` 的作者接口为 `id、canvas、timeline、appearance`；Timeline 可由已有时间上下文解析。子元素只能是带 `source` 引用的 `Track`，至少一个，来源类型只能是 VisualTrack 或 AudioTrack，同一来源不能重复。appearance 必须是作者定义的 `.dvs` Recipe，**且仅有 background 这一项**，不能加入时间和几何。Film 将轨道汇成 Composition，导出 `<id>.composition`。

**层次不是 Track 在 Film 中的书写顺序：** 原实现会规范化、按种类和身份排列 Track；真正绘制时展开所有视觉 Track 的 Present，跨轨道按“绝对层序号、稳定平局键、开始帧、Track 身份、Present 身份”升序绘制，后面的盖在前面。相同绝对层序号与平局键的两个 Present 若主体区间重叠即报错，哪怕它们的细分可见区间不相交。不存在“一个 Track 永远压在另一个 Track 上”的隐式规则。

每个 Present 是一个有生命期的元素树，可另有有序、互不重叠、位于主体区间内的可见子区间。可见性改变不重置动画和视频采样原点。背景在所有视觉下方；视觉元素通过透明度、滤镜、mask、`mix-blend-mode` 与 `isolation` 等样式组合，默认遵守浏览器普通合成。没有 Film 级 blend 属性，也没有音频层的视觉 z。AudioTrack 的 Clip 按采样位置相加；不因书写顺序形成覆盖关系。浏览器中的视频不承担最终影片声音，声音必须进入 AudioTrack。

### 2.3 终端 Visual IR

IR 是版本化的、由组件编译后的视觉语言，不含作者 Recipe 引用。每个 Present 恰好一个根；元素身份不重复，局部排序号是非负安全整数且在该 Present 中唯一。父元素只能是 box/mask/program，必须在同一 Present 内，禁止悬空引用、跨树引用与循环。

| 种类 | 内容与关键规则 |
|---|---|
| box | 布局/样式容器；可拥有子元素。 |
| image | 明确的 image Artifact；无时长，禁止采样映射。 |
| video | 明确的 video Artifact，可附源帧采样映射；默认静音。 |
| surface | 已物化的可合成视觉资源：字节身份、尺寸、alpha、色彩和 still/frames 时间形状必须明确，不能靠扩展名猜测。 |
| text | 原始字符串与非空、有序、精确字体栈；可附字形 Paint，不允许再用原始字体族/字重样式与字体对象冲突。 |
| text-flow | 段落、文字 Run、显式换行；精确字体、排版、Paint、流布局及按单位动画。 |
| path-text | 与 text-flow 共用文档/排版/Paint，另有直线/二次/三次曲线路径、左右侧、跟随/直立方向、边距、反向、对齐与可见/裁剪溢出规则。 |
| mask | alpha 或 luminance 两输入遮罩；恰好拥有声明的遮罩根和内容根。遮罩源必须是一个终端文本、图像或 still Surface，不能是运动视频，也不能另有子树。 |
| program | 声明版本格式、可规范化数据、完整资源依赖，由渲染器解释的本地视觉程序。 |

结构样式是一套封闭的 CSS 形词汇，覆盖盒模型、flex/grid、边框背景、定位、对象适配、变换、滤镜、文字和合成等，不等于开放任意 CSS。重复属性失败；属性值不得嵌入分号/大括号、控制字符或 `!important`，不得使用依赖环境的 `var()/env()/attr()`，也不得用 `url()/image-set()` 偷带资源。资源必须是类型化 Artifact。扩展视觉能力应升级 IR，或通过 program/Surface 表达。额外 HTML 属性只允许 data-/aria-、role、title、lang、dir，拒绝事件处理器和重复属性。

**关键帧：** 偏移以 Present 开始帧为 0，不是影片全局帧。至少两个关键帧，偏移为非负、严格递增的安全整数；每帧至少一个样式声明；允许 linear、ease-in、ease-out、ease-in-out，省略时默认线性。只能动画化 opacity、transform、filter、backdrop-filter、clip-path；宽高/字体等不能伪装成同一层关键帧动画。最后关键帧允许晚于 Present 末端，编译器采用“Present 长度与最后偏移的最大值”为动画长度，末端不足时补最后姿态。元素带显式视频采样时不能同时带元素关键帧，应把运动放在它拥有的外层 box 上。

**视频采样：** 记录源有理帧率、正整数源帧数与一组有序不重叠的目标区间。目标帧相对 Present；区间缺口表示不显示素材。每段给定源起始帧有理位置 s 和“每目标帧前进多少源帧”的非负有理速率 r：目标局部偏移 k 处源位置为 `s+(k−段起点)×r`，最终取其向下整数帧。r=0 是定格，不是暂停外部播放器。可附源帧循环区间和相位，编译时拆分循环段；无循环时首末采样必须在源域内，有循环时区间与起始相位必须有效。原语言不支持负采样速率。frames Surface 无显式采样时，帧率与帧数必须恰好吻合其 Present；有映射时源时钟必须与 Surface 声明一致。

**文本终端能力：** 排版对象包括字距、词距、行高、字重/斜体、变量轴、OpenType 开关、语言/方向、横竖排、基线、缩进、段前后距、大小写、大小写变体、上下标及 CJK 间距/标点处理。Run 可显式覆盖，不改写原文。Paint 按数组顺序生效，支持纯色/线性/径向渐变、填充、内/中/外描边、阴影、发光、背景盒；背景盒可针对帧、内容、段、行、Run、词、字素，分离或连续连接。流布局区分点文本与区域文本、固定/随内容尺寸、对齐、内距、不换行/按词/按字素换行，以及 visible/clip/ellipsis/shrink、多栏和最大行数。序列动画按段/行/Run/词/字素选范围，设开始帧、单元长度、错开帧、循环；随机排序必须由明确 seed 决定，不依赖系统随机状态。

### 2.4 program：HTML/CSS/JS 与确定性边界

浏览器 program 提供 HTML 片段、可选 CSS、setup 函数体及数据。HTML 可用 `{{child-id}}` 将直接拥有的 IR 子元素插入指定位置；未知、重复、未安放的子槽都报错。CSS 被限制在该 program 根的 `@scope` 内。setup 接收根元素和数据，返回同步的“按局部帧重新绘制”函数；没有 setup 时为静态程序。编译器只初始化与当前渲染选区相交的程序。

每次 seek 从绝对影片帧计算局部帧，并将越界姿态夹到 0 或 Present 长度。活动区间内重复请求同一帧仍重新绘制；跨边界时建立对应端点姿态。这是为了让并行分段、乱序 seek、首次从中间帧开始都得到相同结果。

**必须遵守的作者规则：每帧结果是“不可变输入 + 明确帧索引”的函数，不是上一帧状态的累积。** 不能以 Date/墙钟、未固定随机种子、定时器、requestAnimationFrame 步进、网络到达顺序或 worker 编号作为姿态输入。setup 可以建立对象和准备资源，但绘制函数返回 Promise 会报错；异步资源必须在捕获之前准备就绪。CSS 动画从初次绘制起就处于 paused，seek 设置 Animation.currentTime，不让页面载入耗时混入结果。

该规则并不意味着原渲染器把 JS 变成了安全沙箱：它用动态函数执行 setup，源码校验没有证明能阻止 Date、网络、随机数或任意 DOM/CSS 操作。同步约束和错误传播是已实施的检查，所有程序的“无状态确定性”仍是作者/组件合同。新插件不能把任意 HTML 输入宣传为已验证确定性或可信代码。

### 2.5 降低为 HyperFrames 文档及资源准备

编译先校验 Composition 与 ProgramSpace，输出一个包含 IR 版本、精确帧率/帧数、画布、资源清单、Surface 清单和 HTML 的文档。HTML 是完整页面：head 中有重置样式、精确字体的 `@font-face`、暂停关键帧、program 作用域 CSS；body 中只有一个 Composition 根，带尺寸、总时长、精确有理 FPS、明确总帧数。根下有按全局层序排列的绝对定位 Present，包含开始/持续时间及帧索引；共享字形滤镜定义在时间片之外，防止隐藏其他片段破坏引用。附属脚本负责选区、可见性、关键帧、文本布局和 program seek。

作者身份保留在 data 属性中，真正 DOM id 使用稳定的短名称。资源先用内容身份占位（新插件可使用 `dv-resource://<resource-id>`）；img/video 的 src 或 SVG href 先存为延迟启用属性，避免未选片段在页面初始化时抢先读取。运行时物化才替换成本地资源 URL，不改变编译记录身份。文档资源清单必须覆盖所有占位引用；缺失引用是错误。

图片、视频和 Surface 资源带 Present 的保守使用帧区间；字体与 program 显式声明的资源因浏览器需求不可静态精确分析，被标记为全局必需，不按 Present 剔除。同一内容身份若出现不同大小/MIME声明即报错。完整渲染选区统一投影出依赖集合，再为全部 worker 共享准备。资源下载/写入可并发，默认最多 4 个。不应每个 worker 单独遍历并拉取所有影片资源。Snapshot 的 Studio 文档路径同样按目标帧筛选资源；裸 HTML 则解析其中所有资源 URL，没有类型化文档那样的帧依赖证明。

box/text 下沉为 div；image 和 still Surface 为 img；mask 通过 SVG mask/foreignObject 表达；text-flow/path-text 使用终端布局适配；program 插入所拥有子树。定时 video/Surface 的映射先拆成采样运行段，生成相应 video 槽，标记目标帧起止、源起始帧、速率、源 FPS，以及供 HyperFrames 使用的开始秒数/持续秒数/播放速率。**整数帧标记是采样真相，不能从秒数重新猜测它。**

Surface 在资源准备阶段须验证实际字节：大小等于声明；只有一个视觉流，没有音频/附加流；不是 attached picture；实际尺寸相等、方形像素、无显示旋转、逐行扫描；色彩兼容 SDR sRGB。straight alpha 声明必须有实际 alpha，opaque 声明不允许带 alpha；still 恰好解码一帧，frames 的解码帧数和有理帧率须匹配。来源 HDR/任意编码不能直接冒充合格 Surface。

### 2.6 HyperFrames 引擎、Chrome 与逐帧捕获

原本地 Provider 直接依赖 `@hyperframes/engine=0.7.101`、`@hyperframes/producer=0.7.101` 和 `@puppeteer/browsers=3.2.2`，不是调用 HyperFrames CLI。engine 的间接依赖包括 core/parsers，producer 还带 lint/studio-server；这些不是要求新插件加载 HyperFrames 的整套 Studio。Node 要求 ≥22。安装 engine/producer 时设置 `PUPPETEER_SKIP_DOWNLOAD=true`，浏览器由显式准备环节管理。

Chrome 固定选择是 **Chrome Headless Shell 152.0.7928.2**，是四段完整 buildId，不接受 latest/stable 频道。配置只能选择“显式 chromePath”或“精确 browserVersion”之一，不能两者都有，不以环境提示偷偷改浏览器。托管缓存原默认为用户目录 `.cache/hyperframes/chrome`；计算可执行路径使用 `computeExecutablePath`、浏览器种类 CHROMEHEADLESSSHELL。捕获前检查文件、可执行权限及 `--version`，托管版本必须精确相等；渲染过程不自动安装。显式准备通过 browsers.install 下载指定版本，可指定单一归档镜像；发现指定缓存损坏时只卸载/修复该版本，不能清掉其他版本。

一次渲染在可丢弃子进程中运行；父进程包括资源准备和存储在内的默认总截止时间为 30 分钟。过程日志上限默认 4 MiB、待排序 PNG 队列 256 MiB、源帧工作集 1 GiB、最终输出 16 GiB；超时/取消/worker 失败导致整个尝试失败，关闭浏览器/服务器/编码器并清理临时目录。

**实际 API 路径：**

1. 在隔离进程设置 engine 公开的 ffmpeg/ffprobe 路径覆盖；producer 的 `createFileServer` 对已准备项目建立随机端口服务，并在 head 前注入统一渲染选区。
2. 读取所有 video 槽，算目标选区需要的源帧窗；`extractMediaMetadata` 取源尺寸/编码信息。按需 ffmpeg 解码，使用有界 SourceFrameStore，释放后可驱逐；相同源帧由不同槽/worker 复用。
3. `FrameLookupTable` 的活动查询按目标帧算 `floor(源有理位置)`，得到已解码 PNG；`createVideoFrameInjector` 将它们注入对应 video 槽。不是等待浏览器播放到那一刻，也不是每帧盲目修改 currentTime 后碰运气。
4. 每个 worker 调 `createCaptureSession`，参数包括画布、有理 FPS、影片持续时间、已知视频尺寸及跳过 video readiness 的槽身份；配置明确 chromePath/GPU，关闭共享 browser pool，强制 screenshot、不用 drawElement。随后 `initializeSession`。虽然初始化的 format 为 jpeg（借用不透明会话），实际帧捕获是无损 PNG。
5. 对原影片帧 f，执行页面 `__hf.seek(f×fps分母/fps分子)`，再执行会话捕获前 hook，等待 seek 完成、活动 LUT、当前图片 decode 与 CSS/DOM 引起的新图片准备。program 错误必须使捕获失败。shader compositor 若有挂起合成，先做 1px 截图推动 Chrome paint，再 resolve，最后通过 CDP `Page.captureScreenshot` 捕获完整画布 PNG，开启 optimizeForSpeed。
6. 全部 Session 通过 `closeCaptureSession` 关闭。父进程只能接收经过验证的成品，不保留可变浏览器状态作为 Build 成功记录。

源解码用 ffmpeg 的 image2pipe 输出连续 PNG，限制准确帧数。单帧提取在输入之后 seek，多帧窗在输入之前 seek 并限制时长；CFR 用 fps 滤镜，VFR 窗用目标 CFR 输出；VP8/VP9 alpha 显式选 libvpx 系解码器，防止默认解码丢透明度。解码中途少帧/破损 PNG 不能作为已完成资源。

**并行：** workers 可为正整数或 auto，默认 auto。固定值也不能比选中帧数多。auto 的预留上限为 `max(1,min(CPU并行数−2, floor(可用内存/2/1.5GiB)))`，再受 maxWorkers、共享浏览器容量和 `ceil(选中帧数/FPS)` 限制；自动实际初始为预留上限的一半向上取整。影片被切成约一秒的连续批次，worker 动态领取，按全局输出序号进入有界 OrderedFrameSink；完成顺序不能改变编码顺序。自动模式比较有效批次吞吐后逐个增加/退回浏览器，决策只活在本次尝试中，不改变帧姿态；可以在新实现中先用固定策略，但不能牺牲任意分段起点的确定性。

### 2.7 视频编码、音频混合与 mux 验收

**视觉编码形状（文字描述）：** ffmpeg 从 stdin 按原有理 FPS 读取 PNG image2pipe，指定精确帧数且禁用音频，采用 libx264。draft/standard/high 对应 CRF 28/23/18；draft 为 veryfast preset，其余 medium。将浏览器 sRGB 合成结果以 BT.709 矩阵转成电视范围 yuv420p，标记 primaries/transfer/colorspace/range，再用 faststart 写 MP4。最终 MP4 不带 alpha；页面外背景先置不透明黑，Canvas 底色再覆盖其上。

**视觉 ffprobe 门禁：** `-v error、JSON、show_streams、count_frames` 检查恰好一个 H.264 视频流、无音频；实际宽高等于画布；FPS 用整数交叉乘比较而不是浮点近似；解码帧数等于选中范围长度。输出为空、超字节上限、probe JSON 非法、编码形状或帧数不同均失败。Snapshot 不走这一 MP4 门禁，因为没有 MP4 输出。

**音频混合：** 输入 Clip 的资源已经是唯一音轨的 48 kHz、双声道、pcm_s16le WAV，probe 还须证明源样本数等于计划。资源按内容身份去重；同一资源若声明不同样本数则失败。每个 Clip 定义源样本区间、目标样本区间、loop/phase、正播放速度、保音高、增益、淡入淡出，可附全局样本域增益折线及可听区间。

ffmpeg 命令形状为：每份源 WAV 一个输入，filter_complex 中每个 Clip 依次做源区间 atrim、归零时间戳、必要的无限 aloop 和源相位裁剪、atempo 保音高变速、补齐并裁到目标长度、volume、按样本数 afade、逐样本增益/可听掩码，**最后才裁出本次渲染窗口**并以样本单位 adelay 到窗口内目标位置。极端速度拆成多个 `[0.5,2]` 的 atempo，不能改变音高来偷实现。混合用 amix，duration=longest、dropout_transition=0、normalize=0，再 apad/atrim 到准确窗口样本数、重建样本时间戳，输出 48 kHz 双声道 PCM16 WAV。normalize=0 意味着不按轨道数量自动压低声音，峰值管理属于作者增益。

没有任何活动 Clip 时也产出同长度的静音 WAV：lavfi anullsrc，48 kHz stereo，按样本裁切；不是省略音轨。输出 WAV probe 必须证明精确样本数。局部渲染保留循环相位、tempo、淡入淡出和增益包络原时轴，不在选区开头重启声音。

**mux 命令形状：** 输入已经验证的无声 visual.mp4 和 program.wav，显式 map 一个视频流及一个音频流；视频 stream copy，不重编码；音频 AAC、48 kHz、双声道，faststart MP4。没有用 `-shortest` 掩盖时长不匹配。最终 probe 要求恰好一视一音、可接受时间形状、视频帧数不变、音频采样率/声道正确、A/V 呈现起点一致。WAV 是样本精确的；AAC 封装的呈现样本时长允许与计划相差**严格少于 1024 样本**，因为 AAC 帧/priming/edit-list 不能保证任意长度的整数样本往返。更大误差失败，不能扩大成任意“百分比容差”。

### 2.8 render:Video 的合同

作者元素只接受 `id、composition、timeline、start-frame、end-frame-exclusive`，没有子内容。composition 必须为 Composition 引用；timeline 从时间上下文解析。只要任一裁剪属性出现，两者都必须提供，值为非负整数文本，并满足 `0≤start<end≤总帧数`。不提供范围则渲染全片。

编译链路分别建立文档与音频计划，提出“渲染无声视觉”和“渲染音频”的 Need，两者完成后提出 mux Need，再投影最终视频 Artifact，导出 `<id>.video`。视觉和音频可独立运行，但 mux 真正依赖两者。裁剪时浏览器仍 seek 原影片帧，音频仍使用原样本轴，输出成品从零开始，宽高/FPS不变，视频帧数为 end−start。最终作者输出是 `video/mp4` 字节 Artifact，不是 HTML、截图目录或供应商生成任务。

### 2.9 snapshot 命令

新词汇下保留以下形状；原命令的 `--runtime` 选择 Provider/Profile，dsivio-video 不应继续暴露端点绑定 Profile：

```text
dsivio-video snapshot <index.html|HTML-URL> --at-frame 0,24,48 --to <新目录>
dsivio-video snapshot <index.html|HTML-URL> --start-frame 12 --end-frame-exclusive 72 --step-frames 6 --to <新目录>
dsivio-video snapshot --studio <Studio-URL> --at-frame 24 --to <新目录>
可附：--grid 4x3 --cell 480 --workspace <项目> --json
```

- 零基原影片帧；列表必须非空、严格递增、无重复且均小于总帧数。不会悄悄排序或去重。范围右端排除，step 为正整数，默认 1。显式列表与任何范围/step 属性互斥。
- 输入只能为一个 HTML 文件/HTTP(S) URL，或 `--studio` 二选一。HTML 必须是已编译、只有一个 Composition 根、携带明确画布/有理 FPS/总帧数的程序；不能通过 duration 秒数推测帧数，也不是任意网页截图工具。原 HTML 解析依赖编译器固定格式，而非通用浏览器 DOM 解析。
- Studio 模式读取 `/__studio/document` 的结构化文档，并从 `/__studio/material/<资源身份>` 读取选区依赖；不是把 Studio UI 页面本身截成图。裸 HTML 相对文件/URL解析图片、视频、字体与 CSS URL；data: 和片内锚点不拉取，脚本/样式应内联。
- 本地资源扩展名支持 PNG/JPEG/WebP、MP4/WebM、WOFF/WOFF2/TTF/OTF；网络资源须返回对应支持的 Content-Type。网络 HTML 不得读取 file:；非 file/HTTP(S) 协议失败，外链 JS/CSS因非支持资源类型而拒绝。HTML 不能残留未物化资源占位，资源列表须恰好覆盖引用。
- 未知选项、重复带值选项、缺值、非整数索引、已存在输出目录均报错。`--cell` 必须与 grid 同用，至少 32，默认 480；grid 列/行必须为正整数。
- 一个即时 render-frames 请求，无 Build，不触发付费生成。Provider 按请求顺序返回非空 PNG Artifact 列表，数量须恰好相同。原程序钟 f 对应显示秒数 `f/FPS`。
- 每帧写全画布 PNG，文件名 `frame-000000024.png`（九位补零）。可选网格按指定列×行分页，输出 `grid-001.jpg` 等；cell 控制网格图宽，不改变原始 PNG。标签含帧号与六位小数秒数。
- 在目标父目录创建临时输出目录，全部成功后一次重命名为目标目录；失败清理资源/输出临时目录，不交付看似完整的半目录。JSON 输出包含版本标识、输入来源、执行者、每帧的帧号/秒数/路径及网格路径；人读模式给捕获数量、网格数量和目标目录。

### 2.10 开放字体、fallback 与 emoji

原目录是可选安装的固定版本字体依赖，而不是随意读取操作系统字体。Fontsource 静态/变量包固定为 5.3.0，彩色 emoji 使用 `@infolektuell/noto-color-emoji=0.2.0`。请求未安装字体应报准备错误，不能静默换系统字体。Face 必须给 `id、family、weight、style`，为空；静态家族仅允许列出的字重，变量家族要求范围内整数，style 必须在目录支持集合中。字体物化为 WOFF2 字节及 unicode-range、字重、字形风格。

Stack 有一个主字体、按作者順序的 Fallback 子字体，可附 `emoji=color|mono`。emoji 被追加在显式 fallback 之后，固定 400 normal；color 为 COLRv1 Noto Color Emoji，mono 为 Noto Emoji。最终 IR 必须持有非空、无重复的精确字体栈，编译器生成专属字体族名；fallback 次序属于结果语义，不允许由本机字体可用性决定。拉丁紧凑字体一般只取 Latin 文件；CJK、world、emoji 保留完整 unicode-range 分片，多个相同字节分片合并范围但不改变覆盖。

目录家族如下（标识为公共字体名，不是需要复用的实现结构）：

| 分类 | 家族 |
|---|---|
| 手写 | architects-daughter、caveat、coming-soon、handlee、kalam、patrick-hand、permanent-marker、playpen-sans、shadows-into-light、shantell-sans、short-stack |
| 花体 | pacifico、pinyon-script、satisfy |
| 展示 | abril-fatface、alfa-slab-one、anton、archivo-black、bangers、bebas-neue、black-ops-one、bungee、dm-serif-display、fredoka、league-spartan、lilita-one、luckiest-guy、oswald、righteous、unbounded |
| 无衬线 | archivo、barlow、barlow-condensed、cabin、dm-sans、figtree、fira-sans-condensed、geist、instrument-sans、inter、jost、josefin-sans、kanit、lato、lexend、manrope、montserrat、mulish、noto-sans、nunito-sans、onest、open-sans、outfit、plus-jakarta-sans、poppins、quicksand、raleway、rethink-sans、roboto、roboto-condensed、rubik、sora、space-grotesk、urbanist、work-sans |
| 衬线 | bodoni-moda、cinzel、cormorant-garamond、crimson-pro、eb-garamond、fraunces、gloock、instrument-serif、libre-baskerville、lora、merriweather、newsreader、playfair-display、roboto-slab、source-serif-4、vollkorn |
| 等宽 | fira-code、geist-mono、ibm-plex-mono、jetbrains-mono、roboto-mono、space-mono |
| CJK | long-cang、liu-jian-mao-cao、ma-shan-zheng、noto-sans-hk/jp/kr/sc/tc、noto-serif-jp/kr/sc/tc、zcool-kuaile、zcool-qingke-huangyou、zcool-xiaowei |
| 其他文字 | noto-naskh-arabic、noto-sans-arabic/devanagari/hebrew/thai |
| Emoji | noto-color-emoji、noto-emoji |

目录标注多数为 OFL-1.1；coming-soon、permanent-marker、satisfy、luckiest-guy、roboto-slab 标为 Apache-2.0。字体许可与渲染引擎许可不同，应随实际选用文件分别保留许可信息。

### 2.11 Raster 与本地媒体执行的边界

Raster 定义纯数据请求，不在该包内直接执行图片算法；不能把它描述为 HyperFrames 自带修图。输入必须是 image Artifact，操作顺序有意义；至少一项，encode 最多一次且只能放末尾。不指定 encode 默认 PNG；可选 JPEG/WebP。compose 输入 Canvas、明确八位 RGBA 背景和 1～64 个有序层，每层含图片、SpatialFrame、contain/cover/stretch、插值及 `[0,1]` opacity，输出 PNG。

| Raster 操作 | 边界 |
|---|---|
| crop | fraction 的位置/尺寸在单位区间且不能越源边界（容差 1e−9）；pixel 原点非负整数，尺寸 1～65535。 |
| resize | 两轴 1～16384；nearest/linear/cubic/area/lanczos 插值。 |
| rotate/flip | 旋转只为 90/180/270；翻转为水平/垂直/双轴。 |
| denoise | nlm-ycrcb；亮度/色度强度 0～50，template ≤31、search ≤63，均正奇数且 search 更大；饱和恢复 0～4。 |
| color | 曝光 −8～8 stops，对比/饱和 0～4，色温/色调 −1～1，gamma 0.1～10。 |
| sharpen/blur | 锐化 amount 0～5、radius 0.1～20、threshold 0～255；模糊 sigma 0.1～100。 |
| alpha/encode | preserve 禁止背景，flatten 必须背景；quality 1～100，PNG 禁 quality；encode 的背景只对 JPEG 成立。 |

provider-media-local 提供即时本地操作，默认一次请求并发；默认单过程超时 10 分钟、probe 输出上限 256 MiB。它使用 Build 的资源存储、流式准备/存储和 ffmpeg/ffprobe，不接生成厂商。能力包括检查、规范化、顺序裁切/变速、提取音频、提取单帧、静图成片、语音证据音频投影、Timeline 音频和 mux。

- 检查输出实际流/时间/帧样本形状，不把容器时长当成唯一真相。
- 规范化选定流及目标有理 FPS，分别输出同步视觉与音频资源。视觉转 CFR、从零重建 PTS、准确裁帧，物化旋转和非方像素；有 alpha 选 lossless VP9 WebM，无 alpha 选 H.264 MP4。音频按视频公共域重采样到 48 kHz stereo，保留源起点偏差对应的头部静音/裁切，精确 pad/trim。
- 顺序 trim/retime 作用于规范化后的同步媒体；每一步的时间位置相对上一步结果。trim 默认开始 0，结束取明确 end、或当前末端减 tail，必须落在当前时长内且非空；retime 同时改变视频 PTS 和音频 atempo。末端按原 FPS 取最近整数帧（至少一帧），音频补齐/裁到这个帧域对应的 48 kHz 样本数。重新输出 H.264/yuv420p MP4，有源音频才输出 AAC，并验证视频帧数和音频存在性。该输出不是保 alpha Surface，不能把此通道当作透明视觉的无损变换。
- 提取音频按明确 streamIndex 选择源流，归零时间戳并重采样为 48 kHz 双声道 PCM16 WAV，返回经规范音频 probe 的 Artifact；不引入 Narrative/语义 Take/对齐假设。
- 提取帧支持 first、last、源帧索引、秒位置；秒位置取归零后首个时间不早于指定值的帧，输出 PNG 并证明恰好一张图。它不同于 snapshot：没有 Composition、字体或多轨合成。
- 静图成片保持准确 CFR 帧数；多图按计划分段保持，适配首图画框，黑色补边后连接，输出无声视频。
- 语音证据投影是本地媒体转换，不是 TTS。Dsivio 当前无语音生成能力，因此不能把保留该转换误写成支持付费语音模型。

## 3. 关键概念与数据形状

以下是供新实现采用的语义字段，刻意不复用原类型定义：

| 新形状 | 字段含义 |
|---|---|
| SpatialRect | `originPx=[x,y]、extentPx=[w,h]`；Canvas 另固定轴方向/方像素。 |
| ProgramDomain | `axisKey、fpsFraction、totalFrames、totalSamples48k`；保留 Timeline 身份，不复制一套可漂移时钟。 |
| CompositionRecord | `compositionKey、canvasExtent、baseColor、trackSet`；Track 集合顺序不作为 z。 |
| VisualContribution | `contributionKey、axisKey、activeFrames、visibleWindows、layerNumber、stableLayerKey、ownedTree`。 |
| VisualNode | `nodeKey、ownerNodeKey、siblingRank、nodeKind、localStyle、poseKeys、content`；poseKeys 表示帧偏移/缓动/有限属性变化。 |
| VideoMap | `sourceFps、sourceTotal、pieces`；piece 含目标帧窗口、源有理位置、源帧步长及可选循环窗口。 |
| SurfaceDescriptor | `blobIdentity、decodedExtent、alphaConvention、colorConvention、stillOrFrameDomain`；声明须由资源字节验证。 |
| BrowserVisual | `formatTag、markupFragment、scopedStyle、initializerSource、immutableData、declaredBlobs`。 |
| AudioContribution | `clipKey、sourceBlob、sourceSamples、targetSamples、loopPhase、tempo、gain、fadeSamples、sampleGainCurve、audibleWindows`。 |
| RenderDocument | `visualVersion、domain、canvasExtent、resourceUsage、surfaceProofs、htmlText`；临时 URL 不进入内容身份。 |
| SilentVisual / MixedAudio | 前者为视频 Artifact+准确帧域/尺寸，后者为 WAV Artifact+准确样本数。 |
| FinalVideo | MP4 Artifact+帧域/尺寸+计划呈现样本数；作者 render 输出投影为 Artifact。 |
| FrameCaptureRequest | 结构化文档或已物化 HTML 项目二选一、严格递增原帧列表；结果 PNG 与列表位置一一对应。 |

Run/Target/Candidate/Build/Need/Output 在此只承担执行和持久化接口，不应把 Chrome session、解码缓存、临时文件 URL或自适应 worker 历史存成可复用 Build 成果。

## 4. 对 dsivio-video 的建议

### 必须保留

1. Canvas/Frame 精确数学、within 的父基准、终端树父坐标；空间与 Timeline 解耦。
2. 跨 Track 的 Present 绝对层序、显式 blend/mask、视觉与音频分别渲染。不能以 Film 子元素顺序代替终端 z 合同。
3. 精确字体字节、完整 CJK/emoji fallback；帧偏移关键帧、精确视频源帧映射；任意起点/重复/乱序 seek 的无状态要求。
4. 编译后资源清单、按选区准备依赖、每帧 seek 后 readiness、无声 H.264 → 48 kHz WAV → AAC mux 与 probe 门禁。
5. render:Video 的半开原帧选区和 snapshot 的原帧 PNG/网格输出，局部音频保持原相位。

### 可简化

- 本地 renderer 可以成为插件内部任务，不必保留独立 Endpoint 包、Profile 路由、可选云实现或通用 pool 产品模型；但宿主内多个渲染仍应受共享 Chrome/内存容量限制。
- 自适应 worker 算法可用固定、受限并行替换；先保留源帧共享工作集、有界乱序输出和可靠取消。
- 字体目录可以在首发选择较小的明确随包集合，但应保留精确 Face/Stack 格式和后续扩展入口；不得静默改用“系统 sans-serif”。
- Node 22.23 已可直接执行 TypeScript，新实现不因原子进程启动方式额外强制 tsx；Chrome 和 ffmpeg仍是显式外部依赖。

### 砍掉及宿主映射

砍掉 Runtime Profile 的 endpoint bindings、远端 Lambda/S3执行/存储、凭据、所有付费生成网关与组件重复 Studio 包。本地布局、图片处理、浏览器渲染、音频混合不调用付费生成接口，也不要求 app 有厂商密钥。

需要生成新素材的作者元素统一为 `gen:Image/gen:Video`，必须明确 `model="provider/model-id"`，计划时用 `dsivio media models` 的实时 capabilities 校验并固定请求；Build 存计划所展示的精确请求，真正生成只走 `dsivio media`。本篇 renderer 接收其已完成资源，不重提生成、不直连厂商，也不将 generation 的 uncertain 状态“重试成成功”。无 TTS、speech generation、matting能力，不能靠原本地媒体工具补成未存在的宿主付费接口。

## 5. 依赖与外部程序

- Node ≥22；Dsivio 的 Node 22.23 满足引擎约束。
- `@hyperframes/engine 0.7.101`、`@hyperframes/producer 0.7.101`、`@puppeteer/browsers 3.2.2`、Chrome Headless Shell 152.0.7928.2：这些是本次读取原 Provider 的固定组合，不是声称新版仍相同。
- Dsivio 已打包 ffmpeg/ffprobe，须包含 libx264、AAC、PNG、PCM16、所需滤镜及保 alpha 的 VP8/VP9解码/编码能力；不能仅凭程序存在认定功能齐全。
- Snapshot 网格原使用 sharp 生成标签和合成 JPEG；这是插件额外依赖，不是题设已打包二进制。字体文件按 Fontsource 5.3.0/彩色 emoji 0.2.0固定；Raster 真正执行器需另选，不由 raster 数据包实现。

**HyperFrames 许可证已核验：** 同版本 [hyperframes@0.7.101 的 npm 元数据](https://registry.npmjs.org/hyperframes/0.7.101) 明确含 `license: Apache-2.0`，并给 release gitHead `2a98b41edfc793af6113226f6de962e287de4613`；[该固定提交的仓库 LICENSE](https://raw.githubusercontent.com/heygen-com/hyperframes/2a98b41edfc793af6113226f6de962e287de4613/LICENSE) 是标准 Apache License 2.0，版权人为 HeyGen。需准确区分：[engine 0.7.101](https://registry.npmjs.org/@hyperframes%2fengine/0.7.101) 与 [producer 0.7.101](https://registry.npmjs.org/@hyperframes%2fproducer/0.7.101) 的 npm 元数据**没有 license 字段**，不能伪称在这两个字段上直接查到了 Apache；它们元数据指向同一上游仓库，结合固定发行的许可证证明 HyperFrames 项目 Apache-2.0。此结论不把 hypit 的修改版许可证转换成可复用许可，仍须清洁实现其适配层，不能复制 hypit 源码或生成 HTML 模板。

## 6. 待定问题

1. Chrome Headless Shell 随安装准备还是与插件一起打包？保留精确版本与显式错误，不允许渲染期间暗中联网下载；需确认该固定版本在 Dsivio 各目标平台可用。
2. program 来源是否限定为插件官方组件，还是允许用户导入任意 HTML/JS？当前研究到的执行器不是沙箱；若开放导入，安全策略与确定性验收必须另设计，不能声称沿用原同步检查就足够。
3. 宿主内多个视频任务如何共同约束 Chrome、解码内存和 ffmpeg进程？宿主生成队列已存在，但本地渲染容量不等同于付费生成队列。
4. 首发字体全集/按需组件包的分发大小，及缺字时是否主动诊断？精确栈是合同，但读取的校验不等于证明每个作者字符串均有字形覆盖。
5. 原编码固定 yuv420p，Composition 校验却不要求偶数宽高；奇数画布可能到 libx264 才失败。新实现需明确计划期拒绝还是明确可见的输出适配，不能无声改变画布尺寸。
6. Raster 执行器与 OpenCV/Python依赖是否纳入首发？题设提供 Python，不代表已提供 NumPy/OpenCV。该数据模型和能力枚举可以保留，但未选定执行器不能对用户宣称全部图像操作已可用。

## 7. 来源

以下本地路径均相对于 `/Users/zmmini/zmdata/work/dsivioplugin/`，已阅读相关声明或实现区段；没有复制代码/类型定义/原说明句子：

- `packages/spatial/src/{geometry.ts,author.ts,surface.ts,fragment.ts}`。
- `packages/program-space/src/index.ts`（ProgramSpace及边界换算，非 Clock 作者部分）。
- `packages/composition/src/{index.ts,track.ts}`；`packages/visual-ir/src/{index.ts,style.ts}`。
- `packages/film/src/{recipe.ts,program.ts,component.ts,surface.ts}`。
- `packages/hyperframes/src/{document.ts,browser-program.ts,html-project.ts}`。
- `packages/render-hyperframes/src/{surface.ts,fragment.ts,product.ts}`。
- `packages/provider-hyperframes-local/package.json`；`packages/provider-hyperframes-local/src/{render.ts,capture.ts,capture-worker.ts,opaque-capture.ts,sampling.ts,browser.ts,browser-install.ts,concurrency.ts,output.ts,source-frame-decoder.ts,provider.ts}`。
- `packages/provider-media-local/src/provider.ts`；`packages/media-execution/src/{execute.ts,audio-presentation.ts,surface.ts}`。
- `packages/raster/src/{types.ts,program.ts}`。
- `packages/fonts-open/package.json`；`packages/fonts-open/src/{catalog.ts,surface.ts}`。
- `packages/video-cli/src/{snapshot.ts,cli.ts,index.ts,frame-grid.ts}`（后三项通过定位搜索读取对应结果）。
- 外部核验：本篇第 5 节所链接的三个 npm 0.7.101版本元数据、固定 release LICENSE；另核对上游 [engine package.json](https://raw.githubusercontent.com/heygen-com/hyperframes/main/packages/engine/package.json)、[producer package.json](https://raw.githubusercontent.com/heygen-com/hyperframes/main/packages/producer/package.json)、[根 package.json](https://raw.githubusercontent.com/heygen-com/hyperframes/main/package.json) 和 [main LICENSE](https://raw.githubusercontent.com/heygen-com/hyperframes/main/LICENSE)。main 已是 0.8.97，不用于推断原固定组合的 API/版本。
