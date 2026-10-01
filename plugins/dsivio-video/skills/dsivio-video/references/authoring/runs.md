# 用 Run 选择本次工作

决定生成哪些 Output、接纳文件或复用历史时读。Source 表达作品；Run 表达本次选择，不修改 Source 的创意事实。

## 明确目标与候选

```xml
<?dvml using="dsivio-video/run@1"?>
<dvrun version="1">
  <author source="../authors/main.dvml"/>
  <target output="shot.video"/>
  <build-record id="accepted-image" build="BUILD_ID" output="hero.image"/>
  <satisfy output="hero.image" candidate="accepted-image"/>
</dvrun>
```

BUILD_ID 是替换标记，先用真实 inspect/history 取得编号。author 必须第一且唯一；至少一个 target；全部声明为空元素，Run 不支持 imports。output 使用 Source 的准确公开名。定义 Candidate 不会自动选择它；satisfy 才选择。

| 元素 | 必填属性 | 用途 |
|---|---|---|
| author | source | Source 相对路径 |
| target | output | 本次所需 Output，可多个且不能重复 |
| file | id、type、from、media-type | 将真实文件字节接纳为类型化媒体 |
| value | id、type、from | 读取保存的 `{type,data}` JSON 值，不是裸数据 |
| build-record | id、build、output | 选择某 Build 已完成的公开 Output |
| satisfy | output、candidate | 用候选满足 Source 输出；每个 output 至多一次 |

文件/值路径必须以 ./ 或 ../ 开头；只在选中候选时校验。type 使用完整地址，媒体 MIME 与实际输入职责相符，不凭改后缀转换媒体。

```xml
<file id="photo" type="dsivio-video/media@1#Image" from="../assets/photo.png" media-type="image/png"/>
<value id="approved-text" type="dsivio-video/text@1#Text" from="../assets/prompt.json"/>
```

对应 prompt.json 内容：

```json
{"type":"dsivio-video/text@1#Text","data":"暖色陶杯，固定机位。"}
```

上述 file/value 必须放在 author 之后，配合真实存在且类型匹配的 output 的 satisfy 使用；不是完整可单独执行的 Run。

## 在正确层复用

- 只改标题/布局：保留已接受生成媒体及语义 Take，重做受影响的轨道与 Film/render。
- 只改一个 B-roll：仅释放它的满足关系，保留其他候选。
- 改台词：重新判断表演、实际音频和对齐是否仍有效。
- 失败 Build：inspect 已完成 Output；失败不意味着之前素材全丢失。
- 改过的 Track：不能用旧最终 render 满足新输出，隐藏编辑。

check 只报告历史候选尚需解析；plan 才读取历史记录并检查资源。所有选择写入 Run 后再 plan，Progress 中的“准备复用”不是实际执行选择。
