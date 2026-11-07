# dsh-ecom-image · 电商视觉创作

DeepSeek Harness（dsh）插件：**电商视觉创作技能**——25 个场景模板（主图/场景/平铺/详情页/UGC/直播 等）、Campaign Style Lock 一致性机制、转化驱动力诊断、GPT-Image-2 Prompt 铁律。可选通过 apiz CLI 直接出图。

技能来自 [ecom-details-image](https://github.com/liangdabiao/ecom-details-image)（MIT，liangdabiao）。

## 装上以后有什么

| 能力 | 说明 |
|---|---|
| `ecom-details-image` 技能 | `/ecom-details-image` 斜杠命令 + 模型自主触发：视觉简报 + Prompt + Campaign Style Lock + 转化诊断。两种模式（Prompt/Brief 和 Generate） |
| 25 个场景模板 | 主图/生活场景/平铺/细节/海报/社媒/UGC/模特/前后对比/包装/信息图/创意概念/尺码/多产品/直播/试穿/爆炸图/幽灵模特/多角度/杂志/季节/奢侈/设备/店面/运动 |
| 侧栏「电商视觉」面板 | 25 模板速览 + Campaign Style Lock 说明 + 两种模式说明 |
| Generate 模式 | 可选通过 apiz CLI 直接出图（需安装 apiz CLI 并 auth login） |

## 使用

对话里一句话：**「帮我做一款保温杯的电商主图」**或**「生成一套 5 主图 + 7 详情图的完整图片包」**。

模型按 Prompt/Brief 模式输出视觉简报 + Prompt + Campaign Style Lock。如果装了 apiz CLI，还可以直接出图。


## 安装

```bash
dsh plugin --profile web add dsh-ecom-image
```

## 许可

MIT（liangdabiao）
