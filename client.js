// ============================================================================
// 电商视觉创作 · 浏览器半边（最小面板）。
// 两块：📖 使用指南（两种模式+工作流+25 模板速览）。
// ============================================================================
const h = require('react').createElement
const { useState, useEffect } = require('react')

const PANEL_ID = 'ecom-image'
const BASE = 'ecom-image'

function PanelIcon(props) {
  return h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', ...props },
    h('rect', { x: 2.5, y: 2.5, width: 19, height: 19, rx: 5, fill: '#8a5a00' }),
    h('rect', { x: 5.5, y: 5.5, width: 13, height: 13, rx: 2, fill: '#fff' }),
    h('circle', { cx: 10, cy: 10, r: 2, fill: '#ffd24a' }),
    h('path', { d: 'M6 17l4-5 3 3 4-4 2 2', stroke: '#e8734a', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
}

async function fetchJson(path) {
  const res = await fetch(BASE + path)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`)
  return data
}

function GuideTab() {
  return h('div', { style: styles.wrap },
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '怎么用'),
      h('div', { style: styles.stepList },
        '在对话里一句话即可：',
        h('div', { style: styles.quote }, '「帮我做一款保温杯的电商主图」'),
        h('div', { style: styles.quote }, '「生成一套 5 主图 + 7 详情图的完整图片包」'),
        h('div', { style: styles.quote }, '「做一个 UGC 风格的种草图」'),
        '模型按 Prompt/Brief 模式输出视觉简报 + Prompt + Campaign Style Lock；如果你装了 apiz CLI，还可以直接出图。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '两种模式'),
      h('div', { style: { ...styles.muted, lineHeight: 1.8 } },
        'Prompt/Brief 模式（默认）——输出视觉简报、Prompt、负面约束、转化诊断、Style Lock。不需要任何工具。',
        h('br'), 'Generate 模式——通过 apiz CLI 直接出图。需安装 apiz CLI 并 auth login。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, 'Campaign Style Lock'),
      h('div', { style: styles.muted }, '整套图的色板/冷暖调/字体/背景/光线/布局必须一致——这是电商视觉的核心。模型生成 Prompt 时会自动注入 Style Lock。')))
}

function Panel() {
  const [templates, setTemplates] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetchJson('/api/templates').then((d) => setTemplates(d.templates)).catch((e) => setError(e.message))
  }, [])

  return h('div', { style: styles.wrap },
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '电商视觉创作'),
      h('div', { style: styles.stepList },
        '在对话里一句话即可：',
        h('div', { style: styles.quote }, '「帮我做一款保温杯的电商主图」'),
        h('div', { style: styles.quote }, '「生成一套 5 主图 + 7 详情图的完整图片包」'),
        h('div', { style: styles.quote }, '「做一个 UGC 风格的种草图」'),
        '模型按 Prompt/Brief 模式输出视觉简报 + Prompt + Campaign Style Lock。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '两种模式'),
      h('div', { style: styles.muted },
        'Prompt/Brief 模式（默认）——输出视觉简报、Prompt、负面约束、Style Lock。不需要任何工具。',
        h('br'), 'Generate 模式——通过 apiz CLI 直接出图（需安装 apiz CLI 并 auth login）。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '25 个场景模板'),
      error ? h('div', { style: styles.error }, error)
        : templates === null ? h('div', { style: styles.muted }, '加载中…')
          : h('div', { style: styles.tplGrid },
              templates.map((t) => h('div', { key: t.file, style: styles.tplCard },
                h('div', { style: styles.tplName }, t.name),
                h('div', { style: styles.muted }, t.description || t.file))))),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, 'Campaign Style Lock'),
      h('div', { style: styles.muted }, '整套图的色板/冷暖调/字体/背景/光线/布局必须一致。')))
}

const styles = {
  wrap: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box', fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13, color: '#1a1a1a' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  button: { padding: '6px 14px', border: 'none', borderRadius: 8, background: '#8a5a00', color: '#fff', cursor: 'pointer', fontSize: 13 },
  tab: { padding: '8px 16px', border: '1px solid #d9d9de', borderRadius: 8, background: '#fff', color: '#1a1a1a', cursor: 'pointer', fontSize: 13 },
  tabActive: { padding: '8px 16px', border: '1px solid #8a5a00', borderRadius: 8, background: '#f5f0e8', color: '#5a3a00', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  card: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, padding: 12, marginBottom: 10 },
  sectionTitle: { fontWeight: 700, marginBottom: 6 },
  stepList: { lineHeight: 1.9 },
  quote: { background: '#f5f0e8', borderRadius: 6, padding: '4px 10px', margin: '4px 0', color: '#5a3a00' },
  muted: { color: '#8a8a92' },
  error: { color: '#c0392b' },
  tplGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 },
  tplCard: { background: '#fafafa', borderRadius: 8, padding: '8px 10px', border: '1px solid #eee' },
  tplName: { fontWeight: 600, color: '#5a3a00' },
}

function apply(ctx) {
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 14, label: () => '电商视觉' }, PanelIcon))
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
}

exports.isPlugin = true
exports.inject = ['slots']
exports.apply = apply
