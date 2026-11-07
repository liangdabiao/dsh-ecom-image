// 电商视觉创作 · apiz CLI 封装（生图 / 参考图上传 / 结果下载）。
// 认证完全由 CLI 处理（apiz auth login 或 APIZ_API_KEY），本模块绝不接触密钥。
import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const DEFAULT_MODEL = 'apiz/gpt-image-2.5-flare'

// CLI 可能在 JSON 前输出日志行，取第一个 { 开始的部分。
function parseJsonOutput(raw, context) {
  let text = String(raw).trim()
  const brace = text.indexOf('{')
  if (brace > 0) text = text.slice(brace)
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error(`${context}返回格式不正确`)
  return parsed
}

// bin 覆盖优先级：Config.apizBin > APIZ_BIN > PATH
let binOverride = ''
export function setApizBin(bin) { binOverride = typeof bin === 'string' && bin.trim() ? bin.trim() : '' }
function resolveBin() {
  if (binOverride) return binOverride
  if (process.env.APIZ_BIN) return process.env.APIZ_BIN
  return 'apiz' // Windows 上 CreateProcess 自动补 .exe，POSIX 直接走 PATH
}

function runApiz(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(resolveBin(), args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const message = String(stderr || stdout || err.message).trim().slice(0, 800)
        reject(new Error(`apiz CLI 执行失败：${message}`))
        return
      }
      resolve(stdout)
    })
  })
}

// 本地参考图 → apiz CDN 公网 URL（图生图用，保证产品外观准确）。
export async function uploadReferenceImage(imagePath) {
  if (!imagePath || !existsSync(imagePath)) throw new Error(`参考图片不存在：${imagePath}`)
  const raw = await runApiz(['upload', imagePath], 120_000)
  const result = parseJsonOutput(raw, '上传参考图')
  if (!result.public_url) throw new Error(`上传结果缺少 public_url：${JSON.stringify(result).slice(0, 300)}`)
  return result.public_url
}

// 提交生成任务并等待完成。返回 { taskId, price, urls }。
export async function generateImage({ prompt, model, aspectRatio, imageUrl, timeoutMs = 420_000 }) {
  const waitTimeout = Math.max(60, Math.round(timeoutMs / 1000) - 15)
  const args = ['generate', prompt, '--model', model, '--aspect-ratio', aspectRatio, '--wait', '--wait-timeout', `${waitTimeout}s`, '--json']
  if (imageUrl) args.push('--image-url', imageUrl)
  const raw = await runApiz(args, timeoutMs)
  const task = parseJsonOutput(raw, '生成任务')

  const status = String(task.status || '')
  const taskId = task.task_id || ''
  if (status !== 'completed') {
    const hint = taskId ? `，可稍后用 \`apiz tasks get ${taskId}\` 查询` : ''
    throw new Error(`生成任务未完成（status=${status || 'unknown'}）：${JSON.stringify(task.error || task).slice(0, 500)}${hint}`)
  }

  const images = task.result?.images
  const urls = Array.isArray(images)
    ? images.map((item) => (typeof item === 'string' ? item : item?.url)).filter(Boolean)
    : []
  if (!urls.length) throw new Error(`任务结果中缺少图片 URL：${JSON.stringify(images || task.result || task).slice(0, 300)}`)
  return { taskId, price: task.price ?? null, urls }
}

// 下载生成结果到输出目录（Node 22 全局 fetch）。
export async function downloadImages(urls, outputDir, baseName) {
  const saved = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const suffix = /\.(png|jpe?g|webp)(\?|$)/i.exec(url)?.[1]?.toLowerCase().replace('jpeg', 'jpg') || 'png'
    const file = join(outputDir, `${baseName}-${String(i + 1).padStart(2, '0')}.${suffix}`)
    const res = await fetch(url, { headers: { 'user-agent': UA } })
    if (!res.ok) throw new Error(`下载图片失败（HTTP ${res.status}）：${url}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
    saved.push({ file, url })
  }
  return saved
}
