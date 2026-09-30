# Skill、参考知识库与示例工程研究

## 1. 概述

这一层的产品不是一份命令速查表，而是一套让 Agent 承担导演、制片和交付责任的工作协议。入口接受参考视频、创作要求、照片、产品资料或已有工程，最终交付应包含符合用户目标的视听作品及可继续编辑的制作工程；只写脚本、只列镜头或只成功执行构建均不足以完成委托。

研究范围内，主 Skill 为 321 行；`references/` 有 **64 篇 Markdown 与 7 个配套非 Markdown 文件**；公开文档有 **46 篇 Markdown**，即英文与中文各 23 篇；`examples/` 有 7 个顶层示例目录，另有榜单子工程与多个独立变体。长度按源文件物理行计，表中的约数用于估计阅读负担，不代表知识重要性。本文仅记录静态阅读结果，未执行生成、构建、测试、安装或下载。文中的新命名数据形状及目录方案属于 dsivio-video 建议，不宣称已经实现。

`.claude/skills/hypit` 与 `.codex/skills/hypit` 都是指向同一个 `skills/hypit` 的符号链接，不是两个另有规则的 Skill。入口之间应共用一份权威正文，避免更新后分叉。旁边的 `agents/openai.yaml` 另提供界面显示名称、短介绍和默认启动提示，不参与制作图或执行状态。

## 2. 行为规格

### 2.1 主 Skill 的结构及触发方式

源文件 frontmatter 只有 `name` 与 `description`。名称是短工具标识；描述以行动和工作目标为核心，覆盖制作视频、生成或编写素材、采用 Brief/参考/用户素材、作者语言与执行准备。它不是品牌口号，也不把触发条件写成几十个同义关键词。正文顺序是：身份与沟通方式 → 内容组织原则 → 素材导演 → 按需准备 → 理解与改编 → 编排与精修 → 常驻责任 → 问题到文档的路由。

| 部分 | 应具备的行为 | 不应误解为 |
|---|---|---|
| 导演与制片身份 | 理解委托，形成可解释的创意答案；对表演、画面、语言、声音和观众体验共同负责 | 只负责调用视频模型 |
| 创作组织 | 用随时间变化的对象、状态和关系认识作品；一个 Timeline 和一个画布，按共同布局/运动决定组件边界 | 每个镜头一个组件，或先固定轨道再塞内容 |
| 素材导演 | 提示词描述生成素材能实现的事；精确图文、几何和后期事件交给组件 | 把后期界面布局全部要求模型画进素材 |
| 环境准备 | 从眼前需要的能力出发，分清已安装、已选择、已准备、正在运行；准备不依赖的工作可并行进行 | 每次先安装所有工具或全量检查所有服务 |
| 理解参考 | 先通看，再以转录与时间关联帧序列解释细节，反过来修正整体理解 | 抽几个帧、给动效起名字就算完成分析 |
| 编排精修 | 利用已接受素材完成语义事件、空间层级、字幕可读性和视听交接；及时展示真实片段 | 在素材未到时根据占位图宣布完成 |
| 持续沟通 | 用用户语言说明具体发现、其创作意义、正在运行的工作及真正的选择 | 只报命令日志或重复“处理中” |
| 知识路由 | 当前问题命中几个职责，就读取几个文档，必要时反复返回 | 按固定阶段把全部参考文档通读一遍 |

persona 有明显的创作倾向：主动制作委托所需素材，偏好有吸引力、可辨认态度和表现力的人物，但也认可用户提供素材、纯 A-roll、无声动画和纯代码影片。源文将温暖、幽默、克制或荒诞视为应随作品变化的气质，不把一种网感固化为所有作品的模板。

### 2.2 工作门禁与长期责任

以下是跨阶段约束，实际任务可往返各阶段，不能机械套用流水线。

1. **先确认作品边界。** 当前请求、用户提供路径、工程笔记和显式依赖界定本次作品。工具安装目录不等于项目目录；附近另一个成功视频也不自动成为本次交付。保护无关 Source、Recipe、Run、资产和项目包。
2. **用户目标与导演答案分离。** Brief 记录目标、真实产品事实、必须准确的声明、限制、替换要求、账号与费用许可；Treatment 记录创意设计。正式台词只有 Source 内 Script 一份，不能在多个笔记里维护完整副本。改目标更新 Brief，改故事/镜头逻辑更新 Treatment，改字词/角色/语义锚更新 Script。
3. **先读导演知识再写提示词。** 图像提示词前读取图像导演页及所选 Kit；视频提示词、Action 或表演 Recipe 前读取视频导演页及所选 Kit；换声音前读取声音导演页。继承提示词也需检验其假设，不能因为“已有”就跳过。一般提示词能力不替代特定模型的经验知识。
4. **有参考就真实观察。** 完整观看；有语音时结合词级时间与画面；区分观察事实、解释和未知。分析必须说明对象内容、出现位置、进入、变化、持续与离开，以及对观众的作用。源片秒数定位证据，目标片用自己的词和表演重新定位，不照搬源秒数。
5. **花钱前取得委托范围许可。** 明确付款账号、付费工作和可接受费用/预算，并记录在 Brief。登录或拥有额度只说明可访问，不说明获准消费。授权可覆盖多次命令与 Build；超出工作、金额或账号需重新决策。早期付费转录也必须被覆盖，不因还没有 Run 而例外。缺价格资料就保留不确定性，不编造精确总价。
6. **复用必须显式。** 修字幕、布局和 MG 通常保留媒体及语义 Take；改某些 B-roll 保留其余；改台词则重新判断对应表演与对齐。Run 的 Candidate 才是复用选择，Progress 笔记不是可执行复用。失败 Build 中已完成的 Output 仍可使用；只因找不到导出 MP4，不能判断素材丢失。
7. **观察器和执行分离。** 关闭跟随终端或等待超时不等于取消 Build。应查已知 Build 的实际状态；未拿到编号时用 Run、Source、提交时间与 Results 识别已有提交。失败后保留证据和可用 Output，在新的 Run/Build 中完成剩余工作，而不是改写旧尝试。
8. **文件承担跨会话记忆。** 整体理解写 Analysis；定时细节与意义写参考 Timeline；要求写 Brief；创意写 Treatment；Progress 只保存当前问题、下一行动、阻碍、活跃 Build 与复用入口。它们记录当前事实而不是无限追加日志。恢复时先读这些文件，再看 Sources、Runs、Results 与真实执行状态。
9. **完成以实际视听验收为准。** 观看并聆听实际所选作品，判断表演、声音、清晰度、视觉优先级、时机、风格和发布适宜性。浏览器预览可以在编码前确认编排；交付编码文件时还必须检查该文件。用户可访问 Studio 时同时提供可编辑作品。不可用的服务导致只实现部分目标时，明确缺口并继续追求委托结果，不能将局部样品叫成片。
10. **问题在其所有者处修。** 错素材选择修 Run，错语义修 Script，错视觉参数修 Source/Recipe，能力缺失修项目组件。不能用旧最终渲染 Output 满足已修改的 Track，掩盖编辑；也不为单个作品直接改框架或已安装发行包。

源系统的秘密规则是凭据值只留在 Credential Store，Profile 只保存引用，由专用授权命令管理。dsivio-video 保留“不暴露秘密”原则，但删除插件端凭据存储、登录、Provider 槽位与 Endpoint 路由，详见第 4 节。

### 2.3 全部参考文档索引

下面路径均相对于 `skills/hypit/references/`。每行的“何时读”就是主 Skill 路由或该文开头/内容所界定的阅读触发；配套示例只在理解其对应职责时读，不是所有任务的必读材料。

#### 环境与创作：9 篇

| 路径 | 主题与用途 | 何时读 | 关键规则/检查点（转述） | 约行数 |
|---|---|---|---|---:|
| `environment/distribution.md` | 工具定位、安装、更新和资源复用 | 找不到命令、更新或继续旧工程 | Skill/可执行程序/项目生命周期分开；先找到实际启动器；只更新相关安装；保护锁文件、缓存和已产出素材 | 176 |
| `environment/model-and-provider.md` | 能力选择、服务接入及项目扩展 | 需要生成能力、带来 API 或服务无法满足需求 | 能力决定路线；账号与大规模准备需用户选择；不能由单个认证错误推断换账号；映射全部媒体角色并保存异步回执 | 291 |
| `environment/profile.md` | 执行配置、凭据引用、容量与配置生效 | 选执行环境或修改资源限制 | 多个未绑定实现是歧义而非顺序回退；配置/执行目录分开；秘密不进入配置；新 Build 与旧进程采用配置的时机不同 | 286 |
| `environment/local-tools.md` | 本地二进制、浏览器、语音资源与辅助服务 | 准备/修复本地能力，处理下载或启动 | 准备和运行分离；健康服务不证明语言资源齐全；按真实下载主机诊断；镜像、缓存、代理不同；不悄悄换浏览器 | 410 |
| `creation/brief.md` | 用户约束与导演方案的权威划分 | 定义作品或修订目标 | 准确保留用户要求；不把参考的偶然选择升级成要求；正式 Script 只一份；变更在事实所有者处记录 | 93 |
| `creation/project-files.md` | 项目边界、文件职责、恢复及交接 | 开始、恢复、整理或交接工程 | cwd/最近项目清单决定工程；源内路径相对声明文件；参考事实与目标设计分开；交接包含所选 Result 资源 | 232 |
| `creation/reference-video.md` | 参考片的整体及精细语义阅读 | 视频或链接作为证据 | 先看完整作品；用词时序与可变尺度帧网格查关系；记录系统状态、转换、功能与证据；事实与解释分开 | 244 |
| `creation/script-and-time.md` | 台词、发音、段落、测时与语义关系 | 决定说什么、怎么说、哪些事件随话语变化 | Script 不含模型/样式/秒数；显示与发音可分；测目标文本再选时长；无声动画允许独立时钟 | 253 |
| `creation/transformations.md` | 把人物、产品或世界改编到新目标 | 换人、换产品、多参考或改故事 | 替换角色的所有真实表现；重建事件的作用，不只换像素；依赖图浅而有用；生成不足先改负责的导演关系 | 141 |

#### 制作系统：33 篇

| 路径 | 主题与用途 | 何时读 | 关键规则/检查点（转述） | 约行数 |
|---|---|---|---|---:|
| `production/index.md` | 按表达、准备、呈现、扩展、交付分组导航 | 不知道制作问题由谁负责 | 分组不是必经阶段；表演主导工作通常保留 Script→语义 Take→Timeline；资产编辑可直接交付资产 | 73 |
| `production/system.md` | 素材、意义、时间、空间及执行的关系 | 理解整体模型 | 一条完整 Timeline 与一个画布；语义不必填满时间；组件不必铺满画布；已有内容与独立内容分开 | 169 |
| `production/component-design.md` | 视觉职责、边界与可编辑输入 | 新视觉系统实现之前 | 按共同行为成组件；职责/参数化/复用是三个决定；只暴露真实创作选择，固定设计的一次性场景合法 | 217 |
| `production/authoring.md` | Treatment 到 Source/Recipe/Run 的落地 | 编写、修改或复用制作 | Source 表达作品，Run 表达本次执行；选正确复用层；不要用旧下游输出遮住变化；编辑前掌握相关现状 | 228 |
| `production/source-syntax.md` | 导入、引用、字面量、Recipe 与 Run 语法 | 写源文件或解决引用问题 | 文件头选择解析器；后缀是约定；图输出引用不同于普通文本/Recipe 属性；职责不混入 Script | 163 |
| `production/script-syntax.md` | Segment、Role、显示/发音、Cue 和语义标记 | 写或修正 Script | 当前语法与逻辑 ABI 分开；不把旧形式猜成新形式；保留空格；标记不能切开不可分的语音单元 | 236 |
| `production/timing.md` | Instant/Window、偏移与编辑含义 | 组件放时或 Studio 移动时间 | 事件和覆盖分别按 Moment/Selection；时钟表达独立节奏；移动共享锚与修改局部偏移含义不同 | 96 |
| `production/prompt-kits.md` | 可复用提示文本及其参数 | 选、组装或编写 Kit | Kit 是纯数据文本模板，不拥有模型、服务、参考素材和输出大小；保留有价值措辞而不是拆碎每句话 | 161 |
| `production/runs.md` | Target、Candidate、替代和 Run Fragment | 决定本次产物或复用什么 | 依赖选择决定剩余工作；保留无关 Candidate；替代可供值或计算；复用绑定准确公开 Output | 151 |
| `production/media.md` | 输入接纳、流选择、归一化、语义 Take 与处理分支 | 接文件、生成媒体或处理片段 | 来源事实/字节加工/呈现分开；按用途准备；空段落采用媒体边界；原始与处理后媒体都显式保留 | 246 |
| `production/media-presentation.md` | 独立图片、视频及表面的播放 | 显式提供画面内容 | 展示窗口不同于源播放；替换与叠层有明确关系；有视频不自动送音频；Timeline 内画面用 Performance | 111 |
| `production/audio-presentation.md` | 独立音乐、旁白、环境及效果音 | 声音不是已放置 Take 的声音 | 明确选择播放方式和混音；变速有界且保音高；若旁白承载 Script，优先建立音频语义 Take | 49 |
| `production/video-downloads.md` | yt-dlp 保存网页视频 | 参考/素材在平台链接上 | 新输出路径；下载与工具准备分开；不在下载命令中自动更新；先保存真实文件再分析/接入 | 47 |
| `production/browser-capture.md` | 网页截图、交互录屏、本地 HTML | 界面要成为素材 | 交互脚本表达真实动作；输出须新路径；命令报告尺寸与时长；缺浏览器就报准备要求，不隐式安装 | 112 |
| `production/image-operations.md` | 静态合成、校正、裁剪和抠图 | 图像作为参考或 Track 前需加工 | 加工产出普通图像；需独立运动的层留给影片组件；单帧抠图不等于视频抠像；可复现加工入图 | 102 |
| `production/spatial.md` | Canvas、Frame、坐标、fit、裁剪及区域映射 | 放置或适配素材/组件 | 目标几何不同于源拍摄；时间和空间独立；移动外框与移动内容不同；测量框须走实际裁剪/放置链 | 189 |
| `production/fonts-and-text.md` | 字体、字形回退、多语言、Emoji、独立文字 | 找字体或放标题/标签 | 精确字重/样式需确实存在；字体资源、Style、文字内容分别拥有；Emoji 与字幕角色不同 | 138 |
| `production/vocabulary.md` | 查询组件能力与扩展作者词汇 | 选 Surface 或决定写项目组件 | 从内容角色搜，不按外观名字猜；查安装版本的接口；媒体参考是类型化输入；单片新能力留在项目 | 119 |
| `production/component-sharing.md` | 跨项目分享组件及数据包 | 另一人/工程需要包 | npm/私库/压缩包使用同一所有者包；携带公开依赖及资源；纯数据仍是数据；官方收录另有决策 | 150 |
| `production/timeline.md` | Take 放置、空白、重叠与全长 | 拼表演或建立纯 MG 时间 | 所有 Take 落在同一精确帧时钟；语义只在提供处存在；无语音可零 Take；源片秒数不成为目标语义 | 74 |
| `production/tracks.md` | 选择并组合视听贡献 | 不清楚内容应走哪个组件 | 按内容归属选 Performance/Media/Sound/Audio/Caption；共享行为可以成场景；Film 显式装配贡献 | 67 |
| `production/performance.md` | Timeline 已有画面的视觉呈现 | 重构 A-roll、改画面尺寸/视窗 | 保持原源位置与播放；全局 Style 加局部 Use；音频-only Take 没有可供画面；身份或尺寸不是路径判据 | 114 |
| `production/sound.md` | Timeline 已有声音的呈现 | 增益、淡化、静音和原声混合 | 不改变台词和 Take 位置；出入源角色显式指定；窗口端点不能猜出交叉淡化的声音角色 | 75 |
| `production/caption-presentation.md` | 字幕 Style 的角色/片段覆盖与隐藏 | 改某句字幕外观或临时隐藏 | Script 决定文字分组，Use 决定时间呈现；可在 Cue 内换 Style；隐藏不删除语义 | 66 |
| `production/track-authoring.md` | 新 Track 的接口、状态和实现 | 现成行为不能表达作品 | 语义选择、投影、消费分开；生命周期与触发后持久状态分开；状态应支持直接寻帧；不窥探同伴私有状态 | 215 |
| `production/component-visuals.md` | 组件元素、资源和帧驱动绘制 | 实现渲染输出 | 消费已解析窗口/几何/字体；显式资产；外部像素可组合；视频与图形可在同一浏览器程序协作 | 152 |
| `production/caption-authoring.md` | 新字幕族的调度、布局和渲染 | 现有字幕族不能实现词语关系 | 沿用原文字/对齐链；保留显示分隔符，不自行空格拼词；独立决定可见调度，不改语义时间 | 156 |
| `production/builds.md` | plan、计费授权、Build、失败和 Results | 提交、跟随、恢复、查产物 | plan 不执行；费率不是许可；每次 build 新尝试；终端断开不取消；失败 Output 可显式复用；保留回执证据 | 327 |
| `production/studio.md` | 编辑工作、Comments、反馈和交付 | 打开真实 Run 或与用户看作品 | 用实际所选素材；Comments 留时间反馈；支持编辑回写源；预览与导出分开；完成作品同时提供可编辑入口 | 249 |
| `production/studio-companions.md` | 编辑器实体、选中、控件与时序血缘 | 为项目组件添加 Studio 支持 | 编辑项必须对应作者事实；图上对象和时间线实体一致；识别与可编辑不同；不要把内部实现常数全部暴露 | 186 |
| `production/rendering.md` | Film 装配、Composition 和范围编码 | 全片/区间渲染、纯动画交付 | 显式图像和音频贡献；范围用明确帧界；整体及分段用同一 Composition；缺浏览器先准备 | 141 |
| `production/snapshots.md` | 当前作品单帧或分页帧网格 | 查布局、状态、连续运动 | 优先拍当前 Studio 或已有 HTML，不创建新渲染 Build；单帧看细节，连续帧看交接；音频另以播放验证 | 90 |
| `production/review.md` | 创意验收、证据选择与修复 | 看预览/成片，决定改什么 | 语法合法、生成成功、符合 Treatment 是不同事实；看前/中/后状态；按功能比较参考；修后看受影响片段再看整体 | 174 |

#### Playbooks：22 篇

| 路径 | 主题与用途 | 何时读 | 关键规则/检查点（转述） | 约行数 |
|---|---|---|---|---:|
| `playbooks/index.md` | Format/Craft 两个尺度的路由 | 当前问题超出基础创作/制作知识 | Format 可组合而非声明类型；Craft 解决局部导演问题；准确接口继续读组件文档 | 75 |
| `playbooks/craft/image-direction.md` | 生成图像的人物、场景、机位与参考 | 每次写/改图像提示词前 | 手机人像按拍摄/人物/镜头/环境分工；用少量高价值选角锚；完整世界而非空背景；参考分别提供其视觉事实 | 95 |
| `playbooks/craft/examples/image-direction.md` | 六组完整人像导演案例及结果 | 与图像导演和所选 Kit 一起理解力度 | 各案例不是通用人物模板；画幅/分辨率属请求参数；理解措辞的经验范围，不能保证所有模型复现 | 123 |
| `playbooks/craft/examples/conversation-images.md` | 播客/街访的相关视角、持物及生活图 | 构建多人场景或连续产品身份 | 从有用第一视图派生另一机位；同一人/产品各有参考；生活图直接分支；不强制串接视频尾帧 | 218 |
| `playbooks/craft/video-direction.md` | 视频表演、动作、参考片段、镜头与时长 | 每次写/改视频 prompt、Action、Recipe 前 | 动态参考承载静帧没有的行为；动作有表现目的；输入各司其职；时长按台词/动作需求而非参考秒数 | 302 |
| `playbooks/craft/voice-direction.md` | 声音选角和描述 | 选、设计、修改人物声音前 | 声音体现人物和对听众态度；压成鲜明导演意见；样本传达身份，而不是任意文本朗读 | 99 |
| `playbooks/craft/voice-and-performance.md` | A-roll、固定声线、覆盖与独立旁白 | 判断谁承载段落或旁白来源 | 表演角色独立于可见画面；被 B-roll 遮挡仍是 A-roll；复用接受声线；相邻 Take 保留实际时间 | 224 |
| `playbooks/craft/b-roll.md` | 以素材回答话语或主导画面 | 选择静图/视频的编辑用途 | 一一对应与整段蒙太奇是不同关系；进入/离开按思想、动作或音乐；视觉覆盖不改变话语来源 | 94 |
| `playbooks/craft/screen-demonstrations.md` | 界面证据、动作与说明性设计 | 网站/终端/编辑器成为作品内容 | 真实状态、真实操作、作者示意分清；不将说明性插画冒充实测；镜头让观众看清行动及后果 | 51 |
| `playbooks/craft/captions.md` | 分组节奏、多语言、强调与布局 | 导演字幕、溢出或可读性问题 | 当下说话显示才是字幕；中文按字高亮但按意群阅读；布局不改文字；结合实际字形和声音检查 | 252 |
| `playbooks/craft/caption-tracking.md` | 随头部移动的字幕 | 参考确有该效果或用户明确要求 | 有脸不自动检测；角色/空间/时间都须对上；跨切镜不插值；null 可隐藏；检查新素材的实际头部位置 | 125 |
| `playbooks/craft/graphic-compositions.md` | 图板、卡片、图表及画面层级 | 排版比较或设计视觉场 | 先决定注意顺序；给表演/图形共同留空间；需精确编辑的事实进入结构；视觉方向先在代表片段形成 | 85 |
| `playbooks/craft/motion-graphics.md` | 状态变化、持久对象与动效节奏 | MG、效果或协调场景发生变化 | 导演变化前后状态，不只入场；语义定位与运动时长独立；对象需足够停留供阅读 | 68 |
| `playbooks/craft/generated-dependencies.md` | 生成素材的参考关系图 | 人物/场景/产品/机位需一致性 | 每个请求是一幅完整画面；只传新图需要的事实；参考依赖不等于影片顺序；静帧与动态参考职责不同 | 38 |
| `playbooks/craft/sound-mix.md` | 原声、音乐、效果与连续性 | 决定听觉主次、ducking 或切镜声音 | 从素材已有声音出发；切换画面不自动切换声音；效果对其事件；覆盖时保持话语连续 | 70 |
| `playbooks/formats/talking-head.md` | 对镜口播、人物态度及辅助图文 | 人物直对观众承载内容 | 一张有用人物图可支撑多段；按适用关系用 Speaker Kit；字幕/图形与表演各有职责，榜单不是必需 | 82 |
| `playbooks/formats/two-person-podcast.md` | 两人关系、视角与反应 | 双人对话主导论点 | 第二机位保持共同世界；沉默者仍有反应；产品交接与切镜有动机；覆盖可服务整段思想 | 101 |
| `playbooks/formats/street-interview.md` | 相遇、提问、答案及揭示 | 街访关系 | 共享双人图后派生近景；镜头追重要人物；前后行动不能模板化；揭示的画面/音效共享事件 | 92 |
| `playbooks/formats/ranking-listicle.md` | 比较论证及持久榜单 | 排名、清单或层级板 | 记住前项判断；出现/归位分事件；人像/照片服务识别；论点决定表现形态 | 71 |
| `playbooks/formats/narration-led-demo.md` | 独立旁白统领画面证据 | 产品、手部、界面、图形由旁白串联 | 音频-only A-roll 提供语义主轴；图片不是机械名词插图；整个画布和声音保持连续 | 87 |
| `playbooks/formats/presenter-led-explainer.md` | 人物讲解与复杂演示/MG | 图形承担较多视觉论证 | 根据变化关系组织对象；表演播放与其视框独立；语义事件定起点、时长定展开；代表片段持续可见反馈 | 160 |
| `playbooks/formats/short-drama.md` | 人物诉求、动作、反应与叙事 | 人物事件驱动短剧情 | 每段有戏剧作用；机位看同一世界不同角度；表演承载事件而非组件代演动作 | 85 |

#### 同目录配套文件：7 个

这些不是额外的知识页，但属于要求覆盖的全部参考树。新实现不得复制其代码；可独立写有同等教学目的的样例。

| 路径 | 教学用途/何时读 | 主要关系 | 约行数 |
|---|---|---|---:|
| `production/examples/production.svml` | 作者编排页的完整小例子 | Script→提示文本→表演→归一化→语义 Take→Timeline；Performance、Sound、独立文字→Film；全片和局部渲染 | 73 |
| `production/examples/direction.svs` | 学文本模板 Recipe | 导演描述和对话分别占槽，按明确顺序组成 prompt | 14 |
| `production/examples/look.svs` | 学样式职责 | 画面适配、文字外观、影片底色由各自 Recipe 保存 | 6 |
| `production/examples/production.svrun` | 学最终目标 | 只选择完整视频 Output | 5 |
| `production/examples/material.svrun` | 学分阶段制作 | 只先完成准备好的语义 Take，便于素材生成期间继续编排 | 5 |
| `production/examples/detail.svrun` | 学复用后局部交付 | 选择已有 Take，再生成局部编码片段 | 8 |
| `production/examples/visuals.ts` | 学组件绘制边界 | 消费已投影窗口、目标框、字体和图层；独立生成卡片元素及短入场，不解析 Script | 62 |

### 2.4 公开文档的内容地图

公开文档没有替代 Skill 的命令门禁：它们面向用户或组件开发者解释系统。每篇一般有 `title`、`description` frontmatter；正文直接入题，不重复一个与网页标题相同的一级标题。英文 `guide/` 13 篇、`quickstart/` 9 篇，加 `quickstart.md`；`zh/` 下有相同路径布局。

| 路径（`docs/` 下；中文另加 `zh/`） | 面向谁及主要内容 | 英/中约行数 |
|---|---|---:|
| `quickstart.md` | Agent 用户：准备参考→装 Skill→说清变化→选服务→确认费用→观看并继续编辑 | 100/75 |
| `guide/agents.md` | 工作环境、项目可访问性、Agent 入口；与模型服务选择分离 | 55/45 |
| `guide/skill.md` | 委托过程、用户权威、文件工程及可编辑交付 | 71/44 |
| `guide/develop.md` | 开发先决工具、日常命令、仓库布局和下钻导航 | 65/65 |
| `guide/packages.md` | 包职责、项目组件、安装与 Source 导入、扩展分发 | 68/44 |
| `guide/author-packages.md` | 从完整小包理解创作接口、实现、使用和分享 | 93/53 |
| `guide/component-anatomy.md` | Manifest、作者 Surface、图贡献和执行实现的责任边界 | 63/41 |
| `guide/providers.md` | Model/Provider/Endpoint、服务接入、异步任务及价格许可 | 135/78 |
| `guide/runtime.md` | 项目和执行配置、Build 的终端独立性、容量及项目 Results | 172/157 |
| `guide/service-partners.md` | 托管服务、自有部署及五类合作服务；属于原产品商业接入层 | 76/64 |
| `guide/conventions.md` | 命名、模块边界、TS 配置、版本化 wire 数据和错误归属 | 61/57 |
| `guide/testing.md` | Node 测试、可观察契约准入、付费/环境门控及 fixture 管理 | 98/86 |
| `guide/studio-companion-architecture.md` | 组件如何向编辑器提供实体与作者控件，而不复制渲染实现 | 46/26 |
| `guide/studio-temporal-windows.md` | 语义与时钟写法、共享锚、局部偏移和编辑后保留的关系 | 69/61 |
| `quickstart/script.md` | Segment、Role、Dual Text、空格、显示属性、Selection、Moment | 312/295 |
| `quickstart/styles.md` | Recipe 语法、导入、影片/字幕/媒体/文本/模板/字体实例 | 405/384 |
| `quickstart/generation.md` | 静态媒体、文本、视频调用形状、语义 Kit 与组装例子 | 364/317 |
| `quickstart/timing.md` | 逐 Take 归一化和语义对齐，再装配 Timeline | 149/136 |
| `quickstart/tracks.md` | 字幕、Media、Audio、Typography、榜单、卡片、叠层与贴纸 | 571/479 |
| `quickstart/images.md` | 图片合成、校正、背景去除以及与视频抠像的差别 | 116/98 |
| `quickstart/composition.md` | Film、堆叠、全片/纯组件影片及 Source/Recipe/Run 组合示例 | 312/303 |
| `quickstart/run.md` | Run 目标、结果/文件复用、执行配置、计划和 Build 全流程 | 511/430 |
| `quickstart/preview.md` | 启动真实工程、Comments 协作、时间线、Inspector、回写和交付 | 102/64 |

`docs/public/` 是站点的图标、伙伴图片和微信等资源，不是制作协议。`public/zh/index.html` 是中文入口到快速开始页的重定向，并保留 query/hash 与无脚本链接。它不是新的中文指南。

README 的层次是产品承诺和入口、一次性 Skill 安装、三种代表视频的参考/变体展示、使用请求示例、应用场景、贡献与包分享、伙伴和许可。它特别说明：参考改编不是唯一入口；无需生成服务也可完成代码/字幕/MG 影片。README 的历史展示费用、渲染进程数和镜头数量是展示作品的事实陈述，不是新执行的报价或默认设置。它与当前示例正文存在范围差异，例如榜单当前生成入口列八张喜剧 B-roll，而 README 展示描述列十张；不能混用为同一个可复现请求清单。中文 README 对应同种结构，亦不构成独立行为规范。

### 2.5 每个示例工程及组件

以下是实际源文件导入与 README 的交叉阅读。公共媒体流程包括 Script、Text/Kit、Media、Clock、Normalize、WhisperX SemanticTake、Timeline、字体/空间、Film 和本地浏览器渲染；在表中仅展开对该例子最有辨识度的组件。旧来源词汇只用于定位目录，不提供可复制实现。

| 工程/入口 | 演示行为 | 使用组件或包；素材/执行条件 |
|---|---|---|
| `ranking-football/reference` | 持久榜单记忆此前判断，两个独立口播 Take 带语义揭示和重叠 B-roll | 图像生成、VoiceDesign、参考视频生成；Ranking 的 TierBoard/TierItem、Performance、Sound、Media Track、Fine Caption、Audio Track；当前入口生成主持人和八幅笑点图，同一人图和声线供两个 Take；球员照片及音乐/音效是文件 |
| `ranking-football/reference-gpt` | 并列保留的榜单制作研究，不是最新 reference 的上游 | 同类图像/视频、TierBoard、字幕、媒体和混音流程；未导入 VoiceDesign，不能宣称具有最新入口同等全生成保障 |
| `ranking-football/swap-host` | 换香蕉主持人而保留榜单组织 | TierBoard；人物/台词方向和本地 tier Recipe 改变，公共媒体及字幕链保留 |
| `ranking-football/swap-effect` | 换排名表现方式，不换比较作用 | Ranking Column/ColumnItem/ColumnStyle 代替 TierBoard，加已有 Media/Caption/Performance/Sound/Audio 贡献 |
| `ranking-football/swap-topic` | 榜单对象改为科技人物主题 | TierBoard，新的图像/文本及 tech Recipe；榜单状态与语义结构仍在 |
| `ranking-football/reference-banana` | 独立香蕉主持人生成与榜单工程 | TierBoard；其 build Run 没有预满足生成素材，配自己的 Recipe/Kit/配置 |
| `ranking-football/reference-banana-from-swap` | 从换人方向发展出的另一完整生成工程 | TierBoard；生成路线不同于旁边的表演复用研究，不应根据目录近邻关系隐式复用 |
| `ranking-football/swap-effect-banana` | 香蕉主持人的 Column 效果，复用既有表演 | Column 与本地 column Recipe；reuse Run 明确选择 `reused/` 下载片段；下载媒体不在 Git 中 |
| `ranking-football/swap-effect-banana-reference-sync` | 对照参考的 Column 效果/同步复用研究 | Column、column/hybrid Recipe；build Run 显式使用已下载表演，仍需自己的后续媒体准备与编排 |
| `podcast/reference` | 互补机位、产品身份和递交、静默听者反应、生活蒙太奇 J-cut | 图像生成九个画面，两次 VoiceDesign，三个有声视频 Take 与一个无声 B-roll；Performance、Sound、Fine Caption、Media/Audio Track；两个持物图各参考本人和同一产品；`once-start` 覆盖不偷偷拉伸或末帧冻结；仅配乐为最终路线的供应媒体 |
| `podcast/swap-host` | 双人改为另一角色关系 | 与 reference 同类对话/B-roll/字幕包，但不导入 VoiceDesign；独立 Run/Recipe 选择，不保证最新全生成标准 |
| `podcast/swap-item` | 更换实体产品与相应论点 | 同类对话组件；产品图、持物关系、词语及覆盖跟新产品变化 |
| `podcast/swap-app` | 从实体物品改为软件诉求 | 同类图像、视频、Media Track、字幕与音频组件；用途不是仅替换瓶身标签 |
| `interview/reference` | 双人共享场景派生两近景，三段问答，每次答案的图标/音效/闪光同时揭示 | 图像/VoiceDesign/参考视频；Interview Emoji Reveal、Screen Flash、角色 Fine Caption、Performance/Sound/Audio；默认新片字幕是固定位置，不偷用旧 783 帧头框 |
| `interview/swap-host` | Wojak/Chad 人物变体 | 同类 Emoji/Flash/Caption，加 RegionTimeline 与对应头框 Recipe；独立素材与测量 |
| `interview/swap-lang` | 西语变体与其真实时序 | 上述组件加 SemanticTake Adjust 的 Anchor；使用本变体 tracking，不沿用英文片秒数 |
| `interview/swap-ride` | 车辆/故事改为 F1 场景 | 同类问答揭示与 RegionTimeline，用对应人物/场景追踪数据 |
| `complex-explainer` | 约 137 秒中文解说、17 个已接受 Take、无 Take 开场/结尾、网站演示和八个协调场景 | 项目包 `web-scenes`、`opening-system`、`launch-scenes`、`single-line-captions`，以及不产生 Track 的 `visual-language`；公共 Performance/Sound/Audio/Fine Caption/Film；默认 Run 从独立媒体包显式选择 50 个 Output，剩余只本地绘制、混音和封装；代码在 Git，约 455 MiB 媒体归档在外部 |
| `semantic-composition/chat` | 八秒纯组件聊天；四条消息按时钟到达，消息保持或滚动 | 项目 `chat-scene`，Clock/Timeline、Canvas、精确字体、Film/Render；无 Script、语音对齐或生成服务；同一组件在口播里也能接受 Moment |
| `semantic-composition/packages/responsive-explainer` | 同一播放中表演从全屏移动到侧面，为图解让空间 | 一个 Scene、独立 reveal Moment 和外层 Window；HTML/CSS/SVG/帧 JS、类型化视频采样与字体；字幕可继续独立，不在 Core 注册例子专属名字 |
| `semantic-composition/packages/performance-styles` | 自定义移动视框、显式两 Segment 画面交叉淡化 | 项目 Move/Crossfade 返回公共 PerformanceStyle；与标准 Style 同轨，用原源位置播放 |
| `semantic-composition/packages/sound-styles` | 相同 Timeline 的出入声交叉淡化 | 项目 Crossfade 返回 Sound Style；显式 outgoing/incoming，窗口端点不推断声音角色 |
| `minimal-author-package` | 完整作者包、Style Recipe、字体、图输入槽、预览与打包边界 | `example-component` 的 Box、文字、媒体槽与 Style；Manifest/Surface/Fragment/Producer/activation；预览源还含视频→语义 Take→Performance/Sound/Film；只需公开框架开发依赖，tarball 不附带独立 Runtime |
| `provider-package` | 项目自有图像/视频 Provider 的支持检查、媒体角色映射、任务回执、poll/collect 与错误边界 | `provider-images`/`provider-videos`，分别对接图像模型和视频模型的 SDK 能力；协议是教学用假想服务，非可运行供应商，不得当成“已经接好第三方”；dsivio-video 不保留此类供应商接入范例 |

复杂讲解的八个 `web-scenes` 职责分别为：介绍；双产品比较；编辑路线；代码路线；组件复用；语义时间；交付展示；收尾。每个场景拥有内容、样式和可直接寻帧的状态计算；独立人物视框、字幕、计时器和音轨留在外部。`opening-system` 提供 Title、Timer、Flag、Stage、人物缩放/转场/圆形 inset 等视觉关系；Stage 的前景与模糊背景采样相同瞬间且不贡献音频。`launch-scenes` 当前公开的是 PosterTitle。单行字幕包只改可见调度，不改原 Cue 身份和语义。共享色板包只是普通代码依赖，不能因为可复用就被建成 Track。

示例总入口明确警告：三个 `reference` 生成入口不依赖旧 Result 或预制主持人图，但本地真实标识、音乐和特定揭示画可以存在；其他变体没有全部重建到相同标准。展示视频不能证明新一轮随机生成会得到相同像素、声音、长度或追踪坐标。抄一个文件也不等于复制完整项目，应携带相对导入、Kit、Recipe、所需资产和所选 Output 资源。

### 2.6 文风、格式及诊断表达约定

- **入口轻，下钻精。** 主 Skill 用职责和决策串起全局；参考页开头先限定何时读和谁拥有相邻问题；包本地文档掌握准确属性、类型和模型限制。不能把每种控件和所有模型参数塞进 Skill。
- **标题按行动或问题分解。** 参考页有一个一级标题；二/三级标题围绕建立边界、选择关系、保持某事实、审查、修复。网页文档由 frontmatter 给标题，再从二级标题组织正文。
- **祈使句有原因。** 要求 Agent 做明确动作，同时解释其生产价值或边界。创意判断以可见结果和观众感受落地，而不是大量空洞审美形容词；不把建议误写成解析器硬限制。
- **表格承担导航和所有权。** 常见列是问题/所有者、情况/动作、素材关系/输出、参数/含义、示例/学习点。用于分岔选择，不是给所有任务增加完整打勾手续。
- **示例是关系证据。** 小段源语言、CLI、JSON、目录树和少量 Mermaid 用来说明输入/输出或依赖，不表示必须照搬人物、台词、场景数和风格。完整跨文件例子独立放目录，以相对链接引用。
- **“成功”的证据分级。** 检查通过证明作者表达合法；计划证明剩余请求；运行证明端点实际产物；预览证明当前编排；交付文件证明编码结果。编译和截图不能证明音频，提示词不能证明实际动作。
- **费用与失败具体化。** 报告哪项请求、哪个执行入口、公开错误/任务编号、已知回执以及仍不明确的结果；不展示密钥，不将登录/额度/价目当消费许可，也不以无关重装掩盖请求拒绝。
- **双语是同一职责地图。** 中文页不是机械逐行翻译，通常明显更短；概念名保留 English，解释和指令用中文。需维护链接/Frontmatter/示例同步。源中文 `guide/studio-temporal-windows.md` 开头有破损链接及说明字段，属于当前文档缺陷，不能作为格式范本继承。

## 3. 关键概念与数据形状

下表以新字段名描述应保留的知识对象，不是源类型定义。

| 对象 | dsivio-video 建议记录内容 | 权威边界 |
|---|---|---|
| 创作委托 | `goal`、`audience`、`requiredFacts`、`requestedChanges`、`delivery`、`spendScope` | 用户确认的要求/预算归 Brief |
| 导演设计 | `creativeAnswer`、`visualRelationships`、`performanceIntent`、`soundIntent`、`referenceLinks` | Treatment，不代替实际台词或请求参数 |
| 参考观察 | `sourceRange`、`visibleStates`、`changes`、`spokenEvidence`、`viewerFunction`、`evidencePaths`、`confidence` | Analysis 和参考 Timeline；观察与推论分别标明 |
| 恢复记录 | `currentQuestion`、`nextAction`、`blockers`、`activeBuilds`、`selectedRun`、`reusableOutputs`、`remainingBudgetNote` | Progress 指向执行事实，不决定 Candidate |
| 制作工程 | `authors/` 中 `.dvml`，`recipes/` 中 `.dvs`，`runs/` 中 `.dvrun`，项目资产/包及 `.dsivio-video/` 产物 | 文件名/目录约定不冒充解析语义 |
| 执行选择 | `sourceEntry`、`wantedOutputs`、`chosenCandidates`、`exportDestinations` | Run 决定本次 Target 与复用 |
| 生成请求快照 | `modelKey`、`promptText`、`referenceRoles`、`resolvedOptions`、`capabilityEvidence`、`hostTaskId` | plan 展示确定请求，Build 保存同一请求；供应商身份显式 |
| 验收记录 | `reviewedRun`、`reviewedAsset`、`watchedRanges`、`heardAudio`、`issues`、`deliveryLimits` | 不把未观看的结果写成已验收 |

主 Skill 的路由是“当前问题 → 职责页”，不是根据目录名称判断阶段。比如一次换人任务同时命中 Brief、Transformations、Image/Video Direction、Voice/Performance、Generated Dependencies、Runs 与 Review；一次字幕样式修订可能只需 Caption Craft、Caption Presentation、Runs 和 Snapshot/Studio。

项目恢复的最低信息组合是：当前 Brief/Treatment、相关参考解释与证据、权威 Source/Recipe/Run、尚存 Result 的 Output 及资源绑定、活跃 Build 或 Dsivio task 标识、当前下一问题。纯 MP4 缺少这些内容，不能称可编辑工程交接。

## 4. 对 dsivio-video 的建议

### 4.1 必须保留

保留导演/制片 persona、按问题路由、先理解参考、先导演素材、文件记忆、明确预算许可、显式复用、独立观察器、按事实所有者修复及视听验收。保留 Author Graph、Run、Target、Candidate、Build、Need、Output、Timeline、Take、Composition 的职责区别。保留项目自有组件及可选 Studio Companion，**保留 Studio 本体，但不建立每个组件另一个 studio 包的重复分发树**。

Dsivio 接入应成为一个权威阅读入口：在编写生成声明/plan 前查询 `dsivio media models --kind image` 或 `--kind video`。每个 `gen:Image`/`gen:Video` 必须显式填写 `model="provider/model-id"`，不可自动选默认模型、切账号或静默替换供应商。plan 按实时能力检查时长、分辨率、比例、音频开关、首尾帧、各参考角色数量、图像质量/张数等，并展示精确解析请求；同一快照写入 Build。模型目录里的 default/known 不免除显式选择要求。

付费唯一通道是 **`dsivio media`**。生成命令的关键输入由插件翻译到 `--model`、`--prompt-file`、`--ref`、`--first-frame`、`--last-frame`、`--ref-video`、`--ref-audio`、`--duration`、`--resolution`、`--ratio`、`--audio`、`--size`、`--quality`、`--n`，并使用主程序提供的 `--idempotency-key`、`--source`、`--options-json`、`--out`。异步观察用 `status <id>` / `wait <id>`，按需 `--no-wait`。这不是让插件直接调用供应商。模型目录当前没有给出价格字段，文档不能承诺单凭 models 就能报自动精确总价。

CLI 错误处理参考应明确区分：0 成功；2 参数不合法；3 拒绝且未扣费；4 失败；**5 状态不确定，禁止再提交**；6 主程序未运行；124 等待超时，先查原任务。源参考在无回执的超时后讨论新 Build 的行为不能原样迁移：Dsivio 的不确定结果约束更严格，新 Build 也不能成为重新发出同一不确定付费请求的借口。

### 4.2 可简化

- 从“安装 Skill/选择发行版/选择 Profile/连 Provider/准备所有服务”改成“找到插件与 Dsivio、检查主程序状态、读模型能力、只准备本次本地素材操作或渲染”。Node 22.23、ffmpeg、ffprobe、yt-dlp、Python 3.12 已随主程序提供，不重复要求用户 Homebrew/winget 安装。浏览器和语音模型资源是否具备仍须实际判断。
- `environment/profile.md` 改成项目执行设置：路径、本地渲染资源、工作目录和日志，不包含 Endpoint bindings、支付账号、密钥和宿主生成任务并发限制。Dsivio 已拥有任务队列/路由/幂等。
- 图像/视频经验文章保留导演原则，但所有模型经验注明实测模型与能力范围，重新独立写例子和 Kit，不继承原段落。不能把某模型的 person-reference 参数变成通用输入；只使用 Dsivio 公开角色字段和可接收选项。
- 声音导演保留作为表演/已有参考音频的创作知识；语音生成章节改成“使用用户声音素材或模型自身视频音频”。语义对齐可以是独立本地能力，但其准备、Python 兼容性及资源需另行实现和验证，不能宣称主程序已经提供。
- 示例优先建立两个无需付费的完整工程：纯组件动画、使用接受素材的复杂讲解；再建立 Dsivio 通道的图像/视频例子。所有项目用自己的名称、文案、资产与代码，并提供完整可编辑工程及来源说明。

### 4.3 砍掉

删除 HypiHub 推荐/登录、第三方网关套餐、BYOK Provider 教程、供应商协议示范、Credential Stores、S3/Lambda Result Store、Runtime Profile Endpoint 绑定和伙伴营销入口。不能把旧 provider-package 改个品牌名继续宣传插件可直连供应商；新例子只讲 Dsivio 任务提交/收据/结果接纳边界。

删除或显式标为当前不支持的 TTS、VoiceDesign、独立语音生成、图像背景去除及视频 matting 执行路径。保留声音/透明媒体的编辑知识不意味着宿主已经具备这些生成能力。普通裁剪、缩放、已有透明图层和 ffmpeg 媒体加工与 matting 是不同事情。

### 4.4 建议参考树

保留四间知识“房间”的形状及两个 playbook 尺度，但写全新内容；以下是目标树，不是已经存在的文件。

```text
skills/dsivio-video/
  SKILL.md
  agents/openai.yaml
  references/
    environment/
      distribution.md
      dsivio-media.md
      project-runtime.md
      local-tools.md
    creation/
      brief.md
      project-files.md
      reference-video.md
      script-and-time.md
      transformations.md
    production/
      index.md
      system.md
      component-design.md
      authoring.md
      source-syntax.md
      script-syntax.md
      timing.md
      prompt-kits.md
      runs.md
      media.md
      media-presentation.md
      audio-presentation.md
      video-downloads.md
      browser-capture.md
      image-operations.md
      spatial.md
      fonts-and-text.md
      vocabulary.md
      component-sharing.md
      timeline.md
      tracks.md
      performance.md
      sound.md
      caption-presentation.md
      track-authoring.md
      component-visuals.md
      caption-authoring.md
      builds.md
      studio.md
      studio-companions.md
      rendering.md
      snapshots.md
      review.md
      examples/
        production.dvml
        direction.dvs
        look.dvs
        production.dvrun
        material.dvrun
        detail.dvrun
        visuals.ts
    playbooks/
      index.md
      craft/
        image-direction.md
        video-direction.md
        voice-direction.md
        voice-and-performance.md
        b-roll.md
        screen-demonstrations.md
        captions.md
        caption-tracking.md
        graphic-compositions.md
        motion-graphics.md
        generated-dependencies.md
        sound-mix.md
        examples/
          image-direction.md
          conversation-images.md
      formats/
        talking-head.md
        two-person-podcast.md
        street-interview.md
        ranking-listicle.md
        narration-led-demo.md
        presenter-led-explainer.md
        short-drama.md
```

其中 `dsivio-media.md` 取代 Model/Provider 接入页，拥有模型发现、显式模型、能力验证、预算边界、宿主任务状态与 5/124 的处理；`project-runtime.md` 取代含路由的 Profile 页，只拥有插件本地执行设置。`image-operations.md` 不列背景去除；`voice-direction.md` 不出现 TTS 服务操作；`caption-tracking.md` 只在确有需求且测量方法可用时触发，不能偷偷开额外收费检测服务。production 配套小例子建议用供应素材或纯本地作者动画，以免阅读文档就被诱导发出付费请求。

新公开文档也可沿用 `guide/`、`quickstart/`、`zh/` 三层：`providers.md` 改为 Dsivio 媒体契约，`service-partners.md` 删除；生成快速开始改为通用 gen 标签及实时 capabilities，Run 页不再讲插件凭据和 Endpoint。README 应以主程序内插件入口、可编辑工程和真实代表例子为核心，不移植原品牌推广或历史费用。

## 5. 依赖与外部程序

| 原文档涉及的依赖 | dsivio-video 的归属/约束 |
|---|---|
| Coding Agent 的 Skill 装载、Claude/Codex 入口 | 统一 Skill 权威文件；各入口可用链接或由安装机制同步，不维护两份规则 |
| Node、包管理器、TypeScript | 主程序已有 Node 22.23 可直接 type-strip TS；项目作者包的发布/编译方案独立决定，不继承整套工作区构建要求 |
| ffmpeg、ffprobe | 已捆绑，用于真实媒体元数据、流选择、规范化、混音、封装与验收；仅存在可执行文件不证明所有编码器可用 |
| yt-dlp | 已捆绑；下载前说明来源与目标文件，失败按真实平台/网络证据诊断，不自动更新工具 |
| Chromium/HyperFrames 浏览器、网页自动化 | Studio、截图、录屏及局部/全片渲染需要；是否捆绑及隔离生命周期待确认，不默默下载另一个浏览器 |
| Python、WhisperX、语言权重、uv | 宿主只有 Python 3.12 已确定；原文一些本地服务面向 Python 3.13，不能据此宣布可用；语音识别/对齐需另立兼容方案 |
| OpenCV 图像处理 | 原示例有本地解释器；我们可保留等价普通图像操作，但不可把它当成已随 Python 包含 |
| Google Video Intelligence、YOLO 等头框来源 | 原示例可选测量路线，不是基础字幕必需；新片必须重新测量，不照搬历史框数据 |
| 托管图像/视频/声音/转录、价格查询 | 图像与视频只经 `dsivio media`；宿主未提供声音、matting 或价格查询契约的能力不能臆造 |
| Git/npm/私库/媒体归档 | 管理自有组件与资源交接；Result 合成值需带资源绑定，不只是拷贝一个 MP4；无插件云端存储 Provider |

## 6. 待定问题

1. Dsivio 模型目录提供实时 capabilities，但尚未给出价格/报价 API。预算记录、估价来源及实际费用回写应采用哪种可信契约，不能借旧 price 页接口假装已有。
2. 本地语音转录和词级对齐采用何种实现、模型缓存与 Python 3.12 环境？没有它仍能做纯动画或素材编排，但不能把未经测量的词时序称为语义对齐。
3. Studio 和渲染浏览器由宿主捆绑还是插件独立准备？网页捕获能否共用浏览器，但不改变正在渲染作品的进程？需要给出明确能力边界。
4. Skill 由 Dsivio 插件安装到哪些 Agent 环境、如何同步更新及保留用户定制？原仓库的符号链接说明单一来源策略，不代表宿主已有同一机制。
5. 已接受素材的可公开授权、完整资源包及图像/视频模型经验案例由谁提供？演示结果与重新生成结果需分别标记，追踪框等不能混用。
6. 多个语音-only、头部跟踪或自定义字体示例在目前能力下如何可完整运行？需要选择真实供应素材/本地实现，不能用占位服务完成演示。
7. 完成观看的证据记录如何接入 Agent 能使用的播放/音频观察工具？帧网格只能覆盖视觉部分；未能聆听时须报告限制，不能把有音轨当作听过。

## 7. 来源

源仓库根目录：`/Users/zmmini/zmdata/work/dsivioplugin`。所有描述均为独立中文转述；未复制正文、类型定义或实现代码。

- `skills/hypit/SKILL.md`，`skills/hypit/agents/openai.yaml`。
- `.claude/skills/hypit`、`.codex/skills/hypit` 的目录记录及真实链接目标。
- `skills/hypit/references/` 下全部 **64 篇 Markdown、7 个配套文件**：完整路径已逐一列于 2.3，内容读取覆盖环境、创作、production、playbooks 及其 examples 子目录。
- `docs/guide/`、`docs/quickstart/`、`docs/quickstart.md` 及相应 `docs/zh/` 全部 **46 篇 Markdown**：每个文件名已列于 2.4；另读 `docs/public/zh/index.html`，其余 public 资源只作为静态资产目录识别。
- `examples/README.md`；七个顶层示例的 README；所有榜单子工程、各 `swap-*` 与 `variants.md` 说明；每个作者源、Recipe、Run 及项目包的 README/清单/源码，用于交叉核对组件归属和导入，不将教学协议误报成真实服务。
- 重点交叉核对：`examples/complex-explainer/productions/explainer/{README,BRIEF,TREATMENT,CRAFT-NOTES,ASSET-PROVENANCE}.md` 与 `authors/`，`examples/complex-explainer/packages/{web-scenes,opening-system,launch-scenes,single-line-captions,visual-language}/README.md`；`examples/semantic-composition/packages/{chat-scene,responsive-explainer,performance-styles,sound-styles}/README.md`；`examples/minimal-author-package/packages/example-component/README.md`；`examples/provider-package/README.md`。
- `README.md`，补充读 `README.zh-CN.md` 的入口、示例及应用范围。
- Dsivio 的宿主 CLI、捆绑运行时及删除项来自本研究任务给定契约；本文未自行运行验证宿主能力。
