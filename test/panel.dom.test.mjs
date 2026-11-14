// 面板 DOM 冒烟（jsdom）：
// ① 六个标签顺序 & 指南默认打开；② 指南「马上使用」预填指令；
// ③ 案例标签渲染案例图并可「用这个 Prompt 出图」；④ 模板标签带案例图并可进详情；
// ⑤ 出图标签生成完整指令并可填进对话。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(join(ROOT, 'package.json'))
const EXPECTED_PROMPT = '使用‘电商视觉’插件 生成电商图片：'
const TABS = ['指南', '案例', '模板', '出图', '画廊', 'Style Lock']

let deps = null
try {
  deps = {
    JSDOM: require_('jsdom').JSDOM,
    React: require_('react'),
    createRoot: require_('react-dom/client').createRoot,
    act: require_('react').act,
  }
} catch {
  deps = null
}

const MODELS = {
  channels: [
    {
      key: 'dreamina', label: '即梦 Seedream', ready: true, authOk: true, version: '1.3.0',
      defaultModel: 'seedream_5.5', defaultResolution: '2K', ratios: ['1:1', '3:4'],
      resolutions: ['1.5K', '2K'], maxRefs: 10, modelsSource: 'live',
      account: { credits: 2, isVip: true, vipLevel: 'artisan' },
      models: [{ id: 'seedream_5.5', label: 'Seedream 5.5', isDefault: true, ratios: ['1:1', '3:4'], resolutions: ['1.5K', '2K'], maxRefs: 10 }],
    },
    {
      key: 'apiz', label: 'apiz 多模型', ready: false, authOk: false, error: '未安装 apiz CLI', version: '',
      defaultModel: 'apiz/gpt-image-2.5-flare', ratios: ['1:1'], resolutions: [], maxRefs: 16,
      account: null, modelsSource: 'fallback', models: [{ id: 'apiz/gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', isDefault: true, ratios: ['1:1'], maxRefs: 16 }],
    },
  ],
  defaults: { channel: 'auto' },
}

const TEMPLATES = [{
  id: 'flat-lay', file: '03-flat-lay.json', name: '平铺图', description: 'flat lay photography',
  keywords: ['平铺图', 'flat lay'], caseImage: 'templates/t03-flat-lay.jpg', hasCase: true,
  variants: ['luxury', 'minimal'], supportsImageReference: true,
}]

const CASES = {
  groups: [
    {
      id: 'pdp', title: '整套 PDP 案例 · 陶瓷手冲滤杯', subtitle: '5 主图 + 8 详情图',
      items: [{
        id: 'hero-01-packshot', group: 'pdp', label: '主图 1 · 白底 Packshot',
        image: 'hero-01-packshot.jpg', mark: '✅', note: '',
        prompt: { file: 'prompts/pour-over-dripper/hero-01.txt', text: 'Premium e-commerce hero packshot. Warm off-white #F7F4EF background.' },
      }],
    },
    {
      id: 'templates', title: '场景模板轮测 · 17 个电商场景', subtitle: '同一只滤杯',
      items: [{
        id: 't03-flat-lay', group: 'templates', label: '03 · flat-lay', image: 'templates/t03-flat-lay.jpg',
        mark: '✅', note: '俯拍构图、道具搭配稳定，可直接用',
        prompt: { file: 'prompts/pour-over-dripper/templates/t03-flat-lay.txt', text: 'Top-down flat lay. 90-degree overhead angle.' },
      }],
    },
  ],
}

test('面板：六标签 + 指南 CTA + 案例/模板/出图可点击使用', { skip: deps ? false : '未安装 jsdom/react/react-dom，跳过' }, async () => {
  const { JSDOM, React, createRoot, act } = deps
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://127.0.0.1:61448/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  globalThis.HTMLElement = window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  globalThis.fetch = window.fetch = async (url) => {
    const target = String(url)
    const json = (value) => ({ ok: true, status: 200, json: async () => value })
    if (target.includes('/api/models')) return json(MODELS)
    if (target.endsWith('/api/case')) return json(CASES)
    if (target.includes('/api/templates')) return json({ templates: TEMPLATES })
    if (target.includes('/api/template?')) return json({ template: { ...TEMPLATES[0], prompt_template: { type: 'flat lay', background: '#F5F1E8' }, defaults: { props: 'curated objects' }, variants: { luxury: { description: '奢华', overrides: { background: 'silk' } } }, category_tips: { beauty: 'skincare ritual' }, examples: ['example prompt one'] } })
    if (target.includes('/api/stylelock')) return json({ locks: {} })
    return json({ history: [], items: [], count: 0 })
  }

  let factory = null
  window.__ModuleLoader__ = { load: ({ factory: f }) => { factory = f } }
  new Function(readFileSync(join(ROOT, 'dist', 'client.js'), 'utf8'))()
  const mod = factory((spec) => {
    if (spec === 'react') return React
    throw new Error(`bundle 请求了白名单外的模块：${spec}`)
  })
  assert.ok(mod.inject.includes('uiWorkspace'), 'client 必须 inject uiWorkspace 才能开对话')

  let Panel = null
  const starts = []
  mod.apply({
    slots: {
      inject: (_name, fn) => fn(),
      register: (desc, comp) => { if (desc.name === 'main') Panel = comp },
    },
    uiWorkspace: { startSession: (...args) => starts.push(args) },
  })
  assert.equal(typeof Panel, 'function', '面板应注册到 main slot')

  const root = createRoot(document.getElementById('app'))
  const flush = async (ms = 40) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
  const texts = () => [...document.querySelectorAll('button')].map((b) => b.textContent)
  const clickTab = async (label) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === label)
    assert.ok(btn, `找不到标签 ${label}`)
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await flush()
  }

  await act(async () => { root.render(React.createElement(Panel)) })
  await flush()

  // ① 标签顺序 & 默认指南
  const tabBar = [...document.querySelectorAll('button')].filter((b) => TABS.includes(b.textContent))
  assert.deepEqual(tabBar.map((b) => b.textContent), TABS, `标签顺序应为 ${TABS.join('/')}`)
  assert.match(document.body.textContent, /想做一套电商图/, '默认应打开指南（含 CTA 卡片）')

  // ② 马上使用
  const useBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('马上使用'))
  assert.ok(useBtn, '指南里应有一个「马上使用」按钮')
  await act(async () => { useBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  assert.equal(starts.length, 1, '点击应调用一次 startSession')
  assert.equal(starts[0][1].prompt, EXPECTED_PROMPT, '预填指令应与约定完全一致')
  assert.equal(starts[0][1].whenDraftExists, 'replace', '已有草稿时替换')

  // ③ 案例标签
  await clickTab('案例')
  assert.match(document.body.textContent, /实测案例/, '案例标签应显示实测案例')
  assert.match(document.body.textContent, /整套 PDP 案例/, '应显示 PDP 分组')
  const caseImg = document.querySelector('img[src*="/api/case-image?file=hero-01-packshot.jpg"]')
  assert.ok(caseImg, '案例卡片应加载案例图')
  // 点开大图 → 用这个 Prompt 出图
  await act(async () => { caseImg.parentElement.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await flush(20)
  assert.match(document.body.textContent, /Premium e-commerce hero packshot/, '大图里应显示当时的 Prompt')
  const useCase = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('用这个 Prompt 出图'))
  assert.ok(useCase, '案例大图应有「用这个 Prompt 出图」')
  await act(async () => { useCase.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await flush(20)
  assert.equal(starts.length, 2, '应开一次新对话')
  assert.ok(starts[1][1].prompt.includes('Premium e-commerce hero packshot'), '指令里应带上案例 Prompt')

  // ④ 模板标签
  await clickTab('模板')
  assert.ok(document.querySelector('img[src*="templates%2Ft03-flat-lay.jpg"]'), '模板卡片应显示案例图')
  const tplCard = document.querySelector('img[src*="t03-flat-lay"]')?.parentElement?.parentElement
  assert.ok(tplCard, '应找到模板卡片')
  await act(async () => { tplCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await flush(40)
  assert.match(document.body.textContent, /发布 Prompt 骨架/, '模板详情应展示 Prompt 骨架')
  assert.match(document.body.textContent, /background: #F5F1E8/, '骨架应含模板字段')
  const useTpl = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('用这个模板出图'))
  assert.ok(useTpl, '模板详情应有「用这个模板出图」')
  await act(async () => { useTpl.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  assert.equal(starts.length, 3)
  assert.ok(starts[2][1].prompt.includes('模板 平铺图'))

  // ⑤ 出图标签
  await clickTab('出图')
  assert.match(document.body.textContent, /出图配置/, '出图标签应显示配置表单')
  assert.match(document.body.textContent, /指令预览/, '出图标签应显示指令预览')
  assert.match(document.body.textContent, /Seedream 5.5/, '模型下拉应来自 /api/models')
  const generateBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('填进对话出图'))
  assert.ok(generateBtn, '出图标签应有「填进对话出图」')
  await act(async () => { generateBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  assert.equal(starts.length, 4)
  assert.ok(starts[3][1].prompt.startsWith(EXPECTED_PROMPT), '出图指令应以固定前缀开头')
  assert.ok(starts[3][1].prompt.includes('seedream_5.5'), '出图指令应带模型')
  assert.ok(starts[3][1].prompt.includes('一次只出一张'), '出图指令应声明一次一张')

  await act(async () => { root.unmount() })
})
