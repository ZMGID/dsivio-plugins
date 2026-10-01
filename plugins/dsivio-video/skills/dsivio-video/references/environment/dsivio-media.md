# 保持生成入口与回执唯一

选择执行环境、查模型或处理远端异常时读。请求参数读 [generation/surfaces](../generation/surfaces.md)，Build 观察读 [authoring/builds](../authoring/builds.md)。

## 区分 Agent 环境与生成后端

| 场景 | 执行归属 |
|---|---|
| Dsivio 后端 | `dsivio media image/video/speech/transcribe`；主程序持有密钥、模型池、任务与本地 ASR owner |
| Claude Code/Codex 独立后端 | 用户自有配置的 MiniMax/Gemini 直连适配器；不读取或借用 App key |
| 本地 ASR | Dsivio 模式由 App 安装/监督；显式 standalone 使用插件的受监督 WhisperX 服务，两者不共享 child/venv |

项目 `.dsivio-video/config.json` 接受 `gateway: "auto" | "dsivio" | "standalone"`。auto 只在 plan/独立 CLI 执行前、App 确实不可达时选择 standalone；参数错误、缺模型、鉴权/业务失败不回退。选定后端写入 Build，执行中 App 关闭只等待原后端，不换供应商/账户。

## 查实时能力

```sh
dsivio media models --kind image
dsivio media models --kind video
dsivio-video vocabulary --models --kind image
dsivio-video vocabulary --models --kind video
dsivio-video vocabulary --models --kind speech
dsivio-video vocabulary --models --kind transcribe
```

把目录返回的完整模型 id 写入 `model=`。plan 校验其启用状态及能力并展示后端和请求；模型目录不是价格表。不要向用户索要插件 key，不把账号额度当花费许可。

模型 `description.arguments/constraints/factsRevision` 是实际参数权威；false/0 保留，默认值不冒充用户提供项，未知键付费前拒绝。执行前规范请求/描述变化要求重新计划；旧宿主没有 description 时仅支持旧公共参数，不透传额外选项。价格未知明确显示 unknown，不当作零。

## 处理 Dsivio 退出码

以下是宿主退出码，不是插件 CLI 的统一退出码。

| 码 | 事实与动作 |
|---|---|
| 0 | 成功；仍检查具体任务/Output |
| 2 | 参数错误；修作者请求，再 plan |
| 3 | 拒绝且未扣费；保存原因，修负责的输入 |
| 4 | 失败；核查任务和付费事实，不自动判定可重提 |
| 5 | 状态不确定；禁止再次提交同一请求，包括换 Run/Build |
| 6 | 主程序未运行；打开 Dsivio，继续原任务/幂等工作，不切后端 |
| 7 | 宿主任务已确认取消；不消费后续产物，不自动重提 |
| 124 | 等待超时；查询原任务，不当成没提交 |

有宿主任务 id 时用 `dsivio media status TASK_ID` 查原任务；插件 `status BUILD_ID` 查本地 Build。提交中断且无可恢复 id 同样按不确定处理。保留 Build ID、task、receipt、请求摘要与错误，先查证再决定剩余工作。

关闭 --follow 终端不是取消。插件 `cancel` 停止本地后续消费，并向已选后端请求其明确支持的取消；已发出的云任务可能仍完成并收费。只有 `confirmed` 才表示相应作用域确认停止，unsupported/too-late 保留真实回执与任务事实。不用新 Build 来消除尚未确认的费用风险。

## 独立模式的凭证与本地安装

先明确选择 standalone，再配置用户自己的 `MINIMAX_API_KEY` / `GEMINI_API_KEY`，或私有 `~/.dsivio-video/gateway.json` 中的连接。文件/目录要求 0600/0700（Windows 为当前用户专属 ACL）；已有不安全权限明确报错，不静默修改用户目录。配置的 env 存在但为空时不换用另一把 key。仅支持已实现的官方 endpoint/明确模型，不替换退休或无权限模型。

密钥只在独立适配器内读取，不写作品源、Build、评论、命令参数或日志，不传给 FFmpeg/Python 等无关子进程。克隆另需真实授权样本和同意文件；key 配置不等于样本授权。供应商产品/余额、真实收费和产物仍需实际调用证明，不能由目录或替身测试保证。

`setup asr` 根据已选后端调用宿主安装入口或插件 installer；plan 不安装。显式 `local/whisperx-small` 不要求云凭证；本地失败不自动上传云端。缓存模型按离线协议推理，nonce 与 owned-child 监督保护启动/取消/关闭；词时间缺省保持缺省。

