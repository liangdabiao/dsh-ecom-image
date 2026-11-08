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

// 图生图参考图上限（apiz: 1–16 张公网 HTTP(S) URL）。
export const MAX_REFERENCE_IMAGES = 16

// 已实测的"模型 → 参考图参数名"能力表（探针法验证，2026-11 实测）：
//   apiz/gpt-image-2.5-flare  : reference_image_urls ✅ / image_urls ❌(400) / image_url ❌(400)
//   fal-ai/nano-banana-pro    : image_urls ✅ / reference_image_urls ✅（都能提交，但出图保真度不同）
// 用途：传了参考图却用了不认识的模型时，明确警告，而不是默默出一张"像但不对"的图。
export const REF_SUPPORT = {
  'apiz/gpt-image-2.5-flare': 'reference_image_urls',
  'fal-ai/nano-banana-pro': 'reference_image_urls',
}
export const REF_PARAM = 'reference_image_urls'

export function refSupportFor(model) {
  const key = String(model || '').trim()
  return REF_SUPPORT[key] || null
}

// 把 apiz 的原始报错翻译成"下一步该干什么"，避免反复瞎试。
export function explainApizError(message) {
  const text = String(message || '')
  if (/不支持的参数:\s*image_url(?!s)/.test(text)) {
    return `${text}｜该模型不接受 --image-url，参考图必须走 --params '{"${REF_PARAM}":[…]}'（本插件已内置，出现此错说明调用方绕过了 buildGenerateArgs）`
  }
  if (/不支持的参数: image_urls/.test(text)) {
    return `${text}｜该模型用的是 ${REF_PARAM}，不是 image_urls`
  }
  if (/不支持的参数:/.test(text)) {
    const field = /不支持的参数:\s*([^\s；]+)/.exec(text)?.[1] || '未知字段'
    return `${text}｜字段「${field}」不在该模型 schema 内；先用 apiz models docs <model> 核对，或用已知可用组合：apiz/gpt-image-2.5-flare + ${REF_PARAM}`
  }
  if (/额度不足|429/.test(text)) return `${text}｜额度不够，先 apiz account balance 查余额或充值，别重复提交`
  if (/timed out/.test(text)) return `${text}｜任务已提交且已计费，用 apiz tasks get <task_id> 取结果，不要重新下单`
  return text
}

// 参考图归一化：接受 string | string[]，去空、去重、限流。
export function normalizeReferenceUrls(input) {
  const list = Array.isArray(input) ? input : (input ? [input] : [])
  const seen = new Set()
  const out = []
  for (const item of list) {
    const url = String(item || '').trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= MAX_REFERENCE_IMAGES) break
  }
  return out
}

// 构造 apiz generate 参数数组（纯函数，便于测试）。
// 关键：apiz 的图生图参数是 --params '{"reference_image_urls":[...]}'，
// 不是 --image-url（旧实现传 --image-url 会被网关当未知参数丢弃或报 400）。
export function buildGenerateArgs({ prompt, model, aspectRatio, referenceImageUrls, timeoutMs = 420_000 }) {
  const waitTimeout = Math.max(60, Math.round(timeoutMs / 1000) - 15)
  const requested = (Array.isArray(referenceImageUrls) ? referenceImageUrls : (referenceImageUrls ? [referenceImageUrls] : [])).filter((x) => String(x || '').trim())
  const refs = normalizeReferenceUrls(requested)
  // 硬守卫：调用方给了参考图，但没有任何一张是合法 http(s) URL → 立刻失败。
  // 以前这里会静默退化成文生图，产出一张"像但不对"的图，是最贵的 bug。
  if (requested.length && !refs.length) {
    throw new Error(`参考图无效：${requested.length} 个入参里没有一个是 http(s) 公网 URL。先用 apiz upload 上传本地图换 URL，不要直接传本地路径。`)
  }
  const args = ['generate', prompt, '--model', model, '--aspect-ratio', aspectRatio, '--wait', '--wait-timeout', `${waitTimeout}s`, '--json']
  if (refs.length) args.push('--params', JSON.stringify({ [REF_PARAM]: refs }))
  return args
}

// 提交生成任务并等待完成。返回 { taskId, price, urls, referenceUrls, cliArgs, warnings }。
export async function generateImage({ prompt, model, aspectRatio, referenceImageUrls, imageUrl, timeoutMs = 420_000 }) {
  // 兼容旧调用：单张 imageUrl 自动并入 reference_image_urls
  const refs = normalizeReferenceUrls([...(Array.isArray(referenceImageUrls) ? referenceImageUrls : []), ...(imageUrl ? [imageUrl] : [])])
  const args = buildGenerateArgs({ prompt, model, aspectRatio, referenceImageUrls: refs, timeoutMs })
  const warnings = []
  if (refs.length && !refSupportFor(model)) {
    warnings.push(`模型 ${model} 未在参考图能力表里实测过（已知可用：apiz/gpt-image-2.5-flare）。出图后务必逐项比对参考图，别当默认可信。`)
  }
  let raw
  try {
    raw = await runApiz(args, timeoutMs)
  } catch (err) {
    // 带上真实命令行（已脱敏，prompt 截断），排错不用再猜
    const shown = args.map((a, i) => (i === 1 ? `<prompt ${String(a).length} chars>` : a)).join(' ')
    throw new Error(`${explainApizError(err.message)}\n实际命令：apiz ${shown}`)
  }
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
  return { taskId, price: task.price ?? null, urls, referenceUrls: refs, cliArgs: args, warnings }
}

// 从字节流读图片尺寸（PNG / JPEG，无第三方依赖）——用于核验"要 4:5 就真是 4:5"。
export function imageSizeFromBuffer(buf) {
  if (!buf || buf.length < 24) return null
  // PNG: 8 字节签名 + 4 字节长度 + 'IHDR' + width(4) height(4)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: 扫 SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 段
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue }
      const marker = buf[off + 1]
      const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)
      if (isSOF) return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
      const len = buf.readUInt16BE(off + 2)
      if (len < 2) break
      off += 2 + len
    }
  }
  return null
}

// 比例核验：请求 "4:5" → 期望 0.8；容差默认 3%。
export function ratioMismatch(requested, size, tolerance = 0.03) {
  const m = /^(\d+)\s*[x:]\s*(\d+)$/i.exec(String(requested || '').trim())
  if (!m || !size?.width || !size?.height) return null
  const want = Number(m[1]) / Number(m[2])
  const got = size.width / size.height
  const diff = Math.abs(got - want) / want
  return { want: +want.toFixed(3), got: +got.toFixed(3), diff: +diff.toFixed(4), ok: diff <= tolerance }
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
