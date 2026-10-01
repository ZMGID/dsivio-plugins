# 参考影片结构改编

## 何时使用

有参考且用户要求保留表达结构时读；不是逐像素复制，也不移植第三方工程。

本页是制作决策，不声明新的作者元素；准确属性读 [制作参考](../../production/tracks.md)。不同格式可以组合。

## 1. 建立可核查观察

media fetch → media probe → media tile/frames；有语音先 transcribe，再用 --around 对齐观察。记录人物、对象关系、机位、文字进入/停留/离开、声音的作用。标清没有看清或没有听到的部分，不把采样网格等同完整观看。

## 2. 决定保留与改变

Brief 保存用户要求，Analysis 保存事实，Treatment 保存新的导演方案。选择参考提供的是构图、节奏、论证还是动作；源参考的秒数不是新台词的节目时钟。人物/产品身份分别用有用参考，只有明确模型能力才加入请求。

## 3. 用真实组件重建关系

对白经 Script→Normalize→SemanticTake→Timeline；performance + sound 承担原表演。独立覆盖用 media-track，词级字幕用 caption-fine，累计榜单用 ranking。图形事实进 typography，而非让生成图像承担准确排字。

## 4. 代表片段再扩展

先做最能暴露主次、字幕和转场的一段，check/plan 后审批实际 paid 请求。build --follow、get 得到真实影片，media tile 比较前中后状态；完整看/听再扩展。接受素材用 build-record/satisfy 复用，不能用旧最终成片盖掉新标题。

## 门禁与常见偏差

不要承诺模型复现原表演；对未实现抠像要求转为预抠透明媒体。

最终仍执行 check → plan →（实际 paid 请求先审批）→ build --follow → get；记录 Build ID、文件与真正看过/听过的范围。未知结果先 status，不新建付费 Build 重试。
