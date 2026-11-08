// dsh-ecom-image 单测（node test/lib.test.mjs 直接跑，不用 node --test——Windows 下异步清理不可靠）。
// 数据目录指向工作区 .tmp/，不碰系统 Temp（沙箱会杀）。
process.env.DSH_HOME = new URL('../.tmp/test-home/', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')

import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills', 'ecom-details-image')

let passed = 0, failed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err?.message?.split('\n')[0]}`) }
}

// ── data.js ─────────────────────────────────────────────────
const data = await import('../lib/data.js')

rmSync(process.env.DSH_HOME, { recursive: true, force: true })

await test('data: history 追加/读取/更新/清空', async () => {
  assert.equal(data.readHistory().length, 0)
  data.appendHistory({ id: 'g1', status: 'running', prompt: 'a' })
  data.appendHistory({ id: 'g2', status: 'completed', prompt: 'b' })
  // 新的在前
  assert.equal(data.readHistory()[0].id, 'g2')
  data.updateHistory('g1', { status: 'completed', price: 3 })
  assert.equal(data.readHistory().find((r) => r.id === 'g1').price, 3)
  data.clearHistory()
  assert.equal(data.readHistory().length, 0)
})

await test('data: history 上限 500 条截断', async () => {
  data.clearHistory()
  for (let i = 0; i < 505; i++) data.appendHistory({ id: `g${i}` })
  assert.equal(data.readHistory().length, 500)
  data.clearHistory()
})

await test('data: styleLock set 合并 / get / delete', async () => {
  const lock = data.setStyleLock('双11campaign', { palette: '#E85A2A + 米白', tone: '暖调' })
  assert.equal(lock.palette, '#E85A2A + 米白')
  assert.ok(lock.updatedAt)
  // 合并：不清掉 palette
  data.setStyleLock('双11campaign', { lighting: '右上主光' })
  const merged = data.getStyleLock('双11campaign')
  assert.equal(merged.palette, '#E85A2A + 米白')
  assert.equal(merged.lighting, '右上主光')
  assert.equal(data.deleteStyleLock('双11campaign'), true)
  assert.equal(data.getStyleLock('双11campaign'), null)
  assert.equal(data.deleteStyleLock('不存在'), false)
})

await test('data: renderLockText 渲染字段 + 空锁为空串', async () => {
  data.setStyleLock('x', { palette: '橙色系', layout: '产品居中' })
  const text = data.renderLockText(data.getStyleLock('x'))
  assert.ok(text.includes('色板: 橙色系'))
  assert.ok(text.includes('布局: 产品居中'))
  assert.ok(text.startsWith('Campaign Style Lock'))
  data.setStyleLock('empty', {})
  assert.equal(data.renderLockText(data.getStyleLock('empty')), '')
  data.deleteStyleLock('x'); data.deleteStyleLock('empty')
})

// ── 一次一张的闸门 ──────────────────────────────────────────
await test('data: pendingReview 只认 awaiting 的最新一条', async () => {
  data.clearHistory()
  assert.equal(data.pendingReview(), null)
  data.appendHistory({ id: 'g-done', reviewState: 'approved' })
  data.appendHistory({ id: 'g-wait', reviewState: 'awaiting' })
  assert.equal(data.pendingReview().id, 'g-wait')
})

await test('data: recordReview —— approve 必须 6 项全 true', async () => {
  data.clearHistory()
  data.appendHistory({ id: 'r1', reviewState: 'awaiting', files: [{ file: 'a.png' }] })
  const allPass = Object.fromEntries(data.REVIEW_CHECK_KEYS.map((k) => [k, true]))
  const partial = { ...allPass, physicalGrounding: false }
  const bad = data.recordReview('r1', { verdict: 'approve', checks: partial })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /physicalGrounding/)
  const ok = data.recordReview('r1', { verdict: 'approve', checks: allPass })
  assert.equal(ok.ok, true)
  assert.equal(data.readHistory()[0].reviewState, 'approved')
  assert.equal(data.pendingReview(), null)
  // 不能重复验收
  assert.equal(data.recordReview('r1', { verdict: 'approve', checks: allPass }).ok, false)
})

await test('data: recordReview —— reject 记录原因并放行下一张', async () => {
  data.clearHistory()
  data.appendHistory({ id: 'r2', reviewState: 'awaiting' })
  const res = data.recordReview('r2', { verdict: 'reject', checks: { physicalGrounding: false }, notes: '车轮悬空' })
  assert.equal(res.ok, true)
  assert.equal(data.readHistory()[0].reviewState, 'rejected')
  assert.equal(data.readHistory()[0].review.notes, '车轮悬空')
  assert.equal(data.pendingReview(), null)
})

await test('data: acquireGenerateLock 互斥 + 释放后可再取', async () => {
  const l1 = data.acquireGenerateLock()
  assert.equal(l1.ok, true)
  const l2 = data.acquireGenerateLock()
  assert.equal(l2.ok, false)
  assert.match(l2.reason, /一次只允许一张/)
  l1.release()
  const l3 = data.acquireGenerateLock()
  assert.equal(l3.ok, true)
  l3.release()
})

await test('data: safeImageFile 拒绝路径穿越', async () => {  assert.equal(data.safeImageFile('../../etc/passwd'), null)
  assert.equal(data.safeImageFile('a/b.png'), null)
  assert.equal(data.safeImageFile('a\\b.png'), null)
  assert.equal(data.safeImageFile('..\\..\\x.png'), null)
  assert.equal(data.safeImageFile(''), null)
  assert.equal(data.safeImageFile('no-such.png'), null) // 存在性检查
  // 放一张真图验证正向
  data.ensureDirs()
  writeFileSync(join(data.IMAGES_DIR, 'ok.png'), 'PNG')
  assert.ok(data.safeImageFile('ok.png').endsWith('ok.png'))
})

// ── apiz.js（不真正调 CLI，只测导出与参数防护）─────────────
await test('apiz: 模块可导入且导出齐全', async () => {
  const apiz = await import('../lib/apiz.js')
  assert.equal(apiz.DEFAULT_MODEL, 'apiz/gpt-image-2.5-flare')
  assert.equal(typeof apiz.generateImage, 'function')
  assert.equal(typeof apiz.uploadReferenceImage, 'function')
  assert.equal(typeof apiz.downloadImages, 'function')
  assert.equal(typeof apiz.setApizBin, 'function')
})

await test('apiz: generateImage 对不存在参考图报错', async () => {
  const apiz = await import('../lib/apiz.js')
  await assert.rejects(() => apiz.uploadReferenceImage('Z:/no/such/file.png'), /参考图片不存在/)
})

// 回归守卫：图生图必须走 --params {"reference_image_urls":[...]}，禁止再用 --image-url
await test('apiz: buildGenerateArgs 参考图走 reference_image_urls', async () => {
  const apiz = await import('../lib/apiz.js')
  const ref = 'https://cdn.example.com/a.jpg'
  const args = apiz.buildGenerateArgs({ prompt: 'p', model: 'm', aspectRatio: '4:5', referenceImageUrls: [ref] })
  assert.ok(!args.includes('--image-url'), '不能在用 --image-url')
  const i = args.indexOf('--params')
  assert.ok(i > -1, '必须带 --params')
  const params = JSON.parse(args[i + 1])
  assert.deepEqual(params.reference_image_urls, [ref])
  assert.equal(args[args.indexOf('--aspect-ratio') + 1], '4:5')
})

await test('apiz: 无参考图时不带 --params', async () => {
  const apiz = await import('../lib/apiz.js')
  const args = apiz.buildGenerateArgs({ prompt: 'p', model: 'm', aspectRatio: '1:1' })
  assert.equal(args.includes('--params'), false)
})

await test('apiz: normalizeReferenceUrls 过滤非 http/去重/限 16 张', async () => {
  const apiz = await import('../lib/apiz.js')
  assert.deepEqual(apiz.normalizeReferenceUrls(''), [])
  assert.deepEqual(apiz.normalizeReferenceUrls(['ftp://x/a.jpg', '', 'https://a/1.jpg', 'https://a/1.jpg']), ['https://a/1.jpg'])
  const many = Array.from({ length: 20 }, (_, i) => `https://a/${i}.jpg`)
  assert.equal(apiz.normalizeReferenceUrls(many).length, 16)
  assert.equal(apiz.MAX_REFERENCE_IMAGES, 16)
})

// 回归守卫：给了参考图却全是本地路径/坏 URL 时必须立刻报错，禁止静默退化成文生图
await test('apiz: 参考图无效时 buildGenerateArgs 直接报错', async () => {
  const apiz = await import('../lib/apiz.js')
  assert.throws(() => apiz.buildGenerateArgs({ prompt: 'p', model: 'm', aspectRatio: '1:1', referenceImageUrls: ['D:/a/b.jpg'] }), /参考图无效/)
  assert.throws(() => apiz.buildGenerateArgs({ prompt: 'p', model: 'm', aspectRatio: '1:1', referenceImageUrls: ['ftp://a/b.jpg'] }), /参考图无效/)
})

await test('apiz: 模型参考图能力表 + 报错翻译', async () => {
  const apiz = await import('../lib/apiz.js')
  assert.equal(apiz.refSupportFor('apiz/gpt-image-2.5-flare'), 'reference_image_urls')
  assert.equal(apiz.refSupportFor('some/unknown-model'), null)
  assert.match(apiz.explainApizError('apiz: HTTP 400 — 不支持的参数: image_url'), /reference_image_urls/)
  assert.match(apiz.explainApizError('apiz: HTTP 429 — 计费失败: API Key 额度不足'), /余额|充值/)
  assert.match(apiz.explainApizError('apiz: task xxx timed out after 6m45s'), /tasks get/)
})

await test('apiz: imageSizeFromBuffer 读 PNG/JPEG 尺寸', async () => {
  const apiz = await import('../lib/apiz.js')
  // 构造最小 PNG 头
  const png = Buffer.alloc(32)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
  png.writeUInt32BE(13, 8)
  png.write('IHDR', 12, 'ascii')
  png.writeUInt32BE(928, 16)
  png.writeUInt32BE(1152, 20)
  assert.deepEqual(apiz.imageSizeFromBuffer(png), { width: 928, height: 1152 })
  // 4:5 比例核验
  const ok = apiz.ratioMismatch('4:5', { width: 928, height: 1152 })
  assert.equal(ok.ok, true)
  const bad = apiz.ratioMismatch('4:5', { width: 1024, height: 1024 })
  assert.equal(bad.ok, false)
  assert.equal(apiz.ratioMismatch('4:5', null), null)
})

// ── templates.js ───────────────────────────────────────────
const { loadTemplates, listTemplates, getTemplate, searchTemplates } = await import('../lib/templates.js')

await test('templates: 25 个模板全量加载', async () => {
  const all = loadTemplates([SKILL_DIR])
  assert.equal(all.length, 25)
  const list = listTemplates([SKILL_DIR])
  assert.ok(list.every((t) => t.id && t.name))
})

await test('templates: get 按 id / 按 name 命中', async () => {
  assert.equal(getTemplate([SKILL_DIR], 'hero-image').id, 'hero-image')
  assert.ok(getTemplate([SKILL_DIR], '白底/纯色底产品主图'))
  assert.equal(getTemplate([SKILL_DIR], 'no-such'), null)
})

await test('templates: search 中英文关键词', async () => {
  assert.ok(searchTemplates([SKILL_DIR], '白底').some((t) => t.id === 'hero-image'))
  assert.ok(searchTemplates([SKILL_DIR], 'ugc').length >= 1)
  assert.ok(searchTemplates([SKILL_DIR], 'zzz-不存在').length === 0)
})

// ── skills.js ───────────────────────────────────────────────
const skills = await import('../lib/skills.js')

await test('skills: provider list/get 带 addendum 工具指引', async () => {
  const provider = skills.createSkillProvider([SKILL_DIR])
  assert.equal(provider.name, 'ecom-image')
  const list = await provider.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'ecom-details-image')
  assert.ok(list[0].description.length > 20)
  const detail = await provider.get({ locator: list[0].locator, name: list[0].name })
  assert.ok(detail.content.includes('ecom_generate_image'))
  assert.ok(detail.content.includes('ecom_style_lock'))
  assert.ok(detail.content.includes('Campaign Style Lock'))
})

// ── host.js：工具对象结构 + 校验 + 全链路（不打 apiz 网络）──
const host = await import('../src/host.js')

await test('host: 5 个工具注册齐全、schema additionalProperties:false', async () => {
  assert.equal(host.name, 'ecom-image')
  for (const tool of [host.ecomGenerateImageTool, host.ecomReviewImageTool, host.ecomHistoryTool, host.ecomStyleLockTool, host.ecomTemplateTool]) {
    assert.equal(tool.output.schema.additionalProperties, false)
    assert.equal(tool.parameters.additionalProperties, false)
    assert.ok(tool.description.length > 30)
  }
  assert.equal(host.ecomGenerateImageTool.parameters.required[0], 'prompt')
})

await test('host: check 未知参数/坏枚举拒绝', async () => {
  await assert.rejects(
    () => host.ecomHistoryTool.execute({ action: 'list', bogus: 1 }),
    /未知参数/)
  await assert.rejects(
    () => host.ecomTemplateTool.execute({ action: 'bad-action' }),
    /只能是/)
})

await test('host: ecom_history list/get/clear 全链路', async () => {
  data.clearHistory()
  data.appendHistory({ id: 'h1', ts: new Date().toISOString(), status: 'completed', prompt: 'test prompt for history', price: 5, model: 'm', aspectRatio: '1:1', files: [{ file: 'a.png', url: 'http://x' }] })
  const listed = await host.ecomHistoryTool.execute({ action: 'list', limit: 5 })
  assert.equal(listed.ok, true)
  assert.ok(listed.data.includes('h1'))
  const got = await host.ecomHistoryTool.execute({ action: 'get', id: 'h1' })
  assert.ok(got.data.includes('test prompt for history'))
  const miss = await host.ecomHistoryTool.execute({ action: 'get', id: 'nope' })
  assert.equal(miss.ok, false)
  const noConfirm = await host.ecomHistoryTool.execute({ action: 'clear' })
  assert.equal(noConfirm.ok, false)
  const cleared = await host.ecomHistoryTool.execute({ action: 'clear', confirm: 'yes' })
  assert.equal(cleared.ok, true)
  assert.equal(data.readHistory().length, 0)
})

await test('host: ecom_style_lock set/get/list/render/delete 全链路', async () => {
  const set = await host.ecomStyleLockTool.execute({ action: 'set', name: '测试campaign', palette: '暖橙+米白', tone: '暖调' })
  assert.equal(set.ok, true)
  const list = await host.ecomStyleLockTool.execute({ action: 'list' })
  assert.ok(list.data.includes('测试campaign'))
  const render = await host.ecomStyleLockTool.execute({ action: 'render', name: '测试campaign' })
  assert.ok(render.data.includes('色板: 暖橙+米白'))
  const del = await host.ecomStyleLockTool.execute({ action: 'delete', name: '测试campaign', confirm: 'yes' })
  assert.equal(del.ok, true)
  await assert.rejects(() => host.ecomStyleLockTool.execute({ action: 'get' }), /需要 name/)
})

await test('host: ecom_generate_image campaign 不存在时报错并指引', async () => {
  await assert.rejects(
    () => host.ecomGenerateImageTool.execute({ prompt: 'test', campaign: '不存在的锁' }),
    /先用 ecom_style_lock/)
})

await test('host: ecom_template 在未注入 skillDirs 时安全降级', async () => {
  const list = await host.ecomTemplateTool.execute({ action: 'list' })
  assert.equal(list.ok, true)
  const tpl = await host.ecomTemplateTool.execute({ action: 'search', keyword: '主图' })
  assert.equal(tpl.ok, false) // 空目录 → 无匹配
})

// ── api.js：鉴权深度防御 ───────────
await test('api: 无 connection 服务时放行（宿主 token 已把关）；服务在则执行其判定', async () => {
  const api = await import('../lib/api.js')
  const noService = { get: () => undefined }
  assert.equal(api.requestRejection(noService, { headers: {} }), false) // false = 放行
  const okService = { get: () => ({ requestRejection: () => false }) }
  assert.equal(api.requestRejection(okService, { headers: {} }), false)
  const rejectService = { get: () => ({ requestRejection: () => 403 }) }
  assert.equal(api.requestRejection(rejectService, { headers: {} }), 403)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
