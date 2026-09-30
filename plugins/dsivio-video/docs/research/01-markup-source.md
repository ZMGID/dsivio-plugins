# 源语言、样式配方与 Author Graph 行为规格

## 1. 概述

本篇从源文件到已验证 Author Graph 的链路出发，描述标记语言、脚本、配方、文本模板、包装载和工作区边界。它不描述生成供应商或执行调度。下文示例统一使用 dsivio-video 的命名；错误码保留所观察实现的代码，便于逐项追踪行为，但不表示必须沿用原产品名称。

源码不是 XML 文档的通用变体，也不是可执行 JavaScript。宿主先读取强制的处理指令，选择已信任 Frontend，再由 Frontend 发现导入、解析 Surface，并提交静态值、组件实例和可复用 Graph Fragment。Surface 的标签、属性与子元素属于相应包；Core 不认识 Script、Text 或视频轨道。`.dvml`、`.dvs`、`.dvrun` 是人类命名习惯，不能决定解析器。

研究依据为静态源码、文档与示例；没有运行构建、测试或安装。只读 CLI 入口依赖的 `node_modules/tsx/package.json` 在检查位置不存在，故未启动 CLI。本篇把“源码现状”和“新产品建议”明确分开，尤其不把声明的 schema 误认为 Core 已自动执行的验证。

## 2. 行为规格

### 2.1 文件头与文档外壳

最小标记源的改名示意：

```xml
<?dvml using="dsivio-video/markup@1"?>
<dvml>
  <import from="dsivio-video/text@1" as="text"/>
  <text:Value id="headline">今天开始</text:Value>
</dvml>
```

- 处理指令必须从文件第一个字符开始，仅允许其前面有一个 UTF-8 BOM；前置空白或注释均不允许。
- 只允许 `using` 一个属性。指令名后用空格或 tab，`using=` 不允许额外空白，值可用配对单/双引号；指令内部不允许换行、插值或实体。请求不得为空，不得带空白或 `< > & ' "`。
- Frontend 请求是宿主解析的逻辑地址，不是脚本可自行指定的实现路径。未知解析器失败；若同一请求同时注册为 Author 和 Run，CLI 拒绝歧义。
- 宿主把文件头的非换行字符替换为空格后交给正文解析器，保持原始 UTF-16 偏移。因此正文范围仍能映射回完整文件。
- 标记正文的根元素必须是非自闭合 `<dvml>`，不接受任何属性。根前、根后及顶层元素之间可有空白和 `<!-- ... -->` 注释；根结束后只能有这些 trivia。
- 顶层正文不能写自然语言，全部 import 必须位于开头的连续导入区，正文开始后再遇 import 为错误。
- 此语法不支持 XML declaration、DTD、CDATA、XML 处理指令列表或 `xmlns` 命名空间声明。

### 2.2 导入、命名空间与引用

| 写法 | 行为 |
|---|---|
| `<import from="dsivio-video/text@1" as="text"/>` | 把该 Module 直接声明的 Surface 绑定为 `text:标签`。不自动把其依赖包的标签加入作者作用域。 |
| `<import from="dsivio-video/script@1"/>` | 不设前缀，使用包声明的原始标签，例如 `script`。 |
| `<import source="./look.dvs" as="look"/>` | 编译另一个自描述 Source，并把其公共导出名称加上 `look.` 前缀。不会把该源的标签或 import 自动透传。 |
| `<import source="style-pack/presenter.dvs" as="look"/>` | 由宿主读取已安装包中明确导出的数据子路径；不因这个数据 import 执行该包 activation。 |

Import 必须自闭合，只接受 `from`、`source`、`as`；前两者必须且只能出现一个，全部值必须是引号字符串。source 必须有 alias。alias 由小写字母起始，后续小写字母、数字、下划线或连字符，总长 1–64；同一源中模块/source 共用 alias 命名空间，重复失败。没有 alias 的不同包若贡献同一标签，也失败。

普通元素/属性名称由英文字母或下划线开头，后续可含数字、点、冒号和连字符；大小写有意义。标记属性仅有两种词法形态：

1. `'字面内容'` 或 `"字面内容"`：一律先成为字符串；数值、布尔、单位及列表如何转换由 Surface 决定。
2. `{binding.path}`：整个属性值是一个引用。括号内可有首尾空白，不能有表达式、运算、数组或拼接。名称词法允许点、冒号和连字符；这不是 JavaScript 属性求值。

`{story.segment.opening.dialogue}` 查找的是完整公开绑定名。Script 主动生成了这一绑定，它不是先读取 `story` 对象再逐层取成员。同理，配方源公开 `media.performance`，import 为 `look` 后 `{look.media.performance}` 命中那条 Recipe；没有层级继承或自动合并。给引号字符串写 `"{foo}"` 得到字面括号，不会引用；正文中的 `{foo}` 也不会普遍插值。通用语法没有引用列表；`{[a,b]}` 非法。某个 Surface 如需多个输入，可规定重复子元素，或自行解释引号中的字符串，不能推定所有标签通用。

ID 由 Surface 定义，不存在统一的 XML ID 规则：Text 接受去首尾空白的非空文本；Script 的 id 则必须满足小写 1–64 字符标识符规则。不应把 Script 的限制外推到整个语言。静态 Record、组件、组件公共输出分别建索引；公共导出名称最终必须唯一。

解析按顶层元素顺序调用 Surface。引用查询只看到已解析的本地 Record/组件输出以及已编译的导入导出，所以 Text 等即时解析引用的 Surface 不能任意向后引用。底层 Author Graph 自身采用先预声明输出、再绑定输入的两阶段算法，允许符号引用指向后列出的组件；这不等于所有前端标签都支持前向引用。

### 2.3 文本、子元素、注释与转义

结构化 Surface 接收一个树：标签名、字符串/引用属性、顺序子节点、元素及属性值源范围。语法保留普通文本空白，具体是否裁剪由包决定；有配对结束标签和 `/>` 两种写法。结束标签必须精确匹配，不能把空文本与任意子元素当成通用合法内容。

结构化属性和文本只解码 `&lt; &gt; &amp; &quot; &apos;` 五种实体，且只进行一遍替换。属性引号由下一个同类引号终止，反斜线不能转义它。其他实体如数字实体当前不解码，仍留在文本中；代码虽有实体错误分支，但匹配器不会把未知实体送入该分支。不要宣称这是完整 XML 实体实现。裸 `<` 开始解析子标签，文本尖括号应写实体。注释丢弃，未闭合注释失败。

Raw Surface 只由通用解析器解析外层开标签，其正文由包解析并返回结束偏移；不能自闭合。Script 就是 Raw Surface，内部的 `<opening>`、`<主持人>` 和双文本都不经过结构化 XML 树解析，转义规则也不同。

### 2.4 Script：分段、说话人与语义选择

```xml
<script id="story">
  @{topic}
  <opening><主持人>现在看<DVML|dee vee em el>。|| 下一步开始。</opening>
  <silent/>
  @{/topic}
</script>
```

- 外层只接受 id，省略时为 `script`。必须至少有一个 Segment。
- Script 外层正文只接受命名 Segment、注释、空白、Selection/Moment 标记；不能直接写散文。Segment 名由小写字母起始，长 1–64，允许数字、`_`、`-`；名称 `script` 保留。Segment 不带属性，名称不能重复。
- `<opening>...</opening>` 和 `<silent/>` 是 Segment；空 Segment 合法，仍有开始/结束语义锚点。Segment 不嵌套：已经进入 Segment 后，一个合法裸标签被解释为 Role Cue，而不是子 Segment。
- Segment 内 `<主持人>`、`<GUEST>` 表示新说话回合，直到下一个 Cue 或 Segment 结束；没有配对 Role 结束标签。大小写不能用于区分 Role 与 Segment，这是解析状态决定的。
- Role 标签允许 Unicode 字母/组合字符/数字，以及内部空格、点、下划线、连字符；长度最多 32，首尾有更严格限制。无需 Role 也可形成无角色 Turn。若使用 Role，首个 Role 必须在该 Segment 的有效口语文本之前，每个 Role 必须跟有口语内容，Segment 关闭时角色状态清空。
- 文本换行和连续空白归一为一个空格，Turn/双文本两侧裁掉首尾空白；不自行删除中文内部空格或补造中英间隔。注释透明，`hel<!--说明-->lo` 仍形成 `hello`。

选择语法及亲和方向：

| 标记 | 意义 |
|---|---|
| `@{part}` / `@{/part}` | Selection 从后一词开始到前一词结束。 |
| `@{~part}` | 开端改取前一词末尾。 |
| `@{/part~}` | 末端改取后一词开头。 |
| `@{beat!}` / `@{~beat!}` | Moment 分别取后一词开始/前一词结束。 |

名称符合上述小写 1–64 标识符；Selection 和 Moment 共用命名空间。Selection 可交叉、重叠、跨 Segment，无需标签式嵌套，但必须恰好开闭一次，不得重新打开、重复、无开端关闭或漏关。结构边缘保留 Segment/整个 Script 的边界，不硬找不存在的相邻词。标记是零宽语义定位，不是秒数；不能拆开词或词与紧贴标点。旧的裸 `@part` 非法，模型提示里的 `@image1` 若真要进入 Script 文本必须转义，迁移不应在 build 中偷偷发生。

双文本 `<显示|口语>` 分离字幕拼写和实际发音；`<显示|>` 让口语继承显示侧，`< |口语>` 可保留 speech 而不显示字幕。必须至少有一个口语词，不能嵌套。显式双侧时语义标记在口语侧，显示属性在显示侧；共享侧允许两者且不进入文本投影。`||` 在完整对齐单元之间切分 Caption Cue，不能在双文本内部或词中。后置 `{emphasis}`、`{importance=2,tone=warm}` 给紧邻的完整显示词加属性；裸键为 true，值可为布尔、有限数或受限裸字符串，不允许空格隔开、重复键、嵌套或一个词的两个属性块。

Script 用反斜线转义 `@ < \\ | { }`，双文本内部另允许转义 `>`，未知转义报错；它不走通用实体解码。词法以中文/日文字符为单元，其他文字和数字按词/数字表达拆分，标点附着显示词但不增加 speech token。M 个 Token、N 个 Segment 总计 `2M + 2N + 2` 个语义锚点。

解析只产生静态 Record，没有组件和 Fragment：

| 公共引用 | 产物 |
|---|---|
| `{story}` | 全部 Narrative：Segment、Turn、Token、锚点、Selection、Moment 及 CaptionDocument。 |
| `{story.segment.opening}` | 指向所属 Narrative 的 Segment 窄视图，含 Token 半开区间；供 Take 关联。 |
| `{story.segment.opening.dialogue}` | 普通 Text；每回合一行，带 Role 的回合以 `角色: 内容` 开头，发音使用口语投影。 |
| `{story.segment.opening.speech}` | 普通 Text；无角色提示，口语按空格合并。 |
| `{story.caption}` | 完整 CaptionDocument：显示词、N:M 对齐单元、Cue；不含时间。 |
| `{story.selection.part}` / `{story.moment.beat}` | Narrative 身份加语义锚点引用，而非文本截取或时间窗口。 |

Script 声明 Narrative 公共身份：不同 source 里的相同 Script id 仍会触发闭包级身份重复，不能仅靠 import alias 消除冲突。Timeline/TTS/字幕渲染如何消费这些值另见相应研究篇。

### 2.5 `.dvs` 配方与 style kit

```text
<?dvml using="dsivio-video/svs@1"?>
<sheet version="1">
media.performance {
  camera-motion: fixed;
  duration: 6;
  palette: ["#204060", "#f4e8d0"];
}
</sheet>
```

此处 `svs` 是被研究模块的名称，扩展名已改为 `.dvs`；产品可另定模块名称。正文为 `<sheet version="1">`，可带可选小写 id，除此之外无属性。规则名至少含一个点，每一段是小写字母起始、后接小写字母数字/`_`/`-`。属性名只允许小写字母数字和 `-`，必须以字母起始。每项 `名称: 值;`，必须有分号；重复规则、重复属性、未闭合块均失败。注释使用 `/* ... */`，不是 XML 注释。

值按顺序识别 null、true、false、十进制整数/小数、JSON 数组/对象、首尾配对引号字符串、裸字符串。`8f`、`50%` 和 `cover` 保持字符串。数值识别不接受指数或正号，它们成为字符串；过大数字的有限性不能仅凭解析成功推定。数组/对象严格用 JSON（不能用单引号、尾逗号或引用表达式）；普通引号字符串当前只剥掉外层引号，不按 JSON 反转义。集合值不评估图引用，嵌入资源须由消费者使用显式输入。

通用 Frontend 每条规则输出一个 Recipe 静态 Record，公共名等于规则完整路径。sheet id 不添加导出前缀。`media.performance` 和 `media.base` 互相独立；没有 CSS 选择器、cascade、父子继承。style kit 的本质是可导入的数据包/配方文件及消费者的约定，不是新增核心语言。消费者负责检查自己认可的属性和单位，转换成自己的 Program，是否覆盖默认值也由消费者定义。

### 2.6 TextTemplate 与 Render

同为 `.dvs`，选 `dsivio-video/text/svs@1` 会产生 TextTemplate，而非通用 Recipe。文件必须恰好有一个 `text-template.<模板名>` 根规则，模板名为小写字母起始、仅数字/连字符，最长 96。根接受 `separator: paragraph` 和 `default-参数名` 的有限标量默认值。其余规则约定：

| 规则/类型 | 必需及可选项 |
|---|---|
| `text-template.<名>.block.<块名>`，fixed | kind、非负安全整数 order、非空 text。 |
| 同路径，axis | kind、order、parameter；其 choice 用后缀选择名与参数值作严格相等匹配。 |
| 同路径，variant | kind、order；choice 中 `when-param-*` 或 `when-select-*` 条件作合取。 |
| 同路径，slot | kind、order、slot；可有 boolean optional 和非空 label。label 与值之间一个换行。 |
| `text-template.<名>.choice.<块名>.<选择名>` | 非空 text；可有有限标量条件属性。axis/variant 至少一项 choice。 |

块名不含点，order 不重复，按 order 排序；块之间两个换行，空块省略。未知属性及模板内未识别路径报错。该前端只导出 `<模板名>` 一个 TextTemplate，不把全部中间规则同时公开为 Recipe。variant 条件必须存在；匹配多项失败，无匹配且没有兜底也失败，绝非“第一项赢”。

Text 的作者接口：

- `text:Value` 只接受 id 和纯文本子节点；去首尾空白行、统一 CRLF、删除非空行最小公共缩进、去每行尾空白，保留内部换行，产出静态 Text。
- `text:Render` 必须有 id、template，可选 recipe，其他属性拒绝。template 必须为 TextTemplate 引用；recipe 必须为作者内联 Recipe，且这时 template 也必须可读取为作者内联值。
- `text:Param name="camera" value="handheld"` 产生标量绑定。type 默认为 text；number 经数值转换且必须有限；boolean 只允许 true/false。同名 Param 重复失败。
- `text:Set name="dialogue" text={story.segment.opening.dialogue}/>` 和 Append 必须引用 Text，可接静态值或组件输出。每个动态输入都是独立图边，以源顺序逐步构建绑定。
- defaults → 被模板实际消费的 Recipe 标量 → 显式 Param 是参数优先级；Recipe 无关项被忽略，被消费项若为 null/列表/对象则拒绝。Set 不覆盖已有绑定：对已存在的 recipe/Param/先前 Set/Append 再 Set 会在执行时失败。Append 把不存在值初始化为列表，已有标量转成列表，再追加；普通 slot 不能消费列表，列表要由 each 表达式处理。
- Render 输出名为其 id，类型普通 Text，并产生内部绑定 Record 和绑定操作，而非在解析时把动态 prompt 拼好。模板默认值在最终渲染才叠入，因此 Set 不因模板默认值本身而重复。
- 底层文本表达式还支持 literal、slot、sequence、join、choice、optional、each、替换、变换及命名定义调用。定义调用必须有限、无递归；未声明绑定、未消费默认值、缺 slot、把列表交给标量 slot 等会失败。这些并非通用标记表达式语法。

### 2.7 Surface 展开、类型与闭包

1. 宿主逐源读取 Header/发现 import；递归缓存按 canonical source identity 与 Frontend，导入循环失败。同一文件被不同 alias 引入只编译一次。
2. 汇总源闭包需要的 Module，按精确逻辑地址及 manifest 依赖组成闭包；先安装 Surface/Frontend facet 与 Type-owner validator。
3. 子 Source 先编译，父 Source 只能获得其公共导出与公共静态 Record 的副本。Surface 可以读取作者内联值作静态 lowering，但图输出仍保持符号引用。
4. Surface 返回静态 Record、组件调用、Fragment、可选公共导出名单、可选公共身份以及源映射。检查来源范围、重复 id、输出类型是否在 Surface 声明及本包/声明依赖内、Fragment 定义冲突；默认所有生成绑定公开，明确名单则其余私有。
5. 入库前按类型所有者的 validator 验证静态值。每个 Source 的 Record、组件和逻辑输出内部身份加源单元隔离，避免两个文件使用同一个局部 id 冲突；不要把这个机械内部身份写回作者源。另行声明的公共领域身份仍跨文件查重。
6. 每个组件引用一个 Fragment，必须精确绑定其全部输入和全部出口，不能少端口或多端口。先预声明组件/出口，再按依赖拓扑展开；拒绝循环、未知 Record/组件/出口及不同精确类型。
7. Fragment 包含具名 typed input、Producer Operation 和 typed export。操作输入只能指 Fragment 输入或本地操作结果。出口必须根植一个本地操作；所有操作须能从出口到达。实例化给操作、结果 Record、Need 分配实例隔离身份；调用同一 Fragment 多次不会按内容去重。
8. 出口形成 Logical Output 与默认 Candidate，Candidate 指向对应操作根；多个组件贡献合并为 Author Graph 的 outputs/candidates/operations，再做 Core 图验证。静态 Record 不因公开就自动变为 Logical Output。

Type 身份以“Module 名、Module 版本、类型名”三元组精确相等，结构相似不代表兼容，没有隐式强转。值可以是内联 canonical 数据（null、boolean、有限 number、string、递归数组/对象）或资源描述（资源实例身份、字节数、媒体类型）；内联组合值也能含资源描述。canonical 化排序对象键、把负零归零，拒绝非有限数、undefined、函数等；它不是内容去重。

**重要现状：** protocol 虽声明可用于 UI/工具的 number 范围、string enum/长度/color、array 边界、object 字段、oneOf、blob 大小/媒体类型等 schema，Core 的 Record structure 验证仅检查 id 非空与 Type 是否存在，未通用递归执行这些 schema。真正的内容合法性依赖类型包 validator 及其 sealing 函数。没有注册 validator 时 refinement 直接通过。不能在实现规格中虚构“所有类型已自动 schema 验证”。

### 2.8 `check`：边界、输出和错误

```sh
dsivio-video check film.dvml --workspace ./project --asset-root ../shared --verbose --json
```

接受一个 Source，选项有 `--workspace`、可重复 `--asset-root`、`--package-root`、`--limit`，以及通用 `--json --verbose --color auto|always|never --no-color --debug`。check 不接受 runtime 选择、不启动 Build、不执行 Producer、不提交生成；但会执行被信任包的前端/validator，读取源和所需资产。

Author check 走完整上述发现、解码、入库、链接、展开和图验证，而非只检查括号。普通人类输出成功标题、Source、Logical Output 总数；verbose 再显示 Frontend、Module/SourceUnit/附件/值数量及公开 Output/值的名称和类型。隐藏内部 `.binding-数字`、`.bindings` 和含 `.__` 的条目，Output 列表按名排序。JSON 成功对象包含 format、sourceKind=author、ok=true、source、frontend、units、assets、modules、outputCount；仅 verbose 增加 outputs、omittedOutputs 及 details 中 modules/values。`--limit` 是显示截断，不缩小验证范围；assets 计数来自附件，不是唯一文件数。

已安装的 Narrative validator 还检查领域身份与覆盖：Segment、Token、Turn、Selection、Moment、Anchor 各自不重复；锚点序列以整个 Program 的起终点夹住；Segment 顺序完整分割 Token，Token 属于该 Segment 且有有效锚点/文本；Turn 覆盖非空且不越界；Selection 两端锚点存在且终点不先于起点（可同点），Moment 指有效锚点。Caption 单元与显示词必须同时为空或同时非空，身份唯一、单元非空，显示词按作者顺序恰好被单元分割，Role/Turn/Segment 及 source Token 归属一致，Cue Break 不重复且指现有单元。独立的 Selection/Moment 窄引用 validator 只查其身份和锚点字段非空，不在这一层重载整个 Narrative 做跨 Record 解引用。

Run check 另外解析关联 Author 与 Run、构造并检查选择图，只验证选中的本地 value/file 候选；历史 Build Output 保留未解引用意图，plan/build 才要求其存在和类型匹配。成功 JSON 为 sourceKind=run，报告 run、author、frontend、targetCount、targets、candidates、satisfactions、historicalOutputCount；verbose 追加有界的 unresolvedHistoricalOutputs。完整 Run 规则见 Run/Plan 研究篇。成功不保证模型在线、运行端点准备好、历史输出存在或动态模板必然可渲染。

失败立即中止，当前不是聚合全部诊断。JSON 错误对象语义是 format=产品的 cli-error@1、ok=false、error 内 code/message；usage 错误另带 help，debug 才带 trace。没有有效 code 的普通 Error 统一 `CLI_ERROR`。人类输出失败标题、错误码、逐行 message，默认提示 debug，debug 展开内部堆栈；CLI 入口失败退出 1。位置目前不统一：Header 是 `文件:行:列`；Markup message 含 code 并附 `文件:行:列`；Script 是 code 加 `文件:UTF-16偏移`；配方是 `文件:偏移`。JSON 不另行提取 source/range，位置在 message 里。

主要错误与触发条件：表中 `共同前缀{A,B}` 是列举缩写，表示两个独立错误码 `共同前缀A`、`共同前缀B`；斜线连接的完整码则各自独立。

| 层次 | 错误码及规则 |
|---|---|
| Header | `SOURCE_HEADER_{MISSING,UNCLOSED,INVALID,FRONTEND,DUPLICATE}`：缺失、未闭合、非法结构、非法请求、连续重复头。 |
| 标记结构 | `MARKUP_{ROOT,ROOT_ATTRIBUTE,ROOT_CLOSE,ROOT_UNCLOSED,TRAILING,NAME,OPEN,CLOSE,CLOSE_MISMATCH,ELEMENT_UNCLOSED,COMMENT,ATTRIBUTE,ATTRIBUTE_DUPLICATE,REFERENCE}`。 |
| 标记作用域 | `MARKUP_{IMPORT,IMPORT_KIND,IMPORT_SOURCE_ALIAS,IMPORT_ALIAS,IMPORT_AFTER_BODY,ALIAS_DUPLICATE,UNKNOWN_SURFACE,SURFACE_COLLISION,BODY_TEXT,RAW_SELF_CLOSING}`。 |
| Surface 契约 | `MARKUP_SURFACE_{DEPENDENCY,OUTPUT_TYPE,OUTPUT,CURSOR,RANGE,EXPORT_UNKNOWN,EXPORT_DUPLICATE}`、`MARKUP_SOURCE_{IMPORT_UNRESOLVED,EXPORT_COLLISION}`、`MARKUP_RECORD_DUPLICATE`、`MARKUP_COMPONENT_{RANGE,ID,DUPLICATE,FRAGMENT,FRAGMENT_MISSING,EXPORT}`、`MARKUP_FRAGMENT_{IDENTITY,CONFLICT}`、`MARKUP_EXPORT_DUPLICATE`。 |
| 配方 | `SVS_{ROOT,ROOT_UNCLOSED,TRAILING,VERSION,SHEET_ID,SHEET_ATTRIBUTE,SHEET_ATTRIBUTE_DUPLICATE,RULE,RULE_DUPLICATE,RULE_OPEN,RULE_UNCLOSED,PROPERTY,PROPERTY_DUPLICATE,PROPERTY_COLON,PROPERTY_SEMICOLON,VALUE_EMPTY,VALUE_STRUCTURED,COMMENT_UNCLOSED}`。 |
| Script | `SCRIPT_SURFACE_{ID,ATTRIBUTE,UNCLOSED}`；`SCRIPT_SEGMENT_{ID,DUPLICATE,OPEN,CLOSE,MISMATCH,UNCLOSED,CARDINALITY}`；`SCRIPT_ROLE_{EMPTY,AFTER_TEXT}`；`SCRIPT_SELECTION_{REOPENED,DUPLICATE,CLOSE,UNCLOSED}`；`SCRIPT_TEMPORAL_{ID,TYPE}`、`SCRIPT_MOMENT_DUPLICATE`、`SCRIPT_MARKER`、`SCRIPT_MARKER_TOKEN_BOUNDARY`、`SCRIPT_ESCAPE`；双文本、显示属性和 Cue 另有 `SCRIPT_DUAL_*`、`SCRIPT_ATTRIBUTE_*`、`SCRIPT_CAPTION_BREAK_*`。 |
| 源闭包 | `SOURCE_IMPORT_CYCLE`、`UNKNOWN_FRONTEND`、`EMPTY_SOURCE_ALIAS/DUPLICATE_SOURCE_ALIAS`、`DUPLICATE_SOURCE_IDENTITY`、`SOURCE_RECORD_COLLISION/SOURCE_FRAGMENT_CONFLICT`、`EMPTY_SOURCE_EXPORT/DUPLICATE_SOURCE_EXPORT/UNKNOWN_SOURCE_EXPORT/SOURCE_EXPORT_TYPE_MISMATCH`。 |
| Record | `EMPTY_RECORD_ID/UNKNOWN_TYPE/DUPLICATE_RECORD`；validator 重复为 `DUPLICATE_TYPE_VALIDATOR`，其任意拒绝包装为 `TYPE_REFINEMENT_REJECTED`，message 含 Type 地址和原错误。 |
| Author Graph | `AUTHOR_PORT_BINDING_MISMATCH`、`AUTHOR_COMPONENT_CYCLE`、`AUTHOR_INPUT_TYPE_MISMATCH`、`UNKNOWN_AUTHOR_{RECORD,COMPONENT,OUTPUT}`；`DUPLICATE_AUTHOR_COMPONENT`、`DUPLICATE_LOGICAL_OUTPUT_ID`、`EMPTY_LOGICAL_OUTPUT_ID`、`UNKNOWN_GRAPH_FRAGMENT`、`FRAGMENT_RESOLUTION_MISMATCH`。 |
| Fragment/Core | `FRAGMENT_{PORT_BINDING_MISMATCH,INPUT_TYPE_MISMATCH,EXPORT_TYPE_MISMATCH,RESULT_MISMATCH,CYCLE}`、`UNKNOWN_FRAGMENT_{INPUT,OPERATION}`、`UNREACHABLE_FRAGMENT_OPERATION`；Core 再查 `GRAPH_PORT_BINDING_MISMATCH`、`GRAPH_INPUT_TYPE_MISMATCH`、`PRODUCER_RESULT_NORMAL_FORM`、`OPERATION_RESULT_MISMATCH`、`CANDIDATE_RESULT_TYPE_MISMATCH` 及重复操作、结果 Record、Need、Candidate、Output。 |
| Module | `UNKNOWN_MODULE_IMPORT/MISSING_MODULE_DEPENDENCY/DUPLICATE_MODULE_PACKAGE/DUPLICATE_MODULE_SPECIFIER`；manifest 链接检查声明依赖、已知类型/能力、能力返回类型及 Producer 恰好一个公共 output 或 Need。 |

### 2.9 `vocabulary`：人类和机器视图

```sh
dsivio-video vocabulary
dsivio-video vocabulary dsivio-video/text --tag Render --json
dsivio-video vocabulary --visual [shape] --json
```

此工具只读取安装包及其声明，不用 Runtime，不发生成请求，不保存状态；不是从 README 正文推断词汇。无参数扫描当前项目和 Distribution 的 `node_modules/@scope/*`、`packages/*`，同名优先首次发现，仅列带 activation 的包。每行人类显示包名、去重排序标签、模型 offer、描述；加载失败可作为该包 unreadable 字段列出而非隐藏。JSON 是 projectRoot 和 packages 列表，各条含 name、tags、可选 description/models/unreadable。

指定一个或多个物理包名时，仅返回点名包的 Surface，虽然装载其依赖，不把依赖 Surface 混入答案。重复 `--tag` 按 Surface tag 或 Surface 声明名匹配。人类输出标签、raw/structured、package、module、建议 import、简介/外观、属性（必填/可选、枚举或可接类型）、子元素及数量、typed ports、示例、注意项和 README 路径；JSON 为 projectRoot、packages、surfaces，各 Surface 含模块地址、Surface 名、tag、mode、outputs、可选 vocabulary/readme；preview 只给路径和媒体类型，不读图。

`--visual` 列出全部或一个已知视觉形状的字段描述，以及可动画局部样式、样式名/枚举和跨字段规则；JSON 为 shapes、animatableLocalStyles、styleNames、styleEnumValues、rules，而非原始完整 schema。该模式不是 Source 标签目录。

此命令与 check 的参数解析并不完全一致：以 cwd 最近 package.json 为项目，不支持 `--workspace`，`--tag` 必须先点包，`--visual` 最多一个形状。当前会忽略 json/debug/verbose/no-color 这些词；其他未知选项失败。人类模式无包/无匹配 Surface 报错，JSON 模式可返回空列表。新实现不要无意复制这种人类/JSON 差异。

### 2.10 工作区、资产与包解析

- CLI 先选项目：显式 workspace 则以它为边界，否则从 cwd 向上找最近 package.json，没有则 cwd；不按源文件位置猜项目。选择后 realpath。命令行相对路径仍从 cwd 起算，包括指定 workspace 时的 source/asset-root/package-root。
- 库级 Workspace 若未显式 root，才默认入口文件目录。入口、相对 Source 都 canonicalize 后检查 containment；符号链接不能逃逸。相对 import 从 importer 所在目录解析，必须留在该 importer 的源根；asset-root 不扩大源码读权限。
- 资产请求必须以 `./` 或 `../` 起始，从 importer 目录解析。项目源可读 workspace 和显式 asset roots；包源只可读该包根，不能借用项目额外资产根。资产须存在，读取器记录声明 mediaType 和实际字节大小，不在此层自动 ffprobe 或嗅探媒体类型。
- 同一 compilation session 中，同一 canonical 资产路径共享一个资源实例 id；同 resource/mediaType 的附件只一份。资源是随机实例身份，不是 hash，下一次编译可以不同。不同路径的相同 bytes 不自动合并。同一个源用同一 locator 请求不同 mediaType，报 `SOURCE_ASSET_MEDIA_TYPE_CONFLICT`。图中保存资源描述，不把本地绝对路径或 stream 放进 Core；附件携带 file URL 与读取函数供宿主转交字节。
- containment 主要错误：`SOURCE_OUTSIDE_ROOT`、`SOURCE_ROOT_CONFLICT`、`UNKNOWN_SOURCE_IMPORTER`、`UNSUPPORTED_SOURCE_IMPORT`、`UNSUPPORTED_SOURCE_ASSET`、`SOURCE_ASSET_OUTSIDE_ROOT`。不存在文件及 I/O 错误可直接是系统错误码。源资产描述还查空 locator、空 mediaType、合法资源身份、非负安全整数大小、mediaType 一致。
- `from` 指逻辑 Module 请求，宿主映射到已信任包；registry 精确匹配 name@version 或已注册拼写，不做 semver 范围求解/安装。Node 装载器去逻辑版本找物理包，再要求该包确实提供对应 ABI/逻辑地址；不能把 npm package.json 版本直接当 Module 版本。
- 实现包只加载显式选中的 activation 与 manifest Module 依赖，activation 必须是包内文件且返回合法贡献对象；不会扫全部依赖树寻找插件。缺模块、重复提供者、逻辑 offer 缺失、同包提供了错误版本均失败。导入实现包会执行受信任代码，不是沙箱。
- 原内置命名范围属于 Distribution，不能被项目同名包遮蔽；其他包按 importer 附近 node_modules、指定 workspace 的 packages 查找。只有 Distribution 自己的外部依赖可进入机器级精确版本安装目录，项目依赖仍由项目包管理器负责。`--package-root` 影响包发现，不放宽源码 containment。
- package source 使用标准 exports 中精确的字符串目标：根的字符串 exports 或对象里的明确键；当前不展开通配符、条件对象。地址不能含冒号、绝对/相对路径或 `.`/`..` 空段，目标必须包内实际文件，Workspace 再 realpath 验证。只读这一个源数据导出不授予 executable activation 权限。

## 3. 关键概念与数据形状

以下使用新的字段命名表达语义，不是上游类型定义：

| 概念 | 建议字段/内容 |
|---|---|
| 源单元 | sourceKey（宿主 canonical 身份）、displayPath、body、readerRequest；source spans 用 startUnit/endUnit 表示 UTF-16 半开区间。 |
| 导入 | origin（module/source）、locator、localPrefix、sourceSpan；源闭包记录每个 readerRequest 与 resolvedSourceKey。 |
| 类型地址 | owner、revision、typeName；兼容性比较三个字段，不比较 schema 外形。 |
| 作者静态值 | valueKey、typeAddress、payload（inlineData 或 resourceDescriptor）。 |
| 资源描述 | resourceKey、byteLength、contentType；附件在宿主侧另存 readableLocation/openBytes。 |
| 组件调用 | callKey、fragmentKey、incoming（端口到静态值/组件出口）、published（出口到作者名称）。 |
| Fragment | typedInputs、localSteps（Producer 地址、输入、普通结果或 Need 结果）、typedExports；不是可执行函数。 |
| Author Graph | logicalOutputs、defaultCandidates、operationNodes；Record 在 linked program 中。 |
| Source 导出 | publicName、typeAddress、valueHandle；公开 Record 与逻辑输出可区分。 |
| Recipe | ruleName、parameters；规则名中的点不是对象结构。 |
| Narrative 引用 | storyKey、passageKey/tokenInterval，或 beginAnchor/endAnchor、pointAnchor；没有时间码。 |
| 来源映射 | elementKey、sourceKey、elementSpan、inputSpans、generatedValueKeys/callKeys/outputKeys；临时编译产物，不应成为源旁的隐藏编辑真相。 |

Text、Narrative、CaptionDocument、Recipe 是普通 domain Type。author-kit 只汇集 Module、Surface、Fragment 和确定性 handler 的框架接口，不负责安装、发现或运行。component-kit 的 Producer 上下文仅有输入值与类型化操作；无密钥、网络、资源字节或存储，外部动作必须表达为 Need。

## 4. 对 dsivio-video 的建议

### 必须保留

- 强制自描述 Header、前置 imports、alias 作用域、whole-value 引用、源闭包缓存/循环检测、typed ports 和来源映射。保持 Script 是 Raw Surface，不把其裸 Role 标签当 XML。
- Script 的 Segment/Dialogue/Selection 窄导出、语义锚点、双文本、空 Segment、共享命名身份；字幕/Timeline/生成统一引用作者语义，不把选择提前烘焙成秒数。
- Recipe 的数据惰性、显式消费者、TextTemplate 的参数/动态边分离。生成 prompt 只是普通 Text 消费者，不能另建隐式 prompt 插值语言。
- realpath containment、Source 与资产边界分离、package data 与 executable activation 分离；运行 Dsivio 桌面端不意味着插件可任意读取磁盘。
- `check` 与 `vocabulary --json` 的机器接口，同时改善错误位置为独立 source/span 字段。沿用单次失败是否够用可另定，但不可吞掉真实错误。
- 通用 `gen:Image`/`gen:Video` 必填 `model="provider/model-id"`。表面语法检查型号必填与输入类型；plan 通过 `dsivio media models` 取实时能力检查参数/参考数量/提示长度，并显示和封存精确请求。check 的离线成功不得被描述成模型可调用成功。

### 可简化

- 先只实现 `.dvml` markup、通用 `.dvs` Recipe 和 TextTemplate Frontend，保留宿主选 reader 的明确契约，不必把 ABI 打散成与上游同样数量的包。
- 桌面内置包可用固定、受信任注册表；第三方作者包仍须明确安装/启用，不扫描全机。schema 与 validator 的职责应统一说明；建议真正执行通用 schema，再做领域 refinement，不复刻当前只查 Type 存在的弱点。
- macOS 可用同文件系统 rename 发布完整源文件：新开读取者看到新版本，已打开读取者可继续旧版本；调用者负责临时文件、权限和清理，不宣称多文件事务或断电持久性。没必要引入 Windows 原生替换桥。
- vocabulary 统一使用项目解析与通用参数解析，允许 workspace；JSON 空结果与人类空结果的退出状态应一致。

### 砍掉

不复制 vendor-specific 生成标签、HypiHub、网关包、凭证存储、S3/Lambda、每组件 studio 重复包或 Runtime Profile 的 endpoint 绑定。外部生成 Need 只通向宿主 `dsivio media`，由 Dsivio 管密钥、路由、任务与 idempotency。文本/Narrative 保留不代表新增 TTS、speech 或 matting；宿主目前没有这些付费生成能力，不能用替代 vendor SDK 暗中补齐。

## 5. 依赖与外部程序

语法、源闭包、Recipe/Text/Narrative lowering 不需 ffmpeg、ffprobe、yt-dlp 或 Python。Node 文件系统、路径/URL、stream 和随机身份接口足够支撑源和附件。上游 CLI 引导使用 tsx；dsivio-video 可用宿主 Node 22.23 类型剥离运行受支持的 `.ts`，但不能据此宣称能直接运行任意 TSX 或编译期 TypeScript 特性。SQLite 属于执行/结果管理，不是源码解析前提。Windows 文件原子替换依赖原生桥，仅上游跨平台场景相关。

生成能力查询由 `dsivio media models --kind image|video` 提供；插件不应为 vocabulary 本地语法目录发付费请求。Node 包装载是信任机制而非权限隔离；第三方 Frontend/validator 可能读取环境或网络，这需在宿主启用政策中明确。

## 6. 待定问题

1. 新 Header 的精确指令名、Module 地址及 format 命名须形成统一规范；示例已按新词汇改名，不能让 `.dvs` 扩展名成为 reader 的隐式默认。
2. 是否保留当前未知实体原样、配方引号不反转义、文本即时引用不支持前向查找等现状，还是严格化？任何改变须作为新语法决定，不能假装与上游兼容。
3. 类型 schema 自动验证与包 refinement 的关系、validator 缺失时是否允许入库，需要决定；现状不足以保证任意声明 schema 都已生效。
4. Source 闭包公共身份冲突（特别是默认 Script id）需要什么作者提示；不应仅修改 alias 来掩盖同一 Narrative 的身份歧义。
5. check 是否增加显式联网能力校验模式，以及离线/宿主未运行时如何报告；已决定的强制 live 校验边界仍是 plan，不应绕过模型显式选择。
6. 是否保留低层模板全部表达式与 .dvs flat convention，还是给用户少量明确模板形态；必须保持动态 Set/Append 的图依赖与重复绑定错误可见。
7. 相同路径下一次编译分配新资源实例、源内资产声明媒体类型不嗅探的策略，是否符合 Dsivio 资源库？可让宿主提供稳定资源身份，但不能偷偷把实例身份变成内容 hash。
8. 插件包的物理安装与新逻辑命名不再照搬原 scope 特判，如何划定不可被项目覆盖的内置范围，以及禁用不可信 activation 的方式，需要产品规则。

## 7. 来源

以下均为 `/Users/zmmini/zmdata/work/dsivioplugin/` 下读取的路径；文中行为以代码为准，README 仅提供术语/示例上下文。

- `packages/source/src/header.ts`、`unit.ts`。
- `packages/markup/src/syntax.ts`、`frontend.ts`、`element.ts`、`error.ts`。
- `packages/svs/README.md`、`src/parser.ts`、`src/frontend.ts`。
- `packages/script/README.md`、`src/parser.ts`、`surface.ts`、`narrative.ts`、`lexical.ts`、`error.ts`。
- `packages/text/README.md`、`src/frontend.ts`、`svs.ts`、`surface.ts`、`program.ts`。
- `packages/narrative/src/component.ts`、`identity.ts`。
- `packages/elaborator/src/source.ts`、`author.ts`、`fragment.ts`。
- `packages/compiler-node/src/compiler.ts`、`modules.ts`；`packages/compiler-markup-node/src/index.ts`。
- `packages/validation/src/index.ts`；`packages/author-kit/src/index.ts`；`packages/component-kit/src/index.ts`。
- `packages/protocol/src/value.ts`、`canonical.ts`、`module.ts`；`packages/core/src/link.ts`、`graph.ts`。
- `packages/workspace/src/index.ts`；`packages/workspace-fs-node/src/workspace.ts`；`packages/project-context-node/src/project-context.ts`；`packages/file-io-node/README.md`。
- `packages/package-loader-node/README.md`、`src/location.ts`、`src/loader.ts`。
- `packages/cli/src/main.ts`、`arguments.ts`、`source-discovery.ts`、`output.ts`；`packages/video-cli/src/vocabulary.ts`；`bin/hypit.mjs`。
- `examples/complex-explainer/productions/explainer/recipes/performance.svs`。
