// 电商视觉创作 · 技能快照提供方。
// 纯技能零 API key——Prompt/Brief 模式由模型直接产出；Generate 模式由模型在工作区
// 用 bash 调 apiz CLI（需用户安装 apiz 并 auth login）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  let description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') || null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*>/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  return name && description ? { name, description, body: text.slice(m[0].length) } : null
}

function readDir(dir) {
  // 支持两种布局：dir 本身就是一个技能（含 SKILL.md），或 dir 下有多个技能子目录。
  if (existsSync(join(dir, 'SKILL.md'))) {
    const parsed = parse(join(dir, 'SKILL.md'))
    if (!parsed) return []
    const templates = existsSync(join(dir, 'references', 'templates'))
      ? readdirSync(join(dir, 'references', 'templates')).filter((f) => f.endsWith('.json'))
      : []
    return [{ dir, file: join(dir, 'SKILL.md'), ...parsed, dirName: dir.split(/[\\/]/).pop(), templates }]
  }
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (!parsed) continue
    const templates = existsSync(join(sDir, 'references', 'templates'))
      ? readdirSync(join(sDir, 'references', 'templates')).filter((f) => f.endsWith('.json'))
      : []
    out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name, templates })
  }
  return out
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用（重要：工具优先）',
    '',
    '- 本插件提供 4 个原生工具，**优先用工具，不要手写脚本**：',
    '  1. `ecom_template`（list/search/get）——查 25 个场景模板，get 拿 prompt_template/variants/category_tips/examples 后按它构建 Prompt。',
    '  2. `ecom_style_lock`（set/get/list/delete/render）——多图任务先 set 建立 Campaign Style Lock（色板/冷暖调/字体/背景/光线/布局/图标）。',
    '  3. `ecom_generate_image`——apiz CLI 直接生图。多图任务每张都传 campaign 参数自动注入 Style Lock；有产品实拍图传 reference_image 走图生图。结果自动入历史。',
    '  4. `ecom_history`（list/get/clear）——查历史：Prompt/模型/积分/文件路径。',
    '- 生图消耗 apiz 积分；批量出图前先把 Image Pack Plan 报给用户确认。用户未安装 apiz CLI 时，只输出完整 Prompt 包。',
    '- 25 个场景模板 JSON 也在技能目录 `references/templates/`，需要原文时先把技能目录复制到工作区（`cp -r "<目录>" ./ecom-image`）。',
    '- 用户可在侧栏「电商视觉」面板查看画廊/模板/Style Lock。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s, templates) => ({
    name: s.name,
    description: s.description,
    path: s.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: 'ecom-image',
    rank: RANK,
    locator: s.dir,
    resourceBase: { kind: 'directory', path: s.dir },
    templates,
  })

  return {
    name: 'ecom-image',
    async list() {
      return list.flatMap(readDir).map((s) => {
        const c = candidate(s, s.templates)
        const { templates, ...rest } = c
        return rest
      })
    },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, templates, ...summary } = candidate(s, s.templates)
      return { ...summary, content, templates }
    },
  }
}

export { readDir, addendum }

/** 列出 25 个场景模板名（供面板使用） */
export function listTemplates(skillDirs) {
  const out = []
  for (const dir of [].concat(skillDirs)) {
    const tplDir = join(dir, 'references', 'templates')
    if (!existsSync(tplDir)) continue
    for (const f of readdirSync(tplDir).filter((f) => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(readFileSync(join(tplDir, f), 'utf8'))
        out.push({ file: f, name: data.name || f.replace('.json', ''), description: data.description || '' })
      } catch {
        out.push({ file: f, name: f.replace('.json', ''), description: '' })
      }
    }
  }
  return out
}
