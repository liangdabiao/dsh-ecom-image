// ============================================================================
// 电商视觉创作 · 浏览器半边面板
// 六个标签：指南 / 案例 / 模板 / 出图 / 画廊 / Style Lock。
// - 数据面：/ecom-image/api/{health,models,templates,template,case,history,stylelock}
// - 图片面：/ecom-image/api/image?file=（生成图）、/api/case-image?file=（案例图）
// - 所有「用这个出图」都只把指令填进新对话输入框，不直接扣积分：一次一张的验收闸门在 host 侧。
// ============================================================================
const h = require('react').createElement
const { useState, useEffect, useMemo } = require('react')

const PANEL_ID = 'ecom-image'
const BASE = 'ecom-image'
const USE_PROMPT = '使用‘电商视觉’插件 生成电商图片：'
const PREFS_KEY = 'ecom-image:prefs'

// 「马上使用」/「用这个模板出图」的开对话能力（apply 里注入）
let openInChat = null

function PanelIcon(props) {
  return h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', ...props },
    h('rect', { x: 2.5, y: 2.5, width: 19, height: 19, rx: 5, fill: '#8a5a00' }),
    h('rect', { x: 5.5, y: 5.5, width: 13, height: 13, rx: 2, fill: '#fff' }),
    h('circle', { cx: 10, cy: 10, r: 2, fill: '#ffd24a' }),
    h('path', { d: 'M6 17l4-5 3 3 4-4 2 2', stroke: '#e8734a', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
}

async function fetchJson(path, init) {
  const res = await fetch(BASE + path, init)
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

// ── 偏好（面板记住上次选的通道/模型/比例）────────────────────────────────
let prefsCache = null
function prefs() {
  if (prefsCache) return prefsCache
  try { prefsCache = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } catch { prefsCache = {} }
  return prefsCache
}
function savePrefs(patch) {
  prefsCache = { ...prefs(), ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefsCache)) } catch { /* 隐私模式忽略 */ }
}

// ── 通用小组件 ────────────────────────────────────────────────────────────
function Btn({ children, onClick, kind = 'primary', disabled, title, style }) {
  const base = kind === 'primary' ? styles.button : kind === 'ghost' ? styles.buttonGhost : styles.buttonSoft
  return h('button', {
    type: 'button', onClick, disabled, title: title || undefined,
    style: { ...base, ...(disabled ? styles.disabled : null), ...style },
  }, children)
}

function CopyButton({ text, label = '复制', style }) {
  const [done, setDone] = useState(false)
  const doCopy = async () => {
    const ok = await copyText(text || '')
    setDone(ok)
    setTimeout(() => setDone(false), 1500)
  }
  return h(Btn, { kind: 'ghost', onClick: doCopy, title: '复制到剪贴板', style }, done ? '✓ 已复制' : `📋 ${label}`)
}

function Section({ title, subtitle, children, right }) {
  return h('div', { style: styles.card },
    h('div', { style: styles.sectionHead },
      h('div', null,
        h('div', { style: styles.sectionTitle }, title),
        subtitle ? h('div', { style: styles.mutedSmall }, subtitle) : null),
      right || null),
    children)
}

function statusBadge(status) {
  const map = {
    completed: ['#1a7f37', '✓ 完成'],
    running: ['#b58a00', '⏳ 生成中'],
    failed: ['#c0392b', '✗ 失败'],
    ratio_mismatch: ['#c0392b', '✗ 比例不符'],
  }
  const [color, label] = map[status] || ['#8a8a92', status || '?']
  return h('span', { style: { color, fontSize: 11, fontWeight: 700 } }, label)
}

function reviewBadge(r) {
  if (r.reviewState === 'awaiting') return h('span', { style: styles.badgeWarn }, '⏳ 待验收')
  if (r.reviewState === 'approved') return h('span', { style: styles.badgeOk }, '✓ 已验收')
  if (r.reviewState === 'rejected') return h('span', { style: styles.badgeErr }, '✗ 已否决')
  return null
}

function Lightbox({ images, title, meta, body, onClose, actions }) {
  return h('div', { style: styles.lightbox, onClick: onClose },
    h('div', { style: styles.lightboxInner, onClick: (e) => e.stopPropagation() },
      images?.length ? h('div', { style: styles.lbImages }, images.map((src, i) => h('img', {
        key: i, src, style: styles.lbImage, alt: title || '',
      }))) : null,
      h('div', { style: styles.lbInfo },
        h('div', { style: styles.sectionTitle }, title || ''),
        meta ? h('div', { style: styles.lbMeta }, meta) : null,
        body || null),
      h('div', { style: styles.lbActions }, actions || null, h(Btn, { kind: 'ghost', onClick: onClose }, '关闭'))))
}

// 案例 / 模板 / 出图 的指令统一走这里：只填进对话，不发请求、不扣积分。
function fillChat(text) {
  if (!openInChat) {
    alert('开新对话能力未注入（面板版本不匹配），请重启 DSH 后重试。')
    return
  }
  openInChat(text)
}

async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* 降级 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

// ── 渠道数据 hook ─────────────────────────────────────────────────────────
function useModels() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const load = (force) => {
    setLoading(true); setError('')
    fetchJson(`/api/models${force ? '?force=1' : ''}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(false) }, [])
  return { data, error, loading, reload: load }
}

function channelLabel(key) {
  return key === 'dreamina' ? '即梦 Seedream' : key === 'apiz' ? 'apiz 多模型' : '自动'
}

// ──────────────────────────────────────────────────────────────────────────
// 指南
// ──────────────────────────────────────────────────────────────────────────
function GuideTab() {
  const { data, error, loading, reload } = useModels()
  const channels = data?.channels || []
  return h('div', null,
    h('div', { style: styles.ctaCard },
      h('div', { style: styles.ctaText },
        h('div', { style: styles.ctaTitle }, '想做一套电商图？'),
        h('div', { style: styles.muted },
          '点「马上使用」→ 开新对话，输入框已填好指令；补上产品与主图/场景图/A+ 需求后回车即可。')),
      h(Btn, { onClick: () => fillChat(USE_PROMPT), title: `填进对话：${USE_PROMPT}` }, '🚀 马上使用')),

    h(Section, {
      title: '生图通道（点 3：API 与模型可选）',
      subtitle: '即梦 Seedream 5.5 默认优先；apiz 覆盖 GPT Image 2.6/2.5、Nano Banana Pro、Seedream 5.0 Pro。',
      right: h(Btn, { kind: 'ghost', onClick: () => reload(true), disabled: loading }, loading ? '探测中…' : '🔄 重新探测'),
    },
      error ? h('div', { style: styles.error }, error) : null,
      !channels.length && !error ? h('div', { style: styles.muted }, '正在探测 dreamina-canvas / apiz CLI…') : null,
      channels.map((c) => h('div', { key: c.key, style: styles.channelRow },
        h('div', { style: { flex: 1, minWidth: 160 } },
          h('div', { style: styles.channelName },
            c.ready ? (c.authOk ? '🟢' : '🟠') : '🔴', ' ', c.label,
            h('span', { style: styles.mutedSmall }, c.ready ? `  v${c.version}` : `  ${c.error ? '' : '未安装'}`)),
          c.ready && !c.authOk
            ? h('div', { style: styles.mutedSmall }, `未登录：运行 ${c.login}${c.accountError ? `（${c.accountError.slice(0, 80)}）` : ''}`)
            : c.ready
              ? h('div', { style: styles.mutedSmall },
                `默认 ${c.defaultModel} · ${c.models.length} 个模型 · 参考图 ≤${c.maxRefs}`,
                c.account ? ` · 余额 ${c.key === 'dreamina' ? c.account.credits + ' 积分' : c.account.balance + ' 积分'}` : '')
              : h('div', { style: styles.mutedSmall }, `装好后运行 ${c.login}`)),
        h(Btn, { kind: 'ghost', onClick: () => fillChat(`${USE_PROMPT}\n用 ${c.label}（${c.defaultModel}）出一张产品主图，产品：`) }, '用这个通道'))),
      h('div', { style: { ...styles.mutedSmall, marginTop: 6 } },
        '不装任何 CLI 也能用：模型照样输出完整 Prompt 包，拿去即梦网页 / Midjourney 手动生成。')),

    h(Section, { title: '三种典型用法（点击直接填进对话）' },
      h('div', { style: styles.stepList },
        h('div', { style: styles.quoteClick, onClick: () => fillChat(`${USE_PROMPT}做一款保温杯的电商主图，1:1，白底 #FFFFFF，产品占 38%。先给 Prompt 再出图，出完给我 6 项自检。`) }, '「帮我做一款保温杯的电商主图」'),
        h('div', { style: styles.quoteClick, onClick: () => fillChat(`${USE_PROMPT}生成一套 5 主图 + 7 详情图的完整图片包，先建 Campaign Style Lock 再一张一张出，每张都验收。`) }, '「生成一套 5 主图 + 7 详情图的完整图片包」'),
        h('div', { style: styles.quoteClick, onClick: () => fillChat(`${USE_PROMPT}用这张实拍图做白底主图，参考图路径：`) }, '「用这张实拍图做白底图」'),
        h('div', { style: styles.mutedSmall }, '模型会匹配 25 个场景模板构建 Prompt；明确要出图时调 ecom_generate_image（一次一张，出完必须验收）。'))),

    h(Section, { title: '六个工具' },
      h('div', { style: { ...styles.muted, lineHeight: 2 } },
        h('b', null, 'ecom_models'), ' — 看通道/模型/余额，选 API。',
        h('br'), h('b', null, 'ecom_template'), ' — 查 25 个场景模板（带实测案例图）拿 Prompt 骨架。',
        h('br'), h('b', null, 'ecom_style_lock'), ' — 建立 Campaign Style Lock，整套图色板/光线/字体锁死。',
        h('br'), h('b', null, 'ecom_generate_image'), ' — 即梦 / apiz 双通道生图，支持参考图，结果自动入历史。',
        h('br'), h('b', null, 'ecom_review_image'), ' — 验收闸门：approve 要 6 项自检全过。',
        h('br'), h('b', null, 'ecom_history'), ' — 查历史：通道/模型/Prompt/积分/文件/验收状态。')),

    h(Section, {
      title: '一次一张（强制）',
      subtitle: '防批量烧积分：不验收就出不了下一张。',
    },
      h('div', { style: { ...styles.muted, lineHeight: 1.9 } },
        '1. 出图 → 2. 模型把图 + 6 项自检发你 → 3. 你表态 → 4. ecom_review_image 记录 → 5. 才允许下一张。',
        h('div', { style: { ...styles.mutedSmall, marginTop: 4 } },
          '6 项自检：产品一致性 / 物理落地 / 透视一致 / 占比与留白 / 色彩同色系 / 无多余文字标注。'))),

    h(Section, { title: '数据与前置条件' },
      h('div', { style: { ...styles.muted, lineHeight: 1.9 } },
        '历史与图片存在 $DSH_HOME/ecom-image/（history.json / images/ / stylelock.json）。',
        h('br'), '即梦：装 dreamina-canvas 后 ', h('code', { style: styles.codeInline }, 'dreamina-canvas auth login'), '；2K 约 6 积分/张，国内版带「AI生成」水印。',
        h('br'), 'apiz：装 apiz CLI 后 ', h('code', { style: styles.codeInline }, 'apiz auth login'), '；', h('code', { style: styles.codeInline }, 'apiz account balance'), ' 查余额。')))
}

// ──────────────────────────────────────────────────────────────────────────
// 案例（skill 里 docs/case 的实测出图 + 对应 Prompt）
// ──────────────────────────────────────────────────────────────────────────
function CaseTab() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    fetchJson('/api/case').then(setData).catch((e) => setError(e.message))
  }, [])
  if (error) return h('div', { style: styles.error }, error)
  if (!data) return h('div', { style: styles.muted }, '加载中…')

  const groups = data.groups || []
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (!total) return h('div', { style: styles.muted }, '没有找到案例图（技能快照里没有 docs/case）。')

  const imgUrl = (rel) => `${BASE}/api/case-image?file=${encodeURIComponent(rel)}`

  return h('div', null,
    h(Section, {
      title: `实测案例 · ${total} 张`,
      subtitle: '上游 skill 用即梦 Seedream 5.5 实跑出来的图，每张都配当时的 Prompt。先看效果，再照抄。',
    },
      h('div', { style: styles.mutedSmall },
        '点击任意图看大图 + Prompt，可直接复制或把「换成我的产品」一键填进对话。')),

    groups.map((g) => h(Section, { key: g.id, title: g.title, subtitle: g.subtitle },
      h('div', { style: styles.caseGrid },
        g.items.map((it) => h('div', {
          key: it.id, style: styles.caseCard, onClick: () => setDetail(it),
          title: it.note || it.label,
        },
          h('div', { style: styles.caseThumbWrap },
            h('img', { src: imgUrl(it.image), style: styles.caseThumb, loading: 'lazy', alt: it.label }),
            it.mark ? h('div', { style: styles.caseMark }, it.mark) : null),
          h('div', { style: styles.caseMeta },
            h('div', { style: styles.caseLabel }, it.label),
            it.note ? h('div', { style: styles.mutedSmall }, it.note) : null)))))),

    detail ? h(Lightbox, {
      images: [imgUrl(detail.image)],
      title: detail.label,
      meta: detail.note || '',
      onClose: () => setDetail(null),
      body: h('div', null,
        h('div', { style: { ...styles.mutedSmall, marginBottom: 4 } }, '当时用的 Prompt：'),
        h('pre', { style: styles.code }, detail.prompt?.text || '（没有找到对应 Prompt 文件）')),
      actions: [
        h(CopyButton, { key: 'copy', text: detail.prompt?.text || '', label: '复制 Prompt' }),
        h(Btn, {
          key: 'use',
          onClick: () => {
            fillChat(`${USE_PROMPT}\n照这个实测案例出图，产品换成我的：\n\n${detail.prompt?.text || detail.label}\n\n先确认比例/参考图，再 ecom_generate_image 出 1 张（即梦优先），出来给我 6 项自检。`)
            setDetail(null)
          },
        }, '用这个 Prompt 出图'),
      ],
    }) : null)
}

// ──────────────────────────────────────────────────────────────────────────
// 模板（25 个场景 + 实测案例图 + Prompt 骨架）
// ──────────────────────────────────────────────────────────────────────────
function promptSkeleton(tpl) {
  const pt = tpl.prompt_template || {}
  const lines = []
  for (const [key, value] of Object.entries(pt)) {
    if (value === undefined || value === null || value === '') continue
    lines.push(`${key}: ${value}`)
  }
  if (tpl.defaults && Object.keys(tpl.defaults).length) {
    lines.push('', 'defaults:')
    for (const [k, v] of Object.entries(tpl.defaults)) lines.push(`  ${k}: ${v}`)
  }
  return lines.join('\n')
}

function TemplateDetail({ id, fallback, onBack }) {
  const [full, setFull] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [variant, setVariant] = useState('')
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    setFull(null)
    fetchJson(`/api/template?id=${encodeURIComponent(id)}`).then((d) => setFull(d.template)).catch((e) => setLoadError(e.message))
  }, [id])
  const tpl = full || fallback
  if (!tpl) return h('div', { style: styles.muted }, '加载中…')
  const variants = Object.keys(tpl.variants || {})
  const active = variant ? tpl.variants[variant] : null
  const skeleton = promptSkeleton(tpl)
  const imgUrl = tpl.caseImage ? `${BASE}/api/case-image?file=${encodeURIComponent(tpl.caseImage)}` : ''

  return h('div', null,
    h('div', { style: styles.row },
      h(Btn, { kind: 'ghost', onClick: onBack }, '← 返回模板列表'),
      h('div', { style: styles.tplName }, tpl.name),
      h('span', { style: styles.mutedSmall }, tpl.id),
      !full && !loadError ? h('span', { style: styles.mutedSmall }, '加载详情…') : null,
      loadError ? h('span', { style: styles.errorSmall }, `详情加载失败：${loadError}`) : null),
    tpl.description ? h('div', { style: { ...styles.muted, marginBottom: 8 } }, tpl.description) : null,
    tpl.keywords?.length ? h('div', { style: styles.row }, tpl.keywords.map((k) => h('span', { key: k, style: styles.keyword }, k))) : null,

    imgUrl
      ? h('div', { style: styles.caseWide, onClick: () => setZoom(true), title: '看大图' },
        h('img', { src: imgUrl, style: styles.caseWideImg, alt: tpl.name }),
        h('div', { style: styles.caseMark }, '📷 实测'))
      : h('div', { style: styles.caseEmpty }, '这个场景暂无实测案例图 —— 先用模板 Prompt 出一张，案例区会自动由你的历史补充。'),

    h('div', { style: { ...styles.row, marginTop: 8 } },
      h(CopyButton, { text: skeleton, label: '复制 Prompt 骨架' }),
      h(CopyButton, { text: JSON.stringify(tpl, null, 2), label: '复制模板 JSON' }),
      h(Btn, {
        onClick: () => fillChat(`${USE_PROMPT}模板 ${tpl.name}（id=${tpl.id}）${variant ? `，风格变体 ${variant}` : ''}，产品：\n先 ecom_template get 拿 prompt_template/variants/category_tips 组装 Prompt（hex 色板/占比/留白/否定清单都要写死），再 ecom_generate_image 出 1 张（即梦优先），出来给我 6 项自检。`),
      }, '用这个模板出图')),

    variants.length ? h(Section, { title: '风格变体', subtitle: '点一个看覆盖字段；出图时把变体名一起告诉模型。' },
      h('div', { style: styles.row },
        h('button', { style: !variant ? styles.chipActive : styles.chip, onClick: () => setVariant('') }, '默认'),
        variants.map((v) => h('button', {
          key: v, style: variant === v ? styles.chipActive : styles.chip, onClick: () => setVariant(v),
        }, v))),
      active ? h('div', null,
        active.description ? h('div', { style: styles.mutedSmall }, active.description) : null,
        h('pre', { style: styles.code }, JSON.stringify(active.overrides || {}, null, 2))) : null) : null,

    h(Section, { title: '发布 Prompt 骨架' },
      h('pre', { style: styles.code }, skeleton)),

    tpl.category_tips && Object.keys(tpl.category_tips).length ? h(Section, { title: '品类建议' },
      h('div', { style: styles.tipList }, Object.entries(tpl.category_tips).map(([cat, tip]) => h('div', { key: cat, style: styles.tipRow },
        h('span', { style: styles.keyword }, cat), h('span', null, tip))))) : null,

    tpl.anti_ai_tips ? h(Section, { title: 'Anti-AI 真实感技巧（UGC/直播/社媒必看）' },
      h('div', { style: styles.muted }, tpl.anti_ai_tips)) : null,

    tpl.examples?.length ? h(Section, { title: '示例 Prompt（可直接改产品名）' },
      tpl.examples.map((ex, i) => h('div', { key: i, style: styles.exampleRow },
        h('div', { style: styles.exampleText }, ex),
        h(CopyButton, { text: ex, label: `${i + 1}`, style: { flex: '0 0 auto' } })))) : null,

    zoom && imgUrl ? h(Lightbox, {
      images: [imgUrl], title: tpl.name, meta: '实测案例图', onClose: () => setZoom(false),
      actions: h(Btn, { onClick: () => fillChat(`${USE_PROMPT}模板 ${tpl.name}（id=${tpl.id}），产品：`) }, '照这个场景出图'),
    }) : null)
}

function TemplateCard({ tpl, onOpen }) {
  const thumb = tpl.caseImage
    ? h('div', { style: styles.tplThumbWrap },
      h('img', { src: `${BASE}/api/case-image?file=${encodeURIComponent(tpl.caseImage)}`, style: styles.tplThumb, loading: 'lazy', alt: tpl.name }))
    : h('div', { style: { ...styles.tplThumb, ...styles.tplThumbEmpty } }, tpl.name)
  return h('div', {
    style: styles.tplCard, onClick: onOpen,
    title: tpl.caseImage ? '点击看案例图 + Prompt 骨架' : '点击看 Prompt 骨架',
  },
    thumb,
    h('div', { style: styles.tplCardBody },
      h('div', { style: styles.tplName }, tpl.name),
      h('div', { style: styles.mutedSmall }, tpl.description || tpl.id),
      tpl.keywords?.length ? h('div', { style: styles.tplKeywords }, tpl.keywords.slice(0, 4).join(' · ')) : null))
}

function TemplatesTab() {
  const [templates, setTemplates] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [keyword, setKeyword] = useState('')
  useEffect(() => {
    fetchJson('/api/templates').then((d) => setTemplates(d.templates)).catch((e) => setError(e.message))
  }, [])
  if (error) return h('div', { style: styles.error }, error)
  if (selected) return h(TemplateDetail, { id: selected.id, fallback: selected, onBack: () => setSelected(null) })
  if (templates === null) return h('div', { style: styles.muted }, '加载中…')

  const kw = keyword.trim().toLowerCase()
  const filtered = kw
    ? templates.filter((t) => [t.id, t.name, t.description, ...(t.keywords || [])].join(' ').toLowerCase().includes(kw))
    : templates
  const withCase = templates.filter((t) => t.caseImage).length

  return h('div', null,
    h('div', { style: styles.row },
      h('input', {
        style: styles.input, placeholder: `搜索模板（${templates.length} 个，${withCase} 个有实测图）`,
        value: keyword, onChange: (e) => setKeyword(e.target.value),
      })),
    filtered.length === 0 ? h('div', { style: styles.muted }, '没有匹配的模板。') : null,
    h('div', { style: styles.tplGrid },
      filtered.map((t) => h(TemplateCard, { key: t.id, tpl: t, onOpen: () => setSelected(t) }))))
}


// ──────────────────────────────────────────────────────────────────────────
// 出图：通道 + 模型 + 比例 + 参考图 → 生成指令 → 填进对话
// ──────────────────────────────────────────────────────────────────────────
function GenerateTab() {
  const { data, error, loading, reload } = useModels()
  const [templates, setTemplates] = useState([])
  const p = prefs()
  const [channel, setChannel] = useState(p.channel || 'auto')
  const [model, setModel] = useState(p.model || '')
  const [resolution, setResolution] = useState(p.resolution || '2K')
  const [ratio, setRatio] = useState(p.ratio || '1:1')
  const [templateId, setTemplateId] = useState(p.templateId || '')
  const [variant, setVariant] = useState(p.variant || '')
  const [product, setProduct] = useState(p.product || '')
  const [refImage, setRefImage] = useState('')
  const [copyLine, setCopyLine] = useState('')

  useEffect(() => { fetchJson('/api/templates').then((d) => setTemplates(d.templates || [])).catch(() => {}) }, [])
  useEffect(() => { savePrefs({ channel, model, resolution, ratio, templateId, variant, product }) }, [channel, model, resolution, ratio, templateId, variant, product])

  const channels = data?.channels || []
  const effective = channel === 'auto'
    ? (channels.find((c) => c.ready && c.authOk && c.key === 'dreamina')
      || channels.find((c) => c.ready && c.authOk)
      || channels.find((c) => c.ready)
      || channels[0])
    : channels.find((c) => c.key === channel)
  const models = effective?.models || []
  const selectedModel = models.find((m) => m.id === model) || models.find((m) => m.isDefault) || models[0]
  const ratios = selectedModel?.ratios || effective?.ratios || ['1:1']
  const resolutions = selectedModel?.resolutions || effective?.resolutions || []
  const tpl = templates.find((t) => t.id === templateId)

  // 通道切换时把不适配的模型/比例纠正掉
  useEffect(() => {
    if (!effective) return
    if (model && !models.some((m) => m.id === model)) setModel('')
    if (!ratios.includes(ratio)) setRatio(ratios.includes('1:1') ? '1:1' : ratios[0])
    if (resolutions.length && !resolutions.includes(resolution)) setResolution(resolutions[0])
  }, [channel, models.length, effective?.key])

  const instruction = [
    USE_PROMPT,
    product ? `- 产品：${product}` : '- 产品：（请补充产品与卖点）',
    tpl ? `- 模板：${tpl.name}（id=${tpl.id}）${variant ? `｜风格变体：${variant}` : ''}` : '- 模板：由你按产品匹配（先 ecom_template search）',
    `- 通道：${channel === 'auto' ? `auto（当前会走 ${channelLabel(effective?.key)}）` : channelLabel(channel)}${selectedModel ? `｜模型：${selectedModel.id}` : ''}${resolution && effective?.key === 'dreamina' ? `｜分辨率：${resolution}` : ''}`,
    `- 比例：${ratio}${ratio === '4:5' || ratio === '5:4' ? '（即梦不支持时会自动换算）' : ''}`,
    refImage ? `- 参考图（锁产品外观）：${refImage}` : '- 参考图：无（纯文生图；要保产品一致性请补本地图绝对路径）',
    copyLine ? `- 图片内文案：${copyLine}` : '',
    '',
    '流程：先按模板组装 Prompt（Campaign Style Lock + hex 色板 + 产品占比 + 留白 + 否定清单），把最终 Prompt 给我看；确认后一次只出一张，出完立刻给我图 + 6 项自检，等我表态再用 ecom_review_image 记录。',
  ].filter((line) => line !== '').join('\n')

  return h('div', null,
    h(Section, {
      title: '出图配置',
      subtitle: '只是帮你把指令写清楚：点「填进对话」后在对话里执行，仍然一次一张 + 验收。',
      right: h(Btn, { kind: 'ghost', onClick: () => reload(true), disabled: loading }, loading ? '探测中…' : '🔄'),
    },
      error ? h('div', { style: styles.error }, error) : null,
      h('div', { style: styles.formGrid },
        h('label', { style: styles.field },
          h('span', { style: styles.label }, '生图通道'),
          h('select', { style: styles.input, value: channel, onChange: (e) => setChannel(e.target.value) },
            h('option', { value: 'auto' }, 'auto（即梦优先，回落 apiz）'),
            channels.map((c) => h('option', {
              key: c.key, value: c.key, disabled: !c.ready || !c.authOk,
            }, `${c.label}${c.ready ? (c.authOk ? '' : '（未登录）') : '（不可用）'}`)))),
        h('label', { style: styles.field },
          h('span', { style: styles.label }, '模型'),
          h('select', { style: styles.input, value: selectedModel?.id || '', onChange: (e) => setModel(e.target.value) },
            models.length
              ? models.map((m) => h('option', { key: m.id, value: m.id }, `${m.label}${m.isDefault ? '（默认）' : ''}${m.vipRequired ? ' · VIP' : ''}`))
              : h('option', { value: '' }, '通道不可用'))),
        h('label', { style: styles.field },
          h('span', { style: styles.label }, '比例'),
          h('select', { style: styles.input, value: ratio, onChange: (e) => setRatio(e.target.value) },
            ratios.map((r) => h('option', { key: r, value: r }, r)))),
        resolutions.length ? h('label', { style: styles.field },
          h('span', { style: styles.label }, '分辨率（即梦）'),
          h('select', { style: styles.input, value: resolution, onChange: (e) => setResolution(e.target.value) },
            resolutions.map((r) => h('option', { key: r, value: r }, r)))) : null,
        h('label', { style: styles.field },
          h('span', { style: styles.label }, '模板（可留空让模型匹配）'),
          h('select', { style: styles.input, value: templateId, onChange: (e) => setTemplateId(e.target.value) },
            h('option', { value: '' }, '自动匹配'),
            templates.map((t) => h('option', { key: t.id, value: t.id }, `${t.name}（${t.id}）`)))),
        tpl ? h('label', { style: styles.field },
          h('span', { style: styles.label }, '风格变体'),
          h('select', { style: styles.input, value: variant, onChange: (e) => setVariant(e.target.value) },
            h('option', { value: '' }, '默认'),
            Object.keys(tpl.variants || {}).map((v) => h('option', { key: v, value: v }, v)))) : null),
      h('label', { style: { ...styles.field, marginTop: 6 } },
        h('span', { style: styles.label }, '产品（名称/材质/卖点）'),
        h('input', {
          style: styles.input, placeholder: '如：陶瓷手冲滤杯，哑光白釉 + 橡木圈，适合手冲新手',
          value: product, onChange: (e) => setProduct(e.target.value),
        })),
      h('label', { style: { ...styles.field, marginTop: 6 } },
        h('span', { style: styles.label }, '参考图（本地绝对路径 / 公网 URL，留空=文生图）'),
        h('input', {
          style: styles.input, placeholder: '如 D:\\photos\\product.jpg（即梦 ≤10 张，apiz ≤16 张）',
          value: refImage, onChange: (e) => setRefImage(e.target.value),
        })),
      h('label', { style: { ...styles.field, marginTop: 6 } },
        h('span', { style: styles.label }, '图片内文案（可选，短句用「」包裹）'),
        h('input', {
          style: styles.input, placeholder: '如 「上新 8 折」/「一键出图」',
          value: copyLine, onChange: (e) => setCopyLine(e.target.value),
        })),

      h('div', { style: { ...styles.mutedSmall, marginTop: 8 } },
        selectedModel ? `当前：${channelLabel(effective?.key)}｜${selectedModel.id}｜参考图上限 ${selectedModel.maxRefs} 张｜比例 ${ratios.join(' / ')}` : '通道不可用时仍可只产出 Prompt。')),

    h(Section, { title: '指令预览', subtitle: '确认无误后复制或直接填进新对话。' },
      h('pre', { style: styles.code }, instruction),
      h('div', { style: styles.row },
        h(CopyButton, { text: instruction, label: '复制指令' }),
        h(Btn, { onClick: () => fillChat(instruction) }, '🚀 填进对话出图'),
        h(Btn, { kind: 'ghost', onClick: () => fillChat(USE_PROMPT) }, '只开空白出图对话'))))
}

// ──────────────────────────────────────────────────────────────────────────
// 画廊：生图历史 + 大图预览
// ──────────────────────────────────────────────────────────────────────────
function GalleryTab() {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  const [campaign, setCampaign] = useState('')
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    fetchJson('/api/history').then((d) => setHistory(d.history)).catch((e) => setError(e.message))
  }, [])

  const campaigns = useMemo(() => [...new Set((history || []).map((r) => r.campaign).filter(Boolean))], [history])
  const filtered = (history || []).filter((r) => !campaign || r.campaign === campaign)

  if (error) return h('div', { style: styles.error }, error)
  if (history === null) return h('div', { style: styles.muted }, '加载中…')
  if (!history.length) {
    return h('div', { style: styles.muted },
      '还没有生成记录。在对话里说「帮我生成一张保温杯的白底主图」，出图后这里会自动展示。')
  }

  const imgUrl = (file) => `${BASE}/api/image?file=${encodeURIComponent(file)}`

  return h('div', null,
    h('div', { style: styles.row },
      h('span', { style: styles.filterLabel }, 'Campaign 筛选'),
      h('button', {
        style: campaign === '' ? styles.chipActive : styles.chip,
        onClick: () => setCampaign(''), title: '显示全部生成记录',
      }, `全部 ${history.length}`),
      campaigns.map((c) => h('button', {
        key: c, style: campaign === c ? styles.chipActive : styles.chip,
        onClick: () => setCampaign(c), title: `只看 Campaign「${c}」的整组图`,
      }, `🔒 ${c}`))),

    h('div', { style: styles.gallery },
      filtered.map((r) => h('div', { key: r.id, style: styles.gCard },
        h('div', { style: styles.gThumbWrap, onClick: () => r.files?.length && setPreview(r) },
          r.files?.length
            ? h('img', { src: imgUrl(r.files[0].file), style: styles.gThumb, loading: 'lazy', alt: r.title || '' })
            : h('div', { style: { ...styles.gThumb, ...styles.gEmpty } }, r.status === 'failed' ? '✗ 失败' : '⏳ 生成中'),
          h('div', { style: styles.gStatus }, statusBadge(r.status)),
          r.files?.length > 1 ? h('div', { style: styles.gCount }, `${r.files.length} 张`) : null),
        h('div', { style: styles.gMeta },
          h('div', { style: styles.gTitle }, r.title || String(r.prompt || '').slice(0, 42)),
          h('div', { style: styles.mutedSmall },
            `${fmtTime(r.ts)} · ${r.channelLabel || r.channel || '-'} · ${r.aspectRatio || '-'}`),
          h('div', { style: styles.mutedSmall }, `${r.model || '-'}${r.price != null ? ` · ${r.price} 积分` : ''}`),
          h('div', { style: { ...styles.row, marginTop: 4 } }, reviewBadge(r), r.campaign ? h('span', { style: styles.gLock }, `🔒 ${r.campaign}`) : null),
          r.status === 'failed' && r.error ? h('div', { style: styles.errorSmall }, String(r.error).slice(0, 80)) : null)))),

    preview ? h(Lightbox, {
      images: (preview.files || []).map((f) => imgUrl(f.file)),
      title: preview.title || '生成记录',
      meta: `${fmtTime(preview.ts)} · ${preview.channelLabel || preview.channel || '-'} · ${preview.model} · ${preview.aspectRatio}${preview.price != null ? ` · ${preview.price} 积分` : ''}${preview.campaign ? ` · 🔒 ${preview.campaign}` : ''}`,
      onClose: () => setPreview(null),
      body: h('div', null,
        h('div', { style: { ...styles.mutedSmall, marginBottom: 4 } }, 'Prompt：'),
        h('div', { style: styles.lbPrompt }, preview.prompt),
        preview.review?.notes ? h('div', { style: { ...styles.mutedSmall, marginTop: 6 } }, `验收备注：${preview.review.notes}`) : null),
      actions: h(Btn, {
        onClick: () => {
          fillChat(`${USE_PROMPT}\n复用这条 Prompt 再出一张（可改产品/文案），先给我 Prompt，再 ecom_generate_image：\n\n${preview.prompt}`)
          setPreview(null)
        },
      }, '复用这条 Prompt'),
    }) : null)
}

// ──────────────────────────────────────────────────────────────────────────
// Style Lock
// ──────────────────────────────────────────────────────────────────────────
const LOCK_FIELDS = { palette: '色板', tone: '冷暖调', font: '字体', background: '背景', lighting: '光线', layout: '布局', icons: '图标', notes: '备注' }

function lockText(lock) {
  const parts = []
  for (const [field, label] of Object.entries(LOCK_FIELDS)) if (lock[field]) parts.push(`${label}: ${lock[field]}`)
  return parts.length ? `Campaign Style Lock（整套图必须保持一致）—— ${parts.join('；')}` : ''
}

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
    return h('div', null,
      h('div', { style: styles.muted },
        '还没有 Style Lock。多图任务时，模型会用 ecom_style_lock 工具建立锁（色板/冷暖调/字体/背景/光线/布局/图标风格），确保整套图风格一致。'),
      h('div', { style: { ...styles.row, marginTop: 10 } },
        h(Btn, {
          onClick: () => fillChat(`${USE_PROMPT}先建一个 Campaign Style Lock（暖米白 #F7F4EF + 深炭 #2D2D2D + 木色 #B08350 + 灰绿 #8A9B8E，中性暖光，细线图标），再做一套 5 主图 + 7 详情图。产品：`),
        }, '🚀 建锁并出一套图')))
  }

  return h('div', null,
    names.map((name) => {
      const lock = locks[name]
      const rendered = lockText(lock)
      return h('div', { key: name, style: styles.card },
        h('div', { style: styles.sectionHead },
          h('div', null,
            h('div', { style: styles.sectionTitle }, `🔒 ${name}`),
            h('div', { style: styles.mutedSmall }, `更新于 ${fmtTime(lock.updatedAt)}`)),
          h('div', { style: styles.row },
            h(CopyButton, { text: rendered, label: '锁文本' }),
            h(Btn, {
              onClick: () => fillChat(`${USE_PROMPT}用 Style Lock「${name}」出一张图，产品：`),
            }, '用这个锁出图'))),
        h('div', { style: styles.lockFields },
          Object.entries(LOCK_FIELDS).map(([field, label]) => lock[field]
            ? h('div', { key: field, style: styles.lockField },
              h('span', { style: styles.lockLabel }, label), lock[field])
            : null)))
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// 主面板
// ──────────────────────────────────────────────────────────────────────────
const TABS = [
  ['guide', '指南'],
  ['case', '案例'],
  ['templates', '模板'],
  ['generate', '出图'],
  ['gallery', '画廊'],
  ['lock', 'Style Lock'],
]

function Panel() {
  const [tab, setTab] = useState('guide')
  return h('div', { style: styles.wrap },
    h('div', { style: styles.tabBar },
      TABS.map(([id, label]) => h('button', {
        key: id, style: tab === id ? styles.tabActive : styles.tab,
        onClick: () => setTab(id),
      }, label))),
    tab === 'guide' ? h(GuideTab)
      : tab === 'case' ? h(CaseTab)
        : tab === 'templates' ? h(TemplatesTab)
          : tab === 'generate' ? h(GenerateTab)
            : tab === 'gallery' ? h(GalleryTab)
              : h(LockTab))
}

const styles = {
  wrap: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box', fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13, color: '#1a1a1a' },
  tabBar: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  tab: { padding: '8px 14px', border: '1px solid #d9d9de', borderRadius: 8, background: '#fff', color: '#1a1a1a', cursor: 'pointer', fontSize: 13 },
  tabActive: { padding: '8px 14px', border: '1px solid #8a5a00', borderRadius: 8, background: '#f5f0e8', color: '#5a3a00', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  ctaCard: { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', background: '#faf6ef', border: '1px solid #ecdfc7', borderRadius: 10, padding: '12px 14px', marginBottom: 12 },
  ctaText: { flex: 1, minWidth: 200 },
  ctaTitle: { fontWeight: 700, color: '#5a3a00', marginBottom: 4 },
  button: { padding: '7px 14px', border: 'none', borderRadius: 8, background: '#8a5a00', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  buttonSoft: { padding: '7px 14px', border: '1px solid #ecdfc7', borderRadius: 8, background: '#faf6ef', color: '#5a3a00', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  buttonGhost: { padding: '6px 12px', border: '1px solid #d9d9de', borderRadius: 8, background: '#fff', color: '#333', cursor: 'pointer', fontSize: 12 },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  chip: { padding: '4px 12px', border: '1px solid #d9d9de', borderRadius: 999, background: '#fff', color: '#1a1a1a', cursor: 'pointer', fontSize: 12, lineHeight: 1.6 },
  chipActive: { padding: '4px 12px', border: '1px solid #8a5a00', borderRadius: 999, background: '#f5f0e8', color: '#5a3a00', cursor: 'pointer', fontSize: 12, fontWeight: 600, lineHeight: 1.6 },
  filterLabel: { fontSize: 11, color: '#6b6b73', fontWeight: 600 },
  card: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, padding: 12, marginBottom: 10 },
  sectionHead: { display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontWeight: 700, marginBottom: 2 },
  stepList: { lineHeight: 1.9 },
  quote: { background: '#f5f0e8', borderRadius: 6, padding: '4px 10px', margin: '4px 0', color: '#5a3a00', fontFamily: 'Consolas, monospace' },
  quoteClick: { background: '#f5f0e8', borderRadius: 6, padding: '4px 10px', margin: '4px 0', color: '#5a3a00', fontFamily: 'Consolas, monospace', cursor: 'pointer' },
  muted: { color: '#8a8a92', lineHeight: 1.8 },
  mutedSmall: { color: '#a0a0a8', fontSize: 11, lineHeight: 1.6 },
  error: { color: '#c0392b', padding: 12 },
  errorSmall: { color: '#c0392b', fontSize: 11, marginTop: 2 },
  badgeOk: { color: '#1a7f37', background: '#e8f5ec', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 700 },
  badgeWarn: { color: '#8a6d00', background: '#fff6d6', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 700 },
  badgeErr: { color: '#c0392b', background: '#fdeaea', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 700 },

  // 渠道
  channelRow: { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px solid #efeff2', borderRadius: 8, marginBottom: 8, background: '#fcfcfd' },
  channelName: { fontWeight: 600, fontSize: 13 },

  // 表单
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 },
  label: { fontSize: 11, color: '#6b6b73', fontWeight: 600 },
  input: { padding: '7px 9px', border: '1px solid #d9d9de', borderRadius: 8, background: '#fff', fontSize: 12, width: '100%', boxSizing: 'border-box', color: '#1a1a1a' },
  code: { background: '#f7f7f8', borderRadius: 8, padding: 10, fontSize: 11.5, overflow: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Consolas, monospace' },
  codeInline: { background: '#f5f0e8', borderRadius: 4, padding: '1px 5px', fontFamily: 'Consolas, monospace', fontSize: 11.5 },

  // 案例
  caseGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 },
  caseCard: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, overflow: 'hidden', cursor: 'pointer' },
  caseThumbWrap: { position: 'relative', background: '#f2f2f4' },
  caseThumb: { display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' },
  caseMark: { position: 'absolute', top: 6, right: 6, background: 'rgba(255,255,255,.92)', borderRadius: 6, padding: '0 6px', fontSize: 11 },
  caseMeta: { padding: '6px 8px' },
  caseLabel: { fontWeight: 600, fontSize: 12, marginBottom: 2 },
  caseWide: { position: 'relative', borderRadius: 10, overflow: 'hidden', cursor: 'zoom-in', background: '#f2f2f4' },
  caseWideImg: { display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover' },
  caseEmpty: { border: '1px dashed #d9d9de', borderRadius: 10, padding: 14, color: '#a0a0a8', fontSize: 12, textAlign: 'center' },

  // 模板
  tplGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 },
  tplCard: { background: '#fff', borderRadius: 10, border: '1px solid #e3e3e6', cursor: 'pointer', overflow: 'hidden' },
  tplThumbWrap: { background: '#f2f2f4' },
  tplThumb: { display: 'block', width: '100%', aspectRatio: '16 / 10', objectFit: 'cover' },
  tplThumbEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b0b0b8', fontSize: 12, background: '#f7f7f8', aspectRatio: '16 / 10' },
  tplCardBody: { padding: '6px 8px' },
  tplName: { fontWeight: 600, color: '#5a3a00' },
  tplKeywords: { color: '#a0a0a8', fontSize: 11, marginTop: 4 },
  keyword: { background: '#f5f0e8', color: '#5a3a00', borderRadius: 4, padding: '1px 6px', fontSize: 11, marginRight: 6 },
  tipList: { display: 'grid', gap: 4 },
  tipRow: { fontSize: 12, lineHeight: 1.7, display: 'flex', gap: 6, alignItems: 'flex-start' },
  exampleRow: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px dashed #efeff2' },
  exampleText: { flex: 1, fontSize: 12, lineHeight: 1.7, color: '#333', wordBreak: 'break-word' },

  // 画廊
  gallery: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 },
  gCard: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, overflow: 'hidden' },
  gThumbWrap: { position: 'relative', cursor: 'pointer', background: '#f2f2f4' },
  gThumb: { display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' },
  gEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8a92' },
  gStatus: { position: 'absolute', top: 6, left: 6, background: 'rgba(255,255,255,.9)', borderRadius: 6, padding: '1px 6px' },
  gCount: { position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11 },
  gMeta: { padding: '6px 8px' },
  gTitle: { fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 },
  gLock: { color: '#8a5a00', fontSize: 11 },
  lightbox: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 },
  lightboxInner: { background: '#fff', borderRadius: 12, maxWidth: 'min(960px, 94vw)', maxHeight: '92vh', overflow: 'auto', padding: 16 },
  lbImages: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  lbImage: { maxWidth: '100%', maxHeight: '58vh', borderRadius: 8 },
  lbInfo: { marginTop: 10 },
  lbMeta: { color: '#8a8a92', fontSize: 12, marginBottom: 6 },
  lbPrompt: { background: '#f7f7f8', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto' },
  lbActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' },

  // Style Lock
  lockFields: { display: 'grid', gridTemplateColumns: '1fr', gap: 4, marginTop: 6 },
  lockField: { fontSize: 12, lineHeight: 1.6 },
  lockLabel: { display: 'inline-block', background: '#f5f0e8', color: '#5a3a00', borderRadius: 4, padding: '0 6px', marginRight: 6, fontSize: 11, fontWeight: 600 },
}

function apply(ctx) {
  // 一键入口：开新对话并预填指令（不直接发送、不扣积分）
  openInChat = (prompt) => {
    try {
      ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'replace' })
    } catch (err) {
      console.error('[ecom-image] 开新对话失败', err)
      alert('开新对话失败：' + ((err && err.message) || err))
    }
  }
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 14, label: () => '电商视觉' }, PanelIcon))
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
}

exports.isPlugin = true
exports.inject = ['slots', 'uiWorkspace']
exports.apply = apply
