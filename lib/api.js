// 面板数据面：/ecom-image 前缀路由。
// 与工具共用 lib（一份逻辑两个调用方）；图片文件经 safeImageFile 限定在 images/ 下。
import { listTemplates, getTemplate } from './templates.js'
import { readHistory, readStyleLocks, safeImageFile, IMAGES_DIR, DATA_DIR } from './data.js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'

const BASE = '/ecom-image'
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

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

export function registerApi(ctx, { skillDirs }) {
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
          return json(res, 200, { ok: true, dataDir: DATA_DIR, apizReady: Boolean(existsSync(IMAGES_DIR)) })
        }
        if (path === '/api/templates' && req.method === 'GET') {
          return json(res, 200, { templates: listTemplates(skillDirs) })
        }
        if (path === '/api/template' && req.method === 'GET') {
          const id = url.searchParams.get('id') || ''
          const tpl = getTemplate(skillDirs, id)
          if (!tpl) return json(res, 404, { error: `没有模板 ${id}` })
          return json(res, 200, { template: tpl })
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
