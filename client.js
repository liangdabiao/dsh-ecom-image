// ============================================================================
// 电商视觉创作 · 浏览器半边（画廊 / 模板 / StyleLock / 指南 四标签面板）。
// 画廊数据来自 /api/history，图片经 /api/image?file=（Host 侧已做路径防护）。
// ============================================================================
const h = require('react').createElement
const { useState, useEffect, useMemo } = require('react')

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

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return iso || '' }
}

function statusBadge(status) {
  const map = { completed: ['#1a7f37', '✓'], running: ['#b58a00', '⏳'], failed: ['#c0392b', '✗'] }
  const [color, label] = map[status] || ['#8a8a92', status || '?']
  return h('span', { style: { color, fontSize: 11, fontWeight: 700 } }, label)
}

// ---------------------------------------------------------------------------
// 画廊：生图历史 + 大图预览
// ---------------------------------------------------------------------------
function GalleryTab() {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  const [campaign, setCampaign] = useState('') // 空串 = 全部
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    fetchJson('/api/history').then((d) => setHistory(d.history)).catch((e) => setError(e.message))
  }, [])

  const campaigns = useMemo(() => {
    const set = new Set((history || []).map((r) => r.campaign).filter(Boolean))
    return [...set]
  }, [history])

  const filtered = (history || []).filter((r) => !campaign || r.campaign === campaign)

  if (error) return h('div', { style: styles.error }, error)
  if (history === null) return h('div', { style: styles.muted }, '加载中…')
  if (!history.length) {
    return h('div', { style: styles.muted },
      '还没有生成记录。在对话里说「帮我生成一张保温杯的白底主图」，出图后这里会自动展示。')
  }

  return h('div', null,
    h('div', { style: styles.row },
      h('button', {
        style: campaign === '' ? styles.chipActive : styles.chip,
        onClick: () => setCampaign(''),
      }, `全部 ${history.length}`),
      campaigns.map((c) => h('button', {
        key: c,
        style: campaign === c ? styles.chipActive : styles.chip,
        onClick: () => setCampaign(c),
      }, `🔒 ${c}`))),

    h('div', { style: styles.gallery },
      filtered.map((r) => h('div', { key: r.id, style: styles.gCard },
        h('div', {
          style: styles.gThumbWrap,
          onClick: () => r.files?.length && setPreview(r),
        },
          r.files?.length
            ? h('img', {
                src: `${BASE}/api/image?file=${encodeURIComponent(r.files[0].file)}`,
                style: styles.gThumb, loading: 'lazy',
              })
            : h('div', { style: { ...styles.gThumb, ...styles.gEmpty } }, r.status === 'failed' ? '✗ 失败' : '⏳ 生成中'),
          h('div', { style: styles.gStatus }, statusBadge(r.status)),
          r.files?.length > 1 ? h('div', { style: styles.gCount }, `${r.files.length} 张`) : null),
        h('div', { style: styles.gMeta },
          h('div', { style: styles.gTitle }, r.title || r.prompt.slice(0, 42)),
          h('div', { style: styles.muted, fontSize: 11 },
            `${fmtTime(r.ts)} · ${r.aspectRatio} · ${r.price != null ? r.price + ' 积分' : r.model}`),
          r.campaign ? h('div', { style: styles.gLock }, `🔒 ${r.campaign}`) : null,
          r.status === 'failed' && r.error ? h('div', { style: styles.errorSmall }, r.error.slice(0, 80)) : null)))),

    preview && h('div', { style: styles.lightbox, onClick: () => setPreview(null) },
      h('div', { style: styles.lightboxInner, onClick: (e) => e.stopPropagation() },
        h('div', { style: styles.lbImages },
          (preview.files || []).map((f) => h('img', {
            key: f.file,
            src: `${BASE}/api/image?file=${encodeURIComponent(f.file)}`,
            style: styles.lbImage,
          }))),
        h('div', { style: styles.lbInfo },
          h('div', { style: styles.sectionTitle }, preview.title || '生成记录'),
          h('div', { style: styles.lbMeta },
            `${fmtTime(preview.ts)} · ${preview.model} · ${preview.aspectRatio} · ${preview.price != null ? preview.price + ' 积分' : ''}`,
            preview.campaign ? ` · 🔒 ${preview.campaign}` : ''),
          h('div', { style: styles.lbPrompt }, preview.prompt)),
        h('button', { style: styles.button, onClick: () => setPreview(null) }, '关闭'))))
}

// ---------------------------------------------------------------------------
// 模板：25 个场景模板，点击看完整定义
// ---------------------------------------------------------------------------
function TemplateDetail({ id, onBack }) {
  const [tpl, setTpl] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetchJson(`/api/template?id=${encodeURIComponent(id)}`).then((d) => setTpl(d.template)).catch((e) => setError(e.message))
  }, [id])
  if (error) return h('div', { style: styles.error }, error)
  if (!tpl) return h('div', { style: styles.muted }, '加载中…')

  return h('div', null,
    h('div', { style: styles.row },
      h('button', { style: styles.chip, onClick: onBack }, '← 返回列表'),
      h('div', { style: styles.tplName }, tpl.name)),
    h('div', { style: styles.muted, marginBottom: 8 }, tpl.description || ''),
    tpl.keywords?.length ? h('div', { style: styles.row }, tpl.keywords.map((k) => h('span', { key: k, style: styles.keyword }, k))) : null,
    h('pre', { style: styles.code }, JSON.stringify({ prompt_template: tpl.prompt_template, variants: tpl.variants, category_tips: tpl.category_tips, examples: tpl.examples }, null, 2)))
}

function TemplatesTab() {
  const [templates, setTemplates] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    fetchJson('/api/templates').then((d) => setTemplates(d.templates)).catch((e) => setError(e.message))
  }, [])
  if (error) return h('div', { style: styles.error }, error)
  if (selected) return h(TemplateDetail, { id: selected, onBack: () => setSelected(null) })
  if (templates === null) return h('div', { style: styles.muted }, '加载中…')

  return h('div', { style: styles.tplGrid },
    templates.map((t) => h('div', {
      key: t.id, style: styles.tplCard,
      onClick: () => setSelected(t.id),
      title: '点击查看完整 Prompt 模板',
    },
      h('div', { style: styles.tplName }, t.name),
      h('div', { style: styles.muted }, t.description || t.id),
      t.keywords?.length ? h('div', { style: styles.tplKeywords }, t.keywords.slice(0, 4).join(' · ')) : null)))
}

// ---------------------------------------------------------------------------
// Style Lock：已保存的 campaign 锁一览
// ---------------------------------------------------------------------------
function LockTab() {
  const [locks, setLocks] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetchJson('/api/stylelock').then((d) => setLocks(d.locks)).catch((e) => setError(e.message))
  }, [])
  if (error) return h('div', { style: styles.error }, error)
  if (locks === null) return h('div', { style: styles.muted }, '加载中…')

  const names = Object.keys(locks)
  if (!names.length) {
    return h('div', { style: styles.muted },
      '还没有 Style Lock。多图任务时，模型会用 ecom_style_lock 工具建立锁（色板/冷暖调/字体/背景/光线/布局/图标风格），确保整套图风格一致。')
  }

  const fieldLabels = { palette: '色板', tone: '冷暖调', font: '字体', background: '背景', lighting: '光线', layout: '布局', icons: '图标', notes: '备注' }

  return h('div', null,
    names.map((name) => {
      const lock = locks[name]
      return h('div', { key: name, style: styles.card },
        h('div', { style: styles.sectionTitle }, `🔒 ${name}`),
        h('div', { style: styles.mutedSmall }, `更新于 ${fmtTime(lock.updatedAt)}`),
        h('div', { style: styles.lockFields },
          Object.entries(fieldLabels).map(([field, label]) => lock[field]
            ? h('div', { key: field, style: styles.lockField },
                h('span', { style: styles.lockLabel }, label), lock[field])
            : null)))
    }))
}

// ---------------------------------------------------------------------------
// 指南
// ---------------------------------------------------------------------------
function GuideTab() {
  return h('div', null,
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '怎么用'),
      h('div', { style: styles.stepList },
        h('div', { style: styles.quote }, '「帮我做一款保温杯的电商主图」'),
        h('div', { style: styles.quote }, '「生成一套 5 主图 + 7 详情图的完整图片包」'),
        h('div', { style: styles.quote }, '「做一个 UGC 风格的种草图，竖版 9:16」'),
        '模型会匹配 25 个场景模板构建 Prompt；明确要出图时调用 ecom_generate_image 直接生成（消耗 apiz 积分）。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '四个工具'),
      h('div', { style: styles.muted, lineHeight: 2 },
        h('b', null, 'ecom_template'), ' — 查 25 个场景模板（白底主图/生活方式/UGC/爆炸图…）拿到 Prompt 骨架。',
        h('br'), h('b', null, 'ecom_style_lock'), ' — 建立 Campaign Style Lock：色板/冷暖调/字体/背景/光线/布局整套图锁死一致。',
        h('br'), h('b', null, 'ecom_generate_image'), ' — apiz CLI 生图，支持参考图（图生图保证产品外观），结果自动入历史。',
        h('br'), h('b', null, 'ecom_history'), ' — 查历史记录、Prompt、消耗积分、文件路径。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '多图一致性（核心）'),
      h('div', { style: styles.muted },
        '整套图的色板/冷暖调/字体/背景/光线/布局必须一致。流程：模型先 set 建 Style Lock → 每张图生成时传 campaign 参数自动注入锁 → 全部图片在画廊按 campaign 筛选。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '前置条件（Generate 模式）'),
      h('div', { style: styles.muted, lineHeight: 1.8 },
        '安装并登录 apiz CLI（apiz.ai）：',
        h('div', { style: styles.quote }, 'apiz auth login'),
        '不装也能用：模型照样输出 Prompt 包，你拿去即梦/Midjourney 手动生成。')))
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------
const TABS = [
  ['gallery', '画廊'],
  ['templates', '模板'],
  ['lock', 'Style Lock'],
  ['guide', '指南'],
]

function Panel() {
  const [tab, setTab] = useState('gallery')
  return h('div', { style: styles.wrap },
    h('div', { style: styles.tabBar },
      TABS.map(([id, label]) => h('button', {
        key: id, style: tab === id ? styles.tabActive : styles.tab,
        onClick: () => setTab(id),
      }, label))),
    tab === 'gallery' ? h(GalleryTab) : tab === 'templates' ? h(TemplatesTab) : tab === 'lock' ? h(LockTab) : h(GuideTab))
}

const styles = {
  wrap: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box', fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13, color: '#1a1a1a' },
  tabBar: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  tab: { padding: '8px 16px', border: '1px solid #d9d9de', borderRadius: 8, background: '#fff', color: '#1a1a1a', cursor: 'pointer', fontSize: 13 },
  tabActive: { padding: '8px 16px', border: '1px solid #8a5a00', borderRadius: 8, background: '#f5f0e8', color: '#5a3a00', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  chip: { padding: '4px 12px', border: '1px solid #d9d9de', borderRadius: 999, background: '#fff', cursor: 'pointer', fontSize: 12 },
  chipActive: { padding: '4px 12px', border: '1px solid #8a5a00', borderRadius: 999, background: '#f5f0e8', color: '#5a3a00', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  button: { padding: '6px 14px', border: 'none', borderRadius: 8, background: '#8a5a00', color: '#fff', cursor: 'pointer', fontSize: 13 },
  card: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, padding: 12, marginBottom: 10 },
  sectionTitle: { fontWeight: 700, marginBottom: 6 },
  stepList: { lineHeight: 1.9 },
  quote: { background: '#f5f0e8', borderRadius: 6, padding: '4px 10px', margin: '4px 0', color: '#5a3a00', fontFamily: 'Consolas, monospace' },
  muted: { color: '#8a8a92', lineHeight: 1.8 },
  mutedSmall: { color: '#a0a0a8', fontSize: 11 },
  error: { color: '#c0392b', padding: 12 },
  errorSmall: { color: '#c0392b', fontSize: 11, marginTop: 2 },

  // 画廊
  gallery: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 },
  gCard: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, overflow: 'hidden' },
  gThumbWrap: { position: 'relative', cursor: 'pointer', background: '#f2f2f4' },
  gThumb: { display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' },
  gEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8a92' },
  gStatus: { position: 'absolute', top: 6, left: 6, background: 'rgba(255,255,255,.9)', borderRadius: 6, padding: '1px 6px' },
  gCount: { position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11 },
  gMeta: { padding: '8px 10px' },
  gTitle: { fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  gLock: { color: '#8a5a00', fontSize: 11, marginTop: 2 },
  lightbox: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 },
  lightboxInner: { background: '#fff', borderRadius: 12, maxWidth: 'min(900px, 92vw)', maxHeight: '92vh', overflow: 'auto', padding: 16 },
  lbImages: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  lbImage: { maxWidth: '100%', maxHeight: '55vh', borderRadius: 8 },
  lbInfo: { marginTop: 10 },
  lbMeta: { color: '#8a8a92', fontSize: 12, marginBottom: 6 },
  lbPrompt: { background: '#f7f7f8', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto' },

  // 模板
  tplGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 },
  tplCard: { background: '#fff', borderRadius: 8, padding: '8px 10px', border: '1px solid #e3e3e6', cursor: 'pointer' },
  tplName: { fontWeight: 600, color: '#5a3a00' },
  tplKeywords: { color: '#a0a0a8', fontSize: 11, marginTop: 4 },
  keyword: { background: '#f5f0e8', color: '#5a3a00', borderRadius: 4, padding: '2px 6px', fontSize: 11 },
  code: { background: '#f7f7f8', borderRadius: 8, padding: 10, fontSize: 11.5, overflow: 'auto', maxHeight: 420, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },

  // Style Lock
  lockFields: { display: 'grid', gridTemplateColumns: '1fr', gap: 4, marginTop: 6 },
  lockField: { fontSize: 12, lineHeight: 1.6 },
  lockLabel: { display: 'inline-block', background: '#f5f0e8', color: '#5a3a00', borderRadius: 4, padding: '0 6px', marginRight: 6, fontSize: 11, fontWeight: 600 },
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
