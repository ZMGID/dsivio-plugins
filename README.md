# dsivio-plugins

给 Dsivio 用的插件：自己写的，或网上找来改过适配的。

每个插件放在 `plugins/` 下的独立目录，在 Dsivio 设置 → 插件中按目录导入。

## 插件格式

入口为 `.kivio-plugin/plugin.json`（也兼容 `.codex-plugin`、`.claude-plugin`）：

```text
plugins/my-plugin/
  .kivio-plugin/plugin.json
  skills/<name>/SKILL.md
  commands/<name>.md
  agents/<name>.md
```

```json
{"schemaVersion": 1, "name": "my-plugin", "version": "1.0.0"}
```

完整规范见 Dsivio 仓库的 `docs/agents/kivio-plugin-format.md`。
