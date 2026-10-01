# 字幕导演

## 何时使用

对白信息与排版节奏冲突时读。

本页是制作决策，不声明新的作者元素；准确属性读 [制作参考](../../production/tracks.md)。不同格式可以组合。

## 1. 内容不由布局改写

正式内容归 Script CaptionDocument；意群先清楚再选 Cue 切分。caption-fine 的测量词锚决定高亮，样式不能悄悄删词或修改发言。

## 2. 先可读再运动

用精确 Face/Stack、明确 x/y/width/size；从最拥挤 Cue 检查溢出。中文高亮可以逐字，阅读仍按意群；karaoke-transition=wipe 和 atom-reveal=typewriter 是表达选择，不是所有作品的默认。

## 3. 保持角色和证据

Use role 仅匹配所属说话者，Hidden 可盖住不需要的字幕。regions 只接受已有测量，null 隐藏；没有证据不宣称自动跟脸。查看真实字幕与声音，不以未看过的 layout 证明同步。

## 门禁与常见偏差

复杂接口读 production/caption-fine；独立标题读 typography。

最终仍执行 check → plan →（实际 paid 请求先审批）→ build --follow → get；记录 Build ID、文件与真正看过/听过的范围。未知结果先 status，不新建付费 Build 重试。
