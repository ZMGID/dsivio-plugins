# 运动与画面层级

## 何时使用

需要对象状态变化、交接或持续强调时读。

本页是制作决策，不声明新的作者元素；准确属性读 [制作参考](../../production/tracks.md)。不同格式可以组合。

## 1. 先确定状态

列出进入前、活跃期、结束后的对象状态，再选 media motion、typo Motion 或 deck reflow。语义事件定开始，局部帧定展开，两者不要混成源秒数。

## 2. 给阅读时间

enter/exit 不吞掉全部寿命；deck reflow 必须落在阶段内。一次变化一个主角；screen-overlay 的 z 和 Recipe 的 stack-order 明确分配，不以 Film 声明顺序赌博。

## 3. 看中间而非只看漂亮端点

用 snapshot 或 media tile 检查前中后；直接 seek 状态须一致。字幕高亮、媒体相位和音效应服务同一事件，不依赖从头播放历史。

## 门禁与常见偏差

接口读 performance/media-track/typography/deck-track/screen-overlay；不发明 CSS 或项目自定义元素。

最终仍执行 check → plan →（实际 paid 请求先审批）→ build --follow → get；记录 Build ID、文件与真正看过/听过的范围。未知结果先 status，不新建付费 Build 重试。
