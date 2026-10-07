// 干净网址（2026-10-02）：网页版的页面清单、托管转发规则、安全设置三处必须一致，旧链接要能换成新地址
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_PREFIXES } from './appPrefixes'
import { legacyTarget } from './route'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const vercel = JSON.parse(readFileSync(new URL('../../deploy/vercel/0x4-site.vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string; missing?: { type: string; key: string }[] }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const alt = APP_PREFIXES.join('|')

describe('干净网址', () => {
  it('App.tsx 里每个页面的第一段路径都登记了', () => {
    const firsts = new Set([...app.matchAll(/path="\/([^/"*:]+)/g)].map((m) => m[1]))
    for (const f of firsts) expect(APP_PREFIXES, `页面 /${f} 没登记，刷新会 404`).toContain(f)
  })
  it('托管转发：这些路径（带或不带后面的部分）都给网页版', () => {
    const dest = vercel.rewrites.filter((r) => r.destination === '/app/index.html').map((r) => r.source)
    expect(dest).toContain(`/:page(${alt})`)
    expect(dest).toContain(`/:page(${alt})/:rest*`)
  })
  it('安全设置：网页版的页面用网页版那套，官网那套不罩到网页版上（两套同时生效会把网页版拦坏）', () => {
    const csp = vercel.headers.filter((h) => h.headers.some((x) => x.key === 'Content-Security-Policy')).map((h) => h.source)
    expect(csp).toContain(`/((?:app|${alt})(?:/.*)?)`)
    expect(csp).toContain(`/((?!(?:app|${alt})(?:/|$)).*)`)
    expect(csp).toHaveLength(2)
  })
  it('/meet/会议码：只有抓预览的机器人去分享页，真人浏览器直接进网页版', () => {
    const r = vercel.rewrites.find((x) => x.source === '/meet/:id')!
    expect(r.missing).toEqual([{ type: 'header', key: 'sec-fetch-mode' }])
    expect(vercel.rewrites.indexOf(r)).toBeLessThan(vercel.rewrites.findIndex((x) => x.source.startsWith('/:page(')))
  })
  it('页面路径不和官网自己的目录撞名', () => {
    const site = new URL('../../deploy/0x4-site/', import.meta.url)
    const dirs = readdirSync(site).filter((n) => statSync(new URL(n, site)).isDirectory())
    for (const d of dirs) expect(APP_PREFIXES as readonly string[]).not.toContain(d)
  })
  it('旧链接换成新地址', () => {
    expect(legacyTarget('/app/', '#/token/bsc/0xabc?ref=1')).toBe('/token/bsc/0xabc?ref=1')
    expect(legacyTarget('/app/', '#/settings?x=ok&reason=1')).toBe('/settings?x=ok&reason=1')
    expect(legacyTarget('/app/', '')).toBe('/discover')
    expect(legacyTarget('/app', '#/')).toBe('/discover')
    expect(legacyTarget('/app/index.html', '#/live')).toBe('/live')
    expect(legacyTarget('/discover', '')).toBeNull()
    expect(legacyTarget('/', '#/x')).toBeNull()
  })
})
