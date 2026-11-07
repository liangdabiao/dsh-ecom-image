// 离线自检：快照完整 + provider + addendum + 模板列表 + 面板 API。零网络零 key。
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills', 'ecom-details-image')
const { createSkillProvider, listTemplates } = await import('../lib/skills.js')

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

await step('快照完整（SKILL.md + 25 模板 + generate_image.py）', () => {
  for (const p of ['SKILL.md', 'scripts/generate_image.py', 'references/templates/01-hero-image.json', 'references/templates/25-sports-campaign.json']) {
    if (!existsSync(join(SKILL_DIR, p))) throw new Error(`缺 ${p}`)
  }
})

const provider = createSkillProvider([join(ROOT, 'skills')])
let candidates
await step('provider：注册 + 正文完整 + addendum 三条', async () => {
  candidates = await provider.list()
  if (candidates.length !== 1) throw new Error(`候选 ${candidates.length} ≠ 1`)
  const skill = await provider.get(candidates[0])
  if (skill.content.length < 5000) throw new Error('正文过短')
  for (const pattern of ['cp -r', 'apiz', 'Campaign Style Lock']) {
    if (!skill.content.includes(pattern)) throw new Error(`addendum 缺 ${pattern}`)
  }
})

await step('25 模板列表', () => {
  const list = listTemplates([SKILL_DIR])
  if (list.length !== 25) throw new Error(`模板 ${list.length} ≠ 25`)
})

await step('面板 API 健康与模板列表（内存 ctx 模拟）', async () => {
  const { registerApi } = await import('../lib/api.js')
  const captured = []
  const fakeRes = { writeHead() { return this }, end(chunk) { captured.push(String(chunk)) } }
  const fakeCtx = {
    get: () => ({ requestRejection: () => false }),
    webServer: { register: async ({ handler }) => { globalThis.__ecomHandler = handler } },
  }
  await registerApi(fakeCtx, { skillDirs: [SKILL_DIR] })
  const handler = globalThis.__ecomHandler
  if (!handler) throw new Error('路由未注册')
  await handler({ method: 'GET', url: '/ecom-image/api/health', headers: {} }, fakeRes)
  if (!JSON.parse(captured.at(-1)).ok) throw new Error('health 语义错误')
  captured.length = 0
  await handler({ method: 'GET', url: '/ecom-image/api/templates', headers: {} }, fakeRes)
  const tpls = JSON.parse(captured.at(-1)).templates
  if (tpls.length !== 25) throw new Error(`模板 ${tpls.length} ≠ 25`)
})

if (failed > 0) {
  console.error(`\n自检失败 ${failed} 项`)
  process.exit(1)
}
console.log('\n全部通过。')
