# dsh-ecom-image · 电商视觉创作

DeepSeek Harness（dsh）插件：**电商图片生成 + 管理工作台**。不只是教模型写 Prompt——6 个原生工具覆盖通道/模型选择、模板与案例查询、Style Lock 持久化、双通道直接生图、验收闸门、历史管理；侧栏「电商视觉」面板提供 **指南 / 案例 / 模板 / 出图 / 画廊 / Style Lock** 六个可点击标签。

方法论来自 [ecom-details-image](https://github.com/liangdabiao/ecom-details-image)（MIT，liangdabiao）。v0.3.0 跟随上游升级：**即梦 Seedream 5.5 成为默认生图通道**，并内置上游 30 张实测案例图与对应 Prompt。

<img width="1752" height="1065" alt="image" src="https://github.com/user-attachments/assets/26fff5eb-4ac7-45e2-a20a-619508bcbe50" />

## 装上以后有什么

| 能力 | 说明 |
|---|---|
| `ecom_models` | **通道 / 模型选择**：即梦 `dreamina-canvas`、apiz CLI 的就绪状态、版本、积分余额、13+ 模型 id、支持比例、参考图上限。默认 60 秒缓存，`check` 强制实时探测 |
| `ecom_generate_image` | **双通道生图**：`channel`=auto（即梦优先，不可用回落 apiz）/ dreamina / apiz；`model`、`size`、`resolution` 可选；支持参考图（即梦 ≤10 张、apiz ≤16 张），结果自动落盘入历史 |
| `ecom_review_image` | **一次一张的验收闸门**：没记录验收结论，下一次生成直接被拒（防批量烧积分） |
| `ecom_template` | 25 个场景模板：list / search / get，返回 prompt_template、variants、category_tips、examples、anti_ai_tips + **实测案例图路径** |
| `ecom_style_lock` | Campaign Style Lock 持久化：色板/冷暖调/字体/背景/光线/布局/图标整套锁死；set/get/list/delete/render |
| `ecom_history` | 生图历史：通道、模型、比例、Prompt、积分、文件路径、验收状态；list/get/clear |
| `ecom-details-image` 技能 | 上游方法论全文 + 插件补充指引（工具优先、一次一张、6 条硬检查、出图后自检） |
| 侧栏面板 | 指南（通道状态 + 一键开对话）、**案例**（30 张实测图 + 当时 Prompt，可一键复用）、**模板**（25 个卡片带案例缩略图，点开看 Prompt 骨架/变体/品类建议）、**出图**（选通道+模型+比例+模板+参考图 → 生成指令 → 一键填进对话）、画廊（按 campaign 筛选 + 验收状态）、Style Lock |

## 使用

对话里一句话：

- **「帮我做一款保温杯的电商主图」**——模型匹配 hero-image 模板构建 Prompt，要出图时调 `ecom_generate_image`
- **「生成一套 5 主图 + 7 详情图的完整图片包」**——模型先 `ecom_style_lock` 建锁，然后每张图传 `campaign` 保证全套一致
- **「用这张实拍图做白底图」**——传 `reference_image` 走图生图
- **「用哪个模型出图 / 查下余额」**——`ecom_models`

面板里：

- **案例**：点任意实测图看大图 + 当时的 Prompt，`复制 Prompt` 或 `用这个 Prompt 出图`（换产品后一键填进新对话）
- **模板**：卡片上有案例缩略图，点开看 Prompt 骨架、风格变体、品类建议、示例 Prompt
- **出图**：勾选通道/模型/比例/模板，填产品与参考图路径，实时预览生成指令，`🚀 填进对话出图`
- **画廊**：按 campaign 筛选整套图，看验收状态，`复用这条 Prompt`

所有「出图」按钮都只把指令填进新对话，**不会在面板里偷偷扣积分**；真正的生成仍然走一次一张 + 验收。

## 生图通道（点 3：API 与模型可选）

| 通道 | 默认模型 | 说明 |
|---|---|---|
| `dreamina`（默认） | `seedream_5.5` @ 2K | 即梦 `dreamina-canvas` CLI；约 6 积分/张；参考图 ≤10 张（多角度产品图一致性最好）；国内版左上角带「AI生成」水印，交付前需裁切/修补 |
| `apiz` | `apiz/gpt-image-2.5-flare` | apiz CLI；支持 GPT Image 2.6/2.5、Nano Banana Pro/2、Seedream 5.0 Pro、Gemini 3 Pro Image 等 13 个图片模型；参考图走 `--params '{"reference_image_urls":[…] }'` |

插件配置里可改：`defaultChannel`（auto/dreamina/apiz）、`dreaminaModel`、`dreaminaResolution`、`dreaminaCanvasId`、`dreaminaCreditCeiling`、`dreaminaBin`、`defaultModel`（apiz）、`apizBin`。

即梦不支持的比例（如 `4:5`、`5:4`）会自动换算到最近支持的比例（`3:4`、`4:3`）并在回执里说明；尺寸核验不达标会直接判不合格。

### 前置条件

```bash
# 即梦通道（默认）
dreamina-canvas auth login
dreamina-canvas auth account     # 查积分（2K 约 6/张）

# apiz 通道
apiz auth login
apiz account balance
```

两个都不装也能用：模型照样输出完整 Prompt 包，拿去即梦网页 / Midjourney 手动生成。

## 案例从哪来

上游 skill 用即梦 Seedream 5.5 实跑的两组案例随插件打包：

- `skills/ecom-details-image/docs/case/`：整套 PDP 13 张（5 主图 + 8 详情图）+ 17 个场景模板轮测图
- `skills/ecom-details-image/prompts/pour-over-dripper/`：每张图当次使用的 Prompt

面板「案例」直接读这两处；模板详情自动关联对应案例图（`t03` → flat-lay 等，缺测场景用同语义图兜底）。

## 数据存哪

`$DSH_HOME/ecom-image/`（默认 `~/.dsh/ecom-image/`）：

```
history.json   生图历史（最多 500 条）
images/        生成的图片文件
stylelock.json Campaign Style Lock
```

## 安装

```bash
# 从 GitHub 装（dist/client.js 已入库，装完即有面板）
dsh plugin --profile web add github:liangdabiao/dsh-ecom-image

# 钉版本
dsh plugin --profile web add github:liangdabiao/dsh-ecom-image#v0.3.0
```

> ⚠️ 本包**没有发布到 npm**，`dsh plugin add dsh-ecom-image` 会失败——请用上面的 `github:` 形式。
>
> `dist/client.js` 是入库文件：dsh 宿主直接消费已构建的客户端 bundle（`package.json` → `exports["./client"]`），缺它会导致插件激活失败、侧栏「电商视觉」面板不出现。改完源码记得 `npm run build` 再提交。

## 升级 / 跟随上游 skill

```bash
node scripts/sync-skill.mjs D:\path\to\ecom-details-image   # 快照 SKILL.md/模板/脚本/docs案例/prompts
npm run build && npm run selftest && npm test
```

`scripts/sync-skill.mjs` 会写 `skills/ecom-details-image/SNAPSHOT.json`（来源路径、时间、模板数、案例数）。

## 开发

```bash
npm install        # 首次
npm run build      # client.js → dist/client.js
npm run selftest   # 离线自检（快照/技能/模板/案例/API）
npm test           # lib 单测 + 面板 jsdom 冒烟
```

## 许可

MIT（liangdabiao）
