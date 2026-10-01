# 保持生成入口与回执唯一

选择执行环境、查模型或处理远端异常时读。请求参数读 [generation/surfaces](../generation/surfaces.md)，Build 观察读 [authoring/builds](../authoring/builds.md)。

## 区分 Agent 环境与生成后端

| 场景 | 当前实际执行 |
|---|---|
| 在 Dsivio 内使用 | 通过 `dsivio media` 生成图像/视频；主程序持有模型接入、任务队列和付款能力 |
| 在 Claude Code/Codex 独立使用 | 使用相同 CLI、项目与本地素材工具；当前付费生成仍需要 Dsivio |
| 本地 ASR | 插件通过 `setup asr` 准备服务并按需启停；不能据此推断已有独立图像/视频后端 |

当前配置只接受 `gateway: "auto"` 或 `"dsivio"`；auto 不是“连接失败就直连厂商”。独立生成后端尚未实现，不在此页提供密钥、登录或供应商调用教程。

## 查实时能力

```sh
dsivio media models --kind image
dsivio media models --kind video
dsivio-video vocabulary --models --kind image
dsivio-video vocabulary --models --kind video
```

把目录返回的完整模型 id 写入 `model=`。plan 校验其启用状态及能力并展示后端和请求；模型目录不是价格表。不要向用户索要插件 key，不把账号额度当花费许可。

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
| 124 | 等待超时；查询原任务，不当成没提交 |

有宿主任务 id 时用 `dsivio media status TASK_ID` 查原任务；插件 `status BUILD_ID` 查本地 Build。提交中断且无可恢复 id 同样按不确定处理。保留 Build ID、task、receipt、请求摘要与错误，先查证再决定剩余工作。

关闭 --follow 终端不是取消。`cancel` 只停止本地后续处理；已提交远端任务仍可能完成并收费。不用新 Build 来消除尚未确认的费用风险。
