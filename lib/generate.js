// 电商视觉创作 · 统一生图编排：挑通道 → 调对应 CLI → 落盘 → 返回统一结果。
// 一次只出一张的闸门在 host 里，这里只管「这一张怎么出」。
import { generateImage as apizGenerate, downloadImages, normalizeReferenceUrls, setApizBin, uploadReferenceImage, MAX_REFERENCE_IMAGES } from './apiz.js'
import { DREAMINA_DEFAULT_RESOLUTION, generateDreamina, setDreaminaBin } from './dreamina.js'
import { pickChannel } from './channels.js'

/**
 * @param {object} opts
 * @param {'auto'|'dreamina'|'apiz'} opts.channel
 * @param {string} opts.prompt
 * @param {string} [opts.model]  留空用通道默认模型
 * @param {string} [opts.aspectRatio]
 * @param {string[]} [opts.referenceImages] 本地绝对路径或公网 URL 混合
 * @param {string} [opts.resolution] 仅即梦通道（1.5K / 2K）
 * @param {object} opts.cfg 插件 Config（bin 路径 / 默认模型）
 * @param {string} opts.imagesDir 图片落盘目录
 * @param {string} opts.baseName 文件名前缀
 * @param {number} [opts.timeoutMs]
 */
export async function generateOne({
  channel = 'auto', prompt, model, aspectRatio = '1:1', referenceImages = [],
  resolution = '', cfg = {}, imagesDir, baseName, timeoutMs,
}) {
  setApizBin(typeof cfg.apizBin === 'string' ? cfg.apizBin : '')
  setDreaminaBin(typeof cfg.dreaminaBin === 'string' ? cfg.dreaminaBin : '')

  const picked = await pickChannel(channel, cfg)
  const def = picked.probe
  const chosenModel = model || def.defaultModel
  const warnings = []
  if (picked.fallbackUsed) warnings.push(picked.reason)

  const refs = (Array.isArray(referenceImages) ? referenceImages : [referenceImages])
    .map((x) => String(x || '').trim())
    .filter(Boolean)

  if (picked.key === 'dreamina') {
    const credits = def.account?.credits
    if (Number.isFinite(credits) && credits < 6) {
      warnings.push(`即梦账户只有 ${credits} 积分，2K 单张约 6 积分——很可能不够，失败就先充值（dreamina-canvas auth account 查余额）或改用 channel:"apiz"。`)
    }
    const modelInfo = (def.models || []).find((m) => m.id === chosenModel)
    const allowedRes = modelInfo?.resolutions || def.resolutions || []
    const wantedRes = resolution || cfg.dreaminaResolution || DREAMINA_DEFAULT_RESOLUTION
    let res = wantedRes
    if (allowedRes.length && !allowedRes.includes(wantedRes)) {
      res = allowedRes[0]
      warnings.push(`模型 ${chosenModel} 不支持 ${wantedRes}，已改用 ${res}`)
    }
    const gen = await generateDreamina({
      prompt,
      model: chosenModel,
      aspectRatio,
      referenceImages: refs,
      resolution: res,
      supportedRatios: modelInfo?.ratios,
      canvasId: cfg.dreaminaCanvasId || '',
      creditCeiling: Number(cfg.dreaminaCreditCeiling) || 10,
      outputDir: imagesDir,
      baseName,
      timeoutMs: timeoutMs || 600_000,
    })
    if (gen.warnings.length) warnings.push(...gen.warnings)
    warnings.push('即梦国内版产物左上角带「AI生成」合规水印，上线前需裁切或修补。')
    return {
      channel: 'dreamina', channelLabel: def.label, model: chosenModel,
      taskId: gen.taskId, price: gen.price, files: gen.files, warnings,
      resolvedRatio: gen.resolvedRatio, requestedRatio: aspectRatio,
      cliArgs: gen.cliArgs, referenceCount: Math.min(refs.length, def.maxRefs), canvasId: gen.canvasId,
    }
  }

  // ── apiz ──
  const localPaths = []
  const urls = []
  for (const ref of refs.slice(0, MAX_REFERENCE_IMAGES)) {
    if (/^https?:\/\//i.test(ref)) urls.push(ref)
    else {
      urls.push(await uploadReferenceImage(ref))
      localPaths.push(ref)
    }
  }
  const result = await apizGenerate({
    prompt, model: chosenModel, aspectRatio,
    referenceImageUrls: urls, timeoutMs: timeoutMs || 420_000,
  })
  const saved = await downloadImages(result.urls, imagesDir, baseName)
  if (result.warnings?.length) warnings.push(...result.warnings)
  return {
    channel: 'apiz', channelLabel: def.label, model: chosenModel,
    taskId: result.taskId, price: result.price, files: saved, warnings,
    resolvedRatio: aspectRatio, requestedRatio: aspectRatio,
    cliArgs: result.cliArgs, referenceCount: normalizeReferenceUrls(urls).length, referenceUrls: urls, localRefs: localPaths,
  }
}
