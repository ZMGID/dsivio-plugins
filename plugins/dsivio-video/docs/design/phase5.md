# 第 5 阶段设计：Studio 本地创作与评审

对应本地 Studio 服务器、显示闭包、预览播放器、源码与时间编辑、组件 Companion、Comments、Tasks/Artifacts 与英语/简体中文界面。行为依据 [research/08](../research/08-studio.md) **全文**，领域与渲染合同沿用 [phase3](phase3.md)、[phase4](phase4.md)。本文是待实现的合同，不是已交付说明；本阶段只设计，不实现服务器、网页或 Companion。六个工作包的所有权及浏览器验收见 §11。

## 1. 共享契约与边界

| 文件（计划新增/扩展） | 唯一负责的规则 |
|---|---|
| `src/studio/protocol.ts` | HTTP/SSE DTO、ViewRevision、SourceUnit、编辑请求、诊断；只导出类型，无 Node/DOM/执行代码 |
| `src/studio/companion.ts` | StudioCompanion、实体/lane/band/字段/参数拥有者、Film/Script facets；只 type import 既有领域类型 |
| `src/core/authoring.ts` | 编译期来源、作者身份、输入消费边、属性/Recipe/raw span；不依赖 Studio 或浏览器 |
| `src/elaborate/source-index.ts` | 编译器来源索引的汇总，源文件版本、准确拥有者与端点定位 |
| `src/studio/{server,session,watch,security}.ts` | 单 Run 会话、loopback HTTP、80 ms 监听、版本发布、写保护 |
| `src/studio/{display,cache}.ts` | 同编译显示闭包、BuildMachine 调度与缓存策略，不重写 Producer/Capability |
| `src/studio/{edits,temporal-edits}.ts` | 服务端端点解析、精确补丁、结构化事务与时间反向授权 |
| `src/studio/{feedback,libraries}.ts` | FEEDBACK 文件独立并发协议、Build/Output 查询与显示名 |
| `src/studio/ui/` | 原生 ESM `.js` + JSDoc、HTML/CSS/locale；没有 JSX、bundler 或编译产物目录 |
| `src/modules/<name>/studio.ts` | 各模块自己的纯投影与显式字段，不输出任意 DOM/CSS |
| `src/cli/commands/{studio,comments}.ts` | `studio --run` 生命周期、Agent 的 `comments list` |

跨图值仍是 `Value {type,data}`、完整版本化 TypeRef 与 `ResourceRef`；UI DTO 不成为另一套领域 Value。资源描述不带机器路径或临时 URL；路径、令牌、AbortSignal、音频节点仅活在服务器/浏览器。编辑端点 ID 是会话中不透明身份，不是可由客户端提交的文件补丁。

**依赖方向：** CLI → Studio host → elaborate/plan/build/core 与既有 capability；Companion → 自己的领域业务 + `studio/companion` 的 type import。core 不运行或 import Studio 实现。ModuleDef 对 Companion 只有 type import；Companion 不 import UI、HTTP、build worker 或凭证。所有内置 Producer 保持纯，领域算法不为 Studio 再写一套。

本阶段选择**独立 localhost 网页**。不改 Dsivio 仓库、不新增 WebView/宿主桥接、Runtime Profile、任务队列或付费执行入口。浏览器预览不是 MP4 Build，关闭 Studio 不取消已经提交的 Build。

## 2. 启动、会话与 Node HTTP

```text
dsivio-video studio --run runs/main.dvrun [--port 5179] [--workspace <root>]
dsivio-video comments list --run runs/main.dvrun [--workspace <root>]
  [--state open|resolved|all] [--json]
```

### 2.1 项目边界与生命周期

- Studio 必须有非空 `--run`，不收位置参数；沿用现有 CLI 选项解析、错误与 JSON 输出惯例，不私造第二套 parser。`--port` 是 1…65535 的安全整数；未知选项和缺值报错。
- 相对参数从 `INIT_CWD || cwd` 解析；显式 workspace 不改变 Run 的相对路径基准。默认项目根沿用现有项目发现方式（向上找最近 package.json，没有则调用目录）。只使用项目内 Run/Source/Recipe 与 Workspace 允许的素材解析规则。
- 包与 Companion 来自现有显式 ModuleDef registry；不扫描 node_modules，不在本阶段增加 `--runtime`、动态 package-root、额外 locale-pack 或包热加载。改变领域模块代码/registry 需重启；新增普通 Source import 会在下一次编译加载并加入监听。
- `node:http.createServer` 只绑定 **127.0.0.1**，不绑定 `0.0.0.0`、任意 hostname 或公网地址。端口占用时依次尝试后继端口直至可用（65535 仍占用即报错）；实际 URL 使用 `http://127.0.0.1:<actual>/`，以打印值为准。
- 预检 Run、唯一 Film/Timeline 和 registry 后启动监听。初次显示编译中的页面有明确 loading；初次失败可保留可修复 Source，但没有有效预览。打印项目根、绝对 Run、实际 URL 与 `#comments` URL；不打印令牌。
- 每项目/绝对 Run 在 `.dsivio-video/studio/sessions/<run-key>.json` 记录 pid、port、sessionId（不存令牌）。同 Run 再启动，验证 pid/同源只读 health 的 sessionId/Run 后打印已存在 URL；不能仅凭端口占用信任记录。死记录删除后重新监听。该文件只协调进程，不是作品数据库。
- SIGINT/SIGTERM 关闭监听、SSE、watcher 与会话 scratch，取消本会话过时本地工作；缓存/资源/评论/Build 保留。没有 launch browser 的隐式下载或后台收费任务。

### 2.2 localhost 写保护

服务端启动生成 32-byte `crypto.randomBytes` 的随机 session token，仅当前进程有效。`GET /__studio/bootstrap` 在合法 Host 下返回 token、sessionId、协议版本与当前状态；响应 `Cache-Control: no-store`，不设置 CORS，不把 token 放 URL、日志、localStorage、iframe 或 SSE。主页面把它仅存内存，并在所有 PUT/POST/DELETE 上发送 `X-Studio-Token`。token 常量时间比较；错误 403。

所有请求检查 Host：仅 localhost、127.0.0.1、[::1] 的合法端口表示，且必须等于当前监听端口；禁止后缀匹配、userinfo、多个 Host、DNS rebinding hostname。虽仅监听 IPv4，合法别名仍不改变绑定范围。所有写请求还要求 `Origin` 是本会话合法 loopback origin 且与该请求 Host 同源；若 `Sec-Fetch-Site` 存在，只接受 `same-origin`，不存在时仍必须 Origin + token。JSON 写仅接受 `application/json`，不接收 HTML form；OPTIONS/跨源写拒绝 403，绝不回复宽泛 CORS。无 Origin 的脚本不能冒充网页写接口；Agent 评论读取走 CLI/文件。

主 UI CSP 限制到自身静态资源，禁止对象、frame 外站、内联事件、任意远程连接；带 nonce 的 import map/bootstrap 可执行，不能插入作者字符串为 HTML。编译后的 iframe 脚本是**可信内置模块**生成的画面程序，不是作者任意脚本插件执行环境；不把 session token 注入其中。RenderDocument 的现有 IR/样式/资源校验仍不可绕过。HTTP 不是公网协作产品，token 不声称防住已入侵的本机进程。

素材只从本会话已注册 `ResourceRef`/产物所有者白名单取字节；不接受 file URL、绝对路径或拼接请求路径访问磁盘。Source 写每次检查 realpath/父目录，必须在 workspace 内且在已加载源码闭包中，拒绝 symlink 逃逸和目录/特殊文件。

### 2.3 路由与传输合同

选择 **SSE + JSON 写请求**。Node 自带 HTTP 可直接提供 EventSource；无 WebSocket server 依赖，无轮询替代。所有 `/__studio/*` JSON 使用自有协议 `dsivio-video.studio/1`，但下表 document 特意保留裸 RenderDocument。

| 方法/路由 | 输入 / 返回与权限 |
|---|---|
| GET `/`、`/ui/*`、`/vendor/*` | 自有网页、显式静态文件白名单；不暴露任意 node_modules 文件 |
| GET `/__studio/health` | `{sessionId,runFile}`；用于进程复用，不返回 token/绝对文件内容 |
| GET `/__studio/bootstrap` | session token、locale 默认、状态与最新快照；no-store |
| GET `/__studio/events` | SSE：`compiling`、`view`、`compile-error`、`comments-changed`；不发送 token |
| GET `/__studio/view` | 最新会话状态/ViewRevision；重连恢复使用，不是定时查询 |
| GET `/__studio/document` | **裸 `RenderDocument` JSON**，仍可被 `validateDocument` 验证；不包 `{document,version}`，无 token 要求 |
| GET `/__studio/material/<id>` | 精确 ResourceRef 的原字节、原 MIME/Content-Length；支持媒体单区间 Range/206 与 416；无 token 要求 |
| GET `/__studio/html` | 当前有效文档的无交互 shim、无音频 HTML；资源 URL 服务端替换，不修改持久化 RenderDocument |
| GET `/__studio/preview?revision=<n>` | 同版本画面 HTML + seek/选择桥接；AudioTracks 数据仍从 ViewRevision 取，由主 UI 播放 |
| GET `/__studio/source?unit=<id>` | `{unit,fileName,text,sourceVersion,viewRevision}`；仅闭包内文件 |
| PUT `/__studio/source` | `{unit,text,expectedSourceVersion,expectedViewRevision}`；全文自由保存，见 §6 |
| POST `/__studio/fields` | `{expectedViewRevision,editorKey,fieldKey,value}`；原子 record/list 同一请求 |
| POST `/__studio/time` | `{expectedViewRevision,editorKey,authorityKey,gesture,targetFrame?,deltaFrames?,anchorKey?}`；gesture=`move|trim-start|trim-end|reanchor`，每种互斥有效 payload 服务端校验 |
| GET `/__studio/comments` | 当前 Run 留言、文档 revision/编号；独立于视频 revision |
| POST `/__studio/comments` | 新增 `{comment}`，服务端固定当前 Run、验证 ID 唯一 |
| PUT `/__studio/comments/<id>` | `{expectedComment,changes}`；changes 只允许 at/text/resolved |
| DELETE `/__studio/comments/<id>` | `{expectedComment}`；整条旧值冲突协议 |
| GET `/__studio/tasks?state=all|active|ended&before=<cursor>&limit=<n>` | Build 卡片分页、完整 operation/error/result-save 状态；只读 |
| GET `/__studio/artifacts?kind=all|video|image|audio&build=<id>&before=<cursor>&limit=<n>` | 顶层文件 Output、真实所有者及来源列表；只读 |
| POST `/__studio/artifacts/rename` | `{build,output,expectedManifestVersion,displayName}`；只改该指定 manifest/Output 展示名 |

帧捕获合同就是 `/document` + `/material/<id>`，**不增加 Studio 的截图任务或编码 route**。现有 `src/cli/commands/snapshot.ts:65–85` 先取裸 document，再仅下载所选帧所需素材，无 Origin/token；本阶段不能更改该形状或要求 snapshot 先登录。实际抓帧仍使用现有 `local/render-frames`/`captureFrames`，不建 Build。UI 没有伪造“导出当前帧”功能；Comments 的“捕获当前时间”不写 PNG。

成功响应附 `X-Studio-Revision`；document/preview 在正在编译或待更新时 **409**，最近请求编译失败时 **500** 带准确失败原因，初次尚无文档同样 409。`/material` 已分发资源按不可变 ID 保留至会话结束：snapshot 取 document 后遇到后续编译仍能下载该版本素材，绝不以同 ID 返回新字节。未知 ID 404。常规错误 JSON 为 `{code,message,viewRevision?,span?}`：非法值 400、授权 403、找不到 404、陈旧/事务占用 409、结构化编译失败 422。

SSE 每事件有递增 event ID，payload 包含 sessionId、viewRevision 或 commentsRevision。连接建立立即发完整当前状态；Last-Event-ID 重连不要求无限日志，重新发完整状态即可。15s 注释 heartbeat 仅保活，不触发编译/刷新 Tasks。慢客户端只保留最新快照，不能积压所有 HTML；断连后客户端重新建立 EventSource，忽略 sessionId 不符或旧 viewRevision。Tasks/Artifacts 不因 SSE 做隐式 Refresh。

## 3. 显示闭包、重编译与持久缓存

### 3.1 唯一 Film / Timeline 选择

1. 同一次读取/编译 Run 与完整 Author/Recipe import 闭包。调用现有 `parseRun`、`compileAuthor` 的共同实现及 `planRun`，沿真实输出/输入引用追溯目标；不可拿旧 Author Graph 搭配新 Run Plan。
2. 目标必须指向当前 Author Graph 的 Film Composition 或可追溯该 Film 的 Render。允许多个目标指向**同一** Film；不同 Film、无目标、纯生成图片、无 Film 或由不透明媒体 Candidate 替换 Render 导致 Film 关系丢失，预检失败。不能扫描所有 Film 后取第一个。
3. Film facet 声明准确 `.composition` TypeRef、Timeline 输入及 VisualTrack/AudioTrack 子引用。Timeline 恰一个可解析、最终是 inline Value；纯动画正 end 可没有 Take/Script/语词。Film 最终必须给 inline Composition，不能用未知 Composite 形状冒充。
4. 显示 roots 是所选 Film 的 Composition、Timeline、所引用视觉/音频 Track、Companion 声明的**同 Surface 公开支撑输出**。从 roots 反向闭包调用统一 planner，保留 Run 的 Candidate 选择；不执行 render:Video 的视觉编码、完整音频混音和 mux roots。
5. 规划新增 `planDisplayRun(run,author,history,workspace,roots,registry)`（`src/plan/display.ts`），与 `planRun` 共用选择/依赖剪枝实现；Run targets/原文件不被改写。返回 Plan + 真实 author/output/candidate provenance。不能用 producer 名前缀过滤操作，也不能构造“看起来像”的第二套图。
6. 纯 Producer 输出仍通过 `BuildMachine.ready/inputsFor/accept` 的 produced/fulfilled/failed Fact；所有类型用模块 validate。挂起 Need 必须准确展示 capability、消费元素/输入、原因。任何画面/声音/字体 Resource 不可读，整次显示失败，不补黑帧、假图或静音替代。
7. 同一执行图产出 ViewRevision、Companion 投影、RenderDocument、无 shim HTML、preview HTML 与资源表。图来源包括选择 Candidate 后实际参与执行的消费边，不是未选 Author Graph 的假定血缘。

### 3.2 重用 worker，而非第二执行器

从 `src/build/worker.ts` 提取 `src/build/execute.ts` 的共享单命令执行函数 `executeCommand(machine,command,context)`：registry、resolveContext、ExecuteContext、policy、cache 为注入参数；返回已验证 Fact，持久化/提交 Fact 仍由调用者负责。worker 仍写 BuildStore/operation/Result，Studio 用内存 Fact 和单会话 scratch；二者都使用该函数 + BuildMachine，既有 async Build submit/poll 不搬到 Studio。

Studio policy **先用显式 local allowlist 判断是否可 resolve**，再要求 Resolution `cost === "local"` 且 immediate executor；不能凭 `local/` 名称、零美元估价或 Provider handler 猜安全。拒绝 `gateway/*`，不把付费请求交 resolve/submit/run/poll；已选历史 Candidate 的现成 Value 可以读，不提交新任务。缺能力诊断 `STUDIO_CAPABILITY_MISSING` 列准确名称和拥有者；提示通过正常 Build 生成后选择其 Result。

默认批准 inspect、normalize、transform、extract-audio/frame、still-video、speech-audio、align、font-face、raster，以及 §5 的本地音频播放准备。local 不是轻量：align 可能启动本地 ASR，raster/normalize 可能运行 FFmpeg/Chrome；UI 明示本地准备状态。普通播放不调用 render-visual/render-audio/mux；snapshot 独立用 render-frames。新的第三方 local capability 不自动批准，必须修改显式 policy。

### 3.3 缓存键、资源与失效

缓存目录 `.dsivio-video/studio/cache/v1/`，与既有 `.dsivio-video/resources` 的 `ProjectStore` 配合。cache 是可重建索引，不存作品真相，也不成为 Build Result。每项原子保存 `{schema,key,capability,implementationVersion,request,value,resourceDigests}`；失败/取消/未完成不写。使用 `canonicalJson`，不由不同模块重复写 JSON 排序函数。

```text
key = sha256(canonicalJson({
  schema: "dsivio-video.studio-cache/1",
  capability, implementationVersion, resolvedRequest: contentIdentityRequest
}))
```

`contentIdentityRequest` 是**仅用于键**的请求：递归将每个 ResourceRef 替换为 `{sha256,bytes,mime}`，其余确切字段不变；执行仍传原始 resolvedRequest。必须处理 compile/plan 给本地源生成的随机 Resource id，否则每次编辑都会 cache miss。源字节首次校验/入现有 ProjectStore，按内容摘要复用资源身份；仅字节、版本或确切请求变化失效，不能用 mtime 或文件名独立决定命中。哈希索引在 byte/stat 改变时重算，不跳过资源可读性校验。

`implementationVersion` 包含 capability 算法版本及影响结果的工具/模型/字体 pins；align 特别包括 ASR 模型、语言、服务版本/准备策略。缓存命中先验证 Value TypeDef 和所有资源的摘要/bytes/MIME，缺文件即失效并重新准备；不能返回指向消失 scratch 的 Value。单进程同键 single-flight；过时版本与新版本共用同一个工作，不因一次 view abort 丢弃仍有消费者的准备，最后消费者离开才取消。

缓存按 **Need 的确切请求** 而不是整个 Run/Source hash：修改字号、Script 标记位置、Window、评论、播放头不重新跑相同音频的 ASR；normalize 字节/时钟/策略改变才失效。Script 正文改变可重新跑纯匹配，但已有 Evidence 按请求复用。可预先读同键已存 Build Need 证据填缓存，不过现有 Result 的 operation summary 不含完整 request/内部 Value 时**不能猜复用**；本阶段以持久 studio cache 为必须实现路径。Run 明确选的历史 `.take/.media/.composition` 仍通过现有 HistoryReader 直接复用。

### 3.4 80 ms watch 与版本状态

按目录 `fs.watch`，覆盖 Run、全部已加载 Source/Recipe、已引用本地素材及 FEEDBACK（独立分类）；文件 rename/原子替换后重新检查目录中的目标，避免 watch 单文件 inode 丢更新。作品文件内容变化一经发现立即置 `dirty=true`、撤销当前 export/edit readiness 并发 compiling；随后 **80 ms trailing debounce**，到期从磁盘读取 coherent source snapshot，分配递增 requestedRevision。即使还在 debounce 窗口，document/结构化写也返回 409，不能把旧图当当前。解析中发现新的 import 后增订阅；错误状态也保留已发现文件/目录，修复会触发新编译。监听不依赖项目自己的 Vite 配置。

状态为 `{requestedRevision,publishedRevision,dirty,status:"compiling"|"ready"|"error",view?,error?}`。每次请求独立构建；完成前检查请求仍是最新且没有更晚 dirty 变化才发布，旧任务的成功或错误不能覆盖较新状态。源快照读取前后核对所有 unit/content hashes，读取期间变化则重读，不发布跨版本 import 闭包。最新编译成功/失败均消费其 dirty generation；新变化仍待下一次编译。UI 保留上次成功画面时挂显式 stale 标记，暂停播放，禁用结构化写/抓帧，不显示成当前可导出结果。Source 文本/草稿不被旧快照覆盖。事务写回的 watcher 事件按内容版本去重，不制造第二次相同编译。

## 4. 无 bundler 的 UI 技术与发行

选 **Preact + htm + 原生 ESM import map**，不是 Vite/React/JSX。Preact 提供稳定组件状态与声明式 DOM，避免手写面板更新/焦点恢复；htm tagged template 无 transpile、无需危险 innerHTML，保留 JSDoc。代价是 htm 模板不是完整 JSX 类型检查，故 DTO、props、事件/状态必须用 JSDoc，动态字段/record schema 由 runtime validator 校验；不能宣称 checkJs 能证明模板完整正确。时间线与波形使用 canvas 绘制、统一 DOM 可访问选择/菜单，DOM 不为每样本创建元素。

### 4.1 npm pins（已向 npm 验证）

2026-10-01 使用 `npm view preact@10.27.2 version exports --json`、`npm view htm@3.1.1 version exports --json`、`npm view typescript@5.9.3 version --json` 返回指定版本及 ESM exports；不是“建议 latest”。npm 元数据来源：[preact 10.27.2](https://registry.npmjs.org/preact/10.27.2)、[htm 3.1.1](https://registry.npmjs.org/htm/3.1.1)、[TypeScript 5.9.3](https://registry.npmjs.org/typescript/5.9.3)。

| 包 | 精确版本 | 用途/发行文件 |
|---|---|---|
| `preact` | `10.27.2` | runtime；`dist/preact.module.js`、`hooks/dist/hooks.module.js` |
| `htm` | `3.1.1` | runtime；`dist/htm.module.js`，只 `htm.bind(h)`，不另带 standalone Preact |
| `typescript` | `5.9.3` | dev-only，沿用现有 tsc；Phase 5 固定 dev pin，不给浏览器送 TS |

本阶段其他 npm 新包为 **零**：http/SSE/fs/crypto 使用 Node，文本编辑先采用原生 textarea + 独立行号/定位/语法呈现层，有限字段控件自有；音频与缩略图用 Web Audio/媒体 API。沿用现有 HyperFrames/Chrome/sharp 等，不因为网页再带一套渲染器。实际实现再修改 package.json/package-lock，本文不安装/修改依赖。

发行时精确 vendoring 上述 node_modules ESM 与 LICENSE 到插件的 `studio/vendor/`，锁文件固定 integrity；服务器映射固定文件，不允许浏览器访问整个 node_modules，不从 CDN 拉代码、不运行项目配置。import map：

```json
{
  "imports": {
    "preact": "/vendor/preact/preact.module.js",
    "preact/hooks": "/vendor/preact/hooks.module.js",
    "htm": "/vendor/htm/htm.module.js"
  }
}
```

新增 `tsconfig.studio.json`：extends 项目现有 config，`allowJs:true,checkJs:true,noEmit:true`、DOM/DOM.Iterable + ES lib，只 include `src/studio/ui/**/*.js` 及类型合同；Node 类型不得被当浏览器 API 使用。主 tsconfig 不去包含 UI JS，服务端 TS 继续现有规则。脚本 `typecheck:studio` 单独检查；无 `.js` 自动生成、没有 dist bundling/watch build。静态 ESM 可由 server 直接提供。

### 4.2 面板与状态

两页 Studio 与 `#comments`，Studio 左侧共享 Source/Tasks/Artifacts 库，中间 Preview，下方 Timeline，右侧 Inspector。顶栏当前 Author/保存/编译状态、语言、明暗主题。拖拽 Source 宽、Inspector 宽、Timeline 高、Comments 宽，用项目+Run key 的 localStorage 记忆**界面偏好**，不写 Source。

ViewRevision 的 clock/lanes/entities/fields/document/audio/source 都来自一个版本；选择/播放头/缩放/媒体上下文独立于领域持久化。替换快照按稳定 editorKey 恢复存在的选择，消失则清除；播放头 clamp 到新范围并暂停。Source 读/写模式、行号、换行显示、当前发声词及选择源码范围；每次只保存当前文件。没选择时 Inspector 显示项目、Canvas、T/FPS/帧数、Run targets/Candidate 数；选中后只渲染 Companion 显式 fields。

## 5. 预览播放器、采样与快捷键

### 5.1 iframe 与整数 Program 帧

将同一 RenderDocument 的 HTML 资源占位替换为服务 URL，在原画布尺寸的 iframe 载入，再用容器缩放；不把画面改写成 Preact 组件。等待既有画面 readiness、字体与资源；主 UI `seekFrame(f)` 调 iframe `__hf.seek(f * fps.denominator / fps.numerator)`，frame 为唯一播放头，禁止反复 seconds→frame 漂移。附加 preview shim 只控制媒体 seek/播放、选择命中与 readiness，不另写动画语义。

播放由 requestAnimationFrame 使用 elapsed monotonic 时间、有理 FPS 得出整数帧；有效 frame 0…T−1，到末帧停止，末帧再 Play 从 0 开始。播放开始、暂停、跳转、快照替换、进入文件预览均有明确状态转换；每次离散定位取消旧 seek generation，完成最新解码才显示 ready，旧视频 seek completion 不覆盖新帧。

离散 seek 按 VideoSamplingMap 的**精确有理数**求源整数帧，再取该源帧中点；不能先浮点变速后猜中点。`sourceStep=0` hold 固定解码帧、video 暂停。连续播放允许原生解码器跑自己的时钟，偏差超过约 80 ms 才纠正，循环边界/可见段切换更新源相位；不每个 rAF 重设 currentTime。video 元素始终 muted，没有附带声音。

画面选择由真实 render part/node identity 映射 entity；透过透明覆盖与重叠右键菜单选择，轮廓在 Studio overlay，不改变 Film stacking。Comments 点画面只切 Play/Pause，不选实体。

### 5.2 AudioTrack 的 Web Audio

AudioTracks 唯一来自所选 Film，不能搜视频音轨或启动隐藏原视频音频。用 AudioContext 请求 48000 Hz，浏览器实际采样率非 48k 时保留所有领域整数 sample 坐标，只在 Web Audio scheduling 转秒；不重新定义 Program sample 边界。复用 `frameToSample48k` 的 `B(f)`，不会逐帧舍入累加。

每 Clip：资源 AudioBuffer → source/loop phase → 固定 gain → 全局 sample gainCurve → audible mask → fade-in → fade-out → master mute → destination；每个因子独立 GainNode 相乘。gain 0…64，允许超过 1，无隐式 normalize、压限或 ducking。gainCurve 按绝对 48k sample 边界，进入 Use 中段要插值当前值，不重新从首点启动。audible 子窗只门控，不重启源/循环相位；相位依据原 targetSamples 与 sourceSamples 求出。所有 Track 加和，暂停/seek 立即停止旧 AudioBufferSourceNode、取消 automation，定位绝不发声。

**保音高必须成立。** `AudioBufferSourceNode.playbackRate != 1` 会变调，不可用它冒充 `preservePitch:true`。速度为 1 的 Clip 直接用裁后 Buffer/loop；速度非 1 新增即时本地 `local/prepare-audio-playback`，其请求只含 `{source,sourceTotalSamples,sourceSamples,targetSamples,speed,preservePitch:true,loop?}`，返回拥有精确 target 长度的 48k stereo PCM WAV Resource/样本数。从既有 `render/audio.ts` 抽取并共用 trim→loop/phase→atempo→pad/trim 的源准备算法，gain/curve/audible/fades **不烘焙**，仍在 Web Audio；不能调用全片 mixAudio 或重复付费能力。该能力按 §3 缓存，因此改增益/淡化不重新 atempo/ASR。准备 PCM 的第 k sample 对应 Clip target 起点+k，播放从绝对 sample 减 target.start 定位、playbackRate 恒为 1。保存现有 FFmpeg 混音规则，不改其导出行为。

用一个 AudioContext.currentTime 调度 anchor 与 frame anchor 映射，rAF 更新画面，声音从同一个 Program 时间开始；背景页恢复、音频中断先暂停再恢复，不补播经过段落。用户手势首次解锁 AudioContext，资源/PCM 准备失败显示明确错误，不偷偷无声播放。离开会话释放 Buffer/AudioContext；不在每帧分配新 nodes。实际连续播放不是逐帧编码证据，交付仍需导出检查。

### 5.3 快捷键与文件预览

- Space 播放/暂停；左右键或逗号/句号 ±1 帧，Shift ±10；Home/End 首/末帧；Escape 清实体选择。
- 文本框、textarea、contenteditable、Inspector 控件/菜单聚焦时不拦 transport；键盘菜单另有方向/Enter/Escape 语义。Cmd/Ctrl+S 在 Source 立即保存，阻止浏览器保存页；F2 在 Artifacts 名称操作。
- 点击 Artifact 暂停 Composition，切单文件：图片无 transport，音视频 native controls + 静音/秒定位/前后五秒。返回恢复原合成帧，不写 Run/Candidate；Timeline 定位/选中也返回 Composition。
- Comments 进度 hover 懒创建一个独立静音 iframe，在其中 seek 候选帧，不移动主播放头、不写 PNG；离开 Comments/会话销毁它。

## 6. Timeline、来源端点与事务写回

### 6.1 Timeline 呈现

全范围是 Timeline 本身，不能按长素材扩片长。固定 Program 尺；有 placement 时附 Segment/Word/Selection/Moment 带，无语词 Segment 仍显示。是否隐藏空 Word/Marker 带在整部作品判断，不随着 viewport/播放头闪动；没有 Segment 只有 Program 尺。Take 放置及完整时长只是参照，不开放任意裁改。

每声明 lane 一行，重叠不自动分行。band 是 lane 内部带（例如 15px Uses），child lane 是独立垂直轨道（ranking reveals/声音）；二者 DTO 明确区分。实体按层次再投影顺序，选中临时抬高编辑 overlay，不写 Film 层级。一个实体可有多个半开区间，联动选中但不合并；语义顺序稳定，高亮只换颜色。无帧 Anchor 省略；Segment/Word 视觉至少一帧，非正 Selection 不画。

Fit-all/放大/缩小/底部窗口；Ctrl/Meta/Alt+wheel 围绕指针缩放，Shift/横向 wheel 平移，普通垂直 wheel 滚轨道；尺区固定。Segment 双击聚焦；空白拖动定位，实体点击选择，边缘先查授权 trim、中部先查 move；无授权不显示手柄，不因有矩形而允许编辑。

### 6.2 时间授权表（服务端权威）

| 实际作者形式 | 支持反向写 | 不允许的推断 |
|---|---|---|
| 共享 Selection/Moment | Script facet 按准确锚点 inverse 修改原标记，全消费者重编译跟随；没有 inverse 只读 | 不根据 runtime ID 前缀/同帧重合猜共享 |
| 直接 `during` Selection | move 按**不同帧**语义停靠点同时推进首尾同数量；可变帧长 | 不当恒定帧长度普通矩形平移；仅 facet 声明的锚点裁边可编辑 |
| `at/for` | move 改 at；trim-end 改 for | 不开放 trim-start 伪装为独立 start |
| `until/for` | move 改 until；trim-start 改 for | 不开放 trim-end 伪装为独立 end |
| Instant 引用 ± 偏移 | 只改偏移；裸引用=零偏移，首次插入 `+ Nf`/`- Nf` | 不替换引用值、不拖动原锚点 |
| `start/end` | trim-start/end 改各自表达式；move 同 deltaFrames 改两端 | 不只改一端或忽略共享拥有者 |
| 固定/派生/无支持 inverse | 完整显示，只读 | 不由名称/矩形长度/屏幕范围发明 inverse |

共享 Window 的端点属于 Window 作者，不属于消费 Use；共享 Style/Recipe 同理。授权必须从 **实际执行 Track 闭包** 的 Instant/Window lineage、公共领域身份、具体 consumerPort 得到：零个匹配只读，一个匹配使用，多个匹配报 `STUDIO_TIME_AMBIGUOUS`，不能按数组序号选一个。

反向钟值/偏移统一用当前 ProgramSpace `f` 单位；源裁剪/fade 控件的既有 ms/s/f 幅值按领域单位保留，与 Program time gesture 不混淆。同帧不同 Anchor 不合并；Inspector 显示精确 anchorKey，只有已声明 reanchor 的 authority 可换同帧 Anchor。所有手势整数帧、不越 0…T、不允许非正窗口，最后由现有 `timeline/temporal` + domain validators 再验。

### 6.3 elaborator 必须暴露的准确 span

现有 `Attribute.span`、`AttrValue.span`、`RawElement.bodyStart/bodySpan` 与 SourceSpan 已有 UTF-16 范围；**现有 AuthorOperation/AuthorRecord 的整元素 span 不够编辑**。新增核心无 UI 的 `AuthoringIndex`，通过同一编译的 `compileAuthorDetailed(entry,workspace,registry): {graph,authoring}` 返回；`compileAuthor` 调同一内部实现仅返回 graph，不能为 UI 另 parse 一次。Run 解析同样收集 unit/attribute span，供 Source 导航。

每个来源条目：稳定 `authorKey`（workspace 相对文件+元素 id，匿名子项使用拥有者内声明路径）、moduleId、完整 Surface tag、elementSpan、openingTag/closingTag/insertion span、attribute name/value/full spans、raw body span、sourceVersion=sha256 原全文。attribute value range 记录含/不含引号边界与原文，替换调用该语言 serializer，不能把 XML decoded 文本当原文。

`ElaborationContext.authoring(registration)` 注册 **Binding/operation output、准确作者子项、producer input port/list index** 的来源关系与语义 role；anonymous plan records 必须保留对应 Item/Use 来源，不能只保留整 Track span。core `authoring.ts` 只含数据类型，最终索引不混入持久化 Value。要写端点的模块在展开时注册，不靠遍历陌生 JSON 形状复原来源。

`.dvs` parser 为 rule 增加 name span、body braces/insertion span；每 property 增加 name/value/full span、分隔/删除范围，并保留完整原文。嵌套 record/list 的路径可用 JSON path+所属 property 整值 span，整值由 `.dvs` serializer 替换；不对 decoded JSON 的字符位置猜 source offset。

Script parser 另返回 `ScriptSourceMap`：原始正文、Segment/Token/Selection/Moment 身份及 raw slices、marker 起止/亲和方向、anchor↔token-boundary 映射与合法插入 gaps。`script/studio.ts` 提供 marker inverse，移动标记只替换/删除/插入标记 token，保留词正文、Dual Text、词属性、空白、转义。不得用显示词列表重建 Script。StoryKey 可能随正文变动，editorKey 仍优先作者文件/id/标记名，不依赖 compile 随机记录 key。

端点在服务端映射为 `{endpointKey,ownerKey,sourceUnit,sourceVersion,language,span,expectedText,schemaKey,access,path?,groupMembers?,insertion?}`。UI 可以收到定位 slice/read-only 与 endpointKey，但不能自选 span/文件/schema。reference binding 指向准确 Style/Frame/Recipe 拥有者；没有作者化默认的第一次修改插入该拥有者合法位置，不能覆写消费端引用。

### 6.4 写入与失败语义

- **Source 自由编辑：** 480 ms 输入 debounce，Cmd/Ctrl+S 立即 PUT 当前文件全文 + source/view versions。服务器原子保存再编译；即使编译失败也**保留新源码**，Source 显示错误继续修复。当前 error 状态仍允许基于最新 requested/source version 保存；禁止拿上次成功画面的旧 endpoint 编辑。
- **字段/时间结构化编辑：** 单 Run 写队列串行；要求 ready 且 expectedViewRevision=最新 requested=published，并与磁盘每个来源版本一致。服务器重新找 endpoint、验证 canonical schema、构造 patches；核对 UTF-16 边界、expectedText、非重叠，逆偏移应用。无值变化不写文件、不增 revision。
- 在 scratch/内存 Source overlay 上先完成同编译验证（显示闭包/所有必要本地资源），成功后再发布文件与同版本快照；提交前重新比较磁盘原文。确需写磁盘再编译的代码路径必须在失败时恢复原文本再编译，HTTP 422；因此外部可见最终语义是原文件/有效快照均不改变。优先 overlay 路径，避免恢复时覆盖并发作者编辑。
- 多文件手势用同事务 overlay；发布前取全部旧文本 hash，逐文件 atomic rename，失败恢复**仅仍等于本事务新文本的文件**。外部内容变化 409，不覆写外部修改；若无法安全恢复，明确事务冲突/error 状态，不能谎称成功。事务/发布/待更新期间拒绝其他结构化请求 409。
- record 原子修改只替换声明组成员，省略成员删除，无关属性/引用/子内容保留；组成员含 reference 不能当可写 scalar。list/record 草稿完整有效且结束编辑才提交，缺必填不给半成品落盘。
- `0.78 ↔ 78%` 使用 displayScale 的逆变换；`%/px/ms/s/f` 只改幅值、保留既有单位；空值不是零。字段不 spin，滚轮不能改数；选项保留真实 scalar 与 label，颜色支持文本/选择器/建议，字体只是已有 Face 展示，不下载/替换文件引用。

## 7. 通用 StudioCompanion 合同与模块责任

### 7.1 注册与纯投影接口

每个模块在自己的 `src/modules/<name>/studio.ts` 实现。ModuleDef 精确增加：

```ts
// src/core/module.ts：仅 type import，不在 core 加 UI runtime
import type { StudioCompanion } from "../studio/companion.ts";
interface ModuleDef {
  // 保留现有字段
  studio?: readonly StudioCompanion[];
}
```

数组允许同模块 Track + Style 参数或多个 Surface facets；不采用一个全局硬编码 `switch moduleId`。模块 `index.ts` import 自己的纯 companion 常量并挂 `studio`，已有 `modules/index.ts` registry 不另造另一份身份。发行集合显式列出；启动只对已加载模块合成不可变 registry，match 重复/不兼容/未知显式字段 schema 都报错，不默默隐藏。项目组件仅在现有受信任显式 registry 机制下贡献，暂不新增任意磁盘 JS 自动加载。

以下为协议文件实现时冻结的签名（非本阶段代码实现）：

```ts
interface StudioCompanion {
  protocol: "dsivio-video.studio-companion/1";
  key: string;                  // 全限定 moduleId + facetName
  moduleId: string;
  matches: readonly { surface: string; output: string; type: TypeRef }[];
  family: string;               // 数据分类，不作为任意 CSS selector
  icon: "audio" | "video" | "image" | "text" | "board" | "effect" | "film" | "script";
  tone: "neutral" | "blue" | "green" | "orange" | "purple";
  supports?: readonly SupportOutput[];
  project(input: CompanionInput): CompanionProjection;
  film?: FilmFacet;
  script?: ScriptFacet;
}
```

`TypeRef`、Timeline、ResourceRef、Value、Window/Instant 复用现有 type，不另定义。输入/输出数据详细冻结：

| 类型 | 必填事实与约束 |
|---|---|
| `SupportOutput` | 同 Surface 输出名+完整 type；明示选入显示闭包，不跨 Surface 爬陌生数据 |
| `CompanionInput` | 所选输出 Value、完整 TypeRef/module/surface、Candidate provenance、准确作者元素/子项/引用、AuthoringIndex、实际执行 input/output 图、已解析支撑 Values、Timeline、render parts 与通用回退函数；只读 |
| `CompanionProjection` | `entities/lanes/bands/materials/fieldGroups/parameterOwners`，有序数组；全部同步纯计算，无 Promise/IO |
| `StudioEntity` | `editorKey/authorKey/title/paintRank`、有序 `intervals[{start,end}]` 半开帧、`laneKey/bandKey?`、文本/材料 layers、准确 sourceSlice、pictureParts、selectionGroup?、实际 parameterOwners、readonly facts、temporal lineage；editing interval 与永久可见范围分别声明 |
| `StudioLane` | key/title/height/order、可选 parentLaneKey；高度稳定、不为重叠增行 |
| `StudioBand` | key/laneKey/title/height/order；不是伪造 child lane |
| `StudioMaterial` | `ResourceRef` 或准确版本化 Surface Value，媒体种类、裁剪/采样事实；不带 Studio URL。Surface 不假造文件缩略图 |
| `FieldGroup` | Where/When/How、pageKey/sectionKey、显式有序 fields；每 field 有 fieldKey/ownerKey/widget/schemaKey/authorValue/displayScale?/units?/options?/endpointKey?；widget 仅 text/number/boolean/select/color/list/record |
| `SourceBinding` | 真正拥有者/作者属性或 Recipe path、只读/可写权限/reference、白名单 endpoint；binding 可达不等于 UI field 选中展示 |
| `TemporalAuthority` | key/originKind/originKey/consumerPort、实际 Instant/Window 与支持手势/合法 anchors；服务端 inverse 依据授权，不接受 Companion 任意文件补丁 |
| `FilmFacet` | Composition output 的准确完整 TypeRef、Timeline input+TypeRef、子 source inputs+允许 visual/audio Types |
| `ScriptFacet` | parse/observe 原始 Script Surface 与 source map；语义 rows/anchors 投影；`rewriteAnchor(input): SourcePatch[]` 的领域 inverse，由 host 校验版本/patches/编译 |

参数 Style 自身 Companion 通过实际 owner module/Surface/完整输出 type 匹配；消费 Companion 显式引入参数组。多个 Use 引用一个 Style 仍一个共享拥有者，Use 保有自己的 Window。无参数 Companion 时只显示消费方声明的只读事实。未匹配 Track 用通用终端实体回退，只读且有真实来源/材料，不猜额外可编辑属性。

### 7.2 首批 Companion 与字段组

下列 **16 个模块**都有 `studio.ts`，前十二个对齐 research/08 §2.6，另外四个覆盖已实现 Phase 4 模块。表是必须交付的领域投影，不是十二套页面；属性名以现有 ModuleDef/schema 为唯一合法性来源，表列出的所有已存在有端点字段须提供控件，不能因“通用 Inspector 已有”而只交付标题。

| 模块 / Companion | 实体、lane 与 field groups |
|---|---|
| `film` | Composition 会话解释、唯一 Timeline/Track source 类型；没有 Film 专属页，项目 facts 用通用 Inspector |
| `script` | 原始正文/Segment/词/Selection/Moment 的源码与语义带；无通用参数页，标记锚点 inverse；缺帧省略、Selection 正长 |
| `audio-track` | 48px Clip/波形；When/Playback（once/once-start/once-end/loop/loop-start/loop-end/stretch，stretch 双界必填）、Trim、Fade；How/Mix（gain 0–6400%）。多个 playback 作者属性作为 record 原子写 |
| `caption-fine` | 36px Cue 内容+15px Uses band，真实 CaptionDocument 文本、Cue 只读/Use 按 Window 授权；Style：Where/Placement/Region/Flow；How/Text/Paint/Cue Box/Decoration；When/Cue/Token/Loop。涵盖活动字填充/渐变/描边/长阴影/glow、整句进出、karaoke/atom/reveal、活动框过渡响应缩放，Style reference 找真实 owner，不改 Script 显示词 |
| `comment-sticker` | 52px lane，头像装饰与正文内容；Where/Frame/Layout（三段文字、tail/avatar）；How/Appearance/Copy（正文/作者/header/meta）；When/Motion。它**不是** FEEDBACK 评论 |
| `deck-track` | 52px 卡片至下次激活/terminal、多 render parts；Where/Depth/Frame；How/Appearance/Label（含真实 playback/trim、future/past playback）；When/Motion（reflow/enter/sustain/exit）；source/extent 可读不等于可写 |
| `media-track` | visual 76px/audio 48px，Item/Sequence 整体、图重复/视频分镜/波形，Sequence 取首材料；Where/Placement/Size/Fit/Frame-Geometry-Stacking；How/Image/Frame-Paint/Audio-Gain；When/Playback/Enter/Sustain/Exit/Boundary。纯音频仅 Audio Gain/Until Boundary，共有 source-audio binding 不自动展示 |
| `performance` | 60px placement 内容+15px Uses band，Segment/内容窗口只读，Use 有真实授权；引入 Style Where/Frame/Fit/Size/Placement、How/媒体外观/边框；保留 Timeline 原时钟，**排除 playback/trim** |
| `ranking` | 80px Board、40px Reveals/Activations **child lanes**，独立 48px sound lane；Board Where/Frame/Layout/Stage/Stacking，How/Board/Text/Labels，When/Motion；column Item(label/rank)/Stacking，tier Item(tier)/Entrance(direct/drop)/Stacking，top-three Item(label)/Stacking；sound How/Sound(appear/move gain)、When/Sound(fade 帧/只读触发)，时机跟视觉事件不能任意拖 |
| `screen-overlay` | 52px effect lane，Window 血缘；Where/Geometry；When/Motion(attack/hold/decay/travel/from/to/rate/drift)；How/Color/Effect（强度、softness/spacing/thickness/angle/coverage/feather/bars/seed/amount/warmth/scan-lines 等），direction 与 chroma 真枚举 |
| `sound` | 48px Timeline 原波形+15px Uses，Segment/内容范围只读，Use Window；Style How/Sound(gain/end-gain 0–6400%，未写 end-gain 跟 authored gain)，绝对 Use 窗口内线性包络 |
| `typo`（typography-track） | 48px 富文本摘要/Item Window；Where/Layout/Stacking/Area/Point/Path；How/Typography/Paint。包括 region/padding/align/wrap/overflow/max-lines/min-scale/clip/columns/gap、路径侧/方向/margins、font/size/weight/style/spacing/kerning/lang/writing-mode/baseline/tab/indent/paragraph/CJK/punctuation/metric-edge；placement/content/motion reference 不造独立编辑页 |
| `caption` | 已有 Caption Program 的 Cue/Use/材料来源；When/Use window 按授权；引用 Style 的 Where/Placement/Flow、How/Text/Paint、When/已有 cue/token 动效。显示作者 CaptionDocument，不从 ASR 重建字幕；不冒充 caption-fine 的不存在字段 |
| `interview-emoji-reveal` | 已有 Component 的 trigger/视觉部分/装饰材料分开，lane 与稳定 part map；Where/已有 frame/layout/stacking，How/现有 appearance/content，When/事件与 motion；从准确 Instant 消费边授权，不伪造自由 Window |
| `image-compose` | Surface 输出与源材料顺序投影为支持材料/实体；Where/已有几何与 layer，How/已有 paint/composite 参数；无 Program window 只读时间，不把静图合成变自由 Track |
| `image-transform` | Surface/Image 操作及有序 Steps、真实源引用；How/已有 transform record/list（裁剪/滤镜/变换按已实现 schema），Where/真实 geometry；不开放衍生 extent/source 假标量，不造 Timeline 时长 |

字体/Frame/Recipe binding 被各消费 Companion 引入真实参数 owner；不需要为没有输出 lane 的基础模块再发布重复 npm 包。所有字段合法性最终仍在现有领域 schema/type validator，Companion 不能私自扩大编译支持范围。

## 8. Comments 与 Agent 协作

### 8.1 自有版本化 FEEDBACK.json

项目根 `FEEDBACK.json` 首次保存才创建，缺文件=空列表。本项目不兼容/猜测旧系统未版本化格式，读到未知/缺 schema 明确错误，不自动覆写；未来迁移另设显式命令，不混存两种形状。

```json
{
  "schema": "dsivio-video.feedback/1",
  "comments": [
    {
      "id": "comment_8f52e51d-3571-43eb-a62e-8c19e99a66e0",
      "run": "runs/main.dvrun",
      "at": 1.4,
      "text": "这句之后停半秒，再进入下一张卡片。",
      "resolved": false
    }
  ]
}
```

root 是 object，schema 固定、comments 数组；其余 root/单条 comment 扩展字段保留。id 非空字符串全文件唯一（新增用 randomUUID）；run 为 workspace 相对、`/` 分隔、规范化不逃逸路径，必须非空；at 有限非负秒，可在现片长之外；text 非空可多行，纯文本不执行 HTML；resolved 可省略=未完成，有值 boolean。编辑不能改 id/run。commentsRevision 是当前完整文件原始文本 hash（缺文件用约定 empty hash），不要求往 JSON 写计数器。

当前网页只显示当前 Run，按 at 时间排序，同时间按原数组序；`#N` 按该 Run 在原数组提交顺序，不因筛选/改 at 重编号，删除收紧编号；Agent 永远用 id，不用 #N。点击定位保存的**秒数**（播放器 clamp 超片长并提示），不悄悄跟随新语义。文字、开放/完成过滤、编辑/完成/重开/删除均实现。

输入聚焦暂停并捕获当前时间；写作草稿 at 固定，chip 再捕获当前时间，不存截图。Enter 发/保存，Shift+Enter 或 Alt+Enter 换行；IME composing 不发送。点外部清选择但保留编辑，切语言/页面保留草稿。只放已实现功能，没有表情/绘图占位，不声称通知了 Agent。

### 8.2 冲突与原子保存

每次变更重新读磁盘、完整 schema 校验，保留其他 Run/扩展字段/数组顺序。修改/删除请求携带**整条显示时旧 comment**，与最新记录深比较，不一致 409，浏览器保留草稿；新增冲突 ID 409。原 JSON 无效、重复 id、字段无效时报错且绝不覆写。

进程内串行；唯一临时文件 `wx`，写前与发布前比较原始完整文本，rename 发布。为保留扩展字段而重序列化 JSON 可以改变排版，但不改语义字段/数组顺序。检测外部编辑后 409，不自动吞并冲突。同进程提供锁给 CLI 的未来修改能力；本阶段 CLI list 只读。外部文件监测发 `comments-changed`，页面重新读留言，不重编译视频、不轮询、不影响 viewRevision。

### 8.3 Agent 可读合同

`dsivio-video comments list --run <run> --state open --json`（默认 state=open）输出 `{schema:"dsivio-video.comments-list/1",run,commentsRevision,comments:[{id,number,run,at,text,resolved,...extensions}]}`。`--state resolved|all` 可查历史；人类文本打印稳定 id、#N、时间/状态/多行文字。Run/workspace 解析同 Studio，服务未启动也可读，文件无效退出非零并报告，不访问 HTTP 或生成任务。

发送只是落盘，没有自动 agent notification。用户要求处理评审时，Agent 用上述 CLI 读最新开放项与源码/当前画面，按 id 判断意图，编辑真正 Source/Recipe/组件/素材并检查受影响片段和衔接，再重新读取文件并把该 id resolved=true；保留其他字段/新留言。直接改 JSON 必须遵循旧值/最新文本比较与原子发布，不能用过时整个文件覆盖。长期方向/进度资料不是 Studio 自动执行职责。

## 9. Tasks / Artifacts 与 Result 展示名

复用 `.dsivio-video` 的 BuildStore、observe 与 ResultsRepository，**不**扫描输出目录、不新增 Studio 工程清单，不将宿主付费媒体 task 等同插件 Build。任务卡来源是 Build，operation task/receipt 只是子执行事实；含计划确切 model/request 的只读详情可沿现有 BuildStore/plan-view 查询，改 prompt/model 不自动提交收费生成。

### 9.1 查询与状态

现有 `ResultsRepository.list` 只列 ended Result，Phase 5 扩展 `list({includeOpen?:boolean,before?,limit?})` 默认 false 保持现有 history 行为；Studio 查询 active 从 BuildStore 的 builds/observe 合并已发布 open manifest，并按 build id 去重。新增 libraries reader 用一致的 project stateDir，不误把 `dsivio media status` 当全库。

任务全部/进行中/已结束过滤，显示 running/failed/cancelled/action-required 与保存 Result 阶段、来源 Run、可复制完整 error/operation progress。分页按稳定 build id 降序 cursor，不按卡片行号；首次加载/明确 Refresh/滚到底加载 older，**没有库轮询**。再次进库保留列表、选择、scroll；刷新失败保留旧列表+错误。已选 Build 上下文跨页签保留，可跳产物/回任务/清除上下文。

### 9.2 媒体归属与重命名

只展示声明 MIME 为 image/video/audio 的**顶层 class=file Output**（包括进行中已发布文件），不拆 Composite 内 Resource。forward 沿真实 owning Build+Output 解析，检查循环；同 owning file 去重卡片并留所有来源，不仅按相同字节 digest 合并两个独立文件。highlight 输出优先但不排除其他。固定方形缩略图区 contain 原比例、最多两行名称、自适应列数；IntersectionObserver 懒加载视频帧/图/波形，浏览器生成展示，不写新 Result 文件。

ResultOutput 的两个分支统一扩展可选 `displayName?: string`，字段属于**具体 manifest.outputs[output]**，不在 ResourceRef/value.data 上保存，不影响 TypeRef/valueClass/历史 Candidate。未写时名称回退 output logical name。forward 卡片保留自己的 requested Build+Output rename target，真实 owner 只管字节；卡片来源切换决定名称目标，不能误写 owner 名或同时改所有 aliases。

双击/F2 进入名字输入；Enter/失焦保存、Escape 取消，失败保留输入+原因。name 为 trim 后非空文本，不解析为文件路径。只有准确指定 manifest outcome 为 complete/failed/cancelled 可改，open 返回 409；拿最新原文 hash=manifestVersion 比较并原子 write，stale 409。同 Result 多端写串行，ResultsRepository 在发布前比较完整文本，保留 operations/其他 Outputs/扩展字段，不能经 UI overwrite 整个旧 manifest。正在保存/Worker 仍有发布权的 Build 不能改名；ended 的不可变执行数据不被 worker 后续重写。现有 readOutput/export/history 忽略展示字段，现有 manifest 不需迁移。

## 10. 本地化与可访问性

内置 `ui/locales/en.json` 与 `zh-CN.json`，同一 messages keys 与命名变量。首次按 navigator.languages 选择简体中文或英语回退，其后记忆选择；切换不丢播放头、selection、任务上下文、评论/字段/source 草稿。只翻译应用 UI/明确通用分组，作者文字、模块提供自有名称、原始错误/日志不翻译。没有外部 locale-pack CLI 的本阶段范围；缺 key 在开发校验失败，运行回退英语并显示诊断，变量缺失不能静默空白。

明暗主题、键盘可用菜单与焦点可见状态，错误不只靠颜色；Source/Timeline/Comments 各有可访问标签。滚轮数值不改变，record/list 必填补全错误可被读到。保留 Companion option scalar 与用户 label 分离，不能以翻译后的文本写回作者值。

## 11. 六个并行工作包与验收

协议在开工时按 §1/§7 冻结，由 A 先提交 **仅类型** `protocol.ts/companion.ts`、ModuleDef studio field；这一步是共享前置，不是实现阻塞。其后六包可独立依据协议/真实领域 fixtures 开发，最终 A 集成 CLI 注册与发行；所有共享文件只有表中 owner 改，其他包通过接口提出变更。源 provenance 由 C 定型，D/E 注册自己的 module 来源；共同 schema 不由各包复制。

| 包 / owned files | 提供/消费接口 | 必须验收（真实浏览器） |
|---|---|---|
| **A 服务器、显示闭包与集成**：`src/studio/{protocol,companion,server,session,watch,security,display,cache}.ts`、`src/build/execute.ts`/worker 提取接点、`src/plan/display.ts`/plan 共用剪枝、`src/core/module.ts` 新字段、`src/cli/commands/studio.ts`、`src/cli/main.ts`、package/lock/vendor 发行 | 挂载 C edits/F feedback/libraries handlers；`loadView(requestedRevision):Promise<ViewRevision>`；静态 UI/SSE；共享 executor/cache，不能改 F Result schema | 真 Run 启动/复用/occupied port；80ms 合并、故意慢旧编译不覆盖新；字节相同字体/Window 编辑后 ASR 无新执行；付费缺 Need 错误无 submit；跨源/坏 token/Host 写 403；`snapshot --studio` 真抓帧成功，重编译中 409/失败 500；截图 shows ready/stale/error |
| **B UI shell、Source 与播放器**：`src/studio/ui/{index.html,main,api,state,shell,source,stage,transport,audio,materials}.js`、基础 CSS/locale 与 `tsconfig.studio.json`；`src/render/audio.ts` 共用音源准备函数、`src/render/playback-audio.ts` 新本地能力（A 注册 capability） | 消费 ViewRevision/fields/lanes、C/F 面板 exports；`seekFrame/play/pause/select/setFilePreview`；导出应用状态订阅和 transport；C fields/F pages 不重复播放器 | 同 HTML iframe 显示 30000/1001fps/循环/hold/变速，离散 seek 等 decode；音频源静音视频+独立 AudioTrack，>1 gain、全局 curve/phase/淡化且变速保音高；快捷键/控件隔离，Source 自由错误源码保留；en/zh-CN 切换草稿不丢；截图 ready/locale/file return |
| **C 来源、结构化编辑与通用 Timeline/Inspector**：`src/core/authoring.ts`、`src/elaborate/{source-index,compile}.ts`、`src/markup/{ast,parse,dvs}.ts` span 扩展、`src/studio/{edits,temporal-edits,projection}.ts`、`src/studio/ui/{timeline,inspector,fields,menus}.js` | `compileAuthorDetailed`、SourceBinding/TemporalAuthority、`applyFieldEdit/applyTimeEdit`；通用 schema 控件/端点 inverse dispatcher；不实现具体领域 marker inverse | 真拖 move/trim/reanchor，各授权形式边界；共享 Window/Recipe 修改全消费者同步，裸引用只插 offset；UTF-16 中文/emoji 与 `.dvs` record 精确写；原文/陈旧版本/歧义 409 或只读；非法结构化修改 422 且旧源保留；lane/band/重叠菜单 screenshot |
| **D 语义与基础 Companion**：`src/modules/{film,script,sound,performance,typo,audio-track,media-track}/studio.ts` 及各自 index 注册/authoring 调用、`src/timeline/script.ts` source map/marker inverse | Film/Script facets、上述 module project/parameter fields；按 C AuthoringRegistration 记录准确 ports/children；不修改中央 ModuleDef/registry | 真 Timeline Script 标记平移保持原文/Dual Text/词属性；sound/performance 内容只读 Use 有授权；typo 文本事实/Style 共用、media/audio Playback record；七种投影完整、render part 选中与 source 定位对应 screenshot |
| **E 其他组件 Companion**：`src/modules/{caption,caption-fine,comment-sticker,deck-track,ranking,screen-overlay,interview-emoji-reveal,image-compose,image-transform}/studio.ts` 与各自 index 注册/authoring 调用 | 九模块的实体/material/支撑输出/参数组；共享 C schema 控件，不写特殊 DOM/CSS；ranking 准确子 lane/触发血缘 | 九模块真实 fixtures 全部可投影；caption 文本不替代 Script，ranking sound 只读时机，deck 多 parts、image Surface 不假文件；record/list 完整原子保存+引用 owner，逐模块截图 inspector/选择与画面相符 |
| **F Comments、库与 Agent CLI**：`src/studio/{feedback,libraries}.ts`、`src/studio/ui/{comments,tasks,artifacts}.js`、`src/cli/commands/comments.ts`、`src/build/results.ts`/必要只读 store/observe 查询接口 | 独立 comments revision/handlers、manifest displayName/listIncludeOpen/rename、UI panel exports；将命令声明给 A main.ts 集成 | 两 Run 评论隔离、IME/time chip/编辑/重开/删除；外部 JSON 修改与旧值冲突 409 保草稿，无效 JSON 不覆写；CLI list 与 UI id 一致；active/ended 分页与失败 Refresh 保列表、forward 去重/准确 displayName rename 不改 Candidate；截图 Comments/Tasks/Artifacts |

B 导出 `mountPanel(container,componentProps)` 的普通 Preact 宿主，C/F 导出面板组件使用同一 state/api/transport；不各建 React root/状态库。A mount handler 的请求上下文固定 `{session,tokenVerified,workspace,resources,expectedViewRevision}`，C/F 不重做 Host/token 逻辑；写 payload 在各自 handler schema 校验。locale keys 由 B 维护 manifest，各包交付其 namespace 的 en/zh-CN 文案，经 B 合并；不发生多人覆盖整份翻译文件。

### 11.1 每包的截图证据约定

验收不是静态模板截图/测试 mock。用项目真实 `.dvrun`、资源与 Companion，启动实际 Studio，在浏览器完成该包操作并观察 Source/FEEDBACK/Result 与响应，再通过已有 **`capture screenshot`** 保存视觉证明。交互可用 `capture run` 的真实 Puppeteer 脚本先完成，但最终各包至少一张 `capture screenshot`（新建页面可从 hash/localStorage 恢复可重现状态；不能靠它伪造已完成交互）。

```text
dsivio-video studio --run runs/main.dvrun
# 使用实际打印 URL；仅下面示例采用 5179
dsivio-video capture screenshot http://127.0.0.1:5179/ \
  --to review/studio.png --viewport 1440x960 --wait-for '[data-studio-ready]'
dsivio-video capture screenshot http://127.0.0.1:5179/#comments \
  --to review/comments.png --viewport 1440x960 --wait-for '[data-comments-ready]'
dsivio-video snapshot --studio http://127.0.0.1:5179/ \
  --at-frame 0,42,120 --to review/program-frames
```

ready attributes 是真实 readiness，不在 loading/error 随便设置。截图目录由验收创建，不提交无关截图/scaffolds 到源码。每包报告命令、实际截图路径、已观察行为与明确限制；音频不能以 PNG 证明，B 另记录浏览器 AudioContext/源准备与实际试听/波形采样结果；抓帧不能替代完整 UI screenshot，native 连续播放不能替代最终 MP4 检查。

### 11.2 集成完成条件

六包全部到位后，集成 owner 一次运行现有 tsc、`tsc -p tsconfig.studio.json`、项目测试与真浏览器端到端 smoke；各包开发中只跑自身 scoped proof，不在共享半成品上反复跑全套。新增永久测试针对授权/UTF-16/事务/并发/缓存身份等可见不变量，不测字面 wiring。

最终交付必须有：可启动完整 Run；全部 16 companions 与双语字段；同版本显示/错误/抓帧；本地缓存避免无关编辑 ASR 重跑且无任何付费执行；有真实端点的字段/time 编辑、source 自由错误保存；Comments 文件/CLI/冲突；Build/Artifacts/显示名边界；六包真实浏览器截图。缺任一项不能标成“Studio MVP 已完成”。本文设计交付没有运行 Studio 或截图，也没有修改代码/依赖；这些是实现阶段的验收，不冒充当前证据。

## 12. 与研究行为的明确取舍

| research/08 行为 | 本阶段决定 |
|---|---|
| Vite WebSocket/启动网页 | Node loopback HTTP + SSE/POST、原生 ESM；保留 80ms/versioned compile/真实页面，不需要 Vite |
| Runtime 批准瞬时 Need | 显式本地 allowlist + cost/local/immediate 双重检查；共享 executor 与持久 cache；付费只能先正常 Build |
| 十二重复发布 Studio 包 | 16 模块 colocated `studio.ts`、ModuleDef.studio；保留所有领域编辑与参数 owner，而非只留通用矩形 |
| 未版本化原 FEEDBACK 文件 | 自有 `dsivio-video.feedback/1`，保持 id/run/at/text/resolved 行为；不自动兼容旧格式，不假装通知 Agent |
| package-root/runtime/locale-pack | 沿用明确内置模块/当前 Workspace；首批内置 en/zh-CN，无 Runtime Profile/自定义语言包承诺 |
| Tasks 与宿主生成任务 | 复用插件 BuildStore/ResultsRepository，宿主 media task 仅 operation 事实，不复制队列/凭证 |
| screenshot/snapshot | 保留现有 document/material snapshot 合同与本地 renderer；UI screenshot 用已有 capture，不增截图 Build |

本文未读取旧 hypit 实现目录；来源是本项目研究规格与现有编译/计划/机器/模块/Result/抓帧合同。新增 UI npm pins 已查询 npm 元数据；未安装或实现。