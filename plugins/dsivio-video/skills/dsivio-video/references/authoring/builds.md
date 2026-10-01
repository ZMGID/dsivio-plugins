# 规划、审批、构建与恢复

准备提交、查任务、导出或处理失败时读。复用语法读 [runs](runs.md)，付费风险读 [dsivio-media](../environment/dsivio-media.md)。

## 先取得不同层次的证据

```sh
dsivio-video check authors/main.dvml
dsivio-video check runs/draft.dvrun
dsivio-video plan runs/draft.dvrun
dsivio-video build runs/draft.dvrun --title "陶杯小样" --follow --max-wait-ms 600000
```

check 证明语法、引用与类型化作者表达；plan 证明本轮选择与目前可展开请求。plan 不执行付费生成，但会读实时模型目录。等待上游媒体的请求可能仍是 waiting，不能把它当完整报价或保证后续一定成功。

审批前逐项阅读：模型、prompt、参考角色、首尾帧、参数、复用项、剩余工作、已知费用与未知项。授权记录在 Brief；超出原授权范围先停下决策。build 会重新规划/校验，因此能力目录变化时必须比较新的请求，不只沿用旧截图。

## 保存编号并观察原任务

```sh
dsivio-video status BUILD_ID
dsivio-video status BUILD_ID --watch --max-wait-ms 600000
dsivio-video inspect BUILD_ID
dsivio-video inspect BUILD_ID --output shot.video --verbose
dsivio-video builds --before BUILD_ID
dsivio-video history hero.image --source authors/main.dvml --before BUILD_ID
```

BUILD_ID 使用实际返回值。inspect 查看已完成输出及操作证据，verbose 展示付费模型、task/receipt 与摘要。builds 按项目查尝试，history 按准确 Output 查复用；缺少编号时按 Source/Run/提交时间识别，不能先发另一轮。

超时或跟随中断先查 status；关闭观察器不是取消。退出码 5 或提交中断无 id 时禁止重提；6 先恢复 Dsivio，继续同一任务。远端任务失败也要核对收费与可用 Output，不能只看本地导出文件是否存在。

## 导出与取消

```sh
dsivio-video get BUILD_ID --output shot.video --to exports/draft-v1.mp4
dsivio-video cancel BUILD_ID --reason "停止后续工作，保留已完成素材"
```

get 导出准确公开 Output；使用新路径，不覆盖先前验收证据。cancel 是本地后续工作的停止，不保证远端撤销或退款。

## 用新尝试承载修改，而非掩盖风险

已有确定失败且许可允许重做时，写新 Run/Build 显式复用完成素材，计划剩余依赖。旧尝试与回执不可改写。不确定付费请求尚未查清时，新 Build 也不能再发同一请求。

导出后必须实际观看并聆听；用 tile 查全局，用第 3 阶段 snapshot 查 Composition 细节。只改文字或轨道就保留生成媒体，但仍检查受影响片段及整体交接。
