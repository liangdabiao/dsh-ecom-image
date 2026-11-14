// 电商视觉创作 · 即梦 dreamina-canvas 通道（Seedream 5.5 等）。
// 认证由 CLI 自理（dreamina-canvas auth login），本模块不接触任何密钥。
// 流程与上游 skill 的 scripts/generate_image_dreamina.py 保持一致：
//   画布解析 → 参考图登记为画布素材 → node create image --run --wait → resource download
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const DREAMINA_DEFAULT_MODEL = 'seedream_5.5'
export const DREAMINA_DEFAULT_RESOLUTION = '2K'
export const DREAMINA_MAX_REFERENCE = 10
export const DREAMINA_CANVAS_NAME = 'ecom-details-image'

// 模型支持的比例（与 dreamina-canvas model list 输出一致；不同模型略有差异，
// 这里用最保守的交集，并用 RATIO_FALLBACK 把 4:5 等换算到最近支持比例）。
export const DREAMINA_RATIOS = ['1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2', '21:9']
export const DREAMINA_RATIO_FALLBACK = {
  '4:5': '3:4', '5:4': '4:3', '2:1': '21:9', '1:2': '9:16',
  '9:21': '9:16', '3:1': '21:9', '1:3': '9:16', '16:10': '3:2', '10:16': '2:3',
}

let binOverride = ''
export function setDreaminaBin(bin) { binOverride = typeof bin === 'string' && bin.trim() ? bin.trim() : '' }
export function resolveDreaminaBin() {
  if (binOverride) return binOverride
  if (process.env.DREAMINA_BIN) return process.env.DREAMINA_BIN
  if (process.env.JIMENG_BIN) return process.env.JIMENG_BIN
  return 'dreamina-canvas'
}

function runDreamina(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      resolveDreaminaBin(),
      [...args, '--format', 'json'],
      { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const raw = String(stderr || stdout || err.message).trim()
          if (err.killed || /timed out/i.test(String(err.message))) {
            reject(new Error(`dreamina-canvas 执行超时（${Math.round(timeoutMs / 1000)}s）：任务可能已提交并在后台运行，先 dreamina-canvas node list 查，不要立刻重复下单。${raw ? `\n${raw.slice(0, 400)}` : ''}`))
            return
          }
          reject(new Error(`dreamina-canvas 执行失败：${raw.slice(0, 800)}`))
          return
        }
        resolve(stdout)
      },
    )
  })
}

// CLI 的 JSON 输出统一是 { schemaVersion, ok, data, meta }，个别命令也会直接返回 data。
function parseCli(raw, context) {
  let text = String(raw).trim()
  const brace = text.indexOf('{')
  if (brace > 0) text = text.slice(brace)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${context}不是有效 JSON：${String(raw).slice(0, 300)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${context}格式不正确`)
  if (parsed.ok === false) {
    const detail = parsed.error?.message || parsed.message || JSON.stringify(parsed).slice(0, 400)
    throw new Error(`${context}失败：${detail}`)
  }
  return parsed
}

const dataOf = (envelope) => (envelope && typeof envelope.data === 'object' && envelope.data) || envelope || {}

// 纯函数：把请求比例换算成即梦支持的比例，并回报是否被改写。
// supported 传入模型自己的牌面（不同模型支持的比例不同），缺省用通用集合。
export function dreaminaRatio(requested, supported = DREAMINA_RATIOS) {
  const list = Array.isArray(supported) && supported.length ? supported : DREAMINA_RATIOS
  const text = String(requested || '1:1').trim()
  if (list.includes(text)) return { ratio: text, remappedFrom: '' }
  const mapped = DREAMINA_RATIO_FALLBACK[text]
  if (mapped && list.includes(mapped)) return { ratio: mapped, remappedFrom: text, note: `即梦不支持 ${text}，已换算为 ${mapped}` }
  const fallback = list.includes('1:1') ? '1:1' : list[0]
  return { ratio: fallback, remappedFrom: text, note: `即梦不支持 ${text}，已回退 ${fallback}` }
}

// 纯函数：构造 node create image 参数（便于单测，不发起调用）。
export function buildDreaminaNodeArgs({ projectId, prompt, model, ratio, resolution = DREAMINA_DEFAULT_RESOLUTION, referenceIds = [], creditCeiling = 10, title = 'ecom', submitId = randomUUID() }) {
  if (!projectId) throw new Error('缺少画布 projectId')
  if (!prompt || !String(prompt).trim()) throw new Error('prompt 不能为空')
  const refs = (referenceIds || []).slice(0, DREAMINA_MAX_REFERENCE)
  const args = [
    'node', 'create', 'image',
    '--project-id', projectId,
    '--mode', refs.length ? 'i2i' : 't2i',
    '--model', model || DREAMINA_DEFAULT_MODEL,
    '--prompt', String(prompt),
    '--ratio', ratio,
    '--resolution', resolution,
    '--count', '1',
    '--credit-ceiling', String(Number(creditCeiling) || 10),
    '--title', title,
    '--submit-id', submitId,
    '--run', '--wait', '--yes',
  ]
  for (const rid of refs) args.push('--ref', `res:${rid}`)
  return args
}

export async function dreaminaVersion() {
  const raw = await runDreamina(['--version'], 20_000)
  const data = dataOf(parseCli(raw, 'dreamina version'))
  return String(data.version || '')
}

// 账户信息（免费读）：积分余额、是否为 VIP。未登录时抛错。
export async function dreaminaAccount() {
  const raw = await runDreamina(['auth', 'account', '--yes'], 30_000)
  const data = dataOf(parseCli(raw, 'dreamina account'))
  return {
    displayName: data.displayName || '',
    credits: Number(data.availableCredits ?? data.credits?.available ?? 0),
    isVip: Boolean(data.isVip),
    vipLevel: data.vipLevel || '',
  }
}

export async function dreaminaModels() {
  const raw = await runDreamina(['model', 'list', '--type', 'image'], 30_000)
  const data = dataOf(parseCli(raw, 'dreamina model list'))
  const items = Array.isArray(data.items) ? data.items : []
  return items.map((item) => {
    const modes = Array.isArray(item.modes) ? item.modes : []
    const t2i = modes.find((m) => m.name === 't2i') || {}
    const flags = Array.isArray(t2i.flags) ? t2i.flags : []
    const ratioFlag = flags.find((f) => f.flag === '--ratio')
    const resFlag = flags.find((f) => f.flag === '--resolution')
    const countFlag = flags.find((f) => f.flag === '--count')
    const i2i = modes.find((m) => m.name === 'i2i') || {}
    return {
      id: item.model,
      label: item.displayName || item.model,
      aliases: item.aliases || [],
      ratios: ratioFlag?.values || DREAMINA_RATIOS,
      resolutions: resFlag?.values || ['1.5K', '2K'],
      maxCount: countFlag?.max || 1,
      maxRefs: i2i.references?.max ?? DREAMINA_MAX_REFERENCE,
      vipRequired: Boolean(item.vipRequired),
    }
  })
}

// ── 画布 ────────────────────────────────────────────────────
async function resolveCanvas(canvasId) {
  if (canvasId) {
    const raw = await runDreamina(['canvas', 'use', canvasId, '--yes'], 60_000)
    const data = dataOf(parseCli(raw, 'canvas use'))
    const project = data.currentCanvas || data.project || {}
    return project.projectId || canvasId
  }
  try {
    const raw = await runDreamina(['canvas', 'current', '--yes'], 60_000)
    const data = dataOf(parseCli(raw, 'canvas current'))
    const canvas = data.currentCanvas?.canvas || data.canvas || {}
    if (canvas.projectId) return canvas.projectId
  } catch {
    // 没有当前画布不是错误，继续走自动创建
  }
  const raw = await runDreamina(['canvas', 'create', DREAMINA_CANVAS_NAME, '--use', '--yes'], 120_000)
  const data = dataOf(parseCli(raw, 'canvas create'))
  const project = data.project || data.canvas || {}
  if (!project.projectId) throw new Error(`自动创建即梦画布失败：${JSON.stringify(data).slice(0, 300)}`)
  return project.projectId
}

// ── 参考图登记 ──────────────────────────────────────────────
async function waitResourceReady(projectId, resourceId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const raw = await runDreamina(['resource', 'get', resourceId, '--project-id', projectId, '--yes'], 60_000)
    const data = dataOf(parseCli(raw, 'resource get'))
    const resource = data.resource || data
    const status = String(resource.status || '').toLowerCase()
    if (status === 'success') return
    if (status === 'failed') throw new Error(`参考图素材处理失败：${JSON.stringify(resource).slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`参考图素材 ${resourceId} 在 ${Math.round(timeoutMs / 1000)}s 内未就绪`)
}

export async function uploadDreaminaReference(projectId, localPath) {
  if (!localPath || !existsSync(localPath)) throw new Error(`参考图片不存在：${localPath}`)
  const resourceId = randomUUID()
  const raw = await runDreamina([
    'resource', 'upload', '--file', localPath, '--project-id', projectId,
    '--resource-id', resourceId, '--import-kind', 'local_upload', '--yes',
  ], 300_000)
  const data = dataOf(parseCli(raw, 'resource upload'))
  const uploaded = data.resource || data
  const rid = uploaded.resourceId || resourceId
  await waitResourceReady(projectId, rid)
  return rid
}

export async function registerDreaminaReferenceUrl(projectId, url) {
  const resourceId = randomUUID()
  const raw = await runDreamina([
    'resource', 'upload', '--source-url', url, '--project-id', projectId,
    '--resource-id', resourceId, '--import-kind', 'external_generated', '--yes',
  ], 300_000)
  const data = dataOf(parseCli(raw, 'resource upload'))
  const uploaded = data.resource || data
  const rid = uploaded.resourceId
  if (!rid) throw new Error(`参考图 URL 登记失败：${JSON.stringify(data).slice(0, 300)}`)
  await waitResourceReady(projectId, rid)
  return rid
}

// ── 生成 + 下载 ─────────────────────────────────────────────
function extractOutputs(result) {
  const node = dataOf(result).node || {}
  const ids = []
  for (const res of node.resources || []) {
    const status = String(res.status || '').toLowerCase()
    if (res.resourceId && (status === '' || status === 'success')) ids.push(res.resourceId)
  }
  return { nodeId: node.nodeId || '', resourceIds: ids }
}

async function waitNodeOutputs(projectId, nodeId, timeoutMs) {
  const deadline = Date.now() + Math.max(60_000, timeoutMs)
  let last = ''
  while (Date.now() < deadline) {
    const raw = await runDreamina(['node', 'show', '--node-id', nodeId, '--project-id', projectId, '--yes'], 60_000)
    const data = dataOf(parseCli(raw, 'node show'))
    const entries = Array.isArray(data.nodes) ? data.nodes : []
    const hit = entries.map((e) => e.node || {}).find((n) => n.nodeId === nodeId) || {}
    last = String(hit.status || '').toLowerCase()
    const ids = (hit.resources || [])
      .filter((r) => r.resourceId && String(r.status || '').toLowerCase() === 'success')
      .map((r) => r.resourceId)
    if (ids.length) return ids
    if (last === 'failed') throw new Error(`即梦生成节点失败：${JSON.stringify(hit).slice(0, 500)}`)
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`即梦节点 ${nodeId} 在 ${Math.round(timeoutMs / 1000)}s 内未完成（最后状态 ${last || 'unknown'}）`)
}

async function downloadResource(projectId, resourceId, outputPath) {
  await runDreamina(['resource', 'download', resourceId, '--project-id', projectId, '--output', outputPath, '--yes'], 300_000)
  if (!existsSync(outputPath)) throw new Error(`下载后未找到文件：${outputPath}`)
  const size = statSync(outputPath).size
  if (!size) throw new Error(`下载的图片为空文件：${outputPath}`)
  return outputPath
}

/**
 * 走即梦通道生成 1 张图。
 * @returns {Promise<{channel, model, taskId, price, files: {file,url}[], warnings: string[], resolvedRatio, canvasId}>}
 */
export async function generateDreamina({
  prompt, model = DREAMINA_DEFAULT_MODEL, aspectRatio = '1:1', referenceImages = [],
  resolution = DREAMINA_DEFAULT_RESOLUTION, canvasId = '', creditCeiling = 10,
  supportedRatios, outputDir, baseName, timeoutMs = 600_000,
}) {
  const warnings = []
  const { ratio, note } = dreaminaRatio(aspectRatio, supportedRatios)
  if (note) warnings.push(note)
  // 4K 单张更贵，10 的默认上限会挡住下单，自动抬到 20 并说明。
  let ceiling = Number(creditCeiling) || 10
  if (resolution === '4K' && ceiling < 20) {
    ceiling = 20
    warnings.push('4K 单张积分高于 2K，本次积分上限自动抬到 20')
  }

  const projectId = await resolveCanvas(canvasId)

  const localRefs = []
  const urlRefs = []
  for (const ref of referenceImages.slice(0, DREAMINA_MAX_REFERENCE)) {
    const value = String(ref || '').trim()
    if (!value) continue
    if (/^https?:\/\//i.test(value)) urlRefs.push(value)
    else localRefs.push(value)
  }
  if (referenceImages.length > DREAMINA_MAX_REFERENCE) {
    warnings.push(`即梦单次最多 ${DREAMINA_MAX_REFERENCE} 张参考图，已忽略多余的 ${referenceImages.length - DREAMINA_MAX_REFERENCE} 张`)
  }
  const refIds = []
  for (const path of localRefs) refIds.push(await uploadDreaminaReference(projectId, path))
  for (const url of urlRefs) refIds.push(await registerDreaminaReferenceUrl(projectId, url))

  const submitId = randomUUID()
  const title = `ecom-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`
  const args = buildDreaminaNodeArgs({
    projectId, prompt, model, ratio, resolution, referenceIds: refIds, creditCeiling: ceiling, title, submitId,
  })
  const raw = await runDreamina(args, timeoutMs)
  const parsed = parseCli(raw, '即梦生成任务')
  let { nodeId, resourceIds } = extractOutputs(parsed)
  if (!resourceIds.length && nodeId) {
    resourceIds = await waitNodeOutputs(projectId, nodeId, timeoutMs)
  }
  if (!resourceIds.length) {
    throw new Error(`即梦生成节点未产出素材（node=${nodeId || '未知'}）：${JSON.stringify(parsed).slice(0, 500)}`)
  }
  const files = []
  for (let i = 0; i < resourceIds.length; i++) {
    const file = join(outputDir, `${baseName}-${String(i + 1).padStart(2, '0')}.png`)
    await downloadResource(projectId, resourceIds[i], file)
    files.push({ file, url: '' })
  }
  return {
    channel: 'dreamina', model, taskId: nodeId || submitId, price: null,
    files, warnings, resolvedRatio: ratio, canvasId: projectId,
    cliArgs: maskPromptArg(args),
  }
}

// 日志/历史里不要把整段 Prompt 塞进去（几千字符），只留长度标记。
export function maskPromptArg(args) {
  const out = [...args]
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === '--prompt' || out[i] === '--prompt-file') {
      out[i + 1] = `<prompt ${String(out[i + 1]).length} chars>`
      i++
    }
  }
  return out
}
