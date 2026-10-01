# 找到本项目的执行事实

开始、恢复或定位 Worker 时读。创作文件职责读 [project-files](../creation/project-files.md)，付费不确定性读 [dsivio-media](dsivio-media.md)。

## 固定项目边界

项目根优先取 `--workspace <path>`，否则从 cwd 向上找最近含 `.dsivio-video/` 的目录，再否则使用 cwd。引用路径相对声明文件，源导入必须留在项目根；素材可通过重复 `--asset-root <path>` 显式允许额外根。不用工具安装目录充当项目。

```text
project/
  notes/                 创作要求、观察与恢复记忆
  authors/               .dvml
  recipes/               .dvs
  runs/                  .dvrun
  assets/                用户素材与已接受素材
  exports/               明确导出的交付文件
  .dsivio-video/
    config.json          本地配置；当前 gateway 为 auto/dsivio
    store/               项目资源库
    runtime/state.db     Build 定义、事实、远端操作与状态
    runtime/worker.json  Worker 身份
    runtime/worker.log   执行日志
    results/日期/BuildID/result.json  历史结果清单
```

上述作者目录是工程约定，不是解析器强制命名。别手改 SQLite、结果清单或资源库来“修好”状态，也别清缓存后宣称素材不可复用。

## 观察 Worker

```sh
dsivio-video runtime status
dsivio-video runtime logs --lines 40
dsivio-video runtime up
dsivio-video runtime down
```

build 会确保 Worker 启动；Worker 独立于观察终端，空闲可自行退出。runtime down 不等于取消远端任务。恢复先核查已知 Build 的 status/inspect，再决定是否继续观察。

历史复用引用项目资源 id，不靠任意复制结果文件。交接可编辑工程时保留其必要资源绑定；单个 MP4 没有 Run、作者表达和证据，不能代替工程。
