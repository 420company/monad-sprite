// @vitest-environment jsdom
// 燃料费油量表图标：三档各自的读屏名字、当前那段点亮、指针方向；不传档位时是单色的「燃料费」
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FuelGauge from './FuelGauge'
import type { FuelLevel } from '@/lib/gas'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = (level?: FuelLevel) => { act(() => root.render(createElement(FuelGauge, { level }))); return host.querySelector('svg')! }
// 表盘三段的亮度（按左中右顺序）
const lit = (svg: SVGElement) => [...svg.querySelectorAll('path')].slice(0, 3).map((p) => (p as SVGPathElement).style.opacity)
// 指针终点相对表心的横向偏移：左负右正
const needleDx = (svg: SVGElement) => { const d = svg.querySelectorAll('path')[3].getAttribute('d')!; const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number); return n[2] - n[0] }

describe('燃料费油量表', () => {
  it('三档各有读屏名字，当前那段点亮、指针指过去', () => {
    const low = render('low')
    expect(low.getAttribute('aria-label')).toBe('燃料费不足')
    expect(low.querySelector('title')?.textContent).toBe('燃料费不足')
    expect(lit(low)).toEqual(['1', '0.22', '0.22'])
    expect(needleDx(low)).toBeLessThan(-1)

    const mid = render('middle')
    expect(mid.getAttribute('aria-label')).toBe('燃料费偏低')
    expect(lit(mid)).toEqual(['0.22', '1', '0.22'])
    expect(Math.abs(needleDx(mid))).toBeLessThan(0.01)

    const high = render('high')
    expect(high.getAttribute('aria-label')).toBe('燃料费充足')
    expect(lit(high)).toEqual(['0.22', '0.22', '1'])
    expect(needleDx(high)).toBeGreaterThan(1)
  })
  it('三档颜色分别取红 / 黄 / 绿的主题色', () => {
    const svg = render('low')
    const strokes = [...svg.querySelectorAll('path')].slice(0, 3).map((p) => (p as SVGPathElement).style.stroke)
    expect(strokes).toEqual(['var(--color-down)', 'var(--color-warning)', 'var(--color-up)'])
  })
  it('不传档位：单色表盘，读屏叫「燃料费」', () => {
    const svg = render()
    expect(svg.getAttribute('aria-label')).toBe('燃料费')
    expect(svg.getAttribute('data-fuel-level')).toBe('none')
  })
})
