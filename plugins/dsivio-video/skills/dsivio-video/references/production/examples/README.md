# 两个无付费请求的本地工程

- `overlay.dvrun` → `overlay.dvml`：蓝色底、暖色散景与一次闪光，30 fps / 90 帧。
- `title.dvrun` → `title.dvml`：精确中文字体与 12 帧上移淡入标题，30 fps / 90 帧。
- 两者共享 `look.dvs`，不导入媒体、不调用 gen，不需要 ASR 或 Dsivio 模型服务。标题需要已准备的精确 noto-sans-sc 700 normal；本地渲染需要 browser、ffmpeg、ffprobe。缺少时用 `setup browser --kind render` / `setup fonts` 明确准备，而不是自动安装。

## 在临时项目副本运行

先将**整个 examples 目录**复制到新的临时工作目录（保留相对路径），令 WORK 指向这个目录的父级、EXAMPLE 指向副本的 examples 目录。不要把工具安装目录当作品工作区。

```sh
node /path/to/dsivio-video/bin/dsivio-video.mjs check "$EXAMPLE/overlay.dvrun" --workspace "$WORK"
node /path/to/dsivio-video/bin/dsivio-video.mjs plan "$EXAMPLE/overlay.dvrun" --workspace "$WORK" --json
node /path/to/dsivio-video/bin/dsivio-video.mjs build "$EXAMPLE/overlay.dvrun" --workspace "$WORK" --follow
node /path/to/dsivio-video/bin/dsivio-video.mjs get BUILD_ID --output final.video --to "$WORK/overlay.mp4" --workspace "$WORK"
node /path/to/dsivio-video/bin/dsivio-video.mjs media tile "$WORK/overlay.mp4" --at 0.5,1.2,2.5 --columns 3 --cell 400 --to "$WORK/overlay.jpg" --workspace "$WORK"
```

把 overlay 换成 title 重复同一组命令；BUILD_ID 换成本轮输出的真实 id，不复制这里的历史 id。plan 首轮只显示可执行前沿，字体完成后会展开后续本地渲染，不代表只有一个执行步骤。没有付费请求无需付费审批，但仍看实际影片。

## 2026-10-01 实际验证记录

副本工作区：`/var/folders/zs/78t14dm90fx_rjn8985tcl4r0000gn/T/dsivio-skill-round2-zuz_zivv`。所有命令使用该目录的 `--workspace`，不向 Skill 树存 Build 或导出媒体。

| 场景 | check --json | plan --json | build --follow --json | get / media tile |
|---|---|---|---|---|
| overlay | exit 0，ok=true，outputCount=5，target=final.video | exit 0，valid=true，paidNeedTotal=0，localNeedTotal=2，unresolved/unsupported=0 | bld_20261001T014942352Z_96EC010060；done/complete，13/13 steps，3/3 local needs，5 outputs | 均 exit 0；final.video 导出 overlay.mp4；tile 0.5/1.2/2.5 s |
| title | exit 0，ok=true，outputCount=9，target=final.video | exit 0，valid=true，paidNeedTotal=0，localNeedTotal=1（字体前沿），unresolved/unsupported=0 | bld_20261001T014946796Z_C449E88B83；done/complete，15/15 steps，4/4 local needs，9 outputs | 均 exit 0；final.video 导出 title.mp4；tile 0.5/1.2/2.5 s |

两个输出 `media probe` 均为 640×360、30 fps、3 秒，有视频与编码器附带的静音音轨。没有作者声音贡献；ffmpeg volumedetect 的 mean/max 为 -91 dB（检测下限），不是对白或混音验收。

已用 read 查看 tile 的真实 JPEG：overlay 在深蓝青底上分布柔和暖黄圆形散景，1.2 秒帧被闪光明显提亮，2.5 秒恢复底色且散景位置变化；title 的三帧均显示居中、白色、清晰的“把空间留给重点”，周围有充分留白。标题另执行 tile --at 0,0.2,0.5（exit 0）并查看：首帧只有底色，0.2 秒文字呈较淡灰白、位置略低，0.5 秒完成上移并变为白色。这些是实际取样状态检查，未声称完整播放或听过影片。

旧文本模板例子也已恢复真实 CLI 验证：`check skills/dsivio-video/references/authoring/examples/draft.dvrun --workspace skills/dsivio-video` exit 0，Check passed (run)，Outputs=1、Target=prompt、Candidates=0、satisfactions=0、unresolved selected history=0。
