# 第 1 阶段设计：核心

对应 hypit 的 markup / elaborator / core / run / runtime-local / build-result / video-cli 的构建部分。行为以 [research/01](../research/01-markup-source.md) 和 [research/02](../research/02-plan-build-runtime.md) 为准；本文只写我们的结构和接口，以及与规格不同的决定。

## 1. 共享契约（已写好，改动需先改这里）

| 文件 | 内容 |
|---|---|
| `src/core/value.ts` | `Json`、`TypeRef`、`ResourceRef`（`$resource`）、`Value`、`Pending`、`valueClass`、`canonicalJson` |
| `src/core/errors.ts` | `DvError(code, message, {span, hint})`、`SourceSpan`、`spanAt` |
| `src/markup/ast.ts` | `MarkupDocument`、`ElementNode`、`RawElement`、`AttrValue`、`DvsSheet` |
| `src/core/module.ts` | `ModuleDef`、`SurfaceDef`、`ElaborationContext`、`ProducerDef`、`NeedRequest`、`FrontendDef` |
| `src/core/graph.ts` | `AuthorGraph`、`RunIntent`、`ExecutionDefinition`、`Command`、`Fact` |
| `src/core/capability.ts` | `CapabilityDef`（`resolve` + 即时/异步执行器）、`ResourceStore`、`ExecuteContext` |
| `src/core/history.ts` | `HistoryReader` |
| `src/modules/index.ts` | 内置模块与能力注册表 |

## 2. 模块与目录

```text
src/
  core/        契约 + machine.ts（纯状态机）
  markup/      header.ts parse.ts dvs.ts
  source/      workspace.ts（项目根、源与素材的路径边界）
  elaborate/   compile.ts（源闭包 → AuthorGraph）
  run/         parse.ts（.dvrun → RunIntent）
  plan/        plan.ts（反向可达 → ExecutionDefinition）preview.ts（付费前展开请求）
  modules/     text/ recipe/ media/ gen/ + index.ts
  gateway/     index.ts（能力 gateway/image、gateway/video）dsivio.ts models.ts validate.ts
  build/       ids.ts store.ts resources.ts results.ts submit.ts worker.ts observe.ts
  cli/         main.ts + 每个命令一个文件
```

依赖方向：`cli → build/plan/elaborate/run → modules/gateway → core`。`core` 和 `markup` 不依赖任何其他目录。模块代码不做 IO；IO 只在 `source`、`gateway`、`build`、`cli`。

## 3. 各部分公开接口

**markup**
- `readHeader(file, text): { using: string; bodyStart: number }`：`<?dvml using="…"?>` 必须在文件首（可有 BOM）。
- `parseMarkup(file, text, { isRaw(tag, imports): boolean }): MarkupDocument`：根元素 `dvml` 或 `dvrun`；import 必须在正文前。
- `parseDvs(file, text): DvsSheet`。

**source**
- `Workspace.open({ cwd, workspace?, assetRoots? })`：项目根 = `--workspace`，否则从 cwd 向上最近的含 `.dsivio-video/` 目录，否则 cwd；取 realpath。
- `workspace.resolveSource(importer, locator)`、`workspace.resolveAsset(importer, locator)`：只接受 `./`、`../`，realpath 后必须在项目根（素材还可在 asset roots）内。
- `workspace.statFile(path)`（非普通文件报 `SOURCE_ASSET_NOT_FILE`）、`workspace.readText(path)`（严格 UTF-8）：编译和规划读文件只走这里。
- 状态目录 `workspace.stateDir` = `<root>/.dsivio-video`。

**elaborate / run / plan / machine**
- `compileAuthor(entry, workspace, registry?): AuthorGraph`；`registry` 只是测试替身入口，默认内置注册表。
- `readRun(file, workspace): RunIntent`（带 `targetSpans` / `satisfySpans`，错误能指回 `.dvrun` 的行）
- `planRun(run, author, history, workspace, registry?): Promise<Plan>`，`Plan = { definition, overrides, unreachable, assets }`；只在候选被选中时由 workspace 校验并解析资产路径，并交给类型自己的 `validate`；assets 保存提交时需复制的资源描述。
- `checkRun(run, author, workspace, registry?): RunCheck`：`check` 用；与 `planRun` 共用同一次选择遍历，但不读取历史结果，只列出 `unresolvedHistory`，不产生执行定义。
- `previewNeeds(definition, ctx): Promise<NeedPreview[]>`：执行此刻能执行的纯步骤，把每个外部请求交给能力的 `resolve`。行有三种：`request`（完整请求或拒绝原因）、`waiting`（依赖尚未生成的结果；不阻止 build，提交前由 Worker 再校验）、`issue`（步骤本身出错）。`issue` 和被拒绝的 `request` 让 plan 失败、build 不入队。
- `new BuildMachine(definition)`：`ready(): Command[]`、`inputsFor(step)`、`validate(fact)`、`accept(fact)`、`state`、`valueOf(record)`；纯内存，可由 `definition + facts` 重放。Worker 先 `validate`，事实写入 SQLite 后再 `accept`。

**modules**
- `dsivio-video/text@1`：`text:Value`、`text:Render`（`text:Param`、`text:Set`、`text:Append`）；类型 `Text`、`TextTemplate`；读取器 `dsivio-video/text/dvs@1`。
- `dsivio-video/recipe@1`：类型 `Recipe`；读取器 `dsivio-video/dvs@1`。
- `dsivio-video/media@1`：类型 `Image`、`Video`、`Audio`（数据就是一个 `ResourceRef`）；`media:Image|Video|Audio src="./x"` 引入项目文件。
- `dsivio-video/gen@1`：`gen:Image`、`gen:Video`，`model` 必填，发布 `<id>.image` / `<id>.video`。

**gateway**
- `gatewayCapabilities: CapabilityDef[]`：`gateway/image`、`gateway/video`。
- 后端在 plan 时选定并写进请求（`backend`）；第 1 阶段只有 `dsivio` 后端。独立后端是第 6 阶段。
- dsivio 命令查找：`DSIVIO_VIDEO_DSIVIO` 环境变量 → PATH 上的 `dsivio` → `~/.kivio/bin/dsivio`（Windows `dsivio.cmd`）。

**build**
- 项目状态全部在 `<root>/.dsivio-video/`：
  - `store/<资源id>`：项目级资源库，资源 id 随机，历史复用直接引用同一 id，不复制字节。
  - `runtime/state.db`：SQLite 工作列表（定义、事实、异步操作、Build 状态）。
  - `runtime/worker.json`、`runtime/worker.log`：后台 Worker 身份与日志。
  - `results/<UTC日期>/<Build ID>/result.json`：结果清单（历史权威）。
  - `config.json`：`{ "gateway": "auto" | "dsivio" }`。
- `submitBuild({ plan, workspace, title })` → Build ID，并确保 Worker 在运行；Worker 启动失败时撤回，报 `WORKER_START_FAILED`（没有 Build 入队）。
- `runWorker(workspace, options)`：`dsivio-video _worker` 的实现；空闲 `DSIVIO_VIDEO_WORKER_IDLE_MS`（默认 30000）毫秒后退出。
- 重启语义：已拿到远程任务句柄的操作在 Worker 重启后继续查询（同一幂等 key）；停在「提交中」且没有句柄的操作记为 `SUBMISSION_INTERRUPTED`，绝不重新提交；Dsivio 未运行（`GATEWAY_UNAVAILABLE`）时操作保持排队，稍后用同一幂等 key 再提交。远程任务无法取消，`cancel` 只停止本地后续工作。
- `ResultsRepository`：`list`、`history(outputName)`、`read(buildId)`、`exportOutput(buildId, output, to)`；同时实现 `HistoryReader`。
- 付费证据：结果清单的 `operations` 每项为 `{ outputs, backend, model, task, receipt, phase, progress, error, summary }`。`task` 是 Dsivio 任务 id（提交时拿到），`receipt` 是供应商回执（查询时拿到后更新），`summary` 是实际发出的关键参数。`inspect --verbose` 每项一行，可据此在 Dsivio 或供应商处核对。
- 幂等 key：`${buildId}:${sha256(commandKey) 前 24 位}`。

**cli**：`check`、`vocabulary [--models]`、`plan`、`build [--follow]`、`status [--watch]`、`activity`、`builds`、`history`、`inspect`、`get`、`cancel`、`runtime up|down|status|logs`、`paths`、`version`、`doctor`。每个命令支持 `--json`；错误统一 `{ ok: false, error: { code, message, source, hint } }`；退出码 1 为命令失败、2 为用法错误。没有 Runtime Profile，`runtime` 子命令只管理本项目的 Worker。

## 4. 与 hypit 规格有意不同的地方

| 规格 | 我们 | 原因 |
|---|---|---|
| 每模型一个元素包 | `gen:Image` / `gen:Video` + 必填 `model` | 模型参数由网关后端描述，plan 时校验 |
| Runtime Profile、Endpoint 绑定、凭证库 | `config.json` 只选网关后端 | Dsivio 管模型和密钥 |
| 每 Build 一个资源目录，复用靠转发 | 项目级资源库 | 复用不复制，结构更简单 |
| npm 包动态装载 Frontend / 组件 | 内置注册表 `src/modules/index.ts` | 第三方组件以后再开放 |
| check 在第一个错误处停止 | 同样停止，但错误带独立 `source` 字段 | 机器可读 |
| 通用 schema 不执行，只查类型存在 | 每个类型的 `validate` 必须真的检查 | 规格指出的弱点 |

## 5. 示例（验收用）

`examples/first-light/`：

```xml
<?dvml using="dsivio-video/markup@1"?>
<dvml>
  <import as="text" from="dsivio-video/text@1"/>
  <import as="media" from="dsivio-video/media@1"/>
  <import as="gen" from="dsivio-video/gen@1"/>
  <import as="kit" source="./shot.dvs"/>

  <media:Image id="product" src="./assets/product.png"/>
  <text:Value id="direction">一瓶香水放在清晨窗台上，逆光，薄雾。</text:Value>
  <text:Render id="hero-prompt" template={kit.hero}>
    <text:Set name="direction" text={direction}/>
    <text:Param name="camera" value="缓慢推近"/>
  </text:Render>
  <gen:Image id="hero" model="openai/gpt-image-2" prompt={hero-prompt} ratio="9:16">
    <gen:Reference image={product}/>
  </gen:Image>
  <gen:Video id="shot" model="volcengine/doubao-seedance-2-5" prompt={hero-prompt}
    first-frame={hero.image} duration="5" resolution="720p" ratio="9:16" audio="false"/>
</dvml>
```

```xml
<?dvml using="dsivio-video/run@1"?>
<dvrun version="1">
  <author source="./main.dvml"/>
  <target output="shot.video"/>
</dvrun>
```

`plan` 列出两个付费请求（图、视频），视频的首帧显示为「等待 hero.image」；`build --follow` 完成后 `get <id> --output shot.video --to out.mp4` 导出成片。复用：加 `<build-record id="old" build="…" output="hero.image"/>` 与 `<satisfy output="hero.image" candidate="old"/>` 后，plan 只剩视频一个付费请求。
