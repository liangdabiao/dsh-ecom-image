// 电商视觉创作 · 25 个场景模板的加载 / 查询（供工具与面板 API 共用）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 全量读模板 JSON（含 keywords/variants/category_tips/examples）。
export function loadTemplates(skillDirs) {
  const out = []
  for (const dir of [].concat(skillDirs)) {
    const tplDir = join(dir, 'references', 'templates')
    if (!existsSync(tplDir)) continue
    for (const f of readdirSync(tplDir).filter((f) => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(readFileSync(join(tplDir, f), 'utf8'))
        out.push({ ...data, file: f, id: data.id || f.replace('.json', '') })
      } catch {
        // 坏 JSON 跳过，不让一个模板拖垮整个面板
      }
    }
  }
  return out.sort((a, b) => String(a.file).localeCompare(String(b.file)))
}

// 面板列表用的轻量摘要。
export function listTemplates(skillDirs) {
  return loadTemplates(skillDirs).map((t) => ({
    id: t.id, file: t.file, name: t.name || t.id,
    description: t.description || (t.prompt_template?.type || ''),
    keywords: (t.keywords || []).slice(0, 6),
  }))
}

export function getTemplate(skillDirs, id) {
  const all = loadTemplates(skillDirs)
  return all.find((t) => t.id === id || t.file === id || t.name === id) || null
}

// 按 id/name/keywords 模糊搜索（不区分大小写）。
export function searchTemplates(skillDirs, keyword) {
  const needle = String(keyword).toLowerCase()
  return loadTemplates(skillDirs).filter((t) => {
    const haystack = [t.id, t.name, t.description, ...(t.keywords || []), ...(t.trigger_phrases || [])].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}
