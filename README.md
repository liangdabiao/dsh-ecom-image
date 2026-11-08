# dsh-ecom-image · 电商视觉创作

DeepSeek Harness（dsh）插件：**电商图片生成 + 管理工作台**。不只是教模型写 Prompt——4 个原生工具覆盖模板查询、Style Lock 持久化、apiz CLI 直接生图、生成历史管理，侧栏面板提供画廊（大图预览 / 按 campaign 筛选）、模板浏览器、Style Lock 一览。

技能方法论来自 [ecom-details-image](https://github.com/liangdabiao/ecom-details-image)（MIT，liangdabiao）。

## 装上以后有什么

| 能力 | 说明 |
|---|---|
| `ecom_generate_image` | apiz CLI 直接生图：支持参考图上传走图生图（保证产品外观准确）、比例 1:1/16:9/9:16 等多种、传 `campaign` 自动注入 Style Lock。结果自动下载入档、入历史 |
| `ecom_style_lock` | Campaign Style Lock **持久化**：色板/冷暖调/字体/背景/光线/布局/图标风格整套锁定，多图一致性；set/get/list/delete/render |
| `ecom_history` | 生图历史：Prompt、模型、比例、消耗积分、图片文件路径；list/get/clear |
| `ecom_template` | 25 个场景模板查询：list/search（中英文关键词）/get 拿完整 prompt_template/variants/category_tips/examples |
| `ecom-details-image` 技能 | 视觉简报 + Prompt 写作方法论 + 转化驱动力诊断（模型自主触发） |
| 侧栏「电商视觉」面板 | **画廊**（缩略图网格 + 点击大图预览 + campaign 筛选）、**模板**浏览器（点开看完整定义）、**Style Lock** 一览、使用指南 |

## 使用

对话里一句话：

- **「帮我做一款保温杯的电商主图」**——模型匹配 hero-image 模板构建 Prompt，要出图时调 `ecom_generate_image`
- **「生成一套 5 主图 + 7 详情图的完整图片包」**——模型先 `ecom_style_lock` 建锁，然后每张图传 `campaign` 保证全套一致；出完在面板画廊按 campaign 筛选整套
- **「用这张实拍图做白底图」**——传 `reference_image` 走图生图

## 数据存哪

`$DSH_HOME/ecom-image/`（默认 `~/.dsh/ecom-image/`）：

```
history.json   生图历史（最多 500 条）
images/        生成的图片文件
stylelock.json Campaign Style Lock
```

## 前置条件（Generate 模式）

生图走 [apiz CLI](https://apiz.ai)（认证由 CLI 自理，插件不接触密钥），消耗 apiz 积分：

```bash
# 安装 apiz CLI 后
apiz auth login
apiz account balance   # 查积分
```

不装 apiz 也能用：模型照样输出完整 Prompt 包，拿去即梦/Midjourney 手动生成。

默认模型 `apiz/gpt-image-2.5-flare`，可在插件 Config 改 `defaultModel` 或指定 `apizBin`。

## 安装

```bash
# 从 GitHub 装（dist/client.js 已入库，装完即有面板）
dsh plugin --profile web add github:liangdabiao/dsh-ecom-image

# 钉版本
dsh plugin --profile web add github:liangdabiao/dsh-ecom-image#v0.2.1
```

> ⚠️ 本包**没有发布到 npm**，`dsh plugin add dsh-ecom-image` 会失败——请用上面的 `github:` 形式。
>
> `dist/client.js` 是入库文件：dsh 宿主直接消费已构建的客户端 bundle（`package.json` → `exports["./client"]`），缺它会导致插件激活失败、侧栏「电商视觉」面板不出现。改完源码记得 `npm run build` 再提交。

## 一键开始

面板默认打开 **指南** 标签，顶部有 **🚀 马上使用** 按钮：点了会开一个新对话，输入框里已经填好

```
使用‘电商视觉’插件 生成电商图片：
```

补上产品与主图/场景图/A+ 需求后回车即可。

## 许可

MIT（liangdabiao）
