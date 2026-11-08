// 电商视觉创作 · 数据持久化（$DSH_HOME/ecom-image/）。
// 目录布局：
//   history.json   生图历史索引（追加，最多 MAX_RECORDS 条）
//   images/        生成的图片文件（<时间戳>-<序号>.png/jpg/webp）
//   stylelock.json Campaign Style Lock 存储（name → 锁定字段集）
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ecom-image')
export const IMAGES_DIR = join(DATA_DIR, 'images')
const HISTORY_FILE = join(DATA_DIR, 'history.json')
const STYLELOCK_FILE = join(DATA_DIR, 'stylelock.json')
const MAX_RECORDS = 500

export function ensureDirs() {
  for (const dir of [DATA_DIR, IMAGES_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

// 原子写：先写 .tmp 再 rename，避免并发读写截断。
function atomicWrite(file, value) {
  ensureDirs()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

// ---------------------------------------------------------------------------
// 生图历史
// ---------------------------------------------------------------------------
export function readHistory() {
  try {
    const raw = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function appendHistory(record) {
  const list = readHistory()
  list.unshift(record) // 新的在前
  if (list.length > MAX_RECORDS) list.length = MAX_RECORDS
  atomicWrite(HISTORY_FILE, list)
  return record
}

export function updateHistory(id, patch) {
  const list = readHistory()
  const index = list.findIndex((r) => r.id === id)
  if (index === -1) return null
  list[index] = { ...list[index], ...patch }
  atomicWrite(HISTORY_FILE, list)
  return list[index]
}

export function clearHistory() {
  atomicWrite(HISTORY_FILE, [])
}

// ---------------------------------------------------------------------------
// 一次一张 · 验收闸门
// 规则：出完一张图必须等用户验收（ecom_review_image），没验收不许出下一张。
// pending = 历史里最新一条 reviewState === 'awaiting' 的记录。
// ---------------------------------------------------------------------------
export const REVIEW_CHECK_KEYS = [
  'productFidelity',   // 产品与参考图逐项一致（轮廓/结构/配色/文字）
  'physicalGrounding', // 物理落地：轮子踩在面上、有接触阴影、无悬空穿模
  'perspective',       // 透视一致：产品与桌面/道具同一灭点，道具比例合理
  'composition',       // 占比与留白达标
  'color',             // 色彩与参考图同色系
  'cleanliness',       // 无多余文字/尺寸标注/水印/杂物
]

const LOCK_FILE = join(DATA_DIR, 'generate.lock')
const LOCK_STALE_MS = 10 * 60 * 1000

export function pendingReview() {
  return readHistory().find((r) => r.reviewState === 'awaiting') || null
}

// 生成互斥锁：并发/连续调用时挡住第二个（'wx' 原子创建）。
export function acquireGenerateLock() {
  ensureDirs()
  try {
    const fd = writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' })
    void fd
    return { ok: true, release: () => { try { rmSync(LOCK_FILE, { force: true }) } catch { /* ignore */ } } }
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err
    // 陈旧锁（进程崩了）自动回收
    let stale = false
    try {
      const meta = JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
      stale = Date.now() - Number(meta.ts || 0) > LOCK_STALE_MS
    } catch { stale = true }
    if (stale) {
      rmSync(LOCK_FILE, { force: true })
      return acquireGenerateLock()
    }
    return { ok: false, reason: '另一个生图任务正在进行中（一次只允许一张）' }
  }
}

// 记录用户验收结论；approve 要求 6 项检查全部通过。
export function recordReview(id, { verdict, checks = {}, notes = '' } = {}) {
  const record = readHistory().find((r) => r.id === id)
  if (!record) return { ok: false, error: `历史里没有记录 ${id}` }
  if (record.reviewState !== 'awaiting') return { ok: false, error: `记录 ${id} 当前状态是 ${record.reviewState || 'unknown'}，不需要验收` }
  const failed = REVIEW_CHECK_KEYS.filter((key) => checks[key] !== true)
  if (verdict === 'approve' && failed.length) {
    return { ok: false, error: `approve 需要 6 项自检全部为 true，未通过：${failed.join(', ')}。有问题请用 verdict:"reject" 并写 notes。` }
  }
  const updated = updateHistory(id, {
    reviewState: verdict === 'approve' ? 'approved' : 'rejected',
    review: { verdict, checks, notes, at: new Date().toISOString() },
  })
  return { ok: true, record: updated }
}

// ---------------------------------------------------------------------------
// Campaign Style Lock
// 锁定字段：palette 色板 / tone 冷暖调 / font 字体 / background 背景 /
// lighting 光线 / layout 布局 / icons 图标风格 / notes 其他备注。
// ---------------------------------------------------------------------------
const LOCK_FIELDS = ['palette', 'tone', 'font', 'background', 'lighting', 'layout', 'icons', 'notes']

export function readStyleLocks() {
  try {
    const raw = JSON.parse(readFileSync(STYLELOCK_FILE, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

export function getStyleLock(name) {
  return readStyleLocks()[name] || null
}

// set：合并已有锁（同字段覆盖），并补 updatedAt。
export function setStyleLock(name, lock) {
  const locks = readStyleLocks()
  const prev = locks[name] || {}
  const next = { ...prev }
  for (const field of LOCK_FIELDS) {
    if (lock?.[field] !== undefined && lock[field] !== '') next[field] = String(lock[field])
  }
  next.updatedAt = new Date().toISOString()
  locks[name] = next
  atomicWrite(STYLELOCK_FILE, locks)
  return next
}

export function deleteStyleLock(name) {
  const locks = readStyleLocks()
  if (!(name in locks)) return false
  delete locks[name]
  atomicWrite(STYLELOCK_FILE, locks)
  return true
}

// 把锁渲染成一段可拼进生图 Prompt 的一致性约束文本。
export function renderLockText(lock) {
  if (!lock) return ''
  const labels = {
    palette: '色板', tone: '冷暖调', font: '字体', background: '背景',
    lighting: '光线', layout: '布局', icons: '图标风格', notes: '备注',
  }
  const parts = []
  for (const field of LOCK_FIELDS) {
    if (lock[field]) parts.push(`${labels[field]}: ${lock[field]}`)
  }
  if (!parts.length) return ''
  return `Campaign Style Lock（整套图必须保持一致）—— ${parts.join('；')}`
}

// ---------------------------------------------------------------------------
// 面板图片伺服的路径防护：只允许直接位于 IMAGES_DIR 下的文件名。
// ---------------------------------------------------------------------------
export function safeImageFile(name) {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null
  const file = join(IMAGES_DIR, basename(name))
  return existsSync(file) ? file : null
}
