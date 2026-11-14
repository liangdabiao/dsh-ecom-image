// 电商视觉创作 · 技能快照提供方。
// 纯技能零 API key——Prompt/Brief 模式由模型直接产出；Generate 模式由模型在工作区
// 用 bash 调 apiz CLI（需用户安装 apiz 并 auth login）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  let description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') || null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*>/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  return name && description ? { name, description, body: text.slice(m[0].length) } : null
}

function readDir(dir) {
  // 支持两种布局：dir 本身就是一个技能（含 SKILL.md），或 dir 下有多个技能子目录。
  if (existsSync(join(dir, 'SKILL.md'))) {
    const parsed = parse(join(dir, 'SKILL.md'))
    if (!parsed) return []
    const templates = existsSync(join(dir, 'references', 'templates'))
      ? readdirSync(join(dir, 'references', 'templates')).filter((f) => f.endsWith('.json'))
      : []
    return [{ dir, file: join(dir, 'SKILL.md'), ...parsed, dirName: dir.split(/[\\/]/).pop(), templates }]
  }
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (!parsed) continue
    const templates = existsSync(join(sDir, 'references', 'templates'))
      ? readdirSync(join(sDir, 'references', 'templates')).filter((f) => f.endsWith('.json'))
      : []
    out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name, templates })
  }
  return out
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用（重要：工具优先）',
    '',
    '- 本插件提供 6 个原生工具，**优先用工具，不要手写脚本**：',
    '  1. `ecom_template`（list/search/get）——查 25 个场景模板，get 拿 prompt_template/variants/category_tips/examples/anti_ai_tips 后按它构建 Prompt；带 📷 的模板有上游实测案例图（面板「模板」标签可看）。',
    '  2. `ecom_models`（list/check）——看可用生图通道（即梦 dreamina-canvas / apiz CLI）、版本、积分余额、模型 id、支持比例与参考图上限。用户问「用哪个模型」先调它。',
    '  3. `ecom_style_lock`（set/get/list/delete/render）——多图任务先 set 建立 Campaign Style Lock（色板/冷暖调/字体/背景/光线/布局/图标）。',
    '  4. `ecom_generate_image`——**一次只出一张**。channel=auto 即梦优先（Seedream 5.5）、不可用回落 apiz；model 选具体模型（即梦 seedream_5.5 / seedream_5.0_pro，apiz apiz/gpt-image-2.6-flare 等）。出完先把图 + 6 项自检发用户，再用 `ecom_review_image` 记录验收（approve/reject）；没验收，下一次生成会被插件直接拒绝（防批量烧钱）。多图任务每张都传 campaign 参数自动注入 Style Lock；要锁产品一致性就传 `reference_image`（本地图）或 `reference_image_url`，多张参考图用 `reference_images`（即梦 ≤10 张、apiz ≤16 张）。即梦 4:5 之类不支持的比例会自动换算并提示。结果自动入历史。',
    '  5. `ecom_history`（list/get/clear）——查历史：通道/模型/Prompt/积分/文件路径/验收状态/真实 CLI 参数。',
    '  6. `ecom_review_image`——一次一张的验收闸门。approve 要求 6 项自检全为 true；reject 必须写 notes。不记录 = 出不了下一张。',
    '',
    '## 生图通道（插件里已封装，不用自己跑 python 脚本）',
    '',
    '- 即梦 dreamina-canvas：默认通道；2K 约 6 积分/张；产物左上角带「AI生成」合规水印；参考图最多 10 张，多角度产品图一致性最好。',
    '- apiz CLI：GPT Image 2.6/2.5、Nano Banana Pro、Seedream 5.0 Pro 等；参考图走 `--params {"reference_image_urls":[…]}`，**不要**用 `--image-url`。',
    '- 两个 CLI 都没装/没登录时不要阻塞：只输出完整 Prompt 包 + 登录指引（`dreamina-canvas auth login` / `apiz auth login`）。',
    '- 上游 skill 里的 `scripts/generate_image.py` 仍随插件打包（`scripts/`），但插件里优先用 `ecom_generate_image` 工具，它已处理画布/上传/下载/比例换算。',
    '',
    '## 一次一张（硬规则，插件已强制执行）',
    '',
    '- 一次只允许一个生成任务：并发调用被互斥锁挡住，返回"另一个生图任务正在进行中"。',
    '- 出图后必须立刻把**图 + 6 项自检结果**发给用户，等用户表态，再 `ecom_review_image`。',
    '- 有 `reviewState: awaiting` 的记录时，`ecom_generate_image` 直接报错拒绝——这是故意的，防止一次并行烧掉多张。',
    '- 用户没说"重出"就不要重出；多图整套也要一张一张走完验收再下一张。',
    '',
    '- 生图消耗积分；批量出图前先把 Image Pack Plan + 预计积分报给用户确认。用户两个 CLI 都没有时，只输出完整 Prompt 包。',
    '- 25 个场景模板 JSON 在技能目录 `references/templates/`；案例图与对应 Prompt 在 `docs/case/` 与 `prompts/pour-over-dripper/`，需要原文时先把技能目录复制到工作区（`cp -r "<目录>" ./ecom-image`）。',
    '- 用户可在侧栏「电商视觉」面板看：指南 / 案例 / 模板（带案例图）/ 出图（选通道+模型+比例，一键填进对话）/ 画廊 / Style Lock。',
    '',
    '## 出图前必须过的 6 条硬检查（少一条就会翻车）',
    '',
    '1. **先取模板**：`ecom_template get` 对应 id（flat-lay / detail-macro / lifestyle-scene / ugc-style…），用它的 prompt_template + variants + category_tips 拼，不要凭记忆写。',
    '2. **角度词显式**：每张 Prompt 必须写死机位，如 `photographed directly from above at a 90-degree overhead angle`；不写模型默认 3/4 平视。',
    '3. **占比+留白数字**：场景/氛围图产品 20-25%、留白 ≥50%；平铺 30-35%；主图 35-40%；微距 55-80%。',
    '4. **颜色用 hex**：背景 `#F5F1E8`、白底 `#FFFFFF`、深灰字 `#2D2D2D`、金 `#D4AF37`，禁止"米色/金色/木色"这类形容词。',
    '5. **物理落地**（最容易翻车）：必须写 `resting flat on the surface, weight visibly borne by the table, correct contact shadows where each wheel/edge meets the surface, consistent single-point perspective, prop scale matched to product scale`。只写 "on a desk" 一定出来悬空/穿模。',
    '6. **否定清单具体化**：`no dimension annotations, no measurement arrows, no extra props, no hands, no watermark, no fake logo, no duplicated shadows, no floating parts, no text`。',
    '',
    '## 出图后自检清单（逐项贴给用户，不许只说"正常"）',
    '',
    '- 产品一致性：轮廓/立柱/屋顶/遮阳板/桅杆/马匹/牌匾 是否与参考图逐项一致？',
    '- 物理合理性：每个轮子是否都踩在桌面上？有无悬空、穿模、阴影方向矛盾？',
    '- 透视一致：产品与桌面/道具是否同一灭点？道具比例是否合理？',
    '- 画面纪律：产品占比与留白是否达标？有无多余文字/标注/水印？',
    '- 色彩：木色/青绿是否与参考图同色系？有无偏色？',
    '- 即梦通道额外提醒：国内版左上角有「AI生成」水印，需裁切/修补；中文标题放大 200% 逐字核对。',
    '- 任何一项不过 → 直接判定不合格并说明原因，不要"看起来还行"。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s, templates) => ({
    name: s.name,
    description: s.description,
    path: s.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: 'ecom-image',
    rank: RANK,
    locator: s.dir,
    resourceBase: { kind: 'directory', path: s.dir },
    templates,
  })

  return {
    name: 'ecom-image',
    async list() {
      return list.flatMap(readDir).map((s) => {
        const c = candidate(s, s.templates)
        const { templates, ...rest } = c
        return rest
      })
    },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, templates, ...summary } = candidate(s, s.templates)
      return { ...summary, content, templates }
    },
  }
}

export { readDir, addendum }

/** 25 个场景模板（含案例图）——统一由 templates.js 提供，避免两处实现漂移。 */
export { listTemplates } from './templates.js'
