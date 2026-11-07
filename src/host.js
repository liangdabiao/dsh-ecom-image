// 电商视觉创作 · Host 半边（最小宿主：技能提供方 + 模板列表 API）。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider, listTemplates } from '../lib/skills.js'
import { registerApi } from '../lib/api.js'

export const name = 'ecom-image' // = cordis.patch.yml 的 id

export const inject = ['skills', 'webServer', 'connection']

export function apply(ctx) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ecom-details-image')]

  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  ctx.effect(() => registerApi(ctx, { skillDirs }), `${name}: routes`)
}
