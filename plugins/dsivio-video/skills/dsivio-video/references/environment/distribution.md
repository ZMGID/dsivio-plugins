# 找到并准备实际工具

找不到 CLI、在 Claude Code/Codex 使用或恢复旧工程时读。模型与付费任务归 [dsivio-media](dsivio-media.md)，资源准备归 [local-tools](local-tools.md)。

## 分清三个位置

| 位置 | 负责什么 | 不要做什么 |
|---|---|---|
| 插件安装目录 | CLI、Skill、内置模块与依赖 | 不在这里存客户作品；不为单个作品改已安装工具 |
| Skill 目录 | Agent 行为与按需参考 | 不把 Skill 安装当成可执行程序已就绪 |
| 项目目录 | 作者文件、素材、笔记、执行状态与交付 | 不因附近有成功成片就把它当本次 Output |

先使用环境已提供的 `dsivio-video` 启动器。源码发行的真实入口是 `node bin/dsivio-video.mjs`，要求 Node ≥22.18；只在插件根中使用这个相对路径。源码依赖安装用 `npm install`，不要每次任务重新安装。

```sh
dsivio-video version
dsivio-video paths
dsivio-video doctor
dsivio-video setup status
```

Claude Code/Codex 的准备入口仍是 doctor/setup；Skill 加载不启动 Dsivio，也不下载 ASR/Chrome/字体。缺程序时依据 paths 的实际路径与来源修复，别换一个同名副本后继续沿用旧结论。

## 按缺口行动

- 媒体工具已有且可用：继续分析，别重复要求系统包管理器安装。
- 本地转写未准备：执行 `dsivio-video setup asr`，再检查 `setup status`。
- 需要第 3 阶段渲染资源：按 local-tools 的设计命令显式准备，先确认当前 CLI 是否已提供。
- 付费生成无法连接：打开 Dsivio，核查原任务；不改为直连供应商。
- 更新工具：保护项目锁文件、作者文件、`.dsivio-video/` 和已接受素材。版本变化后重查 vocabulary，不把旧经验当接口保证。
