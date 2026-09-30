# Plan、Build 与本地 Runtime 行为研究

## 1. 概述

本篇研究从 Author Graph 到 Run、有限执行计划、后台 Worker 和项目结果仓库的完整链路。参考实现将三个边界明确分开：**作者描述什么、Run 选择这次实现、Runtime 执行并保存事实**。CLI 的观察进程不是执行器，结果历史也不是执行队列。

本文以参考源码的实际行为为依据，全部重新表述；示例已换用 `.dvml`、`.dvs`、`.dvrun`、`dsivio-video` 与 `.dsivio-video/`。下文 JSON 字段是供独立实现使用的自有命名，描述参考命令所提供的信息与省略规则，**不要求与参考 JSON 做逐字节兼容**。必须区分“参考行为”与第四节的 Dsivio 适配决定。

最重要的结论：每次 build 调用都会创建新的执行实例，绝不凭相同源码或计划自动重用旧任务；重用必须在 Run 中显式引用历史 Output。参考实现支持在仍存活的执行上下文中继续异步轮询，却**不承诺 Worker/执行载体崩溃后的原 Build 自动恢复**。

## 2. 行为规格

### 2.1 Run 文档：第二张图而非修改作者源码

Run 的输入是一个作者源地址、至少一个公开 Output Target、零个或多个 Candidate 声明和 Satisfaction 边。它可以导入执行替代片段；作者 Graph 与 Run Graph 都保持原状，由规划器统一选择。

语法示例：

```xml
<dvrun version="1">
  <author source="episode.dvml"/>
  <target output="final-film"/>
  <file id="locked-poster" type="dsivio-video/media@1#Image" from="assets/poster.png" media-type="image/png"/>
  <build-record id="old-shot" build="bld_20261001T031502123Z_A13BC29E04" output="shot-a"/>
  <satisfy output="poster" candidate="locked-poster"/>
  <satisfy output="shot-a" candidate="old-shot"/>
</dvrun>
```

| 声明 | 输入与意义 | 校验与边界 |
|---|---|---|
| author | 唯一作者 Source | 必须是根内第一个声明；不能重复；导入必须在其后 |
| import | 包引用和别名 | 全部位于正文之前；别名唯一；安装包不会自动成为选择 |
| target | 作者公开 Output 精确名称 | 至少一个、名称不重复；不能把普通 authored Record 当可实现 Output |
| value | Candidate 名、完整类型、JSON 资产地址 | 文件包含一个 StoredValue 包装对象，不是任意裸 JSON；仅被选中时读取；UTF-8/JSON/类型错误拒绝 |
| file | Candidate 名、类型、资产地址、MIME | MIME 必须是具体的 type/subtype，不接受通配；作为已固定资源，不调用生成 |
| build-record | Candidate 名、历史 Build ID、公开 Output 名 | 类型由 Satisfaction 目的端推导；同一声明用于不同类型的目的端是错误 |
| fragment | 实例名、导入别名和片段名 | 可绑定来自作者导出的输入，或声明的字面值；片段输入名不能重复；可筛选导出，引用名为“实例.导出” |
| satisfy | 作者 Output 名、Run Candidate 名 | 同一个 Output 最多一条 Satisfaction；必须存在且名义类型完全一致 |

根只支持版本 1。未知属性、未知元素、非空正文文本、尾部非空内容都报错。字符串属性去掉首尾空白后不得为空。片段 input 的 `from` 与 `value` 必须恰有一个；字面值会识别布尔、null 和有限 JSON 数字，其余保留为字符串。声明候选、导入别名、Target、片段输入与导出各有唯一性要求。

错误应保留类别、文件名、字符偏移及行列。参考语法错误类别包括 `RUN_ROOT`、`RUN_VERSION`、`RUN_AUTHOR_ORDER`、`RUN_AUTHOR_MISSING`、`RUN_IMPORT_ORDER`、`RUN_ATTRIBUTE`、`RUN_CHILD`、`RUN_TEXT`、`RUN_TRAILING`、`RUN_TYPE`、`RUN_MEDIA_TYPE`、`RUN_DUPLICATE`、`RUN_TARGETS`、`RUN_FRAGMENT_INPUT`、`RUN_FRAGMENT_REF`、`RUN_SATISFACTION_DUPLICATE`。图层还会报告未知 Record/Output/Candidate、重复 Satisfaction、Candidate 类型不符和 Record 身份冲突；不要将它们压成“构建失败”一条信息。

**固定文件与历史复用的实际规则：**

1. 先以结构化候选做反向规划，只为被选择且可达的 value/file 读取资产。未选候选的坏地址不触发资源读取；但声明、片段和图的结构仍要合法。
2. 历史候选只有被 Satisfaction 使用才建立目的类型；只有被本次计划选中才访问仓库。
3. 历史源必须是已经结束的 Result，允许其总体结论为失败或取消，只要所需公开 Output 已经保存；运行中的开放 Result 不能作为历史源。跨历史转发追到最终拥有者，检测循环和缺失地址。
4. 如果历史 Output 只是本次最终输出，没有下游消费它，检查地址和类型后做整项转发，不打开 Composite 文档、不搬运字节，也不在 Core 中建立假值执行。因而可以出现“有 Target、执行步为零”的 Build。
5. 下游消费历史值时才解码 Scalar/Resource/Composite。资源提供惰性附件，并保存原文件归属；同一历史文件在一次解析会话内复用同一资源引用。
6. 整项转发引用和 Composite 内嵌资源引用都不是内容复制。删除旧 Result 或移动外部固定文件会破坏依赖；这不是归档型快照保证。
7. `check` 只验证 Author/Run、结构计划及被选中的本地 value/file，列出尚未解引用的历史声明。即使历史 Build 还不存在，check 仍可通过；plan/build 才要求历史 Output 存在、已结束且类型相符。

### 2.2 规划、裁剪与定义身份

规划必须从 Target **反向可达**，而不是遍历所有生成元素依次执行：

1. 合并两张图的候选与操作，校验 Target、Satisfaction 和名义类型。
2. 遇到 Logical Output，优先选择它的 Satisfaction Candidate，否则选作者 primary Candidate。
3. 选中固定值则绑定一个初始 Record，并停止这一分支；选中操作则加入该操作并继续追它的输入。
4. Record 是终点；操作结果继续追所属操作。共享操作只加入一次；每个 Output 只解一次。
5. 以操作 ID 稳定排序生成有限步骤；将图边改成确定 Record 绑定。步骤只保留所选结果端口，建立 Goal 和所有可达 Output 的结果绑定。步骤数组的稳定顺序不等于执行拓扑顺序。
6. 保留实际用到的作者输入、Run 初始值、Producer 所属模块、结果类型模块及其传递依赖。未选替代分支、不可达生成、无用记录和模块不会进入 BuildDefinition。
7. 校验所有输入有来源、结果绑定唯一、类型相符、无环、每一步都能到达 Goal；不是“先运行再看哪里需要”。

BuildDefinition 是一次选择后固定的有限程序，由裁剪后的程序/模块闭包、初始 Record、步骤和结果绑定、Target 构成。Candidate 身份和作者图不是运行期权威；源文件路径、标题、结果仓库位置、凭证、Endpoint 选择属于 Host 的执行/展示上下文。参考定义没有独立内容哈希字段，不应误称“BuildDefinition ID 会自动查缓存”。计划内容可相同，但每次提交仍是新 Build；数据库重复 Build ID 会拒绝。

**Needs 列表**按计划步骤顺序展开，每一个外部请求一行，而不是按模型去重。每行有请求身份、所属步骤、Need 端口、Capability、返回类型、结果 Record。规划先执行纯确定性 Producer，得到现在可知的请求约束；尚未生成的媒体保留为带输入名称、上游 Record/步骤、媒体角色的 pending slot。包必须能在付款前描述完整的已知参数和未来输入语义；缺少这项描述或纯 Producer 验证失败都成为 request issue。不得猜测图里哪个对象“看起来像请求”，也不能伪造媒体 URL。

参考 plan 的信息形状（自有字段）如下：

```json
{
  "schema": "dsivio-video.plan-view/1",
  "valid": true,
  "runSource": "episode.dvrun",
  "targetTotal": 1,
  "targetNames": ["final-film"],
  "needTotal": 2,
  "requestProblemTotal": 0,
  "paidNeedTotal": 1,
  "localNeedTotal": 1,
  "unresolvedNeedTotal": 0,
  "unsupportedNeedTotal": 0,
  "overrideTotal": 1,
  "requestRows": [{"needKey":"…","stepLabel":"…","portName":"…","capabilityName":"…","endpointName":"…","parameterSummary":{},"futureInputs":[]}],
  "endpointRows": [{"needKey":"…","resolution":"resolved","endpointName":"…","implementationPackage":"…","priceSource":{"mode":"local"}}],
  "readiness": {"valid":true,"capabilityTotal":2,"diagnosticTotal":0,"diagnosticRows":[]}
}
```

无 Runtime 时仍可产生结构计划、Needs 和 issue；付款服务数量、Endpoint 解析与 readiness 不出现。`--verbose` 额外给步骤数、显式覆盖详情、不可达生成详情和 readiness 能力名称；`--limit` 仅裁剪这些展开详情，并给省略计数。所有需求行和 Provider 行不因 limit 消失，JSON 也遵守同一详细度规则。显式覆盖详情只展示这次可达且被选择的 Run Satisfaction，不把所有 primary 选择称为 override。存在未解析/多义/不支持请求、request issue 或 readiness 错误时，plan 返回非零状态。

### 2.3 价格显示不是报价引擎

参考 plan 展示对应 Endpoint 的自报价格网页或明确的本地无服务费用标记；不会读取价格表来算总价。独立 `pricing <run>` 命令使用相同完整请求和 Endpoint 解析器，可读取当前 Provider 价格材料，返回材料来源、原始规范数据、可选摘要和读取错误。读取价格失败时保留静态价格页；未声明价格来源时显示未知，不能以模型名称推断价格。价格信息不会成为执行权限。

pricing 按完全相同的 Provider 事实与价格材料分组，组中保留每个需求参数组合；不得错误地把不同 duration/resolution 等合并为同一个请求。明确无收费的本地请求只计总数，`--verbose` 才加入详情。默认显示全部组；`--limit` 只裁剪人类输出组，JSON 仍给全部组。输出语义为 `runSource/needTotal/noChargeTotal/priceGroups`，每组包含 Endpoint 解析、来源材料、错误和需求列表。没有成本总计。

范围名称中的 estimate 需澄清：当前 `packages/estimate` 实际负责发音单位与时长估计，并不负责价格；价格实现在 CLI、Runtime Host、Endpoint 契约中。

### 2.4 Core：Command、Fact 与 BuildMachine

Core 是无 IO 的状态机。输入 Definition 加按顺序接受的 Facts，可以重建 Read View；Read View、索引、待执行列表不是额外持久权威。

| 对象 | 行为 |
|---|---|
| 调用 Producer 的 Command | 输入 Record 全部存在后发出，包含步骤、Producer 名义引用、输入端口绑定 |
| 满足 Need 的 Command | Producer 给出外部请求约束后发出，包含 Capability、返回类型、结果绑定和完整约束 |
| Producer 成功结果 | 含输出值和外部请求约束；必须准确覆盖 Producer 声明端口，不能缺项或加项 |
| Need 成功结果 | 转成指定类型和 Record 身份的值；已经满足不能再次插入 |
| Command 失败结果 | 含错误代码、消息和 Command 关联；使 Core 进入 failed，停止发出新工作 |
| 已接受 Fact | 仅三种固定事实：Producer 已应用、Need 已应用、Command 失败；不接受任意补丁或插件自定义事件 |

Host 在接受前执行类型所有者验证；Core 校验结果与 Command 对应、端口、Record 冲突、规范值和引用。未知 Command、结果种类不匹配、重复完成、未知 Need 等均拒绝。Command 身份由类别和图身份稳定组成，在一个 Build 内唯一。所有 Goal Record 存在才 complete；互不相关的轻量步骤不必等待前一轮远程请求。

BuildMachine 维护 Record/Need/Command/依赖/缺失输入索引；它先评估结果并提出 Fact，**SQLite 提交 Fact 成功后才 commit 内存状态**。失败写入不能让内存先“成功”。数据库对 Build+Command 有唯一约束，事实只存一次。

### 2.5 提交与 detached Worker

build 依次进行：加载并裁剪 Run → 评估已知请求 → 解析 Endpoint → 轻量 preflight → 确认 Worker 可启动 → 持久提交 → 返回 Build ID。preflight 检查配置、包、必要凭证、可执行程序和已经运行的本地服务，不安装、不启动服务、不主动访问远程。显式准备属于 runtime up；Worker 启动失败必须明确“没有 Build 入队”。

提交保存 Definition、公开 Output/Target 展示目录、组件包选择、结果仓库地址、资源附件和执行上下文快照。先保存待提交记录/结果仓库种子与资源，再激活 worklist；未激活的中断提交与已激活执行不是同一恢复路径。后续修改 Profile 或项目代码仅影响新 Build。

后台结构是长期 coordinator 加执行 carrier：

- Worker 作为 detached Node 进程，由 PID/owner/ready 文件识别，独立于 CLI 的 stdout 与生命周期；CLI 退出、关闭 follow 或 Ctrl-C 不取消 Build。
- coordinator 读取共享 SQLite 就绪工作。每个 Build 有自己的模块作用域、组件/Endpoint 注册表和选择快照；多个 Build 可共享一个 carrier 的连接与事件循环。
- carrier 内图恢复/大 JSON 解析串行，网络动作与本地执行按资源声明并发。远程提交等待不会占一个“整个 Build 并发槽”。已知 Operation 可依据轻量记录和 wake time 继续 poll，不必每次重建整张图。
- carrier 完成其全部工作后退出，释放模块缓存；coordinator 和本地 Program 可以继续存在。默认执行 RSS 软退休阈值为 1024 MiB；只在已经完成过工作且达到阈值时不再接新 Build，旧 Build 原地结束。不是硬内存上限，不强制杀任务或搬迁活 Build。
- coordinator 启动时发现之前已经 assigned/started 的执行上下文丢失，会以失败结束这些尝试并保存输出/回执；未开始队列仍可启动。carrier 意外退出同理。活 carrier 不抢另一个 carrier 的 turn。

**恢复能力必须准确描述：**事实可重建；已存 immediate 成功结果可再次接受而不再调用；已知异步任务在存活上下文中跨多轮继续；但 immediate 开始后未持久结果、异步开始后无任务回执，不能再执行同一个副作用。前者报告 `EXECUTION_UNKNOWN`，后者报告 `SUBMISSION_INTERRUPTED`。参考策略要求新建 Run/Build，并显式复用已完成输出，不是崩溃后原 Build 自动重放。

### 2.6 Endpoint：支持判定、异步生命周期与回执

Endpoint 公布它提供的 Capability、返回类型、纯 supports 判定、资源限制、生命周期和价格来源。supports 的输入包含完整约束和未来输入角色，不包含执行 Build/Command ID。返回支持，或拒绝并说明原因。先支持判定再上传/生成；已供应的可选字段不得静默丢弃。

参考多 Endpoint 解析同时使用 Capability 与返回类型，按完整请求检查 supports；结果分为 resolved、unresolved、unsupported、ambiguous。多个实现竞争时 Profile binding 决定，binding 指向不提供能力的实例是错误。绑定实现发生认证、配额、传输错误后不得切换模型、账号或服务。

| 生命周期阶段 | 输出和状态迁移 |
|---|---|
| immediate | 一次调用返回 StoredValue，验证后满足 Need |
| start/submit | 先持久化 Operation，再标记 submission 开始；返回 pending handle、wake time、进度，或直接 ready/completed/failed |
| checkpoint | 收到服务确认后立即持久化 handle 与非秘密 receipt，之后才继续下载等工作；可注明远程已结束 |
| poll | 使用已有 handle 查询，同一 Operation 永远绑定原 Endpoint；pending 安排下一次 wake |
| ready | 远程任务已结束、文件尚未收集；释放远程任务占用，后续 collect 单独受短动作限额 |
| collect | 下载现有产物、写 ResourceStore；返回 completed，不是重新提交生成 |
| accept | 对已取得产物做返回类型验证，再将满足 Need 的 Fact 提交 Core |
| cancel | 可选；确认取消、仅接受取消请求、不支持、太晚四种远程反馈与本地取消结论分开记录 |

异步 Operation 记录本地身份、Build/Command/Endpoint、原请求、queued/started/accepted 提交阶段、handle、receipt、wake、进度、完成值或失败、远程结束时刻与取消反馈。receipt 是远程任务 ID 和可选查看 URL，不应包含密钥。完成返回先保存为待接受产物，再做类型检查，因此完成状态与 Core Fact 的落库可以安全分开。

Runtime 自身不设无限重试循环。Endpoint 辅助策略只将 **poll** 的连接/超时、HTTP 429 或 5xx 转回 pending，按 Retry-After 或轮询间隔等待，进度为 retrying；认证错误、坏响应和其他错误终止。submit 异常不能按 poll 策略重发，collect 异常也不能被泛称“自动重试”。没有全局重试次数、指数退避或跨 Provider fallback 的保证。

### 2.7 容量与 SQLite 工作列表

同一 execution store 是本地资源协调范围，不是云服务实际账号的全局限流器。每个 Command 在产生副作用前原子申请其所有资源：总 Endpoint/pool 容量、具体能力/模型容量、本地计算资源。一个 Claim 可以要求多单位，例如一份请求容量加四份浏览器容量；默认一单位。任一不足则不执行，登记资源等待或时间等待。

异步任务的 operation reservation 跨 poll 保留，到确认远程已结束后释放；submit/poll/collect 各自可配置短动作 concurrency 和令牌桶 rate（额度/周期毫秒）。短动作结束归还占用，已消费 rate 令牌不归还；按时间连续补充。计的是获准动作，不是动作内部每一次 HTTP。只有真正共享账号/部署/计算配额的实例才共享 pool。Build 本身不是容量资源，没有额外“每 Build 一条队列”限制。

SQLite 使用 Node 内置同步数据库、STRICT 表、WAL、默认 5 秒 busy timeout。概念表如下，不应照搬参考 SQL 名称：

| 表职责 | 关键内容与约束 |
|---|---|
| 定义表 | Build 唯一键、不可变 Definition JSON |
| 事实表 | 全局递增顺序、Build、Command、Fact；Build+Command 唯一 |
| 操作表 | Operation 唯一键、Build/Command/Endpoint、状态及完整操作载荷 |
| immediate 执行回执表 | Build+Command 主键、started/completed、保存的结果、最新活动 |
| 展示目录表 | 提交时刻、源码/Run/公开 Output/Target |
| 待提交表 | 组件包、结果地址、环境上下文、时间 |
| worklist 表 | 组件选择、结果地址、创建/开始/wake 时刻、operation wait、turn owner、结果写 owner、停止原因、最终决定、attention |
| 容量占用表 | Build+Command、加权资源集合、action/operation 生命周期 |
| 资源等待表 | 等待 Command、阻塞资源和全套申请；资源释放可唤醒 |
| 速率表 | 资源 ID、额度/周期、当前 tokens、更新时间 |

终局 Result 与执行日志保存成功后，事务删除该 Build 的活跃表聚合；结果仓库才是历史权威。无需用 SQLite 永久保留全部旧 Build 图。

### 2.8 失败、取消与结果写失败

第一个请求失败停止本次尝试的新工作；已经在调用中的返回可接受并保存，未结束远程任务不再持续轮询。结果中保留已完成公开 Output、失败原因及非秘密远程 receipt，包括仍未知的 pending 任务。释放的是本地占用，不代表服务端已经结束或退款。

cancel 先持久停止请求，不启动新工作；对支持取消的已有远程任务做一次尽力取消，记录反馈。`accepted` 不等于 confirmed；本地最终 cancelled 也不证明远程未收费。已经因失败停止的 Build 不被 cancel 改成另一种结论；已经结束的 Build 不改写。只有 Core complete/failed，cancelled 是 Runtime/Result 的结论。

complete、failed、cancelled 都走同一路径：同步全部已接受公开输出 → 归档执行日志和操作证据 → 发布最终 manifest → 删除活跃状态与工作资源。输出可以在 Build 运行过程中增量发布；没有新公开输出时不反复写 Result 文件。结果写失败不能变成再次生成：保留已决定 outcome、原工作目录及 result/cleanup attention，提示确定修复动作。参考补救命令 `result finish <id>` 只完成结果写入和清理，不启动 Worker、不加载 Endpoint、不调用 Producer；`result discard <id>` 只处理从未激活的中断提交。

### 2.9 磁盘结果、ResourceStore 与 get

默认项目仓库为 `.dsivio-video/results/<UTC日期>/<Build ID>/`，日期取 Build ID 的**提交日**而不是结束日。目录包含：

- `result.json`：公开 manifest；磁盘文档不重复目录中的 Build ID，读取时注入。
- `files/file-N.<扩展名>`：本次新产生的资源，扩展名由 MIME 安全化，jpeg 转 jpg，无可用后缀用 bin。
- `values/value-N.json`：Composite 文档。
- `.writer.json`：未结束时的私有写入索引，记录资源/值路径、公开输出及历史转发；结束后删除。
- 执行证据文件：由 manifest 中 execution log 地址引用。

资源、值都按实例/Record 身份去重，并非按字节哈希去重。Scalar 直接存在 manifest；Composite 中资源所在槽位编码成 null，旁表保存“对象键/数组下标路径 → 文件引用”，普通业务对象不因此被误解为持久元数据。Resource 引用可以指当前 Build 文件、其他 Build 的文件、外部 URI；整项历史 Output 还可转发到原 Build 的公开名称。

manifest 语义字段见第三节。标题、备注、重点 Output 只影响展示，不改变图身份。公开名称必须唯一，同一个 Logical Output 不能有多个公开别名；重点名称必须已存在。

Runtime 的 ResourceStore 则是 `<runtimeData>/work/<Build ID>/resources/<不透明资源ID>`，并有临时 `.incoming`。新存储总是新资源身份，即使字节相同。支持 put/write/get/has 和流式 put/open；write 用已有身份接入源码/历史资源并检查总字节数。临时写完后原子链接到最终地址，不覆盖已存在身份；中断/Abort 关闭流并删临时文件。引用还包括 MIME 与字节长度。它不是项目素材库，也不是跨 Build 缓存。

`get <id> --output <公开名> --to <目的路径>`：

| 输出种类 | 实際导出物 |
|---|---|
| Scalar | 单文件，JSON 表示并加换行；字符串仍带 JSON 引号，不是纯文本 |
| Resource | 单文件，仓库流式读出原始字节，跟随历史/外部地址 |
| Composite | 一个目录：`value.json` 加所有引用资源；旁表重写为该目录内的相对文件地址 |

Composite 同一源文件只复制一次；保留安全可用的源相对路径，外部资源分配本地 files 地址，遇到路径或 value.json 冲突重新编号。所有导出必须显式目的地，不以 Build 自动选“主视频”。目的地已经存在就报错，不提供覆盖；先写相邻临时文件/目录再 rename，失败清临时内容，拒绝路径逃逸。公开 Output 不存在、无法解析、资源字节缺失分别报错。get 可导出开放 Result 中已保存的 Output；用于 Run 历史复用则必须结束。

### 2.10 Build ID

公共格式为 `bld_YYYYMMDDTHHMMSSmmmZ_XXXXXXXXXX`：UTC 时间精确到毫秒，后缀十位大写字母或数字；参考 CLI 实际使用五个随机字节的大写十六进制，因此只出现 0–9/A–F。字符串可按提交时间排序，同毫秒靠随机后缀区分，不表示内容摘要、重用或同任务语义。验证必须检查真实可往返 UTC 日期，以及单路径段限制：不能空、带首尾空白、为点目录、含斜杠/反斜杠/NUL。

### 2.11 CLI：参数与人类/JSON 输出

以下语法省略统一前缀 `dsivio-video`。除 version 的专用解析器外，共通选项为 `--json`、`--verbose`、`--color auto|always|never`、`--no-color`、`--debug`；color 与 no-color 互斥。未知参数、额外位置参数、重复不可重复选项、漏值都拒绝。`--limit` 默认 20，`--lines` 默认 50，均为正整数；`--max-wait-ms` 为非负安全整数。JSON stdout 只有最终机器结果，进度可去 stderr；JSON 不自动开启 verbose，列表省略仍明确计数。CLI 失败/诊断失败一般返回 1，不要混淆 Dsivio media 的专用退出码。

`--workspace` 指定项目根；`--package-root` 是组件包解析根；可重复 `--asset-root` 扩大授权资产根；`--runtime` 显式选 Profile。显式 Profile 优先于已解析项目根 `.dsivio-video/runtime` 的持久选择；选择读取器只查看该项目根，不逐级搜索祖先 Profile 指针。指针保存相对项目根的地址，空指针或目标消失分别报错；未选 Runtime 的计划与结果历史命令不凭空创建一个环境。

| 命令与专属参数 | 人类输出/行为 | JSON 信息（自有字段） |
|---|---|---|
| `plan <run> [--runtime --workspace --package-root --asset-root --limit]` | Run、Target、请求总数/本地/收费分类、分组参数与未来依赖、Endpoint 拒绝和 readiness；verbose 展开裁剪与覆盖 | 见 2.2；不会返回整个 Core 图 |
| `build <run> [--runtime --workspace --package-root --asset-root --title --follow --max-wait-ms --limit]` | 默认提交即返回 ID、Target、工作量与 watch/cancel 指引；follow 观察进度和终局，失败返回 1；不支持 --out | `schema/buildView`；同 status 视图，可有 title |
| `status <id> [--runtime --workspace --watch --max-wait-ms --limit]` | 工作与结果两层状态、Target、步骤/远程进度、失败/attention 和建议；没 Runtime 仍查仓库 | `schema/buildView`，没找到为 null；max-wait 只用于 watch |
| `activity [--runtime --workspace --watch --jsonl --limit]` | Worker、活跃 Build 数、请求完成数、阶段计数；verbose 显示操作和容量 | `schema/observedAt/workerState/activeBuilds/hiddenBuildTotal`；verbose 有资源占用。watch 每秒观察，只在产品状态变化时输出；watch 禁 --json，流用 --jsonl；jsonl 必须 watch |
| `builds [--workspace --limit --before]` | 已结束 Result，最新优先，标题/ID、结论、时间、Run、Target 数；不列活跃队列 | `schema/buildRows/olderCursor`；每行 ID、提交时间、标题、结论、Run、Target/Output 数；verbose 给受 limit 限制的 Target 名 |
| `history <精确公开名> [--workspace --source --limit --before]` | 查有此 Output 的已结束 Result，允许失败/取消；可限定作者 Source；旧 Source 已删除仍可匹配 | `schema/outputName/authorFilter/historyRows/olderCursor`；行含 Build、时间、标题、结论、Output 描述。游标为扫描边界，不必等于最后匹配行 |
| `inspect <id> [--workspace --output --limit]` | Result 结论、创建时间、Target/可用 Output 数、失败、证据、重点输出；默认仅 Target/重点，verbose 全部 | `schema/resultView`；含 Source/Run、时间、结论、Output 描述、其它/省略计数。--output 只选一公开名；不返回原始值或字节 |
| `get <id> --output <名> --to <路径> [--workspace]` | 导出名和目的地；verbose 有类型/种类/绝对地址 | `schema/buildId/outputName/nominalType/valueClass/exportPath` |
| `cancel <id> [--runtime --workspace --reason]` | 已请求/已结束/已因失败停止/不存在；不是等到远程取消完成 | `schema/cancelRequested/buildView`；未知为 null 且返回 1 |
| `doctor [Profile] [--runtime --workspace --endpoint --limit]` | 主动但只读的环境与结果仓库诊断；Endpoint 可认证/读目录，绝不付费生成；可重复 --endpoint | `schema/valid/projectRoot/selectionOrigin/profilePath/selectionPath/diagnosticTotal/diagnosticRows`；error 使退出 1；位置 Profile 与 --runtime 互斥 |
| `paths [--runtime --workspace]` | 项目、项目状态、选择来源、Profile、Runtime 数据、机器状态/包、Distribution 地址 | 相同各路径与 selectionOrigin；未选 Profile 时 Runtime 字段缺省 |
| `version [--check --registry <URL> --json]` | 本地执行 Distribution/launcher；check 查询 npm latest，给匹配/未知和更新渠道；不更新包或 Skill | `schema/packageName/installedVersion/distributionPath/launcherPath/releasePage/latestQuery`；latestQuery 含 registry、版本、匹配或错误 |

version 另接受 `--help`、`--no-color`、`--debug`，不接受通用 verbose/color。`--registry` 仅能搭配 check，HTTP(S) URL 不得有凭证、query、fragment；默认 npm 公共仓库、查询超时 10 秒；网络或返回包名不符返回 1，但仍提供本地信息。`--version` 是只输出本地版本的快捷查询，不打开项目或 Runtime。

**统一 Build 视图：**工作层状态是 unknown/submitting/working/done，可带 outcome、停止原因、取消请求、总 Needs/已完成数；结果层是 missing/open/complete/failed/cancelled/unavailable，可带公开 Output 数。还有 title、Target、正在执行的进度、Operation 摘要和 attention 修复动作。非 verbose 通常隐藏成功 Operation、内部 ID 和无失败的 receipt，并按 Endpoint/状态/进度/错误分组计数；verbose 给逐项身份与 receipt。inspect 的 Output 描述含精确公开名、名义类型、Scalar/Resource/Composite、是否 Target/重点，资源可有 MIME 与大小。

follow/watch 的等待边界属于观察者，不是任务时限；到时返回仍 active 的视图，不杀 Worker。观察 Worker 已停止或 Result 需要人工处理时应停止盲等并给指引。activity --watch 是无终局的 Runtime 流；status --watch 则围绕一个 Build 观察。

**Runtime 子命令：**

| 子命令 | 参数与行为 | 人类/JSON 输出语义 |
|---|---|---|
| `runtime init [Profile] [--workspace]` | 写 starter 并选择，已有文件不覆盖；没有安装、网络或生成 | 已创建/选择；`schema/profilePath/projectRoot/isSelected` |
| `runtime use <Profile> [--workspace]` | 解析存在的路径并保存项目选择；不是主动诊断或准备 | 已选择；`schema/isSelected/profilePath/projectRoot/selectionPath` |
| `runtime unset [--workspace]` | 移除当前项目选择，不删 Profile/数据 | 已清除或原本无选择；`schema/isSelected:false/selectionRemoved`，可带旧地址 |
| `runtime up [Profile] [--runtime --workspace --endpoint --max-wait-ms]` | 显式准备选定依赖、启动其本地 Program、启动 Worker；endpoint 可重复；省略则全 Profile | ready/attention，失败程序原因；`schema/isReady/workerState/preparedPackageTotal/programSummary`，verbose 包含正常项 |
| `runtime down [Profile] [--runtime --workspace --max-wait-ms]` | 停 Worker，不停本地 Program，也不代表批量 cancel | Worker 已停/仍在；`schema/workerState`；没停返回 1 |
| `runtime status [Profile] [--runtime --workspace --limit]` | 只观察 Worker、本地 Program、活跃队列；Worker 运行但服务未 ready 单独显示 | `schema/isReady/needsAttention/workerSummary/buildPhaseTotals/programSummary/capacityTotal`；Build 数分 submitting/working/saving-result |
| `runtime logs [Profile] [--runtime --workspace --lines]` | 读 Worker stdout，Windows stderr 单独标记；不是每 Build 的执行证据 | 最近 lines、总行数、省略数；`schema/logLines/lineTotal/hiddenLineTotal`，verbose 有路径 |

runtime init/use/unset 不接受 --runtime；其它动作位置 Profile 与 --runtime 不得同时提供。`--limit` 不改变 worklist。Worker 日志位于 Runtime 的 `worker/worker.log`，Windows 可有 `worker.err.log`；Program 安装和服务日志属于共享服务，不能当成本 Build 日志。参考 `_worker` 是带 ready-file/owner/execution-root 的内部入口，不属于公开用户 API。

### 2.12 Runtime Profile 与包/Host 边界

参考 Profile 是 JSON，规定版本标记、相对 Profile 所在目录解析的数据根、可选 worker RSS 退休策略、Credential Store 实例、Endpoint 实例和能力绑定。Endpoint 实例配置含包 use、可选真实共享 pool 和规范配置。Credential/Endpoint 实例名称不能冲突；未知键拒绝；绑定必须指已声明实例。Profile 选择可信 IO 包，作者 import 选择纯领域包，二者互不授权。

Host facet 以 ABI 名、offer 名和实现建立插件边界；Endpoint activation 可提供执行契约、ManagedProgram 和主动诊断。Program 安装探测与服务 readiness 是两件事；up/down 以真实进程身份观察，不以文件存在冒充 ready。Result adapter 有 validate/open/可选 doctor，排队时固化可重新打开的仓库地址。Node Host 负责加载包和组合这些边界，Core 不接触文件系统、进程、网络、凭证。

## 3. 关键概念与数据形状

为独立实现建议采用以下自有数据词汇，而非复制参考类型定义：

| 概念 | 建议字段与不变量 |
|---|---|
| RunIntent | `authorAddress`、`goalNames`、`candidateDeclarations`、`satisfactionLinks`、`fragmentImports`；公开名在编译时解析为内部名义身份 |
| Candidate | `candidateKey`、`valueType`、`origin`（固定值或操作结果）；只是规划选择，不是 Runtime task |
| ExecutionDefinition | `moduleClosure`、`authorInputs`、`seedValues`、`producerSteps`、`goalBindings`、`reachableOutputs`；不可变，且不含运行环境 |
| ProducerStep | `stepKey`、`producerName`、`inputBindings`、`resultBindings`、`needBindings`；所有依赖均指 Record |
| PlannedRequest | `needKey`、`stepKey`、`portName`、`capabilityName`、`resultType`、`knownArguments`、`futureSlots`、`requestIssue` |
| ResourceRef | `resourceKey`、`byteLength`、`mimeType`；身份独立于字节内容 |
| AcceptedFact | `commandKey`、`factCategory`、被准入 Record/Need 或 diagnostic；只追加，按 Command 唯一 |
| RemoteOperation | `operationKey`、`buildId`、`commandKey`、`endpointName`、`submittedRequest`、`submissionPhase`、`remoteHandle`、`remoteReceipt`、`nextWakeAt`、`remoteEnded`、`collectedValue`、`failureInfo`、`cancelAck` |
| ResultIndex | `title`、`note`、`spotlightNames`、`authorAddress`、`runAddress`、`targetNames`、`completedAt`、`finalOutcome`、`failureMessage`、`publicValues`、`operationEvidence`、`executionEvidence`；buildId 从仓库地址注入 |
| PublicValue | `displayLabel`、`nominalType`、`storageAddress`；地址区分 Scalar、文件、Composite 文档、历史 Output |
| CompositeDocument | `payload`、`resourceSlots`；slot 是键/下标路径，引用从业务数据中分离 |
| ExecutionSettings | `dataDirectory`、`localProducerSettings`、`workerSettings`；不承载密钥、厂商 URL 或模型路由 |

这些自有字段只是重建规格，不意味着已经实现。特别是 pending slot 是真实图依赖，不是提交给 Dsivio 的假文件。

## 4. 对 dsivio-video 的建议

### 必须保留

- Run 的 Target/Satisfaction 和显式历史复用、反向规划、未选分支剪除。一次付款前清楚回答“哪些请求会发生、哪些输出已固定”。
- Definition+Facts、先落库后 commit、请求/操作回执、结果与执行状态分离、增量公开输出、终局写失败的只存储补救路径。
- detached Worker 和观察者分离；本地 ffmpeg 等耗时确定性生产也不应绑在 CLI 进程退出上。保留本地容量协调，但不能重建 Dsivio 的付费队列。
- 固定文件和历史输出引用的所有权、Scalar/Resource/Composite、流式 get、显式导出及拒绝覆盖。删除旧 Result 前需可说明依赖；自动 GC 不在本研究已决定范围内。
- `gen:Image` / `gen:Video` 必须显式 `model="provider/model-id"`，不得隐式默认、自动 fallback。plan 调用 live `dsivio media models --kind image|video` 读取真实能力，校验参数、数量和参考角色：video 的时长/分辨率/比例/音频开关/首末帧/参考上限/提示长度/defaults；image 的尺寸/比例/quality/数量/参考上限。
- 计划展示并保存**准确规范化请求**：`model`、prompt、各参考角色、duration/resolution/ratio/audio/size/quality/n、明确应用的默认值和 options。未来资源显示来源 Record slot；真实提交前把 slot 替换为已接受文件，保存最终请求，不能用摘要冒充请求或预先生成媒体。

### 可简化

- 付费 Endpoint 收敛为一个 `dsivio media` 适配器；本地确定性 Producer 或本地 IO Endpoint 继续存在。supports 用 live capabilities，不再依赖每个模型一套静态端口包；model-kit 中名义校验、草稿/完整请求分别校验的思想保留，不照搬每模型包工厂。
- start 使用 `image|video --no-wait --idempotency-key … --source …`；收到 Dsivio task ID 立即存 receipt；poll 用 `status` 或受控 `wait`，collect 只取得已有产物、搬入 ResourceStore。插件不得持有密钥、访问厂商 API、解析厂商任务协议或上传到厂商自建通道。
- **幂等语义由 Dsivio 所有**：插件保存稳定的提交关联和 task ID，但不拿同源码摘要跨新 Build 去重。media 退出 2 作为请求错误、3 明确拒绝且未收费、4 失败、5 不确定且绝不重提、6 app 未运行、124 观察超时分别解释。只要已有 task ID，查询已有任务不是生成重试；任何新 paid submission 都不能由通用错误重试器擅自触发。
- 本地 Profile 可缩成数据目录、local producer 配置（ffmpeg/渲染/下载资源等）、worker 策略。可以保留不同项目选择不同本地设置的 use/unset，但删掉绑定和 Credential Store。单一 Dsivio 付费适配器是 Host 固定组成，不再靠 Profile 控制服务路由。
- doctor 检查 Dsivio app 可用、media models、捆绑程序和本地目录；不能自动启动付费生成来“验通”。paths 聚焦项目状态、Runtime 数据、捆绑 Distribution，不再显示凭证/机器 Provider 仓库。
- 价格在 Dsivio 提供可靠数据前显示“由 Dsivio 结算，当前无法报价”；本地成本标记可保留。不把能力 defaults、duration 或 model 名换算为猜测金额。

### 砍掉

HypiHub、全部 gateway Provider 包、Credential Store/OAuth、S3/Lambda 存储、Runtime endpoint bindings、重复 studio 包以及 TTS/语音/抠像生成。本地分析既有音频不等于获得 paid TTS 能力。插件不能实现第二套厂商队列、账号配额、路由、keys 或失败切服务机制。参考的多网关 supports/价格读取框架用于理解责任分层，不构成移植授权。

## 5. 依赖与外部程序

参考 Core/Run/协议不依赖外部进程；Driver 组合 Producer、类型校验和 Endpoint。SQLite worklist 依赖 Node 的 `node:sqlite`；Worker 依赖 Node 子进程、IPC、文件和进程身份机制。资源/结果仓库依赖本地文件系统的流、原子发布与路径校验；参考 Program 生命周期用 OS 排他锁协调，同一服务准备/启停互斥。

Dsivio 可直接使用捆绑 Node 22.23（TypeScript stripping、SQLite）、ffmpeg、ffprobe、yt-dlp、Python 3.12，不另装相同运行时。模型生成只能通过运行中应用的 `dsivio media` CLI。`version --check` 是可选登记处网络查询，不应成为 Build 前置。方案不需网关 SDK、云凭证或 S3。

本研究仅阅读源码/文档，没有运行 build、测试、安装或付款命令；报告的是静态行为证据，不声称实测网络或后台进程。

## 6. 待定问题

1. 当前给定 media 命令没有 cancel：插件应只实现本地停止后续工作，并明确远程任务可能继续；未来有宿主 cancel 才映射远程取消，不能虚构确认。
2. media status/wait 返回体、产物下载/`--out` 与多产物布局的准确形状尚未提供；必须确定如何把 task ID 对应产物写进 ResourceStore，不能猜远程 URL 协议。
3. 已知 media exit 5 不重提；app 重启后的 task 查询/idempotency 查询保留时长、已完成任务取回方式需由 Dsivio 契约明确。可选择比参考更强的 task-ID 恢复，但不能声称它已经存在。
4. live capability 快照何时重新校验、plan 到 build 间能力变化如何呈现：建议 build 付款前再校验并保存实际解析请求，变化不得自动选另一个 model。
5. pricing API 不在已知 Dsivio CLI 契约内；预算/价格读取暂不能按参考重建为数值报价。
6. Runtime down 对正在执行的本地确定性工作采用优雅结束还是中断，需要明确用户承诺；它不应被误用为远程 cancel。参考上下文丢失即结束尝试的策略是否保留，应与宿主任务持久性一起决定。
7. 结果删除/搬家/归档策略如何保护外部文件、跨 Build 转发依赖；参考没有给出自动永久归档的保证。

## 7. 来源

以下均位于 `/Users/zmmini/zmdata/work/dsivioplugin/`，阅读用于行为归纳，没有复制实现：

- `packages/core/src/plan.ts`、`slice.ts`、`reducer.ts`、`machine.ts`：候选选择、反向可达、闭包裁剪、事实准入和增量状态机。
- `packages/protocol/src/build.ts`、`build-id.ts`、`canonical.ts`（目标检索）：有限定义、值/事实身份、公共 Build 格式。
- `packages/run/src/resolve.ts`、`packages/run-markup/src/syntax.ts`：Run 声明、片段、历史候选与语法错误。
- `packages/compiler-node/src/run.ts`、`packages/cli/src/run-file.ts`：check 与 plan/build 的历史解析区别、惰性加载和纯转发。
- `packages/host/src/facet.ts`、`packages/runtime-host-node/src/index.ts`、`packages/runtime-kit/src/index.ts`、`request-deadline.ts`：Host 边界、适配器、Program 与请求截止。
- `packages/driver-node/src/driver.ts`、`packages/runtime/src/types.ts`：执行准入、异步状态、回执、资源契约。
- `packages/runtime-local/README.md`、`src/config.ts`、`src/worker.ts`、`src/supervisor.ts`：Profile、Worker、失败与载体丢失策略。
- `packages/store-sqlite/src/store.ts`：worklist、事实/操作/容量/令牌持久模式与终局清理。
- `packages/artifact/src/index.ts`、`packages/resource-store-fs/src/store.ts`：资源名义类型与流式实例存储。
- `packages/build-result/src/types.ts`、`store.ts`、`writer.ts`、`packages/build-result-fs/src/index.ts`、`packages/build-result-kit/src/index.ts`：manifest、磁盘布局、编码、复用和仓库契约。
- `packages/generation/README.md`、`packages/model-kit/README.md`、`packages/endpoint-kit/src/index.ts`：精确模型请求、draft/complete 检查、supports、限额、轮询错误分类。
- `packages/estimate/README.md`：确认其职责为时长估计，非价格。
- `packages/cli/src/arguments.ts`、`main.ts`、`build-planning.ts`、`view.ts`、`output.ts`、`observation.ts`、`paths.ts`、`result-export.ts`、`commands/execution.ts`、`commands/results.ts`、`commands/environment.ts`：CLI 参数、输出信息、详细度、观察与导出。
- `packages/video-cli/src/version.ts`：版本查询、registry 校验与失败报告。
- `packages/project-context-node/src/runtime-selection.ts`：项目选择指针、相对地址、只读查找与失效错误。
