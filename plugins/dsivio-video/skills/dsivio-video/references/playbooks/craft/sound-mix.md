# 声音主次与连续性

## 何时使用

对白、原声、音乐与效果发生遮蔽时读。

本页是制作决策，不声明新的作者元素；准确属性读 [制作参考](../../production/tracks.md)。不同格式可以组合。

## 1. 保留真实声音所有者

sound 投影 Take 现有声音，audio-track 放独立音频。media-track 声音必须显式声明；Film 不自动加入 sibling .audio。

## 2. 听觉主次是作者决策

设明确 gain 与 fades；没有自动 ducking/响度标准化。切 B-roll 不切对白，窗口拆分不重置原声相位；音效从真实事件开始，不为每个标题滥用。

## 3. 听最终输出

get 本次成片，完整播放并听对白清晰度、段首尾、削波与背景存在感。探流只能证明音轨存在；snapshot 不能验声音。

## 门禁与常见偏差

用 sound 或 audio-track 的真实属性；不编造均衡器、压缩器或声线服务。

最终仍执行 check → plan →（实际 paid 请求先审批）→ build --follow → get；记录 Build ID、文件与真正看过/听过的范围。未知结果先 status，不新建付费 Build 重试。
