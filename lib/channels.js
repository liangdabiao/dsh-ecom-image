// 电商视觉创作 · 生图渠道注册表 + 就绪探测（面板/工具共用）。
// 两个通道：
//   dreamina —— 即梦 dreamina-canvas（Seedream 5.5 等，2K 约 6 积分/张，国内版带「AI生成」水印）
//   apiz     —— apiz CLI（GPT Image 2.6/2.5、Nano Banana、Seedream 5.0 Pro 等）
import {
  DREAMINA_DEFAULT_MODEL, DREAMINA_DEFAULT_RESOLUTION, DREAMINA_MAX_REFERENCE, DREAMINA_RATIOS,
  dreaminaAccount, dreaminaModels, dreaminaVersion, resolveDreaminaBin,
} from './dreamina.js'
import {
  APIZ_FALLBACK_MODELS, APIZ_RATIOS, DEFAULT_MODEL, apizAccount, apizImageModels, apizVersion, resolveApizBin,
} from './apiz.js'

export const CHANNEL_KEYS = ['dreamina', 'apiz']
export const CHANNEL_PREFERENCE = ['auto', 'dreamina', 'apiz']

// 无 CLI 时的静态兜底清单（保证面板/Prompt 模式仍可用）。
const DREAMINA_FALLBACK_MODELS = [
  { id: 'seedream_5.5', label: 'Seedream 5.5（推荐）' },
  { id: 'seedream_5.0_pro', label: 'Seedream 5.0 Pro' },
  { id: 'seedream_4.7', label: 'Seedream 4.7' },
  { id: 'seedream_4.5', label: 'Seedream 4.5' },
]

export function channelDefs(cfg) {
  return {
    dreamina: {
      key: 'dreamina',
      label: '即梦 Seedream',
      cli: 'dreamina-canvas',
      bin: resolveDreaminaBin(),
      install: 'https://jimeng.jianying.com/ai-tool/install',
      login: 'dreamina-canvas auth login',
      balance: 'dreamina-canvas auth account',
      defaultModel: cfg?.dreaminaModel || DREAMINA_DEFAULT_MODEL,
      defaultResolution: cfg?.dreaminaResolution || DREAMINA_DEFAULT_RESOLUTION,
      ratios: DREAMINA_RATIOS,
      resolutions: ['1.5K', '2K'],
      maxRefs: DREAMINA_MAX_REFERENCE,
      maxCount: 8,
      creditsPerImage: 6,
      note: '国内版产物左上角带「AI生成」合规水印，交付前需裁切或修补；参考图最多 10 张（多角度产品图一致性最好）。',
      fallbackModels: DREAMINA_FALLBACK_MODELS,
    },
    apiz: {
      key: 'apiz',
      label: 'apiz 多模型',
      cli: 'apiz',
      bin: resolveApizBin(),
      install: 'https://apiz.ai',
      login: 'apiz auth login',
      balance: 'apiz account balance',
      defaultModel: cfg?.defaultModel || DEFAULT_MODEL,
      defaultResolution: '',
      ratios: APIZ_RATIOS,
      resolutions: [],
      maxRefs: 16,
      maxCount: 1,
      creditsPerImage: null,
      note: 'GPT Image 2.6/2.5、Nano Banana Pro、Seedream 5.0 Pro 等 13 个图片模型；参考图走 --params {"reference_image_urls":[…]}。',
      fallbackModels: APIZ_FALLBACK_MODELS,
    },
  }
}

// ── 探测缓存（面板每次渲染都查一次，不能真去跑 CLI）──────────────
const CACHE_TTL_MS = 60_000
const cache = new Map()

async function step(fn, fallback) {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 400), value: fallback }
  }
}

export async function probeChannels(cfg, { force = false } = {}) {
  const defs = channelDefs(cfg)
  const cacheKey = `all:${defs.dreamina.bin}|${defs.apiz.bin}|${defs.dreamina.defaultModel}|${defs.apiz.defaultModel}`
  const hit = cache.get(cacheKey)
  if (!force && hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value

  const [dreamina, apiz] = await Promise.all([
    probeOne(defs.dreamina, {
      version: () => dreaminaVersion(),
      account: () => dreaminaAccount(),
      models: () => dreaminaModels(),
    }),
    probeOne(defs.apiz, {
      version: () => apizVersion(),
      account: () => apizAccount(),
      models: () => apizImageModels(),
    }),
  ])
  const value = { channels: [dreamina, apiz], probedAt: new Date().toISOString() }
  cache.set(cacheKey, { ts: Date.now(), value })
  return value
}

async function probeOne(def, callbacks) {
  const version = await step(callbacks.version, '')
  if (!version.ok) {
    return {
      ...publicDef(def), ready: false, authOk: false, error: version.error, version: '', account: null,
      models: def.fallbackModels.map((m) => decorateModel(m, def)), modelsSource: 'fallback',
    }
  }
  const [account, models] = await Promise.all([
    step(callbacks.account, null),
    step(callbacks.models, null),
  ])
  const liveModels = models.ok && Array.isArray(models.value) && models.value.length ? models.value : null
  const list = (liveModels || def.fallbackModels).map((m) => decorateModel(m, def))
  // 默认模型排最前，其余保持 CLI 顺序（CLI 常把新模型排前面，但面板要一眼看到默认）
  list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  return {
    ...publicDef(def),
    ready: true,
    authOk: account.ok,
    version: version.value,
    account: account.ok ? account.value : null,
    accountError: account.ok ? '' : account.error,
    models: list,
    modelsSource: liveModels ? 'live' : 'fallback',
  }
}

function decorateModel(model, def) {
  return {
    id: model.id,
    label: model.label || model.id,
    ratios: model.ratios || def.ratios,
    resolutions: model.resolutions || def.resolutions,
    maxRefs: model.maxRefs ?? def.maxRefs,
    maxCount: model.maxCount ?? def.maxCount,
    vipRequired: Boolean(model.vipRequired),
    isDefault: model.id === def.defaultModel,
  }
}

function publicDef(def) {
  const { fallbackModels, ...rest } = def
  return rest
}

/**
 * 按偏好挑通道：auto → 即梦优先（skill 默认），不可用回落 apiz。
 * 返回 { key, def, probe, fallbackUsed, reason }
 */
export async function pickChannel(pref, cfg, { force = false } = {}) {
  const { channels } = await probeChannels(cfg, { force })
  const byKey = Object.fromEntries(channels.map((c) => [c.key, c]))
  const wanted = CHANNEL_PREFERENCE.includes(pref) ? pref : 'auto'
  if (wanted !== 'auto') {
    const probe = byKey[wanted]
    if (!probe?.ready) {
      throw new Error(`${probe ? probe.label : wanted} 通道不可用：${probe?.error || '未安装 CLI'}。先装好并登录（${channelDefs(cfg)[wanted]?.login}），或把 channel 改成 auto 走另一个通道。`)
    }
    if (!probe.authOk) {
      throw new Error(`通道 ${probe.label} 未登录：先运行 ${probe.login}${probe.accountError ? `（${probe.accountError}）` : ''}，或把 channel 改成 auto 走另一个通道。`)
    }
    return { key: wanted, probe, fallbackUsed: false, reason: `用户指定 ${wanted}` }
  }
  if (byKey.dreamina?.ready && byKey.dreamina?.authOk) {
    return { key: 'dreamina', probe: byKey.dreamina, fallbackUsed: false, reason: 'auto：即梦优先' }
  }
  if (byKey.apiz?.ready && byKey.apiz?.authOk) {
    const why = byKey.dreamina?.ready ? '即梦未登录' : '即梦不可用'
    return { key: 'apiz', probe: byKey.apiz, fallbackUsed: true, reason: `auto：${why}，已回落 apiz` }
  }
  throw new Error(
    '没有可用的生图通道：dreamina-canvas 与 apiz CLI 都不可用。\n' +
    `- 即梦：安装后 ${byKey.dreamina?.login || 'dreamina-canvas auth login'}\n` +
    `- apiz：安装后 ${byKey.apiz?.login || 'apiz auth login'}\n` +
    '不装也能用：只输出完整 Prompt 包，拿去任何生图工具手动生成。',
  )
}

export function invalidateChannelCache() {
  cache.clear()
}
