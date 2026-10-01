# 按实时能力选模型

每次开始生成、修改输入角色或 plan 因能力拒绝时读。模型家族经验不是接口保证，属性见 [surfaces](surfaces.md)。

```sh
dsivio media models --kind image
dsivio media models --kind video
dsivio-video vocabulary --models --kind image
dsivio-video vocabulary --models --kind video
dsivio-video vocabulary dsivio-video/gen@1
```

## 先列制作需求，再筛选

| 要求 | 查目录的事实 |
|---|---|
| 静图/视频 | kind 与启用的完整 id |
| 文生、首帧、首尾帧或参考生成 | modes、firstFrame、lastFrame、lastFrameNeedsFirst |
| 人物/产品、动作或声音参考 | maxReferenceImages/Videos/Audios、referenceAudioNeedsVisual、localReferenceMedia |
| 画幅、清晰度与时间 | ratios、sizes、qualities、durations、resolutions |
| 是否需要实际声音 | audioToggle；原生输出是否有声音仍需实际检查 |
| 张数与文本长度 | maxCount、maxPromptLength |
| 帧与参考共用 | framesExcludeReferences |

这些是模型目录能力字段，不是可直接写进 gen 元素的属性。model 仍必须显式写完整 id；known/default 标记不提供自动选模许可。

## 遵守校验边界

- known=false 时只允许 prompt；不要附带比例、时长、audio、首尾帧或参考“试试看”。
- 图像 size 为自定义像素仅在目录明确支持时可用；不能因为其他模型支持就照抄。
- `audio="false"` 也需要 audioToggle 支持，不支持时不要假定显式关闭无害。
- 视频输入有普通参考时按 reference 模式判定；否则尾帧、首帧、纯文本依次决定 frames/image/text。
- 本地参考视频/音频受 localReferenceMedia 限制；缺能力就清楚说明，不把本地文件伪装成网络 URL。
- 参数省略后应用宿主公开 defaults；这不等于存在插件默认模型，也不等于费用已知。

把目录查询的时间、选择理由和重要限制写入工程笔记。plan 时再核查展开后的请求；需要换模型时说明结果/成本影响并更新 Source，不在后台静默替换。
