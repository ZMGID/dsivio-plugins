# 把模型家族经验作为待验证假设

选家族、换模型或导演小样时读。这是依据公开产品资料写的创作起点，不是本插件实测性能排名。型号、版本、接入渠道与目录启用状态可不同；所有时长、比例、参考数量、声音、首尾帧、分辨率和价格必须核对 `dsivio-video vocabulary --models`，再 plan。不要把以下经验变成通用参数。

| 家族 | 从什么制作问题开始试 | 如何写/检查小样 | 必须验证的未知 |
|---|---|---|---|
| Seedance | 有动作因果、人物交互或镜头关系的短片；部分版本公开强调多模态与视听共同生成 | 明确人物目标、动作顺序与反应；参考各自拥有身份/动作/声音，不把一堆风格词当表演 | 具体型号支持哪种模式、声音开关、多模态参考与组合限制；不同代不可互推 |
| Grok Imagine | 用清楚的主体动作与视听气氛建立短片小样 | 先写一个主动作和一个镜头关系，再说明声音；检查实际对白、结束姿态与素材清晰度 | 该接入是否输出声音、是否可关闭、真实画幅/分辨率是否遵守 |
| GPT Image | 图像指令、参考编辑、产品/人物关系的静帧 | 明确保留与改变的事实；一幅完整画面先验收，再用作视频锚 | 具体型号的尺寸、quality、count、参考数量；文字能力不代表品牌事实或文字必定准确 |
| MiniMax / Hailuo | 文生/图生动作与镜头小样 | 先用自然语言写动作；厂商的特殊镜头词只在确认当前型号支持后试，不新增 gen 属性 | 分辨率与时长组合、首尾帧、参考及音频均按目录；Hailuo 与其他 MiniMax 系列不能视为同接口 |
| Kling | 人物/产品动作和由图像约束的镜头 | 起始姿态清晰，描述动作结果与停留；检查接触、遮挡及结束画面，而非只看运动幅度 | 具体版本的声音、首尾帧、参考组合；厂商控制能力不等于 Dsivio 暴露了相同选项 |
| Vidu | 参考驱动的人物/场景一致性研究 | 给每个输入一个清楚的身份职责，用短动作验证主体与共同世界是否保持 | 某型号是否支持多个参考、视频参考或声音；不要把厂商参考主体机制编造成通用 Reference 属性 |
| 其他目录家族 | 需求与实际能力有交集时再考虑 | 同一具体创作问题分别试最小许可小样，按真实输出比较 | 目录未知能力只允许 prompt；营销演示不证明当前渠道表现 |

## 以公共资料界定来源，而非复制模板

- Seedance：[ByteDance Seedance](https://seed.bytedance.com/en/seedance/)、[Seedance 2.0](https://seed.bytedance.com/en/seedance2_0/)。
- Grok Imagine：[官方发布说明](https://x.ai/news/grok-imagine-api)。
- GPT Image：[OpenAI 图像生成指南](https://platform.openai.com/api/docs/guides/image-generation?image-generation-model=gpt-image)。
- MiniMax/Hailuo：[官方模型介绍](https://platform.minimax.io/docs/guides/models-intro)、[视频生成指南](https://platform.minimax.io/docs/guides/video-generation)。
- Kling：[官方 image-to-video 文档](https://kling.ai/document-api/api/video/2-6/image-to-video.md)。
- Vidu：[官方参考生视频文档](https://platform.vidu.com/docs/reference-to-video.md)。

这些链接用于理解家族设计，不用于绕过 Dsivio 直接请求。没有把公开示例的型号、价格或参数数字作为本插件承诺。

## 让项目经验可恢复

记下实际完整 model id、目录查询时间、展开请求、参考证据、task/receipt、小样观看结论与已接受 Output。用“这次素材的杯形保持正确，但手部接触失败”代替“模型擅长产品片”。同一 prompt 随机生成也不会保证同一像素、声音或时长。
