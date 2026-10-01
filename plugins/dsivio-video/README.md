# dsivio-video

由 Agent 驱动的视频制作插件：拆解参考视频、写分镜、生成镜头、合成成片。流程和架构对齐 hypit，代码全部自写。可在 Dsivio 中使用，也能在 Claude Code / Codex 中单独使用。

- 架构：[docs/architecture.md](docs/architecture.md)
- 第 1 阶段设计与接口：[docs/design/phase1.md](docs/design/phase1.md)
- hypit 行为调研（净室规格）：[docs/research/](docs/research/README.md)

## 当前状态

已实现核心编译/规划/后台构建、素材工具、真实 WhisperX 转写、语义时间线、HyperFrames 渲染与音频合成、组件库和 Agent Skill。Studio 的真实本地预览、源码与属性写回、嵌套渐变记录和图像操作列表重排已验收；可选本地 Studio 不增加 Dsivio 原生内嵌页，不宣称已完成 Hypit 原界面的视觉对照。语音、宿主 ASR、模型参数、取消与独立供应商适配器已接入代码，真实缓存 ASR 和本地渲染有运行证据；付费供应商、冷安装模型准备与运行中桌面入口仍有[明确验收缺口](docs/design/phase6.md#11-实机证据与尚缺的验收前置)。默认 Dsivio 与显式 standalone 的边界见下文。

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

Studio 使用同一作品源和运行目标，不另存编辑工程：

```sh
node bin/dsivio-video.mjs studio --run examples/canonical/build.dvrun --workspace examples/canonical
# 打开命令打印的本地 URL；支持简体中文/English。
node bin/dsivio-video.mjs snapshot --studio http://127.0.0.1:5179/ --at-frame 0,42,120 --to review/frames
```

上面的端口只是示例；抓帧使用实际打印的 URL。Studio 自动执行仅限批准的本地能力，不提交缺失的付费生成请求；结构化编辑写回 `.dvml` / `.dvs`，评论独立写入项目 `FEEDBACK.json`。

`plan` 列出每个付费请求的后端、模型和完整参数，价格未知明确标记，不花钱；`build` 前再校验描述快照。Dsivio 模式由运行中的宿主持有密钥和任务，插件不读取 App key。显式 standalone 模式使用用户自己的环境变量或私有 gateway 配置；后端在计划时固定，执行失败不切换供应商。

## 开发

```sh
npm install
npm run typecheck
npm run typecheck:studio
npm test
```

默认测试不提交付费请求；外部提交路径使用隔离的测试替身。渲染和 Studio 回归中包含真实 FFmpeg/Chromium 调用，需本地工具；供应商付费产物验收另行执行和记录，不能用替身证明。
