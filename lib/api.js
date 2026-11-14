// 面板数据面：/ecom-image 前缀路由。
// 与工具共用 lib（一份逻辑两个调用方）；图片文件经 safeImageFile / safeCaseImage 限定目录。
import { listTemplates, getTemplate } from './templates.js'
import { readHistory, readStyleLocks, safeImageFile, IMAGES_DIR, DATA_DIR } from './data.js'
import { listCases, safeCaseImage } from './cases.js'
import { probeChannels } from './channels.js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'

const BASE = '/ecom-image'
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

// 深度防御：dsh 0.2.x 宿主 webServer 已用 URL token 统一鉴权（未登录请求在到达
// 插件前就被 401 拦截）。若宿主提供 connection.requestRejection 服务则再过一道；
// 服务缺席时放行——鉴权边界在宿主，插件不能因为服务不存在而把所有面板请求打死。
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

function serveImage(res, file) {
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const stat = statSync(file)
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'private, max-age=3600',
  })
  createReadStream(file).pipe(res)
}

export function registerApi(ctx, { skillDirs, configRef }) {
  const dirs = [].concat(skillDirs)
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })
        const url = new URL(req.url, 'http://x')
        const path = url.pathname.slice(BASE.length) || '/'

        if (path === '/api/health' && req.method === 'GET') {
          return json(res, 200, { ok: true, dataDir: DATA_DIR, imagesDir: IMAGES_DIR, hasImagesDir: existsSync(IMAGES_DIR) })
        }
        // 渠道 / 模型 / 余额（点 3：生图 API 可选）。默认走 60 秒缓存，force=1 强制探测。
        if (path === '/api/models' && req.method === 'GET') {
          const force = url.searchParams.get('force') === '1'
          const cfg = configRef?.config || {}
          const data = await probeChannels(cfg, { force })
          return json(res, 200, {
            ...data,
            defaults: {
              channel: cfg.defaultChannel || 'auto',
              dreaminaModel: cfg.dreaminaModel || '',
              dreaminaResolution: cfg.dreaminaResolution || '',
              apizModel: cfg.defaultModel || '',
            },
          })
        }
        if (path === '/api/templates' && req.method === 'GET') {
          return json(res, 200, { templates: listTemplates(dirs) })
        }
        if (path === '/api/template' && req.method === 'GET') {
          const id = url.searchParams.get('id') || ''
          const tpl = getTemplate(dirs, id)
          if (!tpl) return json(res, 404, { error: `没有模板 ${id}` })
          return json(res, 200, { template: tpl })
        }
        // 案例：整套 PDP + 17 个场景轮测（图 + 当时用的 Prompt）
        if (path === '/api/case' && req.method === 'GET') {
          return json(res, 200, listCases(dirs[0]))
        }
        if (path === '/api/case-image' && req.method === 'GET') {
          const file = safeCaseImage(dirs[0], url.searchParams.get('file') || '')
          if (!file) return json(res, 404, { error: '案例图不存在' })
          return serveImage(res, file)
        }
        if (path === '/api/history' && req.method === 'GET') {
          return json(res, 200, { history: readHistory() })
        }
        if (path === '/api/stylelock' && req.method === 'GET') {
          return json(res, 200, { locks: readStyleLocks() })
        }
        if (path === '/api/image' && req.method === 'GET') {
          const file = safeImageFile(url.searchParams.get('file') || '')
          if (!file) return json(res, 404, { error: '图片不存在' })
          return serveImage(res, file)
        }
        json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}
