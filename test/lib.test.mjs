// 快照合规 + provider + 模板列表 + 面板 API 单测。零 dsh 依赖零网络。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills', 'ecom-details-image')
const SKILL_DIRS = [join(ROOT, 'skills')]
const { createSkillProvider, listTemplates, addendum } = await import('../lib/skills.js')
const { requestRejection } = await import('../lib/api.js')

test('快照完整：SKILL.md + 25 模板 + generate_image.py', () => {
  assert.ok(existsSync(join(SKILL_DIR, 'SKILL.md')), '缺 SKILL.md')
  assert.ok(existsSync(join(SKILL_DIR, 'scripts', 'generate_image.py')), '缺 generate_image.py')
  const tpls = readdirSync(join(SKILL_DIR, 'references', 'templates')).filter((f) => f.endsWith('.json'))
  assert.equal(tpls.length, 25, `模板数 ${tpls.length} ≠ 25`)
})

test('provider：单技能注册、SKILL.md 正文含核心方法论', async () => {
  const provider = createSkillProvider(SKILL_DIRS)
  const candidates = await provider.list()
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'ecom-details-image')
  assert.equal(candidates[0].rank, 600)
  const skill = await provider.get(candidates[0])
  assert.ok(skill.content.length > 5000, '正文过短')
  assert.match(skill.content, /Campaign Style Lock/, '应含 Style Lock 机制')
  assert.match(skill.content, /GPT-Image-2/, '应含 Prompt 铁律')
  assert.match(skill.content, /references\/templates\//, '应引用模板目录')
})

test('addendum：复制到工作区 + apiz CLI + 模板目录', async () => {
  const provider = createSkillProvider(SKILL_DIRS)
  const c = (await provider.list())[0]
  const skill = await provider.get(c)
  assert.match(skill.content, /cp -r/, '应有复制命令')
  assert.match(skill.content, /读不到插件安装目录/, '应说明沙箱限制')
  assert.match(skill.content, /apiz/, '应提 apiz CLI')
  assert.match(skill.content, /references\/templates\//, '应提模板目录')
})

test('listTemplates：25 个模板有名称', () => {
  const list = listTemplates([SKILL_DIR])
  assert.equal(list.length, 25)
  for (const t of list) assert.ok(t.file.endsWith('.json'))
})

test('面板 API：鉴权 fail closed', () => {
  const noService = { get: () => undefined }
  assert.equal(requestRejection(noService, { headers: {} }), 403)
  const okService = { get: () => ({ requestRejection: () => false }) }
  assert.equal(requestRejection(okService, { headers: {} }), false)
})
