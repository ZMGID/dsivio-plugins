# 媒体准备、进程执行与浏览器采集

## 1. 概述

本篇覆盖媒体资产声明、底层媒体执行、八个 `media` 子命令、即时转写、网页采集、节目帧快照，以及下载器和 OpenCV 本地运行环境。依据为所列实现文件的静态阅读；本次没有执行下载、浏览器安装、构建、测试或外部服务。以下明确区分“观察到的行为”和“迁移建议”，不是运行验证报告。

这一层有三种不同职责：

- **声明资产**：在 Author Graph 中命名既有图片、音频、视频和字体；由 Host 获取不可变字节，不生成内容，也不把音频自动解释为语音。
- **技术执行**：根据明确的 Need 做探测、归一化、裁切、变速、抽帧、混音及封装；结果可以是 Blob，也可以是描述 Blob 的内联事实。
- **作者取证工具**：把输入文件、网页或已编译节目转成可检查的文件。帧标签、转写上下文和视觉变化分数都只是证据，不替作者判断镜头、静默、剧情或剪辑点。

`media` 无需项目 Run、Build 或 Runtime Profile；其中 `fetch` 确实联网，`prepare-fetch` 也可能联网准备环境，不能把整组命令说成“绝不联网”。`capture` 不经生成 Provider。源实现的 `transcribe` 和 `snapshot` 则通过选定 Runtime Profile 发起一次即时能力调用，但不建立 Build。Dsivio 版本应移除这些 Profile 绑定：本地处理直接执行，收费图像/视频生成只走 `dsivio media`。

## 2. 行为规格

### 2.1 共同约束与错误边界

CLI 形态统一写为 `dsivio-video media <子命令> ...`。除 `prepare-fetch`、`fetch` 外，每个命令恰有一个本地输入文件，按工作目录解析成绝对路径并确认是普通文件。`fetch` 恰有一个 HTTP(S) 地址；`prepare-fetch` 不接受位置参数。

`media` 所有命令接受 `--json`；解析器还容忍全局 `--debug`、`--verbose`、`--no-color`、`--color <值>`，它们不改变采样或编码。普通选项不准重复，唯一可重复的业务选项是 `cut --keep`。未知选项、缺值、重复布尔业务标志、位置参数数量错误都会报错。秒数为有限非负数，整数参数为安全整数。该解析器采用分离式选项值；不要据此推定支持 `--start=1`。发现 `--help` 时显示帮助而不执行。

有 `--to` 的媒体命令均要求显式目标；目标已经存在时拒绝写入，父目录可递归创建。没有“强制覆盖”标志。实现强度不同：

- `cut` 在目标同目录生成临时成品，然后用硬链接发布；即使另一进程抢先创建目标，也不会覆盖。
- `frames`、`tiles`、`snapshot` 用同目录临时目录生成完整结果，成功后重命名，失败清理临时目录。
- `tile` 和 `fetch` 有事前存在性检查，但写入/重命名本身不是排他发布；源实现对竞争写入的保护并不等同于 `cut`。
- `capture` 先用排他创建保留文件名，失败删除自己保留的输出；`transcribe` 最后以排他写入发布。

错误内容应包含出错选项、范围上限、来源或目标路径、外部程序退出信息。源 CLI 总入口对未处理错误返回退出码 1；非 JSON 错误发 stderr，JSON 错误经统一渲染器发 stdout。不要将这个本地工具错误码与宿主收费生成的 2/3/4/5/6/124 混为一套。JSON 成功输出不夹杂进度；支持进度通道时进度去 stderr。

### 2.2 `probe`

形态：`dsivio-video media probe <file> [--json]`，无业务选项。

用 ffprobe 读取容器时长和各流的类型、宽高、标称帧率、封面标记。视频选择第一条不是 attached picture 的视频流；音频存在性取任意音频流。必须得到有限且大于零的容器时长，以及至少一种音频/视频流。视频宽高缺失报错；标称帧率的分数不能解析为正值时显示为 0/静态。时长和帧率保留三位小数。只有封面图加音频的文件在这个轻量视图里是纯音频；它不等同于底层“逐帧完整探测”。

文本输出包括绝对路径、秒数、视频尺寸、帧率、是否含音频；纯音频单独标明。JSON 包含路径、时长、音视频存在性；视频另有宽、高、帧率，纯音频不伪造这些字段。普通单张图片如果没有有效容器时长，不能指望本命令接受。

### 2.3 `cut`：生产裁切与带时间的证据副本

形态：

```text
dsivio-video media cut source.mp4 [--start <s> --end <s> | --keep <start:end> ...] [--label-time] --to output.mp4 [--json]
```

| 参数/条件 | 精确行为 |
|---|---|
| `--start`、`--end` | 默认 0 和探测时长；开始非负、结束大于开始，结束允许比探测时长多最多 0.001 秒 |
| `--keep` | 每值恰为两个以冒号分隔的秒数；多个区间按输入顺序连接，必须前后有序、不重叠；相邻端点相等允许 |
| 模式互斥 | 任何 `--keep` 都不能同时给 `--start` 或 `--end` |
| `--label-time` | 只允许一个视频区间；即使通过一个 `--keep` 指定也可用；纯音频或多区间报错 |
| 纯音频目标 | 强制 `.wav`；不是自动改名 |
| 视频目标 | 不在 CLI 中做固定扩展名白名单；由 ffmpeg 容器/编码兼容性决定成功与否 |

**无标签的生产输出**：只读取输入一次，必要时从首段开始前两秒寻址。视频/音频分别分流，各段做时间裁切、重设零点，再按顺序连接；仅保留第一条视频和第一条音频，不把字幕、附件或额外流带入。视频 H.264，medium 预设、CRF 17、YUV420、可变帧率；MP4/MOV 添加 faststart。含视频时音频为 AAC 192 kbit/s；纯音频为 24-bit PCM WAV。未做淡入淡出、交叉转场或静音补齐。

**有标签的证据输出**：先做干净短片，再进行第二次编码，把源时间叠加在左上角 `(8,8)`；两个编码步骤都使用 H.264 veryfast、CRF 23、AAC 96 kbit/s 和 faststart。时间标签刷新率为源帧率向上取整、限制到 1–30；帧率未知按 10 处理。首个标签是区间源起点，随后按标签刷新步长递增。它是源时间参考，不应冒充逐帧真实 PTS。

完成后重新探测输出，JSON 同时返回：目标路径、原区间列表、各原区间到新零点时间轴的名义映射、请求总秒数、实际输出时长、音视频存在性、是否加标签；单区间另有起止值。名义映射按各段请求长度累计，不能用它代替编码后实际测量。

### 2.4 帧、网格的共同采样与转写规则

适用于 `frames`、`tile`、`tiles`：

| 选项 | 行为 |
|---|---|
| `--at <s,s,…>` | 至少一项，均非负且严格递增、严格早于文件结束；不能同时有 `--start`、`--end`、`--every`、`--frames`、`--around`、`--occurrence`、`--padding`；可以附 `--transcript` |
| `--start`、`--end` | 默认 0 和文件时长；满足 `0 ≤ start < end ≤ duration` |
| `--every <s>` | 至少 0.001 秒；从 start 开始，按步长取样，排除 end；时间四舍五入到毫秒后再去掉不早于 end 的项 |
| `--frames <n>` | 只在 `tile`、`tiles` 接受；整数至少 2，与 `--every` 互斥 |
| 默认网格样本数 | 时长乘 1.5 后四舍五入，再限制到 4–9；把区间均分成 n 份，取每份中点，不取两端点 |
| 毫秒精度 | 生成的时间必须仍严格递增；过密采样导致四舍五入后重复时明确报错，不默默合并 |
| `--around <phrase>` | 必须有 `--transcript`，替代 `--start/--end`；在转写词序列中匹配整词或连续整词，不匹配词内子串 |
| `--occurrence <n>` | 从 1 开始；多次匹配而未指定时列出各次时间并报错；超过匹配次数报错 |
| `--padding <s>` | around 两端各扩展，默认 0.3，有限非负；裁到 `[0,duration]`。与 occurrence 一样，不用 around 时不允许给 |

短语匹配先做 NFKC 规范化、转小写、去标点与空白，然后连接连续词进行比较。空查询、没有匹配、匹配首词缺起点或末词缺终点都报错；不根据邻词猜出缺失边界。扩展后完全落在文件外也报错。

转写输入须为版本化 JSON，含 passage 序列，每段包含词序列。词必须有字符串文本，可分别缺起止时间；存在的时间必须有限非负，齐全时终点不得早于起点。不强制全局排序，也不把缺时间补成 0。迁移后的文件字段见第 3 节；不要直接兼容旧品牌格式标记。

选一张视频帧时，先跳到请求时间前最多两秒，再从该位置解码，取**第一张 PTS 不早于请求时间的帧**。保留源时钟，读取 ffmpeg showinfo 的时间基和 PTS 得到实际源秒数；因此请求时间与实际帧时间常不同，JSON 必须保存二者。JPEG 使用 full-range YUV420 和质量档 3。请求落在容器尾部但没有后继帧时仍可能报“没有可用帧”，不能因为请求小于容器 duration 就保证成功。

转写标注绑定实际帧时间：活跃词满足 `begin ≤ t < end`，可同时有多个。上下文取第一个活跃词前三词到最后一个活跃词后三词；没有活跃词时，用有任一边界时间且距离 t 最近的词为锚点；所有词都无时间则上下文为空。活跃词缺失的标签只说“该帧没有计时词”，不宣称静默。

**标签与拼图**：

- 单纯 `--label-time` 的采样 JPEG 用内建数字点阵，不需要 ffmpeg drawtext、外置字体或 Pango；黑底近白字，`HH:MM:SS.mmm`，画在 `(8,8)`。数字/冒号/小数点采用 5×7 网格、字间空隙和整数放大；默认三倍，标签高度取偶数。
- 网格及转写标签由 sharp 的文本接口渲染：首行源时间；接着活跃词加粗并列各词三位小数时间区间；最后是上下文，活跃词黄字加粗。先转义文本的 `&<>`，避免转写被当成标记。字体 sans，字号为 cellWidth/28 四舍五入且至少 12，文本宽为 cellWidth−16，支持词/字符换行，四周各留 8 像素。
- 图片按 cellWidth 等比例缩放，不裁切。整页画布近黑，外围与单元间隔均 8 像素。全页图片区高度取所有图片最大高度，标签区高度取所有标签最大高度；最后一行不满时保留空黑格。画布宽为 `columns×(cellWidth+8)+8`，高为 `实际行数×(图片最大高+标签最大高+8)+8`。

### 2.5 `frames`

形态：`dsivio-video media frames <file> (--at <列表> | --every <s> | --every-frame) [共同范围/转写选项] [--label-time] --to <新目录> [--json]`。

采样模式必须明确给 at 或 every；不像网格那样自行选默认样本数。要求视频流。文件名按**请求时间**生成，如 `frame-2_500s.jpg`。无转写时可选左上时间叠加；有转写时总是标注，使用源宽、单列拼图，时间及词文本放在图片下方，输出尺寸含边距和标签。JSON 返回目录、标注开关、每张帧的目标路径、请求时间、实际时间，以及可选的活跃词/上下文；没有转写时不伪造词字段。

`--every-frame` 切换为原始帧模式：与 at/every 冲突；本命令不接受 frames、ranges、cell、columns 或 rows。范围仍能用 start/end 或 around。每区间一次连续解码，以半开 `[start,end)` 保留所有原始帧，使用 passthrough 帧率模式，不补帧、不重新等间隔采样。通过 showinfo 的逐帧 PTS 求真实时间。文件名改为九位零补齐的帧序号，如 `frame-000000000.jpg`；标注或转写均使用图片下方标签。JSON 只给目录和原始帧的实际时间、目标路径，不产生请求时间或普通模式的标注开关。空区间无帧报错。

### 2.6 `tile` 与 `tiles`

`tile` 输出一个网格文件：

```text
dsivio-video media tile <file> [共同采样/转写选项] [--frames <n>] [--cell <px>] [--columns <n>] --to <image> [--json]
```

所有单元格始终有时间标签。`--cell` 为整数至少 80，默认 `max(80,min(480,源宽))`；`--columns` 为整数至少 1，默认 3。没有 rows 标志，也没有 every-frame 模式。目标文件格式由 sharp/扩展名决定，不强制 JPEG。JSON 包含目标路径、全部请求时间、列数、实际行数、单元宽、逐帧实际时间和词信息。

`tiles` 输出新目录中的分页 JPEG：

```text
dsivio-video media tiles <file> [共同采样/转写选项 | --ranges <json>] [--frames <n> | --every <s> | --every-frame] [--cell <px>] [--columns <n>] [--rows <n>] --to <新目录> [--json]
```

默认列数 3、每页最多 3 行；rows 是整数至少 1；cell 同 tile。每页容量 columns×rows。最后一页实际行数按剩余帧计算，不强行填满 rows。

`--ranges` 文件必须是非空 JSON 数组；各区间具有非负起点、较大终点且终点不超过时长，可有文件名安全标识、帧数或步长。标识匹配“首字符字母或数字，其余字母数字/点/下划线/连字符”；普通模式的显式标识必须唯一。区间可以重叠，也不要求时间排序，按数组顺序处理。单项 frames/every 互斥；局部采样设置覆盖 CLI 默认并去掉另一采样模式。ranges 不能和 start/end/at/around/padding/occurrence 同用；仍可给 transcript 来标注。

文件名为三位区间序号、区间标识或毫秒起止串；只有区间超过一页时才加三位页号，例如 `001-intro-p001.jpg`。不同区间独立分页。无 ranges 时也形成一个区间；at 模式的区间元数据采用第一和最后请求时间，单个 at 时元数据起终点可以相同，不代表空采样。

普通 JSON 给目录、列/最大行/单元宽，以及逐页清单；每页包括区间标识（若有）、区间起终点、该页请求时间、图片路径和帧详情。文本仅概述网格数，不截断 JSON。

`tiles --every-frame` 同样逐区间连续解码，再分页标注；拒绝 at/every/frames，ranges 单项也不准含帧数或步长。支持 ranges 的范围元数据及 transcript。每页始终带页号，如 `001-frames-p001.jpg`；JSON 精简为目录和逐页的路径、各原始帧实际秒数，不含普通模式的请求样本、区间元数据或 cell/列行参数。源原始帧分支没有复用普通 ranges 的标识去重检查；区间序号仍使文件名不冲突。

### 2.7 `boundaries`：唯一视觉分数的计算

形态：`dsivio-video media boundaries <file> [--rate <samples/s>] [--threshold <0..1>] [--json]`。必须含视频；rate 默认 12，有限且在 1–120 范围内，允许小数；threshold 默认 0.1，闭区间 `[0,1]`。

算法是相邻采样帧的归一化绝对像素差，**不是 ffmpeg scene 分数、直方图差、边缘差、光流或音频检测**：

1. 整段视频通过 ffmpeg 变为指定固定采样率、32×32 像素、RGB24 的原始帧序列。
2. 每 3072 字节是一帧，不足一帧的尾部字节忽略。
3. 从第二帧开始，每个 RGB 字节与上一帧相应字节取绝对差；累加后除以 3072，再除以 255，得 `[0,1]` 分数。
4. 以未舍入分数比较 threshold；大于等于阈值就保留。第 i 个相邻比较的候选时间是 `i/rate`，时间和分数输出均舍入到三位小数。

没有最小镜头长度、峰值抑制、连续候选合并或首尾自动补点；threshold 为 0 时所有相邻帧都入选。输出分数舍入后可能看起来略低于阈值，入选仍以原值为准。时间是采样序号的估计，不是 showinfo 测到的原始 PTS。快速运动、亮度变化、闪光均可触发，不可命名为“切镜头”。文本最多显示前 40 项并提示剩余数；JSON 返回全部候选、源路径、采样率、阈值。实现把整段原始缩略帧收进内存，长视频内存随时长线性增长。

### 2.8 `prepare-fetch`、`fetch` 与下载环境

形态分别为 `dsivio-video media prepare-fetch [--json]` 和 `dsivio-video media fetch <HTTP(S)-url> --to <video> [--json]`。fetch 目标扩展名仅接受 `.mp4/.mkv/.webm/.mov`，大小写不敏感。

源下载服务固定 `yt-dlp[default]` 为 **2026.8.19**，锁文件同时固定 EJS 求解器 **0.8.0**；支持 Python `>=3.10,<3.14`。环境按所选版本放在机器级 Host 状态目录的 `programs/yt-dlp/<版本>/.venv`，而非项目目录。prepare-fetch 显式运行 uv 的 frozen、no-dev 同步，设置专用虚拟环境地址，结束后校验真实下载器版本。fetch 绝不隐式安装：用选定可执行文件调用忽略配置的 version 查询（15 秒超时）；缺失或版本不符提示先 prepare-fetch。校验允许日期版本各段的前导零不同。

fetch 先检查 ffmpeg 可启动（15 秒超时），随后在系统临时目录下载，最大 15 分钟，收集输出上限 10 MiB，允许 API 调用者提供取消信号。调用行为：忽略用户配置，不自更新，不拉远程组件，不加载插件；先清空 JS runtime 选择，再指定调用者当前 Node 可执行文件；关闭播放列表、进度和普通消息。优先独立最佳视频加最佳音频，不可用时退到最佳合流文件；质量排序偏好 1080p 和 H.264，但不是“只准 ≤1080p”。合并容器跟随目标扩展名，不保证视频重新编码为 H.264。

下载结束后过滤 `.part` 文件，将剩余文件名排序取首个成品；没有成品报错。向目标重命名，跨卷失败才改为复制；无论成功失败都清理工作目录。错误保留 URL 和下载器末尾最多 2000 字符信息，取消不包装成普通下载错误。随后 probe 目标并要求有非封面视频。JSON 返回目标、原 URL、probe 事实；prepare-fetch JSON 仅返回可执行地址。封装 CLI 不暴露 cookie、认证或站点参数；需要这些的操作在源系统是作者明确直接调用该固定下载器，下载后再传本地文件。

### 2.9 `capture screenshot/run/install-browser`

| 命令 | 输入、标志及默认 |
|---|---|
| `capture screenshot <URL或本地HTML> --to <image>` | HTTP(S) 大小写不敏感，支持 file URL；普通路径须是文件。默认截可视区。`--full-page`、`--selector <Puppeteer选择器>`、`--clip <x,y,w,h>` 三者互斥。clip 坐标非负，宽高正数；`--transparent` 保留透明背景；`--wait-for <selector>` 等可见元素；`--wait-ms <ms>` 为非负显式延迟 |
| `capture run <script.mjs> [浏览器选项] [-- 参数…]` | 动态导入脚本，必须有默认可调用函数；可导出会话配置。screenshot 的 to/full-page/selector/clip/transparent/wait-for/wait-ms 在此报错，采集路径和时机由脚本选。`--` 后原样传入脚本；screenshot 不准有非空脚本参数 |
| `capture install-browser` | 无位置参数/脚本参数，仅接收全局输出选项和 browser-version/cache/download-base-url；明确下载浏览器，其他命令不自动安装 |

通用浏览器标志：`--viewport <宽>x<高>`（正整数，默认 1280×720）、`--scale <正数>`（默认 1）、`--headed`、`--timeout-ms <非负毫秒>`、`--browser <可执行路径>`、`--channel <名称>`、`--browser-version <四段版本>`、`--browser-cache <目录>`、`--browser-download-base-url <HTTP(S)源>`、`--json` 及常规全局显示标志。省略 timeout 使用 Puppeteer 自身默认，0 表示传给其无限等待设置。

browser 与 channel 互斥；外部 browser/channel 与命令行 managed-browser 设置也互斥。channel 仅允许 chrome、chrome-beta、chrome-canary、chrome-dev。managed 默认 Chrome for Testing **153.0.8010.12**，缓存按显式值、`PUPPETEER_CACHE_DIR`、用户家目录 `.cache/puppeteer` 顺序确定。只计算/检查选定路径；未安装报错并提示 install-browser，不偷下载。安装时必须给精确四段版本，不接受 latest。CLI 参数覆盖脚本相应配置；显式选择外部浏览器会移除脚本 managed 设置。

screenshot 导航等待 load；HTTP 响应非成功时报 URL 和状态。之后按用户要求等可见元素及延迟，再截取。选择器模式等可见元素，截该元素并释放句柄。页面截图完成后 sharp 读取实际宽高、格式；不是把 viewport 当输出尺寸。

run 的会话有 browser、page、截图函数、录制函数、参数列表、日志函数；脚本拥有普通 Node 权限，并不是沙箱，也不自动解读网页。录制使用 Chrome **原生 Page.record**，不是 ffmpeg 屏幕抓取；需要 Chrome 153+，音频显式 opt-in。录制前检查 ffprobe；默认最大像素尺寸为 CSS 内宽高乘 devicePixelRatio 后取整，可被录制参数覆盖。输出为 MP4。stop 可重复调用且共享一次完成 Promise，必须等原生录制停止和文件写完，再 ffprobe 得到实际尺寸、时长、平均帧率、容器和音频存在性。任务正常返回自动停止尚未关闭的录制；异常路径也等待停止尝试，然后关闭浏览器。单文件失败会移除该文件，之前已成功输出的文件不整体回滚。

截图/录制输出都拒绝覆盖、创建父目录、记录绝对路径和页面 URL；视频 URL 取启动录制时页面地址。JSON 返回版本标记和输出序列，每项含类型、路径、URL、宽高、格式；视频另含时长、可读平均帧率、含音频与否。install-browser JSON 返回版本标记和浏览器路径。非 JSON 显示每个保存文件及最终数量；进度尽量走 stderr。

### 2.10 `transcribe`

形态：`dsivio-video transcribe <audio|video> --language <code> --to <transcript.json> [--json]`；源 CLI 额外接受 `--runtime <profile>`、`--workspace <project>`，两项在迁移中应删除，不保留伪绑定。

language 必填：小写 2–3 字母，不接受 auto、und；代码格式合格不等于所选转写执行器真的支持。恰有一个输入文件、目标不能存在。先读 RIFF WAV：已经是 16 kHz、单声道、16-bit PCM 时保持字节；否则 ffmpeg 选第一条音频，丢弃视频，转为同一规范 WAV，复查格式。时长由数据字节/2/16000 得到，保留毫秒。无音轨由转换失败说明，不假造空转写。

源行为是建立一个对齐 Need，选择唯一可执行 Provider，执行前说明其身份和本地/价目页信息；未绑定、歧义、不支持都报有行动指引的错误。内联返回段落和词；采样边界除以 16000 得秒，缺失边界继续缺失，保留词置信分；段落文本由词以空格连接。真正写入的文件包含格式版本、绝对源路径、语言、音频秒数、完整段落/词。stdout JSON 则是摘要：转写文件路径、是否发生音频抽取、执行器/价格来源、段数、词数、时长，不把摘要误当完整转写。进度按连续阶段去重。

**Dsivio 限制**：宿主当前只有图像/视频生成，没有 ASR/TTS；不能把此命令转发到不存在的 `dsivio media transcribe`，更不能自行接收费供应商。可保留导入本地转写以及所有 around/标注功能；完整 transcribe 需要另行确定免费本地 ASR/对齐运行包、模型和部署方式。Python 3.12 本身不是转写能力。

### 2.11 `snapshot`：节目帧而非普通网页截图

```text
dsivio-video snapshot <compiled.html|HTML-URL> --at-frame <n[,n,…]> --to <新目录>
dsivio-video snapshot --studio <studio-URL> --at-frame <n[,n,…]> --to <新目录>
dsivio-video snapshot <HTML输入> --start-frame <n> --end-frame-exclusive <n> [--step-frames <n>] --to <新目录>
```

另有 `--grid <列>x<行>`、`--cell <px>`、`--json`。源实现也有 runtime/workspace，迁移删去。索引从 0 开始、均为安全非负整数；范围满足 `start < end ≤ 节目帧数`，排除 end；step 默认 1、至少 1；显式帧列表与所有范围标志互斥。显式帧列表后续交给渲染请求校验，不应推定 CLI 自身已经检查所有越界或去重。

studio 是带协议的基 URL，读取 `/__studio/document` 的当前节目文档；普通 HTTP(S) 输入读取 HTML，普通本地输入读文件；以编译 HTML 的有理帧率/总帧数为时钟，不允许把普通页面 wall-clock 采样当节目帧。HTML 脚本、样式应已内联，外部图像/视频/字体资产被收入临时 ResourceStore。网络 HTML 不得读取本地 file 资产；不支持的协议、扩展名或网络 MIME 报错。允许 PNG/JPEG/WebP、MP4/WebM、WOFF/WOFF2/TTF/OTF。studio 输入只取所选帧区间相关资产，读取对应 material URL。

源实现即时请求 render-frames，要求内联图像列表且返回数量与请求一致。每帧存原尺寸 PNG，九位帧索引文件名。grid 列行均至少 1；cell 只有给 grid 才允许，默认 480，至少 32。每页最多列×行图，JPEG 网格三位页号；标签是帧索引和按节目有理时钟计算的秒数，保留六位小数，不是源视频抽帧标签。JSON 返回输入来源、执行器信息、逐帧索引/节目秒数/路径和网格路径。输出目录预检、临时生成、完成后发布；临时资产在所有路径清理。

### 2.12 `media` 资产声明与 `media-execution` 的运行契约

资产声明元素为 `media:Image/Audio/Video/Font`，禁止元素子节点及非空文本。前三者仅有 id、src 和可选 media-type；必须非空，Host 解析并暂存资源后检查实际返回 MIME 主类。字体额外必须给真实字重 1–1000 整数及 normal/italic/oblique；不是合成粗体/斜体。扩展名推断忽略 query/fragment、大小写：

- 图像：AVIF、GIF、JPEG/JPG、PNG、WebP。
- 音频：AAC、FLAC、M4A、MP3、OGA/OGG、OPUS、WAV。
- 视频：M4V、MOV、MP4、WebM；MKV 下载目标与资产声明默认扩展表并不完全一致，后者需显式 MIME。
- 字体：OTF、TTF、WOFF、WOFF2，不支持以面索引选 TTC/OTC；多分片字库可由其他组件提供统一字体面。

这一声明不做 probe、不决定视频/音频用途。归一化以后下游只拿一个共同帧率/帧数、可选画面及固有尺寸、可选规范音频，不再携带选择策略、源流索引或执行账本。

底层执行器接受资源读写入口、明确 ffmpeg/ffprobe 路径、进程超时和探测输出限制。无 shell，stdin 忽略；媒体进程只继承 PATH，Windows 另保留创建进程必须的系统/临时目录变量；可显式加共享库路径，不传 Host 凭证环境。超时 SIGKILL，stdout 超限 SIGKILL，非零退出包含最后 8000 字符 stderr。输入由资源存储逐块落盘并校验总字节数；缺资源/大小不符报错；所有操作结束清理临时文件。普通本地 Provider 的默认值是 10 分钟、探测输出 256 MiB；工具链 doctor 仅检查程序能否返回非空版本，不保证全部编解码器可用。

独立的 video-cli 进程包装器默认 5 分钟，stdout 全量收集、stderr 保留末尾 100000 字符；支持逐行 stderr 元数据和向 stdin 流式写点阵标签、背压等待。它继承通常的父进程环境，与资源执行器的最小环境不同，不能混写为同一种安全隔离。

| 执行操作 | 输入、变换和成功不变量 |
|---|---|
| 完整探测 | ffprobe 读取容器、全部流、全部解码帧并记录工具版本。附件/字幕/数据不丢弃；流按索引排序；封面与静帧/动态图分开。旋转只准 0/90/180/270，其他角度报错 |
| 时序评价 | 时间基缺失、PTS缺失或最后时长不可推导记 missing；PTS 不严格递增记 non-monotonic。时长优先帧时长，其次 packet 时长，音频再由采样数推；中间缺时长用后继 PTS 差，末帧用最后一个差。音频相邻偏移超过正负 2 ticks 分别记断裂/非单调；视频至少两个相邻差时，任一差大于 max(差值下中位数×4, 向上取整半秒 ticks) 记断裂 |
| 归一化 | 选择明确的流与时间跨度权威；有画面必须以视频为权威，音频权威只支持纯音频。视频跨度×目标有理帧率四舍五入，纯音频跨度向上取整；由帧数算 48 kHz 样本数。音频按实际起点偏移裁前尾、补头尾静音，不可完全在权威跨度外 |
| 归一化画面 | CFR、固定帧数、时间零点、物化自动旋转、扩展非方形采样轴并输出方形像素；不透明为 H.264 MP4，透明为无损 VP9 WebM。动画 WebP 有独立解析/拆帧连接路径，不把它误判为单张图。重探测确认帧数、旋转和采样比例 |
| 归一化音频 | 48 kHz、双声道、16-bit PCM WAV；采样数精确等于计划。与纯音频 `media cut` 的 24-bit 输出不同 |
| 静图持帧视频 | 每段取图的首帧按计划重复，无音频，CFR/H.264。单图补到偶数尺寸；多图以首图偶数尺寸为基准，等比缩小、黑边、顺序连接；重探测核对总帧数/帧率/方形像素 |
| 同步媒体变换 | 顺序执行 trim/保音高变速，每步针对当前局部时间轴。视频调整 PTS，音频用分段 atempo 将倍率拆到 0.5–2；最后按原帧率量化帧数（至少1）、重采样成 CFR，音频补裁到对应样本数。输出 H.264/AAC MP4；检查视频帧数和音频存在性。源实现此路径不保透明输出 |
| 抽音轨/抽帧 | 指定音轨转普通 48 kHz 双声道 PCM WAV，不自动赋予语音语义；指定视频流按首/末/索引/首个不早于秒值的帧选择，输出恰能解码一帧的 PNG |
| 语音证据音频 | 输入是已核实的 48 kHz 双声道规范音频；转换为指定样本数的16 kHz单声道 PCM，补裁精确边界，再封为对齐证据；不是 TTS |
| 时间轴混音 | 只读取与指定节目区间相交的 Clip；资源去重且同资源源样本数必须一致。顺序为源裁切、循环与相位、保音高速度、长度补裁、增益、淡入淡出、逐样本包络/可听窗口，之后才裁节目范围并重设局部零点；重叠相加、不自动响度归一化。无相交 Clip 输出精确静音 |
| 范围样本时钟 | 以原起始帧求源采样偏移，但以选中帧数独立求新样本数；有理帧率会与两个绝对端点之差相差一个样本，必须保留该规则 |
| 最终 mux | 验证画面恰一条无音视频流、符合帧域；音频恰规范 PCM 且样本数吻合。视频复制、不重编码；音频 AAC、MP4 faststart。重探测要求恰一条视频一条音频、同展示起点、画面帧数精确；AAC 展示样本与原 PCM 的差必须严格小于1024，不要求不可能的逐样本无损一致 |

合成 Surface 校验还有独立入口：可检查调用者保持不变的已落盘文件，或为字节创建自己的临时文件；支持取消，默认 120 秒、探测上限 8 MiB。要求唯一视觉流、无音频/附件/封面，尺寸、帧数、帧率与声明吻合，方形像素、无旋转、逐行扫描、SDR sRGB 相容元数据；通过像素格式和 alpha 标记验证 opaque/straight，不按扩展名假定透明。

### 2.13 OpenCV 服务与 API

`services/image-opencv` 是**锁定 Python 环境的分发资产**，不是常驻 HTTP 服务。真实执行为本地 Provider 每个 Need 启动一个短命 Python 进程：`python <执行入口> <请求JSON路径> <输出文件路径>`；另有自检输出 OpenCV/NumPy 版本。它做确定性的栅格变换与图层合成，不做 AI 生成、抠图、OCR、文字排版、跟踪或视频分析。

Provider API 语义为“执行 raster 请求并返回图像 Blob”。输入只能是 image 类 Blob；按资源标识去重、读取、验证字节数，写临时文件，再把请求中的资源换成受控本地路径。默认并发 1、超时 5 分钟、输入合计 128 MiB、输出 256 MiB、stderr 256 KiB；超时或 stderr 超限杀进程。输出必须是非空普通文件且不超限制；按请求确定 MIME 并入资源存储，失败/成功均清理临时目录。

API 两类：

1. **变换**：一个输入图像、非空有序步骤；编码最多一次且必须最后，省略时 PNG。解码保留灰度/颜色/alpha；以下调色、降噪、模糊、锐化处理 RGB/BGR 颜色，保留原 alpha。
2. **合成**：画布、明确 RGBA 背景、1–64 个有序图层；每层有图像、像素框、contain/cover/stretch、插值、0–1 opacity。后层覆盖前层，输出 PNG；框与缩放几何用半向上取整，居中偏移用整数除法；图层越过画布只裁可见区域，完全不可见时不贡献像素。以逐像素 alpha-over 混合，先按 opacity 调源 alpha，以预乘量求合成色，再转回 straight alpha。

| 步骤 | 验证、算法和边缘行为 |
|---|---|
| crop | 像素坐标非负整数、宽高1–65535；比例坐标0–1、宽高>0且≤1，范围越界容差1e−9。比例乘当前尺寸后 Python round；真实裁切仍检查至少1像素及不越界 |
| resize | 目标宽高1–16384；contain用较小比例留背景，cover用较大比例居中裁切，stretch非等比；插值 nearest/linear/cubic/area/lanczos。有alpha默认透明黑，否则黑。缩放尺寸半向上取整 |
| rotate/flip | 仅90/180/270；水平/垂直/双向；不是任意角度插值旋转 |
| denoise | 仅YCrCb非局部均值；亮度/色度强度0–50，模板奇数1–31、搜索奇数1–63且大于模板；小于32像素任一维时保持原图。分通道降噪后按亮度系数0.0722/0.7152/0.2126及0–4饱和恢复处理 |
| color | 曝光−8至8档乘2的档位次方；对比0–4围绕127.5；饱和0–4基于同亮度权重；温度−1至1对红加、蓝减32倍值；tint−1至1对绿加32倍值；gamma0.1–10取归一化值的1/gamma次方；最后舍入夹到8-bit |
| sharpen |  amount0–5、Gaussian半径0.1–20、阈值0–255；高斯差形成细节，以每像素最大通道绝对差低于阈值时整像素清零，再加权回原色 |
| blur | Gaussian sigma0.1–100，颜色模糊、alpha不模糊 |
| alpha | preserve不接受背景；flatten必须有背景，按原alpha把颜色压到明确底色后删除alpha |
| encode | PNG/JPEG/WebP；quality若给则1–100，PNG不接受quality；background只准JPEG。JPEG有alpha必须显式背景，否则执行时报错；JPEG/WebP质量默认95 |

普通颜色为六/八位十六进制，合成背景必须八位。底层按 BGR(A) 存储，不能据通道顺序把温度或色调写反。验证层拒绝未知请求类型、非法步骤/范围、编码顺序、过多图层；解码失败、越界裁切、缺JPEG底色、进程失败会返回明确错误。接口输入是本地资源，不是供任意调用者提交文件路径的开放网络服务。

默认 managed 部署用每实例独立虚拟环境及 frozen uv；显式 Python 地址则视为外部环境，不代它安装。doctor 导入 cv2/numpy，要求主版本分别4和2，报告 ready/down/mismatch；没有常驻 start/stop。源 pyproject 要求 Python **3.13**，锁文件解析为 NumPy **2.5.1**、opencv-python-headless **4.14.0.94**，不能直接宣称同锁文件兼容 Dsivio 的 Python 3.12。

## 3. 关键概念与数据形状

下表是 **dsivio-video 新接口的语义字段建议**，刻意采用自己的字段名，不是旧类型定义或原 JSON 的复制；第2节描述的返回事实必须完整保留，实施时可按这些字段建立新版本契约。

| 新字段/概念 | 必须保存的内容 |
|---|---|
| `assetRef` | 不可变内容地址、字节长度、MIME；不能拿工作机路径充当持久资源地址 |
| `clock` | `fpsNum/fpsDen/totalFrames`，有理正帧率；帧/采样边界用整数运算避免累积浮点误差 |
| `tickTime` | 十进制字符串 tick 值及有理每tick秒数；保留可能超安全整数的PTS |
| `inspection` | 容器名列表、全部流事实；每流的选择索引、编码、默认/封面标记、时序质量、解码单元数；视频几何/SAR/旋转、音频采样布局分别存在 |
| `streamChoice` | 所选视频/音频索引、跨度权威、选择策略；归一化之后不要继续传播 |
| `SynchronizedMedia` | clock、可选`pictureAsset/pictureSize`、可选`pcmAsset`；至少有真实媒体；同步不是“视频里原有声轨”的别名 |
| `sampleEvidence` | `wantedSec/observedSec/filePath`，可有 `activeTokens/contextTokens`；原始帧模式没有wantedSec |
| `cutReport` | `outputPath/inputIntervals/nominalMap/requestedDuration/measuredDuration/videoPresent/audioPresent/timeLabelled`；nominalMap每项保存输入起终点及局部输出起终点 |
| `gridReport` | 普通模式的`outputPath/requestedTimes/gridColumns/usedRows/cellPixels/items`；分页目录另有`pageLimitRows/pages`；原始模式只给页面路径及实际帧时间 |
| `boundaryReport` | `inputPath/rateHz/minChange/events`；事件`observedAtSec/changeMagnitude`明确是取证候选 |
| `transcriptDocument` | 自有版本标记、`originFile/spokenLanguage/audioDurationSec/blocks`；block含文本及可选起止、tokens；token含`content/beginSec/endSec/confidence`，缺时间与0不同 |
| `captureReport` | 自有版本、`savedFiles`；每项`category/filePath/pageAddress/pixelWidth/pixelHeight/containerName`，视频附`durationSec/averageFps/audioPresent` |
| `snapshotReport` | 自有版本、来源、`frameFiles`（帧索引/节目秒数/路径）、`gridFiles`；本地执行器可记工具版本，不再记Profile绑定 |
| `rasterJob` | `action=edit|compose`；edit含输入及orderedSteps；compose含canvasPixels/backdrop/layerStack。临时本地路径只存在执行边界，Graph内保持assetRef |

`Output` 是作者指定的导出目标，不等于证据图格；`Need` 是待满足技术请求，不等于供应商任务；`Build` 保存计划和可复查成果。以上本地直接 CLI 不应为了报一个探测结果就偷偷建立 Run/Build。若生成帧后要裁切或排版，也应分别记录原始生成 Output 和后处理结果，不能把加工图谎称原始供应商图。

## 4. 对 dsivio-video 的建议

### 必须保留

- 全部八种 media 行为，特别是 keep顺序拼接、原始帧连续解码、请求/实际时间区别、毫秒重复拒绝、转写缺时不猜、候选不升级为镜头结论。
- 明确输出、不覆盖、失败临时文件清理；迁移时把原先较弱的 tile/fetch 发布也做成无覆盖发布，但标注这是新实现的保护，不是声称源实现已有。
- 资源声明与用途分离；方形像素、透明、音频采样形状及节目时钟不变量；mux允许AAC编码带来的小于一帧采样误差。
- 浏览器采集与节目snapshot分离、浏览器安装显式、原生录制停止后等待文件写完；脚本执行不是沙箱的提示。
- 下载器版本和工具版本可查询；收费请求完全留给宿主，plugin不持钥匙、不讲供应商协议。

### 可简化

- 用宿主提供的绝对工具路径统一进程边界，不再要求用户凭PATH装程序；保留stdin点阵输入与stderr逐帧元数据功能，不必复制两套包装器。
- 已捆绑yt-dlp时 `prepare-fetch` 可变为版本/EJS环境就绪核验并输出精确路径，不运行uv、不另外建venv。需要升级由Dsivio分发包承担；是否强制2026.8.19见待定问题。
- OpenCV作为可选本地技术执行模块，不需要通用Endpoint/Profile部署体系。若只用sharp实现基础裁切合成，也须明确高级降噪/调色算法是否保持；不能用名字一样但算法不同的替代品宣称兼容。
- snapshot直接调用本地节目渲染能力，保留精准帧域、资产暂存和验证；去掉“先选远程渲染Provider”概念。

### 砍掉

- Runtime Profile endpoint bindings及对应runtime/workspace路由、远程Lambda/S3部署、凭证存储、HypiHub和所有收费网关。
- 不复制源品牌格式、模块类型定义、Python执行源码或文档句子；新契约使用`.dvml/.dvs/.dvrun`、`.dsivio-video/`以及`dsivio-video/<pkg>@1`。
- 不加不存在的TTS、语音/抠图宿主命令。图片和视频生成用`gen:Image/gen:Video`，必须显式`model="provider/model-id"`，计划时查询宿主实时能力，显示并在Build存精确请求；媒体取证不能代替能力验证。

## 5. 依赖与外部程序

| 源依赖/程序 | 映射到 Dsivio | 仍有缺口或要求 |
|---|---|---|
| Node与child_process | 捆绑Node 22.23，直接运行可type-strip的TS；用于进程、HTTP、采集脚本和下载JS挑战 | TS依赖/包导入需适配分发布局；type stripping不等于能运行任意编译器专有语法 |
| ffmpeg；用户所说ffmpeg-static | 使用Dsivio自带ffmpeg；若宿主以ffmpeg-static取得路径，只需消费最终可执行地址 | 本篇所读工具代码没有依赖ffmpeg-static包，源实现使用PATH/显式路径。静态ffmpeg不附送ffprobe；需H.264/AAC/VP9 alpha、PNG/JPEG、concat、trim、fps、showinfo、rawvideo、overlay、audio滤镜等实际支持 |
| ffprobe | 使用独立捆绑ffprobe路径；probe/录制/snapshot后处理校验都共享 | 必须支持stream、frame、PTS、sample、像素格式表/alpha等查询；不能用视频duration粗估代替逐帧检查 |
| yt-dlp及EJS | 宿主捆绑yt-dlp；JS runtime强制宿主Node，不用系统node | 捆绑版本与EJS是否固定、ffmpeg合并路径如何传入、站点认证路径；不要静默拉插件或远程求解组件 |
| Python/uv | 下载器的Python范围容纳3.12；宿主已有下载器时不需要其uv环境 | OpenCV源锁限定3.13，不能原样冻结安装到3.12；重新选择/锁定兼容依赖是实施前提，不是修改版本字符串即可 |
| NumPy、OpenCV headless | 可用捆绑Python3.12运行新的本地栅格模块 | Python内置库没有cv2/numpy；需要可分发的arm64及其他目标平台wheel和兼容锁，doctor只查主版本还不足以证明精确算法结果 |
| sharp 0.35.4 / libvips | 宿主事实没有承诺sharp；网格、转写标签、截图尺寸识别需要提供此库或等价实现 | 原生二进制平台分发、图像编解码、文本栅格化；替代方案不能只会resize |
| Pango/字体支持 | sharp文本接口依赖libvips文本/Pango路径；为中文等语言提供确定字体 | 普通numeric-overlay不需要Pango或ffmpeg drawtext，但网格/转写/snapshot文字标签需要；缺字、换行和渲染宽度都是可见差异 |
| puppeteer-core 25.10.0、浏览器安装器3.2.2、Chrome | source固定Chrome for Testing153.0.8010.12；Dsivio内置网页浏览器是否可直接供独立控制需确认 | 捆绑runtime清单不含Chrome；不能假定宿主Electron Chromium满足Page.record、自动化协议与153+要求 |
| 本地转写执行器/模型 | 当前无宿主映射 | `transcribe`须另定免费本地ASR/对齐方案；仅保留已生成转写文件的读取不等于命令已实现 |

下载器及普通capture脚本默认继承父环境；新插件应避免把宿主敏感环境下放。网络输入和有权限的脚本是用户明确选择的外部内容，不是可信项目代码。宿主任务队列与幂等只负责它自己的收费生成，不应被下载器/ffmpeg内部重试冒用；特别是宿主返回不确定状态时不得重新提交生成请求。

## 6. 待定问题

1. 宿主捆绑yt-dlp的精确版本、default extras/EJS、升级节奏能否纳入工具事实？源严格pin应换成宿主pin，还是要求最低兼容版并记录实值？这影响prepare-fetch契约，不能默默任选系统下载器。
2. Chrome采用独立固定下载还是复用宿主浏览器？后者必须先证明截图/原生MP4录制/API兼容；宿主存在网页视图本身不能证明可用。
3. sharp/Pango及多语言字体怎样捆绑？点阵时间标签可零字体运行，但中文转写和snapshot标签仍需真实文本引擎。
4. OpenCV在Python3.12上的依赖重锁及跨平台结果容差；需要保留非局部均值/调色/alpha-over语义，不能以升级主版本通过doctor代替结果验证。
5. 免费本地转写所用模型、语言支持、下载和离线缓存、对齐能力如何决定？在缺少此能力时，命令必须明确说明未具备，而不是产生虚假词时间。
6. 新JSON契约字段和格式标记需与其他研究篇章统一；本篇第3节为重建语义建议，不要求兼容旧品牌文件。转写的源时钟标识是否需额外关联内容hash，是新设计问题，不是已观察行为。
7. 图格/下载的竞争发布和超长boundaries内存：建议完善排他发布及流式相邻比较，但不改采样和分数语义；属于明确的实现改进。
8. snapshot的节目编译格式、Studio资产端点和本地render-frames协议由渲染篇章最终定稿；媒体工具只要求准确节目帧域与完整输出。

## 7. 来源

以下均相对 `/Users/zmmini/zmdata/work/dsivioplugin`；只列实际阅读的来源，不代表外部程序已经运行验证。

- `packages/media/README.md`；`packages/media/src/{types,schema,surface,render,component,frame-range}.ts`。
- `packages/media-execution/README.md`；`packages/media-execution/src/{execute,probe,process-env,toolchain,surface}.ts`。
- `packages/video-cli/src/{media,media-frames,frame-grid,process,transcript,capture,snapshot,creation,cli}.ts`。
- `packages/yt-dlp/src/{environment,download}.ts`；`services/yt-dlp/{pyproject.toml,uv.lock,README.md}`。
- `packages/browser-capture/src/{index,browser}.ts`；`packages/browser-capture/package.json`。
- `packages/provider-image-opencv-local/src/{provider,deployment,program}.ts`；`packages/provider-image-opencv-local/runtime/raster_execute.py`；`services/image-opencv/{pyproject.toml,uv.lock}`。
- `packages/raster/src/{index,program}.ts`：为说明OpenCV输入验证边界而补读。
- `packages/whisperx/src/{index,types}.ts`：为说明转写语言参数而补读。
- `packages/provider-media-local/src/{activation,provider,program}.ts`：通过定向搜索确认路径选择和本地执行默认限制。
