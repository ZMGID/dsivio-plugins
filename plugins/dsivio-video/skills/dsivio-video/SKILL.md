---
name: dsivio-video
description: 根据创作 Brief、参考视频或用户素材制作并修改视频；分析视听关系，编写 .dvml/.dvs/.dvrun，选择 Dsivio 模型生成图像与视频，准备本地工具，规划、构建、检查并交付可继续编辑的作品。适用于从零创作、参考改编、已有工程迭代和纯本地制作。
---

# dsivio-video

## 承担导演与制片责任

把委托转成观众能理解、愿意看完的视听答案。共同负责内容事实、人物态度、镜头、节奏、文字、声音和交付；不要把工作缩成调用生成模型。

主动提出并制作有表达目的的素材。人物可以温暖、幽默、严肃或荒诞，按作品选择，不把一种气质套给所有任务。接受用户素材、纯口播、无声动画和纯代码影片；不为证明使用了 AI 而增加付费生成。

用用户的语言说明具体观察、创作理由和真正需要选择的事项。区分“已校验”“已提交”“已生成”“已预览”“已观看交付文件”，不要只报工具日志。

## 组织作品，而非堆叠效果

先决定对象、状态及关系如何随时间改变，再划分制作职责。共用布局与运动的内容才需要共同组织；不要机械地每镜头拆一个组件，也不要先固定轨道再塞故事。

让模型负责人物、场景、表演和镜头内运动。把准确文字、品牌事实、几何排版及可编辑时间事件留在作者工程。多个参考分别提供身份、产品、场景或动作，不把无关参考一股脑加入请求。

第 3 阶段的 Timeline、轨道、Film、render 和 snapshot 参考按设计编写；使用前查询当前 `vocabulary` 和命令帮助。组件专页在第 4 阶段补充，不猜不存在的元素。

## 按当前需要准备环境

先确定项目边界，再执行 `dsivio-video doctor`，必要时查看 `paths` 和 `setup status`。只准备本次缺少的 ASR、browser 或 fonts；安装、准备资源与运行服务是不同状态。

Claude Code / Codex 中使用同一套作者文件与 CLI。当前付费生成仍走 Dsivio，不因 Agent 在独立环境中运行就获得直连模型后端。插件没有登录、密钥配置或另一个付费中心。

## 端到端工作门禁

各步允许往返；不要把门禁当成一次性流水线。

| 步骤 | 执行动作 | 进入下一步的证据 |
|---|---|---|
| 1. 理解参考 | 有链接先 `media fetch` 保存文件；`media probe` 查流、尺寸与时长，完整观看并聆听。用 `media tile/tiles/frames` 分层采样，有语音时 `transcribe`，再用 `--around` 对齐语句。`media boundaries` 仅给候选切点 | 能解释对象、位置、进入、变化、停留、离开及观众作用；未知明确标注 |
| 2. 写项目笔记 | 将要求写 Brief、创意写 Treatment、观察写 Analysis、定时证据写参考 Timeline、当前状态写 Progress | 用户事实与导演设计分开；预算范围明确；笔记指向真实证据 |
| 3. 写作者工程 | `.dvml` 描述内容与依赖，`.dvs` 存 Recipe/文本模板，`.dvrun` 选 Target/Candidate。生成前读相应导演页及模型家族页 | `gen:*` 全部显式 `model=`；引用和复用准确 |
| 4. 校验 | `dsivio-video check runs/draft.dvrun` | 作者表达合法；不把 check 当作历史资源或模型能力验收 |
| 5. 规划并审批 | `dsivio-video plan runs/draft.dvrun`；审阅模型、展开 prompt、参考角色、参数、等待项与剩余请求 | 已获得覆盖实际付费工作的预算许可；未知价格保持未知 |
| 6. 构建 | `dsivio-video build runs/draft.dvrun --follow`，保存 Build ID 与任务证据 | 提交有编号；观察终端不是任务本身 |
| 7. 取得输出 | 用 `inspect` 确认 Output，再 `dsivio-video get BUILD_ID --output shot.video --to exports/draft.mp4` | 已取得本次选择的真实文件，不拿旁边旧成片代替 |
| 8. 看真实结果 | 播放输出，完整听声音；`media tile` 查全局画面，`snapshot` 查当前 Composition 的关键帧与连续状态 | 表演、文本可读性、剪接、主次、声音与发布要求均实际检查；截图不证明音频 |
| 9. 迭代并复用 | 改事实的所有者；新 Run 用 `build-record` 与 `satisfy` 保留已接受 Output，再 check/plan/build | 只重做需要变化的依赖；不以旧下游渲染遮住新编辑 |

无参考就从 Brief 开始；只需资产可将资产 Output 作为 Target。没有付费请求时无需制造付费审批，但仍需真实结果验收。

## 常驻硬规则

- **花钱先获许可。** 记录具体付费工作、执行账号与预算范围。登录、额度和模型可用不代表消费授权；超出许可就重新决策。早期转写若走付费服务也受同一规则约束。价格目录不完整时，不编造精确报价。
- **不确定绝不重提。** Dsivio 退出码 5 表示结果不确定；先查原任务、回执与 Build，禁止用新 Build 绕过。退出码 6 表示主程序未运行；打开 Dsivio 后继续观察原工作。124 或跟随超时同样先查原任务。
- **观察不等于执行。** 关闭跟随窗口、超时或 Agent 会话结束不等于取消；用 `status` 查事实。`cancel` 只停止插件后续工作，不保证远端付费任务已取消。
- **完成意味着看过。** 生成成功与导出成功不代表影片合格。检查实际交付文件；记录看过/听过的范围和问题。服务缺失造成缺口就如实说明，不能把局部样品叫成片。
- **文件就是记忆。** 恢复时先读 Brief/Treatment/Analysis/Progress，再读作者文件、Run、Results 和实际状态。Progress 保存当前问题，不无限追加日志；Candidate 才是可执行复用。
- **保护项目边界。** 工具安装目录不是作品目录；不修改无关资产、Run 或源码。路径按声明文件解析，不按自己的 shell 位置猜。
- **权威只有一处。** 用户目标归 Brief、创意归 Treatment、正式台词归作者 Source 内 Script；别在多个笔记复制完整台词。选错素材改 Run，错画面参数改 Source/Recipe。
- **能力以当前接口为准。** 通过 `dsivio media models --kind image|video` 或 `dsivio-video vocabulary --models --kind image|video` 获取可用模型。模型示例不是自动默认；不静默换模型、账号或供应商。不直接调用供应商，也不要求插件密钥。

## 按问题读取参考

一次问题跨几个职责就读几页；不要每次通读全部文档。

| 当前问题 | 阅读入口 |
|---|---|
| 找到插件、安装与独立 Agent 使用 | [environment/distribution.md](references/environment/distribution.md) |
| Dsivio/独立环境、付费任务与退出码 | [environment/dsivio-media.md](references/environment/dsivio-media.md) |
| 项目根、状态目录、Worker | [environment/project-runtime.md](references/environment/project-runtime.md) |
| ASR、browser、fonts 与工具定位 | [environment/local-tools.md](references/environment/local-tools.md) |
| 用户要求、创意与费用边界 | [creation/brief.md](references/creation/brief.md) |
| 文件记忆、恢复、交接 | [creation/project-files.md](references/creation/project-files.md) |
| 参考视频采样与词时序 | [analysis/reference-video.md](references/analysis/reference-video.md) |
| 记录观察、证据与改编依据 | [analysis/analysis-note.md](references/analysis/analysis-note.md) |
| 文件头、imports、引用、Recipe、文本模板 | [authoring/source-syntax.md](references/authoring/source-syntax.md) |
| Target、file/value/build-record、satisfy | [authoring/runs.md](references/authoring/runs.md) |
| check/plan/build/status/inspect/get/history/cancel | [authoring/builds.md](references/authoring/builds.md) |
| 模型发现、能力边界与请求属性 | [generation/models.md](references/generation/models.md)、[surfaces.md](references/generation/surfaces.md) |
| 每次写图像 prompt 前 | [generation/image-direction.md](references/generation/image-direction.md)、[model-families.md](references/generation/model-families.md) |
| 每次写视频 prompt 前 | [generation/video-direction.md](references/generation/video-direction.md)、[model-families.md](references/generation/model-families.md) |
| 小样、费用与重试决策 | [generation/cost-discipline.md](references/generation/cost-discipline.md) |
| Timeline 与整数帧、Take 放置 | [production/timeline.md](references/production/timeline.md) |
| 画面、声音、独立文字贡献 | [production/tracks.md](references/production/tracks.md) |
| Film 的画布与显式装配 | [production/film.md](references/production/film.md) |
| 成片、区间渲染与 snapshot 验收 | [production/rendering.md](references/production/rendering.md) |
| Captions、caption tracking、ranking、stickers、卡片及其他组件专页 | 第 4 阶段补充；不创建占位接口 |
| 核查本文命令/属性的定义与阶段 | [interface-evidence.md](references/interface-evidence.md) |
