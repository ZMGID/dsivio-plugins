# 时间线、脚本、语音证据与语义 Take

## 1. 概述

本文描述从创作文字到可定位视频时间的完整链路：Script 产生没有时间码的 Narrative；录制或生成媒体经过 Normalize 获得统一帧域；WhisperX 测量实际音频；确定性匹配把脚本词映射到媒体局部帧；SemanticTake 保存这一段脚本与真实媒体的对应关系；Timeline 再把多个 Take 平移到节目时间。时间消费组件通过 TemporalInstant / TemporalWindow 使用结果，而不是在渲染器里重新识别文字。

必须区分三类真相：**作者决定说什么、媒体实际持续多久、声学证据测到什么**。measure 只是选取请求时长的辅助工具，不提供词时间；transcribe 只提供识别证据，不修改 Script；Timeline 只组织时间和持有媒体，不自动播放画面或声音。

这是源码和现有文档的静态行为研究，未执行构建、测试、安装或模型推理。下文语法示例使用 dsivio-video 命名；源实现中某些字段名仅作为格式对照说明，不是建议照搬其类型或实现。

## 2. 行为规格

### 2.1 Script 与 Narrative

Script 是正文优先的语法。`<intro>正文</intro>` 定义命名 Segment，`<silent/>` 是合法空段。在段内，类似 `<HOST>` 的裸标签切换 Role / Turn；不是另一个 Segment。没有 Role 的段形成无角色 Turn；开始使用 Role 时，第一条角色提示必须在该段发言之前；角色状态在段结束时清空。缩进、换行不决定结构，换行也不代表字幕分句。

Narrative 保存段、发言轮次、发音 Token、语义锚点、Selection、Moment 和字幕文档，不保存秒数、帧、生成模型或视觉样式。每个词和每个 Segment 都有独立起止锚点，节目也有独立起止锚点；M 个词、N 个段共 `2M + 2N + 2` 个锚点，即使多个锚点在逻辑或物理时间上重合，也不能合并身份。

| 创作形式 | 含义 |
|---|---|
| `<2018年 | twenty eighteen>` | 左侧用于显示，右侧用于发音；形成一个不可拆分的字幕 N:M 对应单元 |
| `<组件化|>` | 发音继承左侧；显示可以成组，但内部发音 Token 仍独立 |
| `< | spoken wording>` | 参与语音与时间定位，不出现在字幕里 |
| `||` | 字幕 Cue 分界；必须位于完整对应单元之间，不切 Segment、不切画面 |
| `word{emphasis,importance=2}` | 紧邻前一显示词的平面属性；不是时间锚点 |
| `@{part}…@{/part}` | 命名语义范围 |
| `@{cue!}` | 命名语义点 |

普通词法将英文词、缩写和数字表达作为词单元；汉字、平假名、片假名逐字符形成 Token。Latin 名称紧邻汉字时会在文字系统边界处分开。数字的千位分隔、小数和数字区间可保持一个词法单元；这不代表系统知道其读音。标点附着于显示文字，不额外获得发音时间。用于匹配的 Token 正规化执行 Unicode NFKC、英文规则小写，并去掉字母、组合符号和数字之外的字符。没有简繁转换、翻译、拼音或近音匹配。

正文空白串统一成一个空格，首尾空白移除，但不会因为“这是中文”而删掉作者写的空格。注释和零宽标记不应切开词；一个 Dual Text 至少含一个实际发音 Token。纯标点发音侧、词内 Cue 分界、词与紧邻标点之间的标记、隔空格的词后属性等是语法错误。语法诊断保留错误代码、源文件和可选字符偏移。

导出视图包括完整 Narrative、`story.segment.intro` 段摘录、`.dialogue` 带角色提示的发音文本、`.speech` 不带角色提示的发音文本、`.caption`、`.selection.<name>`、`.moment.<name>`。measure 使用 speech；语义准备使用 Segment 摘录，不能用“任选一些字”的 Selection 替代它。

#### 标记的亲和方向

标记本身没有时间；它绑定已有锚点。默认起点靠右、默认终点靠左。

| 标记 | 绑定 |
|---|---|
| `@{part}` | 后一个词的开始 |
| `@{~part}` | 前一个词的结束 |
| `@{/part}` | 前一个词的结束 |
| `@{/part~}` | 后一个词的开始 |
| `@{cue!}` / `@{~cue!}` | 后一个词开始 / 前一个词结束 |

结构边缘绑定对应的段或节目边界，而不是伪造邻词。名称为小写字母开头，后续可含小写字母、数字、下划线、连字符，总长不超过 64；Selection 和 Moment 共用名称空间。Selection 可交叉、重叠、跨段，无需像 XML 那样嵌套；其范围仍须符合作者词序。相邻两段选择的终点/起点若分别为前词结束和后词开始，词间停顿不属于任一个范围；选用同一个邻接边界才能明确把停顿交给一侧。

内容查询按 Narrative 的作者词序返回半开 Token 范围，独立于 Take 后来的重排、空隙和重叠。改写标记只移动语义关系，保留发音、显示和无关源码；无操作应返回原文。

### 2.2 Normalize：把媒体事实变成统一时钟

公开流程是媒体 Artifact → inspect Need → 所有容器流的 Inspection → 确定性选流 → normalize Need → SynchronizedMedia。选音轨不意味着选中了旁白；Script 意义要等下一步显式连接。

```xml
<program:Clock id="clock" frame-rate="30"/>
<pipeline:Normalize id="intro-media" source={recording.video}
  video="primary-moving" audio="default" span-authority="video" clock={clock}/>
<whisperx:SemanticTake id="intro-take" narrative={story}
  segment={story.segment.intro} media={intro-media.media} language="zh"/>
```

Normalize 是空元素，需要 id、source。时钟必须且只能取 `clock={…}` 或 `frame-rate="…"` 之一。选流策略必须是一个 recipe 引用，或完整的 `video`、`audio`、`span-authority` 三属性；不能混用或只补其中一个。

| 属性 | 值与规则 |
|---|---|
| `video` | `primary-moving`、`none`、`stream:<容器索引>` |
| `audio` | `default`、`none`、`stream:<容器索引>` |
| `span-authority` | `video` 或 `audio`，决定媒体的时间起点、时长和统一域；权威流不能关闭 |

`primary-moving` 排除封面 attached picture、非运动视频及时间不可用的流。在合格候选中，唯一 default 优先；没有 default 时只接受唯一候选；多个 default、多个无默认候选、没有候选均失败，并报告相关索引。显式 video 索引仍必须是时间有效的运动视频，不允许用封面冒充。`audio=default` 在时间有效音轨中采用相同唯一性规则，**不等于取第一个音轨，也不会在无音轨时悄悄静音成功**。两个流都 none 无效。

当前本地执行限制：**只要含视觉流，就必须以 video 为 span authority；audio authority 仅支持音频专用媒体**。不能把“以长音轨为准、补齐短视频”描述为现成功能。

假设目标帧率为 p/q，权威流真实呈现区间长 d 秒：video authority 帧数取 `d × p/q` 的最近整数，半帧取后；audio authority 帧数向上取整。帧数必须正数。统一时长为 `F × q/p` 秒，48 kHz 主音频采样数取 `F × 48000 × q/p` 的最近整数。

权威流的实际呈现起点成为局部零点，不分别把音、视频各自起点无条件拉到零。音轨的起止相对该起点换成 48 kHz 整数坐标：超前部分裁掉，迟到部分前补静音，过长尾部裁掉，过短尾部补静音。完全不与权威区间相交的所选音轨失败。画面变为目标恒定帧率、指定精确帧数，固化旋转并转为方形像素；透明源保持透明，当前本地中间格式是透明 WebM 或不透明 MP4。主音频是 48 kHz 双声道 PCM s16 WAV，保持输入电平，不做隐含响度标准化、压限或母带处理。

输出只携带公共帧率、帧数、可选画面 Artifact 与尺寸、可选音频 Artifact。选流索引、权威来源与裁补明细留在选流/执行阶段。只有音频、只有画面都是有效 prepared media；静态图片先通过 StillVideo 变成有时长视频，再走同一 Normalize 链路。

Transform、Trim、Retime 等媒体改变应在语义准备前完成；不能在词时间已经产生后偷换媒体长度。media-pipeline 还提供 ExtractAudio、ExtractFrame、按顺序的 Transform、StillVideo 及最终音频渲染/mux 的 Need 边界，均不应在纯 Producer 中隐藏 FFmpeg 调用。

### 2.3 从 Script 段与证据到 SemanticTake

带发音的路径包含两个外部 Need 和一个确定性步骤：

1. 从 Normalize 的 48 kHz 双声道主音频派生 **16 kHz、单声道、PCM s16 WAV**；采样数由既有主时钟换算，重采样后裁补到精确值，不重新猜时长。
2. WhisperX 对该标准音频进行 ASR 和逐词声学对齐，返回 provider-neutral Evidence。服务不知道 Script、Segment、字幕或角色。
3. 显式取某个 Narrative 的一个完整 Segment，与这个 media 和 Evidence 做本地匹配，再物化为 SemanticTake。

段摘录必须确实属于 Narrative、种类为 Segment、词区间与作者段完全一致；媒体要有 normalized audio。对齐只接受一个段，局部段范围覆盖 `[0,F)`；不支持把整篇多段识别结果自动分配给多个拍摄段。多个角色可在一个段中出现，不因此要求多个 Take。

**空段走不同分支**：其 media 可以没有音频，省略 language，直接把段起止锚点映射到 0 和 F，不调用重采样、ASR 或对齐服务；它仍是真实媒体，不是空白素材占位符。带词段必须显式 language，不能以空段分支回避语音定位。

#### A. 证据输入与校验

证据包含按声学 passage 分组的词、可选字符测量和可选语音活动区间。时间坐标是 16 kHz 整数采样边界；它没有作者段 ID。词的时间和置信度可缺失；时间要么两个边界都有、要么都没有。非法整数、负数、超出媒体采样域、字符指向不存在的词等为错误。原始证据允许重叠、零宽甚至反向区间：这些测量不先被强行整齐化，只有正长度区间参与时间定位。

单段调用会把所有 passage 按识别顺序归入该段，合并字符的词索引。评分综合词及其字符的已有评分。没有评分不是零置信度。

#### B. 脚本文字与 transcript 的匹配算法

这是**顺序保留的分组动态规划**，不是子串查找，也不是按识别词数量平均分配。双方都做 NFKC、小写、去标点/空格；中文逐字 Token 因而可与识别器的中文词组匹配，英文一个词也可与识别器拆开的多个片段匹配。

每个状态表示已消费的脚本词数和识别词数。允许：一对一、多对一 merge、一对多 split、多对多 replacement、脚本遗漏和识别插入。模糊配对每侧最多 4 个词；若连续片段拼起来与另一侧单个词完全一致，精确 split / merge 不受 4 词上限限制。

用于复现既有决策的代价：

- 一对一文字完全相等为 0；文字拼接完全相同但分词不同为 0.055。
- 其他配对：字符 Levenshtein 距离除以两侧最长字符数，乘证据可靠系数，再加 `0.055 × max(0, 两侧词数之和−2)`，并加 `0.06 × 未匹配词边界数`。词边界数用两侧正规化词的精确最长公共子序列计算。
- 可靠系数无有效评分为 0.8；否则先把评分截到 0–1、取均值，再取 `0.5 + 0.5 × 均值`。
- 每遗漏一个脚本词代价 0.5；每插入一个识别词代价 0.35。
- 总代价相等时依次优先更多精确一对一、更少遗漏、更少插入、更简单分组；浮点比较容差为 1e−9。

“嗯”等识别插入不变成脚本词；遗漏脚本词仍要得到时间。该过程没有翻译、数字读法展开、简繁统一、拼音或固定相似度拒绝阈值。Dual Text 的显式发音是解决数字、缩写和名称读法的作者入口。

#### C. 将匹配转为完整词时间

1. 对每个识别词建立正规化字符序列。没有字符测量时，在其有效词区间内按字符等份生成定位参考；有字符测量时，以字符级 Levenshtein 回溯匹配，已有有效字符时间覆盖这些参考。回溯同代价时优先对角步。
2. 对分组内脚本字符与识别字符再次匹配，把识别字符时间归到相应脚本 Token。一对多时该脚本 Token 包住整个识别词组；多对一时尽量利用字符位置定位，不把所有汉字都视为整个识别词的同一窗口。组首/组尾补全测量外边界。
3. 连续缺失 Token 在左邻已测词结束与右邻已测词开始之间插值；两端缺邻居时用语音活动的最外边界，没有活动证据则用整个媒体边界。按每个脚本 Token 正规化字符数分权重，至少为 1。若右界早于左界，把可插值跨度收为零，不虚构负长度。
4. 采样区间投射为所有被其触及的帧：开始 `floor(sample × p/(16000q))`，结束 `ceil(sample × p/(16000q))`；限于局部 F。坍缩结果给其所在的一帧，媒体结束处给最后一帧。
5. 所有作者词获得局部帧和词起止锚点；段起止始终为媒体 0/F，不能取首末发音词代替。节目起止不属于局部 Take，等 Timeline 组装时提供。

这允许两个词窗口重叠，也允许多个词共享同一视频帧。不是所有缺失情况都会失败：无识别词时，作者词仍可按语音活动或整个段插值。**插值不是声学实测**，后续实现不得把这种“完整性”当作“准确性”证明。当前物化结果不附每词 measured / inferred 标记，也不把分组关系保留在公共 Take 中。

最终校验会拒绝缺词时间、缺锚点、越界、反向或初次物化的空词窗口，以及词起点序列/终点序列倒退。它不要求前一词结束小于后一词开始，因此合法重叠保留；测量异常若导致整体非单调，仍可能在最终 Take 校验失败，不能承诺任意异常证据都能自动修复。

常用对齐诊断包括帧率非法、音频 Artifact 非法、不是单段/段不覆盖媒体、不可用采样窗口、词文本非法、字符词索引非法和采样转帧溢出；源码分别有 `SPEECH_FRAME_RATE`、`SPEECH_AUDIO_DIGEST`、`SPEECH_BASIS_SEGMENTS`、`SPEECH_WINDOW`、`SPEECH_WORD_TEXT`、`SPEECH_CHAR_WORD`、`SPEECH_FRAME`。dsivio-video 可重新命名代码，但要保留区分能力和具体坐标信息。

### 2.4 Clock、Timeline、Take 放置与帧算术

Clock 只定义帧率，不定义节目时长。`frame-rate="30"` 或 `"30000/1001"` 合法；分子分母均须正安全整数。不接受 `29.97`、零或负数。当前按分子分母直接比较 Take 与 Timeline 帧率，数学等价但写法不同的 30/1 与 60/2 也不视为相同。

```xml
<time:Timeline id="program" clock={clock} end="content.end+30f">
  <time:Take source={intro-take.take} at="60f"/>
  <time:Take source={body-take.take} at="previous.end-12f"/>
</time:Timeline>
```

- 首 Take 省略 at 为 0f，后续省略为 previous.end。
- at 可以为非负绝对 f/ms/s，或紧邻**前一声明 Take**的结束，加减一个时长；首 Take 不允许 previous.end。
- 放置就是局部帧到全局帧的平移，播放速度和完整媒体长度不变。负偏移可制造重叠，正偏移可制造空隙；有更早的长 Take 时，正偏移不保证该处全局无人占用。
- content.end 是全部已放 Take 结束的最大值，不是最后声明的结束；节目 end 默认 content.end，可加减偏移或写绝对值，但必须正数且包含全部媒体。
- at/end 所有计算必须**恰好落在整数帧边界**；这不同于下面普通 Temporal 投影的四舍五入。30fps 的 250ms 是 7.5 帧，不能直接用作 Take 放置；可明确写 8f。
- 无 Take 的 Timeline 必须显式正 extent；它没有 Narrative，也不生成虚构 Script 或空白视频。拥有 Take 时全部必须属于同一 Narrative、同一帧率；不能重复 Segment、Token、Anchor，也不能由 Take 声明节目起止锚点。

若 Take 放在 S，则局部锚点 k 的节目位置为 S+k；媒体跨度为 `[S,S+F)`。节目共有 T 帧，时间边界可取 0…T，实际帧索引为 0…T−1，时长 `Tq/p`。节目 duration 与整数帧换算容差为 1e−7，仍须正安全整数。

Selection 通过其两锚点定位；Moment 通过一个锚点定位；词范围通过词时间定位。引用必须属于 Timeline 的 Narrative，且该 Timeline 真正含有其锚点；未收录的段或词不能按脚本顺序推测时间。`during={story.segment.intro}` 使用整个已放置媒体跨度，不只是说话跨度。Selection 的作者词序向前不保证物理时间向前：重排/重叠后可定位为空或反向；单独消费起点仍可能有效，最终组合为 Window 才拒绝无效范围。

节目帧边界换音频采样：`round(frame × sampleRate × q/p)`，半采样取后，用整数有理数一次计算，不能逐帧累加已舍入的每帧采样数。在 30000/1001fps 下尤其需要这一规则。48 kHz 主音频转 16 kHz Evidence 边界同样取最近采样。

Timeline 自身不输出画面轨或声音轨。重叠只意味着可用的媒体有多份，不自动溶解、不自动混音；Performance / Sound / Media / Audio 等消费方明确决定呈现。

### 2.5 temporal-markup：消费时间而不重新找词

每个时间消费组件显式引用同一 Timeline；前端把作者形式编译为 Instant 投影和 Window 合成。一个 Window 必须且只能使用以下一种形式：

| 形式 | 语义 |
|---|---|
| `during="program"` | 整个节目半开跨度 |
| `during={story.segment.intro}` | 完整段媒体跨度 |
| `during={story.selection.claim}` | Selection 两锚点，含作者选择的停顿归属 |
| `at="2s" for="8f"` | 绝对起点＋时长 |
| `at={story.moment.cue} for="8f"` | Moment 起点＋时长 |
| `until={story.moment.cue} for="250ms"` | Moment 为终点，向前取时长 |
| `start="selection.start-2f" end="program.end" selection={story.selection.claim}` | 独立端点表达式 |

`during=` 是范围绑定，不是循环、补帧、变速或 Source 裁切指令。不能与 at、until、for、start/end 混用；Moment 本身不是 during 范围；不能同时写 at 和 until。引用/属性必须恰好为相应形式所用，闲置时间绑定也会报错。

Instant 形式包括 Moment 的 `at={…}`，Selection / Segment 的 `at={…} boundary="start|end"`，绝对 `at="2.6s"`，或 `instant="moment.cue+2f" moment={…}`。Selection / Segment Instant 必须显式选边界；Instant 不规定事件此后保持显示多久。

表达式支持 program.start/end、selection.start/end、segment.start/end、moment.cue，加减**一个**明确单位时长；并非通用数学语言，不支持变量名、乘除或一串运算。绝对值是单个时长。`f`、`ms` 只接受非负整数，`s` 可为十进制小数，不能省单位、写科学计数、写 `0.5f` 或 `.5s`；负号只出现在锚点之后的偏移中。对应的 selection/segment/moment 属性必须提供有类型的引用。start-source/end-source 可独立绑定不同语义来源，不移动被引用的 Script 锚点。

投影先以精确有理数计算、先检查原始结果是否在 0…T，再取最近整数帧，半帧取后；不把越界值裁回节目。Window 两端须同节目时轴、同消费 subject，且结束严格晚于开始；量化后空、反向均错误。两端保留各自来源、表达式和作者权限，不制造一个虚假的“共同来源”。消费组件应检验 subject 与 Timeline 身份，不能仅接受任意两个整数。

编辑规则也由作者形式决定：直接 Selection 绑定改 Script 两锚点，整窗移动按语义停靠步数而非固定帧数，故时长可变；直接 Moment 改其 Script 绑定；结构段/节目边界不由消费窗口拖拽改写。at/for 移动改 at（或 Moment），尾边改 for；until/for 对称地只开放前边时长。显式表达式拖动只改本地偏移，裸引用也写出帧偏移，不改引用源；start/end 整体移动让两端各加相同帧差。已编辑参数回写 f，未编辑参数保留原单位。重合锚点共用物理停靠点但保留各自身份。

Temporal 另有 sibling Window 检查：independent 不限制重叠；disjoint 按物理起止排序，首尾相接合法，交叠报错。触发阶段调度要求非空外范围、唯一 ID、作者次序上严格递增且位于 `[outer.start,terminal)` 的触发点，terminal 不得晚于 outer.end；累计阶段从各触发点延续到 outer.end，互斥阶段到下一触发点，最后到 terminal。它是纯时间工具，不规定具体视觉动效。

### 2.6 measure / estimate：发音单位估时

```sh
dsivio-video measure film.dvml --segment intro --language zh --pace normal
dsivio-video measure --text "Meaning guides editing." --language en --rate 5 --rounding ceil
```

输入二选一：源文件＋段 ID，或 `--text <正文或文件路径>`。若 text 参数指向真实文件，读取该文件；否则把参数本身当正文，去首尾空白。源文件模式编译作者源并寻找段的 pronunciation-only Text，不执行 Build、Runtime 请求或模型生成。源码和 segment 不能与 text 混用；未知或重复选项、空正文、找不到段发音视图均错误。

CLI 默认 language=auto、pace=normal、rounding=none、padding=0。pace 和 rate 不可同时存在；API/recipe 要求 language、rounding，以及 pace/rate 恰有一个。language 支持 auto/en/zh/ja/es；rate 为任意正有限数，padding 为非负有限秒数。

| 语言 | slow | normal | fast | 单位 |
|---|---:|---:|---:|---|
| en | 4.2 | 4.6 | 5.6 | 音节/秒 |
| zh | 4.2 | 5.25 | 6.5625 | 近似音节/秒 |
| ja | 6 | 7.5 | 9.375 | 当前实现的字符近似单位/秒 |
| es | 4.72 | 5.9 | 7.375 | 音节近似单位/秒 |

中文规则是每个 Han 字符计一单位，简繁相同；实现还把日文假名逐字符计入 zh/ja 通道。夹杂的英文使用英文音节计数；标点不计数。英文先标准化大小写、撇号和连字符，查 CMUdict，计算发音序列中带重音数字的音素数量。未收录的连字符词分段查词/估计；其他未知词去非 a-z，三个字母以内至少一音节，较长词按去常见静音尾缀及起始 y 后的元音组估计，每个匹配包含一至两个元音，结果至少一。数字、缩写、人名不能凭空展开：纯数字在英文计数中可贡献零，字母缩写可能被错误视为普通词，作者必须明确写出要说的读法。

auto 的检测是轻量启发式，不是 ASR：假名数量大于汉字和 ASCII 字母数/4 时选 ja；否则汉字数大于 ASCII 字母数/4 时选 zh；随后检查西语特殊字符或常见词占比，余下选 en。混合中文大量英文名称时建议显式 zh；不能把检测结果当语言识别保证。

计算为 `units / rate + padding`，最后才做 none 原值、round 最近整秒（半秒向上）、ceil 向上整秒。普通停顿已包含在预设密度中，padding 只表示作者额外留白；不能默认再加通用暂停预算。无可数发音单位、非法政策、round 得到零秒均报错。60 中文单位 normal 为约 11.429 秒、fast 约 9.143 秒；60 英文音节 normal 约 13.043 秒，不等于 60 英文词。

人类输出显示估时、单位数、语言、解析后速率、padding、rounding 和来源；JSON 保存完整数字精度，并包括文字字符数、来源/segment 或文本输入标识、政策和结果。该字符数是 JS 字符串长度，不是发音单位。估时不会自动选择视频模型允许的时长或写回 duration；作者仍需兼顾表演节奏与 `dsivio media models` 的 live capabilities。

### 2.7 transcribe 与 Transcript 文件

```sh
dsivio-video transcribe recording.mp4 --language zh --to recording.transcript.json --json
```

一个音频或视频文件，必须 language 和新输出路径；未知选项、重复选项、已有目标均失败，写入也采用独占创建，允许自动创建父目录。源实现还接受 runtime/workspace 参数选择 Endpoint/Profile；这是源行为，不应成为 dsivio-video 的新 Runtime Profile 设计。

已是标准 16 kHz mono PCM s16 WAV 时原字节直接作为 Evidence；否则 FFmpeg 取第一音轨 `0:a:0`、弃画面、转同格式。这里不走完整 Normalize 选流策略，没有音轨会在提取时失败。一次 immediate Need，不创建 Build、Result 或长期任务状态。

对外的 JSON 文件与 stdout 摘要不同。源文件格式的**字段说明**如下，dsivio-video 应换掉格式标识而非冒用旧协议：

| 层级 | 字段 | 行为 |
|---|---|---|
| 根 | format、source、language、audio_seconds、passages | 格式版本、绝对源路径、请求语言、音频时长、声学段数组 |
| passage | text、start_seconds?、end_seconds?、words | text 是识别词以空格连接；中文也如此，不是 Script 显示真相 |
| word | text、start_seconds?、end_seconds?、score? | 时间缺失就省略；置信度可选，0–1 |

文件里的秒数由整数采样除 16000，再保留三位小数；不应用作再次生成精确内部采样时钟的依据。段时间可以缺失或与词范围不同。stdout 的 JSON 是执行摘要，含输入、请求语言、音频时长、是否提取、服务信息、passage 数、word 数和输出路径，不是完整 transcript。进度应与 JSON 主输出分流。

**语言规则与 estimate 不同**：transcribe/带词 SemanticTake 要求显式小写两或三字母代码，例如 en/zh/ko；拒绝缺省、auto、und、区域标签、大小写混用。是否真的支持由所选服务的对齐模型决定。底层 Python API 自身允许自动检测，但公开作者/CLI 合约不允许；不要把二者混淆。当前 provider 也不验证 wire response 的语言等于请求，文件写的是请求语言。

WhisperX wire 秒数转 Evidence 时，每边界只做一次 `round(seconds × 16000)`。非有限、负开始、反向、超采样域的 wire 时间不进入 Evidence，文字仍可保留；score 只接受 0–1 的有限数。adapter 优先有词的 segments，若 segments 全无词且顶层 words 存在则回退到顶层 words；没有两种数组才失败。当前本地服务不开字符级输出，因此 chars 为空，未输出 speechActivity；更丰富的 provider-neutral Evidence 类型仍支持这些数据。

### 2.8 WhisperX 本地服务：模型、权重与 API

这是独立、常驻、可信 Python 进程，不是 DVML 模块。Node adapter 暂存**未经二次转换**的标准 WAV，先查 health 身份，再提交本地绝对路径；协议只用于 loopback HTTP，不是把本机路径交给远端服务器。

| API | 请求/结果 |
|---|---|
| GET /health | ok、protocol、serviceVersion、whisperxVersion、model、device、compute、batchSize；ASR 加载完成后可用，不证明全部语言权重已准备 |
| POST /transcribe | application/json，Content-Length 必须提供；仅允许 audio_path 与可选 language |
| 成功响应 | language＋segments；segment 包含 text、可选 start/end 秒、words；word 包含 text、可选 start/end 秒、score |
| 失败响应 | error 对象，包含 code 和 message |

源部署默认 ASR=small、CPU、int8、batchSize=8、端口 8765；服务版本 0.1.0、WhisperX 3.8.6。Node 每次对比协议和这六项版本/执行配置，不一致立即失败，不接受“健康但不是指定模型”的结果。默认请求超时 10 分钟、结果 JSON 上限 64 MiB，health 上限最多 64 KiB；同一超时信号覆盖 health 和推理请求。

ASR 模型与语言对齐权重是两套资源：ASR 使用 faster-whisper / CTranslate2 模型名或本地目录；small 是轻设备默认，不是质量排名。large-v3 可在合适硬件上选择；CUDA 示例可用 float16 与较小 batch。`.en` ASR 模型拒绝明确的非英文请求。Apple Silicon 不意味着 CTranslate2 支持 CUDA 或 PyTorch mps，CPU int8 是该默认路径。

语言 aligner 由固定 WhisperX 版本的默认注册表选择：先查 torchaudio，再查 Hugging Face；无默认 aligner 的语言拒绝。仓库没有自建语言→权重名表，本文也不把未经读取的上游具体权重名写成事实。ASR 缓存必须含 model.bin/config.json/tokenizer.json；HF aligner 要有配置、实际权重（包括可接受的分片索引形式）且能读 processor/tokenizer；torchaudio 依其上游 bundle checkpoint 文件名定位。ASR 变大不会自动切换为“更大对齐器”。

准备阶段明确下载 ASR、所选 language 的 aligner、NLTK 句子资源；Pyannote 默认 VAD checkpoint 随所固定 WhisperX wheel 提供。推理阶段只能读本地缓存：HF local-files-only，torchaudio/NLTK 的下载入口被禁止。资源缺失返回准备指引，不在第一次渲染中偷偷下载。默认复用上游 HF/torch 缓存，可明确选同一缓存根及 huggingface/torch 子目录；alignmentLanguages 是准备需求，不是运行期白名单，已缓存且上游支持的语言仍可使用。aligner 第一次使用加载到内存，之后进程内复用。

服务把 s16 PCM 转 float32 后 ASR，再取检测/返回语言选择 aligner；无 speech segments 时直接返回空 segments。调用 alignment 时关闭字符级输出。服务不跑 FFmpeg、不修 Script、不分字幕、不创建 SemanticTake、不缓存 Build。

一次只允许一个推理，第二个直接请求返回 503 BUSY，不进入暗队列；health 在推理中仍可响应。请求最大 64 KiB，音频最大 512 MiB。路径必须绝对、解析符号链接后仍在配置允许根内、为普通文件；默认允许 OS 临时目录。服务再次检查标准 WAV、正采样数及数据长度。

| HTTP | 典型错误 |
|---|---|
| 400 | INVALID_JSON / INVALID_REQUEST / UNKNOWN_FIELD / INVALID_AUDIO_PATH / INVALID_INPUT / INVALID_LENGTH / TRUNCATED_REQUEST |
| 411 | LENGTH_REQUIRED |
| 413 | REQUEST_TOO_LARGE |
| 415 | UNSUPPORTED_MEDIA_TYPE |
| 503 | BUSY / RESOURCE_NOT_PREPARED |
| 500 | INFERENCE_FAILED，详细异常留服务日志 |
| 404 | 不支持的上述方法路径 |

日志记录加载、转录、对齐和耗时，不输出 transcript/audio 正文。准备下载与运行日志应分离。更新语言资源且缓存根不变可不重启；改变模型、设备、compute、batch、缓存根或服务代码，需要空闲时明确重启，不能仅重启上层 Build worker。

### 2.9 semantic-take-adjust：校准锚点而不是编辑媒体

输入是完整 SemanticTake 与同 Narrative 的调整计划，至少一条“既有 anchor → 局部整数帧”。公开 markup 的 Adjust 父元素需要 id/source，子元素只接受空 Anchor，`at={story.moment.cue}` 指向作者 inline Moment，`frame="63"` 指向 **Take 本地**而非节目全局帧。Moment 是选择目标 Anchor 的便利入口，不是新造可任意定位的锚点。

每个目标必须已存在，不可重复，帧必须是 0…F 的安全整数；不能混 Narrative。调整同时更新 anchor 表以及引用该 anchor 的 Token 起/终帧和 Segment 边界，其他锚点、词、文本、媒体 Artifact 不变。不是把附近词一并平移，不插值传播，不改变发音，不重新识别，不 trim/retime、不移动 Timeline Take。

最终仍执行 SemanticTake 不变量：词起点序列和终点序列不得倒退，起点不得晚于终点，锚点与词必须一致，Segment 必须完整覆盖 0…F。因此虽然计划形式能指定段锚点，实际不能把段起止改离媒体边界；节目起止根本不在局部 Take 中。需注意初次物化拒绝零宽 Token，但通用 Take 校验允许起止相等，所以调整可能产生零宽词；这是源行为差异，不应误写为“一切词恒有至少一帧”。

校准一个词边界与移动 Script Moment 是两种操作：前者修正当前媒体对应的测量帧，所有绑定该 Anchor 的消费者随之移动；后者改变作者想绑定哪一个语义边界。源实现未提供自动置信度筛选、比例拉伸整段或可持久化修订历史。

## 3. 关键概念与数据形状

以下为 dsivio-video 的自有命名建议，以关系表表达，不复制源类型定义。

| 概念 | 建议字段与约束 |
|---|---|
| Narrative | `storyKey`、`passages`、`utterances`、`spokenUnits`、`anchorCatalog`、`ranges`、`cues`、`captionTruth`；全部是作者顺序/关系，无时间码 |
| 段引用 | `storyKey`、`passageKey`、`spokenBounds`、`boundaryAnchors`；完整段摘录，不是任意词范围 |
| Evidence | `acousticBlocks`；每块含 `recognizedUnits`、`characterMeasurements`、可选 `voiceRegions`；采样坐标为 `sampleIn/sampleOut`，固定 16 kHz，可缺测，无段 ID |
| Prepared media | `frameClock`、`totalFrames`、可选 `pictureBlob/pictureSize`、可选 `soundBlob`；48 kHz 主音频规则由协议固定 |
| SemanticTake | `storyKey`、`preparedMedia`、`passageBinding`、`locatedWords`、`anchorPositions`；帧是局部坐标，段范围等于媒体范围 |
| Timeline | `axisKey`、`frameClock`、`extentFrames`、可选 `storyKey`、`placements`；每次放置含 take 与 `offsetFrames` |
| Instant | `consumerKey`、`axisKey`、`originBinding`、`authoredExpression`、`editAuthority`、`resolvedFrame`；原始单位和语义源不能丢失 |
| Window | `consumerKey`、独立 `leading/trailing` Instant、物化 `frameIn/frameOut`；半开、正跨度 |
| 校准计划 | `storyKey`、`edits`，每条 `anchorKey/localFrame`；不包含媒体改写 |
| 估时报告 | `origin`、`speechUnits`、`resolvedLanguage`、`deliveryRate`、`extraHoldSeconds`、`roundingRule`、`estimatedSeconds` |

Selection 身份、内容词范围和物理 Window 是不同数据；Frame 表示统一域中的整数边界，不是可以跨 Clock 任意复用的裸整数。Transcript 文件是面向取证的有损秒格式，不等同内部 Evidence。

## 4. 对 dsivio-video 的建议

### 必须保留

- Script/Narrative 的发音与显示分离、稳定锚点、空段、Role/Segment/Cue 的不同边界、Selection 亲和方向。内部协议不得依赖 Script AST，给未来其他作者前端留同等输入入口。
- Normalize 显式选流、统一 origin、精确帧域、音频裁补、透明性以及 fail-closed 歧义处理。保留独立 FFmpeg Need，而非把对齐变成隐含媒体预处理入口。
- 单段 SemanticTake、完整词映射、局部→全局平移、整数/有理数算术。保留分组动态规划应对中英分词差异，保留失败诊断与显式局部校准。
- 带词对齐必须指定语言；measure 与 transcribe 分离。保留 Timeline 不自动呈现，以及 Temporal 的来源、消费身份和编辑权限。
- 模型/语言权重明确准备、推理禁止联网下载、health 配置一致性、CPU int8 默认与单推理互斥。即使无需重现旧 Provider 架构，这些实际部署性质不能省掉。

### 可简化

- 用 Dsivio 已捆绑 Python 3.12 建立受控语音环境，无需默认另装 Python 3.13；它符合源项目声明的 3.10–3.13 区间，但仍需验证与选定锁定依赖的兼容性。保留权重准备与运行分离，不保留复杂 Endpoint/Profile 管理。
- Node 22.23 负责纯匹配、时钟和 CLI；FFmpeg/ffprobe 使用宿主捆绑版本。分包数量、独立版本 Manifest 可以收敛，行为边界不能收敛成不可观察黑盒。
- estimate 首先重建 zh/en；ja/es 是否暴露由产品明确决定，不能声称完全兼容后静默删除。速率表是作者默认，可设置显式 rate，不把其当特定生成模型预测器。
- transcript 采用 dsivio-video 自有版本标识与自有字段名，提供一次性迁移/导入约定，而非兼容性别名。可在 Build 内额外存精确 Evidence，避免从三位小数文件恢复时钟。

### 砍掉与 Dsivio 映射

- 砍掉 Runtime Profile endpoint bindings、外部 gateway、凭证/云存储逻辑，以及每组件 studio 重复包；不要为 WhisperX 另建付费供应商配置体系。
- 付费 image/video 只能经 `dsivio media`。通用 gen:Image / gen:Video 必须显式 model，计划时校验 live capabilities，并展示/保存解析后的精确请求。完成的生成媒体与录制素材一样进入 Normalize，本节不含任何 vendor 协议。
- 不能因为源链路支持 speech，就假设 Dsivio 支持 TTS、语音生成或 matting。当前可对导入音视频及生成视频自带音轨做本地对齐；无音轨视频不能产生带词 SemanticTake。独立配音需用户真实音频输入，或等待宿主实际能力，不添加伪 TTS fallback。
- 本地 ASR/对齐不是付费 generation，可由插件受控执行；宿主任务队列、密钥和付费 idempotency 不能在插件里复制。模型任务 exit 5 的不确定状态绝不能触发重新生成；恢复策略不应由语音组件自作主张。

## 5. 依赖与外部程序

- 核心纯数据依赖：Narrative、媒体 Artifact、SynchronizedMedia、ProgramClock、SemanticTake、Timeline、Temporal；estimate 使用 Text、发音字典和纯数字政策，不依赖服务。
- 进程/执行依赖：Node、FFmpeg、ffprobe、临时文件与资源存储、loopback HTTP Python 服务；重采样/编码属于外部执行边界。
- 源语音服务锁定 WhisperX 3.8.6，直接依赖 NumPy 2.x，间接使用 faster-whisper、CTranslate2、PyTorch/torchaudio、transformers/Hugging Face、NLTK 与 VAD。英文估时依赖 CMU pronunciation dictionary。
- 冷准备涉及 Python 包、ASR 权重、aligner 权重和句子资源四类独立下载；推理只能使用已准备缓存。代理/镜像选择应是操作者明确行为，NLTK 代理授权也不能由插件偷偷开启。
- ffmpeg 版本及真实编码器可用性影响 opaque/alpha 编码；超时、缺二进制、无法解码、结果帧/采样数不符需要直接错误，不用无声或空白假素材代替。

## 6. 待定问题

1. 是否给每词保存“实测/插值/手工修正”与分组诊断？源实现只保证公共 Take 完整，没有这种来源标记；对低质量录音尤为重要，属于新设计，不能说已有。
2. 校准是否应禁止零宽词？源初次物化与后续校验不一致。需要一个明确的 dsivio-video 合约，并评估字幕消费行为。
3. 帧率是否在入口约分，避免数学同率却不相等？约分是可取的新规范，当前源实现直接比较原始分子/分母。
4. WhisperX 环境如何使用捆绑 Python 3.12、如何分发依赖锁/离线权重、模型资源大小和缓存位置如何向用户展示？源服务目录无安装环境可供本次核验；不承诺具体中英 aligner checkpoint 名或 Apple 硬件加速。
5. transcript 导出继续三位小数，还是并列精确采样坐标？若改变格式需新版本，不能让分析工具误用近似秒数作 exact clock。
6. 是否扩展 audio authority 到含视频的素材？源本地明确不支持，该能力不是改一个属性就可获得。
7. 本地转录与宿主任务队列如何协同取消、并发和进度？保留服务 BUSY 语义即可描述源行为；不要在插件里再建隐含重试队列。

## 7. 来源

以下均在 `/Users/zmmini/zmdata/work/dsivioplugin/` 下阅读；主要依据为实现，README/编辑规格用于补充作者语义。未运行所列测试。

- `packages/script/README.md`；`src/lexical.ts`、`src/error.ts`；`src/parser.ts`、`src/narrative.ts` 的正规化/Token 投影定位片段。
- `packages/narrative/README.md`；`src/identity.ts` 的 Token/Anchor 校验定位片段。
- `packages/speech/src/identity.ts`、`src/materialize.ts`。
- `packages/speech-evidence/src/index.ts`。
- `packages/speech-alignment/src/align.ts`、`src/normalize.ts`、`src/locate.ts`、`src/local.ts`；`test/speech-align.test.ts` 的测试目录与声明。
- `packages/semantic-take-adjust/src/program.ts`、`src/surface.ts`；`test/semantic-take-adjust.test.ts`。
- `packages/whisperx/src/manifest.ts`、`src/types.ts`、`src/surface.ts`、`src/fragment.ts`、`src/evidence.ts`、`src/transcript.ts`。
- `packages/provider-whisperx-local/README.md`；`src/provider.ts`。
- `services/whisperx/README.md`、`pyproject.toml`；`src/hypit_whisperx_service/server.py`、`application.py`、`engine.py`、`models.py`、`audio.py`。
- `packages/timeline/src/identity.ts`、`src/location.ts`。
- `packages/timeline-author/README.md`；`src/program.ts`、`src/surface.ts`。
- `packages/program-space/src/index.ts`、`src/surface.ts`。
- `packages/temporal/README.md`；`src/location.ts`、`src/projection.ts`、`src/rational.ts`、`src/sample.ts`、`src/schedule.ts`。
- `packages/temporal-markup/README.md`、`EDITING.md`；`src/index.ts`。
- `packages/estimate/README.md`；`src/program.ts`、`src/policy.ts`。
- `packages/media-pipeline/README.md`；`src/selection.ts`、`src/surface.ts`。
- `packages/provider-media-local/src/provider.ts`；`packages/media-execution/src/execute.ts` 的 normalize 计划、执行与证据音频投影部分。
- `packages/video-cli/src/creation.ts` 的参数、目标文件、音频提取、transcribe、measure 和帮助；`src/transcript.ts` 的格式定位片段。
