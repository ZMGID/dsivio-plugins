# 编写 Source、Recipe 与文本模板

写 .dvml/.dvs、解决导入或 prompt 引用时读。执行选择归 [runs](runs.md)。完整无付费例子见 [examples/main.dvml](examples/main.dvml)、[prompt.dvs](examples/prompt.dvs)、[draft.dvrun](examples/draft.dvrun)。

## 先放正确文件头

| 文件职责 | 文件头 | 根 |
|---|---|---|
| Source | `<?dvml using="dsivio-video/markup@1"?>` | `<dvml>` |
| Recipe sheet | `<?dvml using="dsivio-video/dvs@1"?>` | `<sheet version="1">` |
| 文本模板 sheet | `<?dvml using="dsivio-video/text/dvs@1"?>` | `<sheet version="1">` |
| Run | `<?dvml using="dsivio-video/run@1"?>` | `<dvrun version="1">` |

头必须在文件首（允许 BOM），不要在前面加注释。后缀是惯例，实际 parser 由 using 决定。

## 显式导入并引用完整值

```xml
<?dvml using="dsivio-video/markup@1"?>
<dvml>
  <import as="text" from="dsivio-video/text@1"/>
  <import as="kit" source="./prompt.dvs"/>
  <text:Value id="direction">桌边一只暖色陶杯，晨光从左后方进入。</text:Value>
  <text:Render id="prompt" template={kit.shot}>
    <text:Set name="direction" text={direction}/>
    <text:Param name="camera" value="近景，固定机位"/>
  </text:Render>
</dvml>
```

imports 放在正文之前且自闭合；from 导入模块，source 导入本地文件，二者恰一个。source 必须配 as，别重复别名。相对路径以声明文件为基准，不能越出项目允许边界。

`id` 声明公开名，`{prompt}`、`{kit.shot}` 引用完整类型化值；不要写 `"{prompt}"` 或在字符串内插一半引用。text:Value 的裸 id 是 Text，生成结果是 `shot.image`/`shot.video` 公开端口；二者不可混用。

## 把 Recipe 当显式数据

```xml
<?dvml using="dsivio-video/dvs@1"?>
<sheet version="1">
film.base { background: "#102030"; }
</sheet>
```

规则完整名 `film.base` 就是导出的 Recipe 名；导入为 look 后引用 `{look.film.base}`。没有 CSS 继承或级联，也没有按 sheet id 自动前缀。消费者决定允许哪些属性；合法 Recipe 语法不代表所有组件都接受其内容。此 background 消费者属于第 3 阶段 Film 设计。

## 用文本模板保存导演关系

```xml
<?dvml using="dsivio-video/text/dvs@1"?>
<sheet version="1">
text-template.shot { separator: paragraph; default-camera: 固定机位; }
text-template.shot.block.direction { kind: slot; order: 0; slot: direction; }
text-template.shot.block.camera { kind: slot; order: 1; slot: camera; label: 镜头：; }
</sheet>
```

一张文本模板 sheet 只有一个 text-template 根。模板支持 fixed/axis/variant/slot，按唯一 order 组成段落；更复杂选择先查 vocabulary 与模板诊断，不凭 CSS 经验猜语法。

| text:Render 输入 | 动作 |
|---|---|
| id、template 必填 | 发布裸 id Text，template 引用 TextTemplate |
| recipe 可选 | 静态 Recipe 与模板必须都已知；只取模板消费的标量 |
| text:Param：name、value、type 可选 | 静态标量；type 为 text/number/boolean，默认 text |
| text:Set：name、text | 绑定 Text；只可替换模板默认值，不能覆盖已有 Recipe/Param/动态绑定 |
| text:Append：name、text | 顺序追加成列表；普通标量 slot 不接受列表 |

优先级是模板默认值 < Recipe 标量 < Param，再按声明顺序 Set/Append。缺 slot、重复 Param 或选择歧义直接修模板/绑定，不能在最后调用处偷偷换 prompt。模板保存文本，不拥有 model、分辨率、参考素材或费用选择。
