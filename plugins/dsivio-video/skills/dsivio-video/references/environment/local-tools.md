# 只准备本次需要的本地能力

转写、取帧、下载或渲染缺资源时读。先 doctor/paths，再修精确缺口；不要把安装与执行混成一个命令。

## 遵守工具查找顺序

ffmpeg、ffprobe、yt-dlp、Python 按下列顺序定位：

1. 显式环境变量 `DSIVIO_VIDEO_FFMPEG`、`DSIVIO_VIDEO_FFPROBE`、`DSIVIO_VIDEO_YT_DLP`、`DSIVIO_VIDEO_PYTHON`。
2. `dsivio tools --json` 返回的捆绑运行时；此查询不要求主程序正在运行。
3. PATH（Python 先 python3 再 python）。
4. `~/.dsivio-video/tools/` 的托管程序。

显式变量指向不可执行文件时直接失败，别期待静默回退。Dsivio 命令自身按 `DSIVIO_VIDEO_DSIVIO` → PATH → `~/.kivio/bin/dsivio` 查找，Windows 使用对应 cmd 入口。不要默认用户需要另外安装 Dsivio 已捆绑的程序。

## 准备转写

```sh
dsivio-video doctor
dsivio-video setup status
dsivio-video setup asr --model small
dsivio-video transcribe assets/reference.mp4 --language zh --to notes/reference.transcript.json
```

ASR 准备涉及 Python 虚拟环境、WhisperX、识别模型及语言对齐资源，安装位置在 `~/.dsivio-video/asr/`。当前安装方案要求 Python ≥3.10、<3.14；优先已有的 Python 3.12。实际安装状态由 setup status 决定，不把服务健康当成所有语言资源已齐全。

转写按需启动本地服务；正式执行缺模型就报错，不临时联网下载。逐词时间可能缺测，别补零或均分当作实测。中文识别与作者台词可能不一致，保存原始诊断，勿擅自改用户事实。

## 准备 browser 与 fonts（第 3 阶段设计）

以下命令来自第 3 阶段合同；实现合并后先核对帮助，不能把设计当现有安装成功证据。

```sh
dsivio-video setup browser --kind render
dsivio-video setup browser --kind capture
dsivio-video setup browser --kind all
dsivio-video setup fonts
```

browser 准备与 snapshot/render/capture 分离，执行期间不隐式下载或更换浏览器。render 与 capture 使用不同的固定浏览器版本；缓存位于 `~/.dsivio-video/tools/browser/`。不支持的系统架构不能假装准备完成。

fonts 准备固定集合：inter、noto-sans-sc、noto-emoji、noto-color-emoji；渲染引用精确 Face/Stack 与字体字节，不依赖系统字体。中文必须确有 CJK 分片，彩色 Emoji 和单色 Emoji 不是同一种资源。

## 下载器也只检查一次缺口

`dsivio-video media prepare-fetch` 检查下载器路径/版本，不自动更新。fetch、cut、frames、tile、tiles 和 transcribe 的输出使用新路径；已有目标不会覆盖，迭代时换新文件名，保留原证据。
