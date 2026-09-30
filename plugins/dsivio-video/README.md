# dsivio-video

由 Agent 驱动的视频制作插件：拆解参考视频、写分镜、生成镜头、合成成片。流程和架构对齐 hypit，代码全部自写。可在 Dsivio 中使用，也能在 Claude Code / Codex 中单独使用。

- 架构：[docs/architecture.md](docs/architecture.md)
- 第 1 阶段设计与接口：[docs/design/phase1.md](docs/design/phase1.md)
- hypit 行为调研（净室规格）：[docs/research/](docs/research/README.md)

## 当前状态

第 1 阶段（核心）已完成：`.dvml` / `.dvs` / `.dvrun` 解析与校验、规划与复用、后台 Worker、结果仓库，以及通过 `dsivio media` 生成图片和视频（`gen:Image` / `gen:Video`）。时间线、渲染、组件、Skill、Studio 在后续阶段。

## 运行

需要 Node.js 22.18 或更新版本（直接运行 TypeScript 源码，无编译步骤）。

```sh
node bin/dsivio-video.mjs doctor
node bin/dsivio-video.mjs vocabulary --models          # 当前可用模型及其参数能力
node bin/dsivio-video.mjs check examples/first-light/main.dvml
node bin/dsivio-video.mjs plan examples/first-light/build.dvrun
node bin/dsivio-video.mjs build examples/first-light/build.dvrun --follow
node bin/dsivio-video.mjs get <build-id> --output shot.video --to out.mp4
```

`plan` 列出每个付费请求的模型和完整参数，不花钱；`build` 前会再校验一次。生成通过正在运行的 Dsivio 完成，插件不保存任何密钥。

## 开发

```sh
npm install
npm run typecheck
npm test
```

测试用 `test/fixtures/fake-dsivio.mjs` 代替真实的 `dsivio` 命令，不会产生费用。
