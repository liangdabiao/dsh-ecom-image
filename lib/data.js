// 电商视觉创作 · 数据持久化（$DSH_HOME/ecom-image/）。
// 目录布局：
//   history.json   生图历史索引（追加，最多 MAX_RECORDS 条）
//   images/        生成的图片文件（<时间戳>-<序号>.png/jpg/webp）
//   stylelock.json Campaign Style Lock 存储（name → 锁定字段集）
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
