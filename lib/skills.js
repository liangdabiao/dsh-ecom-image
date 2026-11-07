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
  if (!existsSync(dir)) return []
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
    '## 在 DSH 插件里使用（重要：先复制再执行）',
    '',
    `- 本技能目录：\`${skill.dir}\`。**你的 bash 沙箱读不到插件安装目录**——需要运行脚本或写文件时，先把整个技能目录复制到当前工作区：`,
    '  ```bash',
    `  cp -r "${skill.dir}" ./ecom-image`,
    '  ```',
    '- 之后的所有操作在工作区副本 `./ecom-image/` 里执行。',
    '- **Prompt / Brief 模式**（默认）：不需要任何工具，直接按正文方法论输出视觉简报 + Prompt + 负面约束。',
    '- **Generate 模式**（可选）：需要用户安装 [apiz CLI](https://apiz.ai) 并 `apiz auth login`。在工作区副本里运行 `python scripts/generate_image.py`。未安装 apiz 时，只输出 Prompt 让用户去即梦/Midjourney 手动生成。',
    '- 25 个场景模板在 `references/templates/` 目录（JSON 格式），生成 Prompt 时按需读取对应模板。',
    '- Campaign Style Lock 是核心机制：整套图的色板/冷暖调/字体/背景/光线/布局必须一致。',
    '- 生成的 Prompt 和 Campaign Style Lock 写到当前工作区文件（如 `ecom-image-output.md`），不要往插件安装目录写文件。',
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
