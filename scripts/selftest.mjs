// 离线自检：快照完整（含案例图/即梦脚本）+ provider + addendum + 模板/案例索引 + 面板 API。
// 零网络零 key，不调用任何生图 CLI。
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills', 'ecom-details-image')
const { createSkillProvider, listTemplates } = await import('../lib/skills.js')
const { listCases } = await import('../lib/cases.js')

let failed = 0
const step = async (name, fn) => {
  process.stdout.write(`- ${name} … `)
  try {
    await fn()
    console.log('ok')
  } catch (err) {
    failed++
    console.log('失败')
    console.error(`  ${err.message}`)
  }
}

await step('快照完整（SKILL.md + 25 模板 + 双通道脚本 + 案例图 + 案例 Prompt）', () => {
  const required = [
    'SKILL.md',
    'SNAPSHOT.json',
    'scripts/generate_image.py',
    'scripts/generate_image_dreamina.py',
    'references/templates/01-hero-image.json',
    'references/templates/25-sports-campaign.json',
    'docs/case/hero-01-packshot.jpg',
    'docs/case/templates/t03-flat-lay.jpg',
    'prompts/pour-over-dripper/hero-01.txt',
  ]
  for (const p of required) {
    if (!existsSync(join(SKILL_DIR, p))) throw new Error(`缺 ${p}`)
  }
  const snap = JSON.parse(readFileSync(join(SKILL_DIR, 'SNAPSHOT.json'), 'utf8'))
  if (snap.templates !== 25) throw new Error(`快照模板 ${snap.templates} ≠ 25`)
  if (snap.caseImages < 30) throw new Error(`快照案例图 ${snap.caseImages} < 30`)
})

const provider = createSkillProvider([join(ROOT, 'skills')])
let candidates
await step('provider：注册 + 正文完整 + addendum 关键指引', async () => {
  candidates = await provider.list()
  if (candidates.length !== 1) throw new Error(`候选 ${candidates.length} ≠ 1`)
  const skill = await provider.get(candidates[0])
  if (skill.content.length < 5000) throw new Error('正文过短')
  for (const pattern of ['cp -r', 'Campaign Style Lock', 'ecom_models', 'dreamina-canvas', '一次一张']) {
    if (!skill.content.includes(pattern)) throw new Error(`addendum 缺 ${pattern}`)
  }
})

await step('25 模板列表 + 案例图关联', () => {
  const list = listTemplates([SKILL_DIR])
  if (list.length !== 25) throw new Error(`模板 ${list.length} ≠ 25`)
  const withCase = list.filter((t) => t.caseImage).length
  if (withCase < 17) throw new Error(`带案例图的模板只有 ${withCase} 个`)
})

await step('案例索引：2 组 30 张，全部配 Prompt', () => {
  const data = listCases(SKILL_DIR)
  const items = data.groups.flatMap((g) => g.items)
  if (items.length !== 30) throw new Error(`案例 ${items.length} ≠ 30`)
  const missing = items.filter((i) => !i.prompt?.text).length
  if (missing) throw new Error(`${missing} 张案例没有对应 Prompt`)
  if (!data.byTemplate['flat-lay']) throw new Error('flat-lay 未关联案例图')
})

await step('面板 API：health / templates / template / case / models 路由齐全', async () => {
  const { registerApi } = await import('../lib/api.js')
  const captured = []
  let status = 0
  const fakeRes = {
    writeHead(code) { status = code; return this },
    end(chunk) { if (chunk) captured.push(String(chunk)) },
  }
  let handler = null
  const fakeCtx = {
    get: () => ({ requestRejection: () => false }),
    webServer: { register: async ({ handler: h2 }) => { handler = h2 } },
  }
  await registerApi(fakeCtx, { skillDirs: [SKILL_DIR], configRef: { config: {} } })
  if (!handler) throw new Error('路由未注册')

  const call = async (path) => { captured.length = 0; status = 0; await handler({ method: 'GET', url: `/ecom-image/api/${path}`, headers: {} }, fakeRes); return JSON.parse(captured.at(-1)) }

  const health = await call('health')
  if (!health.ok) throw new Error('health 语义错误')
  const tpls = (await call('templates')).templates
  if (tpls.length !== 25) throw new Error(`模板 ${tpls.length} ≠ 25`)
  const tpl = (await call('template?id=flat-lay')).template
  if (!tpl.prompt_template) throw new Error('template 详情缺 prompt_template')
  const cs = await call('case')
  if (cs.groups.flatMap((g) => g.items).length !== 30) throw new Error('case 条数不对')
  await handler({ method: 'GET', url: '/ecom-image/api/case-image?file=..%2FSKILL.md', headers: {} }, fakeRes)
  if (status !== 404) throw new Error('case-image 未做路径防护')
})

if (failed > 0) {
  console.error(`\n自检失败 ${failed} 项`)
  process.exit(1)
}
console.log('\n全部通过。')
