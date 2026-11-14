// 把上游 skill（默认 D:\new-image-project\ecom-details-image）快照进插件。
// 用法：node scripts/sync-skill.mjs [skillDir]
// 只拷贝运行所需的部分：SKILL.md / README.md / references/templates / scripts /
// docs/case（案例图）/ prompts（案例对应 Prompt）。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2] || 'D:\\new-image-project\\ecom-details-image'
const DEST = join(ROOT, 'skills', 'ecom-details-image')

if (!existsSync(join(SRC, 'SKILL.md'))) {
  console.error(`[sync] 找不到 skill：${SRC}（缺 SKILL.md）`)
  process.exit(1)
}

const ITEMS = [
  ['SKILL.md', 'file'],
  ['README.md', 'file'],
  ['references/templates', 'dir'],
  ['scripts', 'dir'],
  ['docs/case', 'dir'],
  ['prompts', 'dir'],
]

let copied = 0
let bytes = 0
function countFiles(p) {
  const st = statSync(p)
  if (st.isFile()) { copied++; bytes += st.size; return }
  for (const name of readdirSync(p)) {
    if (name === '__pycache__') continue
    countFiles(join(p, name))
  }
}

mkdirSync(DEST, { recursive: true })
// 清掉会随上游变化的目录，避免旧图/旧模板残留
for (const rel of ['references/templates', 'docs/case', 'prompts', 'scripts']) {
  rmSync(join(DEST, rel), { recursive: true, force: true })
}

for (const [rel, kind] of ITEMS) {
  const from = join(SRC, rel)
  if (!existsSync(from)) {
    console.warn(`[sync] 跳过（上游没有）：${rel}`)
    continue
  }
  const to = join(DEST, rel)
  mkdirSync(dirname(to), { recursive: true })
  if (kind === 'dir') {
    cpSync(from, to, {
      recursive: true,
      filter: (src) => !basename(src).startsWith('__pycache__') && !src.endsWith('.pyc'),
    })
  } else {
    cpSync(from, to)
  }
  countFiles(to)
  console.log(`[sync] ${rel}`)
}

const stamp = {
  source: SRC,
  syncedAt: new Date().toISOString(),
  templates: readdirSync(join(DEST, 'references', 'templates')).filter((f) => f.endsWith('.json')).length,
  caseImages: countCaseImages(),
  scripts: readdirSync(join(DEST, 'scripts')).filter((f) => f.endsWith('.py')),
}
writeFileSync(join(DEST, 'SNAPSHOT.json'), JSON.stringify(stamp, null, 2) + '\n', 'utf8')

function countCaseImages() {
  const dir = join(DEST, 'docs', 'case')
  if (!existsSync(dir)) return 0
  let n = 0
  const walk = (p) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(jpe?g|png|webp)$/i.test(name)) n++
    }
  }
  walk(dir)
  return n
}

const skill = readFileSync(join(DEST, 'SKILL.md'), 'utf8')
console.log(`[sync] 完成：${copied} 个文件 / ${(bytes / 1048576).toFixed(2)} MB，${stamp.templates} 个模板，${stamp.caseImages} 张案例图`)
console.log(`[sync] SKILL.md ${skill.length} 字符，脚本：${stamp.scripts.join(', ')}`)
