// 电商视觉创作 · Host 半边（工具 + webServer + 技能提供方）。
// 工具：ecom_generate_image（apiz CLI 生图）、ecom_history（生图历史）、
//       ecom_style_lock（Campaign Style Lock 持久化）、ecom_template（25 模板查询）。
// 面板数据面：/ecom-image 前缀路由（lib/api.js），与工具共用 lib。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { registerApi } from '../lib/api.js'
import { ensureDirs, readHistory, appendHistory, updateHistory, clearHistory, getStyleLock, setStyleLock, deleteStyleLock, readStyleLocks, renderLockText, pendingReview, acquireGenerateLock, recordReview, REVIEW_CHECK_KEYS, IMAGES_DIR, DATA_DIR } from '../lib/data.js'
import { DEFAULT_MODEL, MAX_REFERENCE_IMAGES, REF_PARAM, setApizBin, uploadReferenceImage, generateImage, downloadImages, imageSizeFromBuffer, ratioMismatch } from '../lib/apiz.js'
import { readFileSync } from 'node:fs'
import { listTemplates, getTemplate, searchTemplates } from '../lib/templates.js'

export const name = 'ecom-image' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'webServer', 'connection']

export const Config = Schema.object({
  defaultModel: Schema.string().default(DEFAULT_MODEL).description('默认 apiz 图片模型 id（apiz models list 可查）'),
  apizBin: Schema.string().default('').description('apiz CLI 可执行文件路径（留空自动从 PATH 查找）'),
})

const configRef = { config: Config }

// 手写参数校验（原生注册工具 dsh 不代验参数）
function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const arr = (description, extra = {}) => ({ type: 'array', items: { type: 'string' }, description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：历史记录/模板详情/StyleLock 等结构化文本' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

const CHECK_LABELS = {
  productFidelity: '产品与参考图逐项一致（轮廓/结构/配色/牌匾文字）',
  physicalGrounding: '物理落地：轮子踩在面上、有接触阴影、无悬空穿模',
  perspective: '透视一致：产品与桌面/道具同一灭点，道具比例合理',
  composition: '产品占比与留白达标',
  color: '色彩与参考图同色系',
  cleanliness: '无多余文字/尺寸标注/水印/杂物',
}

// ---------------------------------------------------------------------------
// 工具 1：ecom_generate_image —— apiz CLI 生图 + 自动入历史 + 可挂 Style Lock
// ---------------------------------------------------------------------------
export const ecomGenerateImageTool = {
  name: 'ecom_generate_image',
  description:
    '用 apiz CLI 直接生成电商图片——**一次只出一张**。出图后必须立刻把图和 6 项自检结果发给用户，' +
    '并用 ecom_review_image 记录验收结论；有未验收的记录时本工具会直接拒绝开新任务（防批量烧钱）。' +
    '要锁住产品外观一致性，必须传参考图：reference_image（本地绝对路径，自动上传 CDN）/ reference_image_url / reference_images（数组，最多 16 张）。' +
    'prompt 应为完整的英文生图 Prompt；如有多图任务，先用 ecom_style_lock 建立并锁定 Campaign Style Lock，' +
    '再传 campaign 参数让每张图自动注入同一段一致性约束。需用户已安装 apiz CLI 并 auth login（消耗 apiz 积分）。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: str('完整生图 Prompt（英文效果最佳）。传了 campaign 时无需再手写 Style Lock，会自动拼接'),
      title: str('可选：本张图的用途标注（如「保温杯-主图1」），会进历史记录'),
      campaign: str('可选：Campaign Style Lock 名称（先用 ecom_style_lock 的 set 建立），自动把锁定约束拼进 Prompt'),
      size: str('可选：图片比例，默认 1:1。可选 16:9 / 9:16 / 2:3 / 3:4 / 4:5 / 21:9 等', { enum: ['1:1', '16:9', '9:16', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '1:2', '2:1', '21:9', '9:21'] }),
      model: str('可选：apiz 图片模型 id，默认配置里的 defaultModel'),
      reference_image: str('可选：本地参考产品图绝对路径，先上传 apiz CDN 再走图生图（保证产品外观准确）'),
      reference_image_url: str('可选：参考图公网 URL（与 reference_image 二选一，URL 优先）'),
      reference_images: arr('可选：多张参考图（本地路径或公网 URL 混合），最多 16 张；传了它则忽略上面两个单图参数'),
      timeout: num('可选：单张生成等待上限秒数，默认 420'),
    },
  },
  timeoutMs: 480_000,
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    const cfg = configRef.config
    ensureDirs()
    setApizBin(typeof cfg?.apizBin === 'string' ? cfg.apizBin : '')

    // ── 一次一张 · 闸门 1：上一张还没验收，先别出新的 ──
    const pending = pendingReview()
    if (pending) {
      throw new Error(
        `上一张图还没验收，拒绝开始新的一张。\n` +
        `待验收：${pending.id}｜${pending.title || '未命名'}｜文件 ${(pending.files?.[0]?.file) || 'N/A'}\n` +
        `请先把这张图 + 6 项自检结果发给用户，再用 ecom_review_image 记录结论（verdict: approve / reject），之后才能出下一张。`)
    }
    // ── 一次一张 · 闸门 2：并发互斥（防我一次并行开好几张）──
    const lock = acquireGenerateLock()
    if (!lock.ok) throw new Error(`${lock.reason}。等这一张落盘并验收后再继续。`)
    try {
    const model = args.model || (typeof cfg?.defaultModel === 'string' && cfg.defaultModel) || DEFAULT_MODEL
    const aspectRatio = args.size || '1:1'

    // Campaign Style Lock 自动注入
    let lock = null
    if (args.campaign) {
      lock = getStyleLock(args.campaign)
      if (!lock) {
        const names = Object.keys(readStyleLocks())
        throw new Error(
          `Style Lock「${args.campaign}」不存在。先用 ecom_style_lock 的 set 动作建立${names.length ? `；已有：${names.join('、')}` : '（当前还没有任何锁）'}。`)
      }
    }
    const lockText = renderLockText(lock)
    const finalPrompt = lockText ? `${args.prompt}\n\n${lockText}` : args.prompt

    // 参考图收集：reference_images（数组，最多 16 张）> reference_image_url > reference_image（本地，自动传 CDN）
    const rawRefs = Array.isArray(args.reference_images) && args.reference_images.length
      ? args.reference_images
      : [args.reference_image_url, args.reference_image].filter(Boolean)
    const referenceImageUrls = []
    const localRefPaths = []
    for (const ref of rawRefs.slice(0, MAX_REFERENCE_IMAGES)) {
      const value = String(ref || '').trim()
      if (!value) continue
      if (/^https?:\/\//i.test(value)) referenceImageUrls.push(value)
      else {
        referenceImageUrls.push(await uploadReferenceImage(value))
        localRefPaths.push(value)
      }
    }

    // 记录占位（失败也留痕）
    const record = {
      id: `gen-${Date.now()}`,
      ts: new Date().toISOString(),
      title: args.title || '',
      prompt: args.prompt,
      finalPromptUsedLock: Boolean(lockText),
      model, aspectRatio,
      campaign: args.campaign || '',
      referenceImages: localRefPaths.length ? localRefPaths : referenceImageUrls,
      referenceImage: localRefPaths[0] || referenceImageUrls[0] || '',
      status: 'running',
      price: null,
      files: [],
      urls: [],
    }
    appendHistory(record)

    try {
      const { taskId, price, urls, cliArgs, warnings } = await generateImage({
        prompt: finalPrompt, model, aspectRatio, referenceImageUrls, timeoutMs: (args.timeout || 420) * 1000,
      })
      const baseName = record.ts.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
      const saved = await downloadImages(urls, IMAGES_DIR, baseName)

      // 产出校验：请求比例 vs 实际像素，不达标直接判不合格，不许静默"完成"。
      const checks = saved.map((s) => {
        const size = imageSizeFromBuffer(readFileSync(s.file))
        return { file: s.file.replace(/\\/g, '/').split('/').pop(), size, ratio: ratioMismatch(aspectRatio, size) }
      })
      const failedRatio = checks.filter((c) => c.ratio && !c.ratio.ok)
      const ratioLine = checks.map((c) => c.size
        ? `${c.file} ${c.size.width}×${c.size.height}${c.ratio ? `（要求 ${c.ratio.want}，实得 ${c.ratio.got}${c.ratio.ok ? ' ✓' : ' ✗'}）` : ''}`
        : `${c.file} 尺寸无法识别`).join('\n')

      updateHistory(record.id, {
        status: failedRatio.length ? 'ratio_mismatch' : 'completed', taskId, price,
        reviewState: 'awaiting', // 必须等用户验收，才允许出下一张
        cliArgs: cliArgs.map((a, i) => (i === 1 ? `<prompt ${String(a).length} chars>` : a)),
        referenceUrls: referenceImageUrls,
        sizeChecks: checks.map((c) => ({ file: c.file, ...(c.size || {}), ratio: c.ratio })),
        warnings,
        files: saved.map((s) => ({ file: s.file.replace(/\\/g, '/').split('/').pop(), url: s.url })),
        urls,
      })
      const fileList = saved.map((s) => s.file).join('\n')
      const warnLine = warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''
      if (failedRatio.length) {
        return result(false,
          `生成完成但**比例不符**（消耗 ${price ?? '未知'} 积分），已判不合格，请勿直接使用：\n${ratioLine}${warnLine}`,
          fileList)
      }
      return result(true,
        `生成完成，消耗积分 ${price ?? '未知'}，已保存 ${saved.length} 张图到 ${DATA_DIR} 的 images/ 目录（历史记录 ${record.id}）。` +
        `\n参考图 ${referenceImageUrls.length} 张已随请求提交（${REF_PARAM}）。尺寸核验：\n${ratioLine}` +
        `\n⚠️ 尺寸合格 ≠ 内容合格：请按 6 条硬检查逐项比对参考图（产品一致性/物理落地/透视/占比/色彩/无多余标注），再决定是否交付。` +
        (lockText ? '\n已自动注入 Campaign Style Lock。' : '') + warnLine,
        fileList)
    } catch (err) {
      updateHistory(record.id, { status: 'failed', error: String(err?.message || err).slice(0, 800) })
      throw err
    }
    } finally {
      lock.release()
    }
  },
}

// ---------------------------------------------------------------------------
// 工具 1.5：ecom_review_image —— 一次一张的验收闸门（没验收就出不了下一张）
// ---------------------------------------------------------------------------
export const ecomReviewImageTool = {
  name: 'ecom_review_image',
  description:
    '记录一张已生成图片的验收结论，是"一次只出一张"流程的闸门：不调用它，下一次 ecom_generate_image 会被直接拒绝。' +
    '先把图给用户看 + 贴 6 项自检，再按用户意见记录 approve 或 reject。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'verdict'],
    properties: {
      id: str('待验收的历史记录 id（gen-… ，见 ecom_generate_image 回执或 ecom_history list）'),
      verdict: str('approve = 用户确认可用；reject = 用户否决/需重出', { enum: ['approve', 'reject'] }),
      notes: str('可选：用户原话或不合格原因（reject 时必填，写清哪一项不过）'),
      checks: {
        type: 'object',
        description: '6 项自检，approve 时必须全部为 true',
        additionalProperties: false,
        properties: Object.fromEntries(REVIEW_CHECK_KEYS.map((k) => [k, { type: 'boolean', description: CHECK_LABELS[k] }])),
      },
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    if (args.verdict === 'reject' && !String(args.notes || '').trim()) {
      throw new Error('reject 必须写 notes：哪一项不过（产品一致性/物理落地/透视/占比/色彩/多余标注）。')
    }
    const res = recordReview(args.id, { verdict: args.verdict, checks: args.checks || {}, notes: args.notes || '' })
    if (!res.ok) throw new Error(res.error)
    const left = pendingReview()
    return result(true,
      args.verdict === 'approve'
        ? `已验收通过 ${args.id}，现在可以出下一张（一次仍然只能一张）。`
        : `已记录否决 ${args.id}：${args.notes}。改 Prompt 后可以重出，但要等用户明确说重出。`,
      left ? `注意：仍有待验收记录 ${left.id}` : '当前没有待验收记录。')
  },
}

// ---------------------------------------------------------------------------
// 工具 2：ecom_history —— 生图历史 dashboard 的数据源
// ---------------------------------------------------------------------------
export const ecomHistoryTool = {
  name: 'ecom_history',
  description: '查询/管理电商生图历史：每条记录含 Prompt、模型、比例、消耗积分、生成的图片文件路径。用户问「刚才生成了哪些图」「上次的图在哪」时使用。所有图片也在侧栏「电商视觉」面板的画廊展示。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('list 列历史；get 看单条详情；clear 清空全部历史（图片文件保留）', { enum: ['list', 'get', 'clear'] }),
      id: str('get：历史记录 id（list 里能看到）'),
      limit: num('list：最多返回条数，默认 20'),
      confirm: str('clear 必须传 "yes" 才执行', { enum: ['yes'] }),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    if (args.action === 'clear') {
      if (args.confirm !== 'yes') return result(false, '清空历史是破坏性操作，请用 confirm:"yes" 确认（图片文件不会被删除）。')
      clearHistory()
      return result(true, '生图历史已清空（images/ 目录里的图片文件保留）。')
    }
    if (args.action === 'get') {
      if (!args.id) throw new Error('get 需要 id（先 list 找到记录 id）。')
      const record = readHistory().find((r) => r.id === args.id)
      if (!record) return result(false, `没有找到记录 ${args.id}。`)
      return result(true, `记录 ${record.id}（${record.status}）`, JSON.stringify(record, null, 2))
    }
    const list = readHistory().slice(0, args.limit || 20)
    if (!list.length) return result(true, '还没有生图历史。对话里说「生成一张电商主图」试试。')
    const lines = list.map((r) => {
      const files = (r.files || []).map((f) => f.file).join(', ')
      const label = String(r.title || r.prompt || '未命名')
      const review = r.reviewState === 'awaiting' ? ' · ⏳待验收' : ''
      return `- ${r.ts} [${r.status}] ${label.slice(0, 60)} · ${r.model || '-'} · ${r.aspectRatio || '-'} · ${r.price ?? '-'} 积分${files ? ` · ${files}` : ''}${review} · id=${r.id}`
    })
    return result(true, `共 ${readHistory().length} 条历史，最近 ${list.length} 条：`, lines.join('\n'))
  },
}

// ---------------------------------------------------------------------------
// 工具 3：ecom_style_lock —— Campaign Style Lock 持久化
// ---------------------------------------------------------------------------
export const ecomStyleLockTool = {
  name: 'ecom_style_lock',
  description:
    '持久化 Campaign Style Lock：锁定整套电商图的色板/冷暖调/字体/背景/光线/布局/图标风格，保证多图一致性。' +
    '多图任务开始时先 set 建锁，之后每次 ecom_generate_image 传 campaign 参数即可自动注入。用户问「之前的风格锁」「保持同一套风格」时使用。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('set 建立/更新锁；get 查看锁；list 列出全部锁；delete 删除锁；render 输出可拼进 Prompt 的锁文本', { enum: ['set', 'get', 'list', 'delete', 'render'] }),
      name: str('锁名称（如「双11保温杯campaign」；字母/数字/中文，不含路径符）'),
      palette: str('set：色板（如「主色 #E85A2A + 辅助米白 #F5F0E8 + 点缀深棕」）'),
      tone: str('set：冷暖调（如「暖调偏橙」）'),
      font: str('set：字体风格（如「无衬线粗黑体标题 + 细体正文」）'),
      background: str('set：背景（如「浅灰渐变摄影棚背景」）'),
      lighting: str('set：光线（如「柔和侧逆光，右上主光」）'),
      layout: str('set：布局（如「产品居中偏下，留顶部 1/5 文案区」）'),
      icons: str('set：图标风格（如「细线条圆角图标」）'),
      notes: str('set：其他一致性备注'),
      confirm: str('delete 必须传 "yes"', { enum: ['yes'] }),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    if (args.action === 'list') {
      const locks = readStyleLocks()
      const names = Object.keys(locks)
      if (!names.length) return result(true, '还没有任何 Style Lock。set 一个即可。')
      return result(true, `共 ${names.length} 个锁：`, names.map((n) => `- ${n}（更新于 ${locks[n].updatedAt}）`).join('\n'))
    }
    if (!args.name) throw new Error(`${args.action} 需要 name。`)
    if (args.action === 'set') {
      const lock = setStyleLock(args.name, args)
      return result(true, `Style Lock「${args.name}」已保存。之后 ecom_generate_image 传 campaign:"${args.name}" 即自动注入。`,
        JSON.stringify(lock, null, 2))
    }
    if (args.action === 'get') {
      const lock = getStyleLock(args.name)
      if (!lock) return result(false, `没有「${args.name}」这个锁。`)
      return result(true, `Style Lock「${args.name}」：`, JSON.stringify(lock, null, 2))
    }
    if (args.action === 'render') {
      const lockText = renderLockText(getStyleLock(args.name))
      return lockText ? result(true, '锁文本（可直接拼进 Prompt）：', lockText) : result(false, `「${args.name}」没有可用的锁定字段。`)
    }
    // delete
    if (args.confirm !== 'yes') return result(false, '删除锁请用 confirm:"yes" 确认。')
    return deleteStyleLock(args.name)
      ? result(true, `Style Lock「${args.name}」已删除。`)
      : result(false, `没有「${args.name}」这个锁。`)
  },
}

// ---------------------------------------------------------------------------
// 工具 4：ecom_template —— 25 个场景模板查询
// ---------------------------------------------------------------------------
export const ecomTemplateTool = {
  name: 'ecom_template',
  description:
    '查询电商视觉的 25 个场景模板（主图/生活方式/平铺/微距/海报/社媒/UGC/模特/前后对比/包装/信息图/尺寸图/多产品/直播/虚拟试穿/爆炸图/隐形模特/多角度/杂志/节日/轻奢/设备样机/门店/运动 等）。' +
    'search 用中文或英文关键词找场景；get 拿到完整 JSON（prompt_template/variants/category_tips/examples）后按它构建生图 Prompt。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('list 列模板名；search 关键词搜索；get 取完整模板 JSON', { enum: ['list', 'search', 'get'] }),
      id: str('get：模板 id（list/search 里能看到，如 hero-image）'),
      keyword: str('search：关键词，如「白底」「主图」「lifestyle」「UGC」「包装」'),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    const skillDirs = skillDirsRef.dirs
    if (args.action === 'list') {
      const templates = listTemplates(skillDirs)
      return result(true, `共 ${templates.length} 个场景模板：`,
        templates.map((t) => `- ${t.name}（id=${t.id}）${t.description ? `：${t.description}` : ''}`).join('\n'))
    }
    if (args.action === 'search') {
      if (!args.keyword) throw new Error('search 需要 keyword。')
      const found = searchTemplates(skillDirs, args.keyword)
      if (!found.length) return result(false, `没有匹配「${args.keyword}」的模板，试试 list 看全部。`)
      return result(true, `匹配到 ${found.length} 个模板：`,
        found.map((t) => `- ${t.name}（id=${t.id}）`).join('\n'))
    }
    if (!args.id) throw new Error('get 需要 id。')
    const tpl = getTemplate(skillDirs, args.id)
    if (!tpl) return result(false, `没有找到模板 ${args.id}。`)
    return result(true, `模板「${tpl.name}」完整定义：`, JSON.stringify(tpl, null, 2))
  },
}

const skillDirsRef = { dirs: [] }

export function apply(ctx) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const skillDirs = [join(root, 'skills', 'ecom-details-image')]
  skillDirsRef.dirs = skillDirs

  ctx.effect(() => ctx.tools.register(ecomGenerateImageTool), `${name}: tool generate`)
  ctx.effect(() => ctx.tools.register(ecomReviewImageTool), `${name}: tool review`)
  ctx.effect(() => ctx.tools.register(ecomHistoryTool), `${name}: tool history`)
  ctx.effect(() => ctx.tools.register(ecomStyleLockTool), `${name}: tool stylelock`)
  ctx.effect(() => ctx.tools.register(ecomTemplateTool), `${name}: tool template`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  ctx.effect(() => registerApi(ctx, { skillDirs, configRef }), `${name}: routes`)
}
