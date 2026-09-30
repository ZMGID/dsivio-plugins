# dsivio-plugins

给 Dsivio 用的插件集合，分两类：

| 目录 | 内容 |
| --- | --- |
| `original/` | 自己写的插件 |
| `adapted/` | 网上找来、改过以适配 Dsivio 的插件 |

每个插件是一个独立目录，可在 Dsivio 设置 → 插件中按目录导入。

## 插件格式

优先使用原生格式，入口为 `.kivio-plugin/plugin.json`：

```text
my-plugin/
  .kivio-plugin/plugin.json
  skills/<name>/SKILL.md
  commands/<name>.md
  agents/<name>.md
```

```json
{"schemaVersion": 1, "name": "my-plugin", "version": "1.0.0"}
```

Dsivio 也能直接加载 `.codex-plugin/plugin.json` 和 `.claude-plugin/plugin.json`。清单优先级为 `.kivio-plugin` → `.codex-plugin` → `.claude-plugin`，只加载一份。完整规范见 Dsivio 仓库的 `docs/agents/kivio-plugin-format.md` 和 `docs/agents/plugin-hooks.md`。

## 适配插件的约定

`adapted/<name>/` 下必须带 `UPSTREAM.md`，写明：

- 来源仓库 URL 和所基于的 commit
- 原许可证（同时保留原 LICENSE 文件）
- 为适配 Dsivio 所做的改动

示例：

```markdown
# Upstream

- Source: https://github.com/owner/repo
- Commit: abc1234
- License: MIT（见 LICENSE）

## Changes
- 新增 `.kivio-plugin/plugin.json`
- Hook 工具名从 Claude 格式改为 Kivio 格式（如 `Write` → `write`）
```
