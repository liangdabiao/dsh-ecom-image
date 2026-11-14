// 电商视觉创作 · 案例图索引（上游 skill 的 docs/case + prompts 实测产物）。
// 案例 = 一张真实出图 + 它当时用的 Prompt，用于面板里「先看效果，再照抄」。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const IMAGE_RE = /\.(jpe?g|png|webp)$/i

// README 里的人工结论（哪些能直接用、哪些要返修）——面板上直接告诉用户。
const TEMPLATE_NOTES = {
  't03': ['✅', '俯拍构图、道具搭配稳定，可直接用'],
  't04': ['✅', '木纹/釉面质感极强，最惊艳的场景之一'],
  't05': ['✅', '「上新 8 折」「马上抢」中文全对，可直接用'],
  't06': ['⚠️', '版式好看，但 bullet 标签出现重复文案'],
  't07': ['✅', '初版双人四手+木圈乱码，换通道单图重选后修复'],
  't08': ['✅', '手持产品、浅景深、人物自然，可用'],
  't09': ['✅', '上下分层+标签全对，叙事清楚'],
  't10': ['✅', '牛皮礼盒+丝带质感好，可直接用'],
  't12': ['⚠️', '悬浮水螺旋视觉冲击强，但木圈有小畸形'],
  't13': ['✅', '标注线+「高 12cm」「口径 8.5cm」等 5 处文字全对'],
  't14': ['✅', '三色木圈变体+标签全对，SKU 卡一步到位'],
  't15': ['✅', '首版「专」字渲染错误，逐字约束重做一次后文字全对'],
  't17': ['✅', '三层拆分+标注全对，产品结构清晰'],
  't19': ['⚠️', '2×2 网格规整，但四个角度差异偏小'],
  't20': ['✅', '中英文刊头+光影氛围，质感最高级'],
  't21': ['✅', '「冬季暖冬限定」+节日氛围到位'],
  't22': ['✅', '低调棚拍+烟雾光束，高级感强'],
}

const HERO_LABELS = {
  'hero-01': '主图 1 · 白底 Packshot',
  'hero-02': '主图 2 · 木纹特写',
  'hero-03': '主图 3 · 生活场景',
  'hero-04': '主图 4 · 竞品对比',
  'hero-05': '主图 5 · 促销 CTA',
}
const DETAIL_LABELS = {
  'detail-01': '详情 1 · 首屏承接',
  'detail-02': '详情 2 · 痛点放大',
  'detail-03': '详情 3 · 机制解释',
  'detail-04': '详情 4 · 核心利益',
  'detail-05': '详情 5 · 使用步骤',
  'detail-06': '详情 6 · 场景覆盖',
  'detail-07': '详情 7 · 信任背书',
  'detail-08': '详情 8 · 收尾 CTA',
}

// 没有 tXX 实测图的模板，用同语义的整套 PDP 案例图兜底。
const TEMPLATE_FALLBACK_IMAGE = {
  'hero-image': 'hero-01-packshot.jpg',
  'lifestyle-scene': 'hero-03-lifestyle.jpg',
  'infographic': 'detail-04-benefits.jpg',
}

function walk(dir, base = '') {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walk(full, rel))
    else if (IMAGE_RE.test(name)) out.push(rel)
  }
  return out.sort()
}

function readText(file, limit = 8000) {
  try {
    return readFileSync(file, 'utf8').trim().slice(0, limit)
  } catch {
    return ''
  }
}

function promptFor(skillDir, group, stem) {
  const base = join(skillDir, 'prompts', 'pour-over-dripper')
  const candidates = group === 'templates'
    ? [join(base, 'templates', `${stem}.txt`)]
    : [join(base, `${stem}.txt`)]
  for (const file of candidates) {
    if (existsSync(file)) return { file: file.replace(/\\/g, '/'), text: readText(file) }
  }
  return { file: '', text: '' }
}

/**
 * 汇总案例：两组（整套 PDP / 模板轮测）+ 模板→案例图映射。
 * 返回的 image 是相对 docs/case 的路径，面板经 /ecom-image/api/case-image 取图。
 */
export function listCases(skillDir) {
  const caseDir = join(skillDir, 'docs', 'case')
  const images = walk(caseDir)

  const pdp = []
  const templateItems = []
  for (const rel of images) {
    const name = basename(rel).replace(IMAGE_RE, '')
    const m = /^(t\d{2})-(.+)$/.exec(name)
    if (m) {
      const [mark, note] = TEMPLATE_NOTES[m[1]] || ['', '']
      templateItems.push({
        id: name,
        group: 'templates',
        label: `${m[1].slice(1)} · ${m[2]}`,
        image: rel,
        mark, note,
        prompt: promptFor(skillDir, 'templates', name),
      })
      continue
    }
    const stem = /^(hero|detail)-\d{2}/.exec(name)?.[0] || name
    pdp.push({
      id: name,
      group: 'pdp',
      label: HERO_LABELS[stem] || DETAIL_LABELS[stem] || name,
      image: rel,
      mark: '✅',
      note: '',
      prompt: promptFor(skillDir, 'pdp', stem),
    })
  }

  const groups = [
    {
      id: 'pdp',
      title: '整套 PDP 案例 · 陶瓷手冲滤杯',
      subtitle: '即梦 Seedream 5.5 实测：5 张主图 + 8 张详情图，统一 Campaign Style Lock，13 张产品形态保持一致。',
      items: pdp,
    },
    {
      id: 'templates',
      title: '场景模板轮测 · 17 个电商场景',
      subtitle: '同一只滤杯挂在同一张参考图上跑 17 个场景：纯产品摄影最稳，人物/场景类最容易出乱码，建议多出候选挑。',
      items: templateItems,
    },
  ]

  return { groups, byTemplate: mapTemplatesToCases(skillDir, images) }
}

// 模板 id（如 flat-lay）→ 案例图相对路径。优先 tXX 同名实测图，其次语义兜底图。
export function mapTemplatesToCases(skillDir, images = walk(join(skillDir, 'docs', 'case'))) {
  const out = {}
  const tplDir = join(skillDir, 'references', 'templates')
  const templateFiles = existsSync(tplDir) ? readdirSync(tplDir).filter((f) => f.endsWith('.json')) : []
  const byName = new Map()
  for (const rel of images) {
    const name = basename(rel).replace(IMAGE_RE, '')
    byName.set(name, rel)
  }
  for (const file of templateFiles) {
    const m = /^(\d{2})-(.+)\.json$/.exec(file)
    if (!m) continue
    const num = m[1]
    const id = m[2]
    const hit = [...byName.entries()].find(([name]) => name.startsWith(`t${num}-`))
    if (hit) {
      out[id] = hit[1]
      continue
    }
    const fallback = TEMPLATE_FALLBACK_IMAGE[id]
    if (fallback && byName.has(fallback.replace(IMAGE_RE, ''))) out[id] = byName.get(fallback.replace(IMAGE_RE, ''))
  }
  return out
}

// 面板取图：只允许 docs/case 下的图片文件（不接受绝对路径 / ..）。
export function safeCaseImage(skillDir, rel) {
  const value = String(rel || '').replace(/\\/g, '/')
  if (!value || value.includes('..') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null
  if (!IMAGE_RE.test(value)) return null
  const file = join(skillDir, 'docs', 'case', value)
  if (!existsSync(file) || !statSync(file).isFile()) return null
  return file
}
