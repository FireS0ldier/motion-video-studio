/** Animated charts and numbers. `progress` 0..1 drives the build-up. */

import type { Graphics, Paint } from '../gfx/graphics.ts'
import { alpha } from '../gfx/color.ts'
import { ease } from '../motion/easing.ts'
import { clamp01 } from '../motion/tween.ts'

export function formatNumber(v: number, o: { decimals?: number; prefix?: string; suffix?: string; compact?: boolean; separator?: string } = {}): string {
  let n = v
  let unit = ''
  if (o.compact) {
    if (Math.abs(n) >= 1e9) [n, unit] = [n / 1e9, 'B']
    else if (Math.abs(n) >= 1e6) [n, unit] = [n / 1e6, 'M']
    else if (Math.abs(n) >= 1e3) [n, unit] = [n / 1e3, 'k']
  }
  const d = o.decimals ?? (o.compact && unit ? 1 : 0)
  const fixed = n.toFixed(d)
  const [int, frac] = fixed.split('.')
  const sep = o.separator ?? ','
  const withSep = int!.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  return `${o.prefix ?? ''}${withSep}${frac ? '.' + frac : ''}${unit}${o.suffix ?? ''}`
}

export interface BarChartOptions {
  x: number
  y: number
  w: number
  h: number
  values: number[]
  labels?: string[]
  progress: number
  color?: Paint
  /** Index of a bar to emphasize (others are dimmed). */
  highlight?: number
  max?: number
  radius?: number
  gap?: number
  showValues?: boolean
  format?: Parameters<typeof formatNumber>[1]
}

/** Vertical bar chart centered on (x, y); bars grow with a stagger. */
export function barChart(g: Graphics, o: BarChartOptions) {
  const n = o.values.length
  const max = o.max ?? Math.max(...o.values) * 1.08
  const gap = o.gap ?? 0.32
  const labelH = o.labels ? 40 : 0
  const left = o.x - o.w / 2
  const bottom = o.y + o.h / 2 - labelH
  const plotH = o.h - labelH
  const bw = o.w / (n + (n - 1) * gap)
  // baseline
  g.line({ from: [left, bottom], to: [left + o.w, bottom], stroke: 'border', lineWidth: 2 })
  o.values.forEach((v, i) => {
    const p = ease('expoOut')(clamp01(o.progress * (1 + n * 0.12) - i * 0.12))
    const bh = Math.max(0, (v / max) * plotH * p)
    const bx = left + i * bw * (1 + gap) + bw / 2
    const dim = o.highlight !== undefined && o.highlight !== i
    if (bh > 0.5) g.rect({ x: bx, y: bottom, w: bw, h: bh, anchor: 'bottom', radius: [o.radius ?? 10, o.radius ?? 10, 2, 2], fill: o.color ?? { type: 'linear', from: [0, bottom - plotH], to: [0, bottom], stops: [g.color('primary'), g.color('accent')] }, opacity: dim ? 0.35 : 1 })
    if (o.showValues && p > 0.05) g.text(formatNumber(v * p, o.format), { x: bx, y: bottom - bh - 22, size: 22, weight: 650, font: 'numeric', opacity: clamp01(p * 2) })
    if (o.labels?.[i]) g.text(o.labels[i]!, { x: bx, y: bottom + 24, size: 19, color: 'muted', opacity: clamp01(o.progress * 3) })
  })
}

export interface LineChartOptions {
  x: number
  y: number
  w: number
  h: number
  values: number[]
  progress: number
  color?: string
  fill?: boolean
  dots?: boolean
  min?: number
  max?: number
  lineWidth?: number
  /** Show a glowing dot at the head of the line. */
  head?: boolean
}

/** Line chart that draws on from left to right, with a gradient area fill. */
export function lineChart(g: Graphics, o: LineChartOptions) {
  const n = o.values.length
  const min = o.min ?? Math.min(...o.values)
  const max = o.max ?? Math.max(...o.values)
  const left = o.x - o.w / 2
  const top = o.y - o.h / 2
  const pts: Array<[number, number]> = o.values.map((v, i) => [left + (i / (n - 1)) * o.w, top + o.h - ((v - min) / Math.max(1e-9, max - min)) * o.h])
  const p = clamp01(o.progress)
  if (p <= 0) return
  const color = g.color(o.color ?? 'accent')
  // partial polyline up to progress
  const cut = p * (n - 1)
  const k = Math.floor(cut)
  const part = pts.slice(0, k + 1)
  if (k < n - 1) {
    const a = pts[k]!
    const b = pts[k + 1]!
    const f = cut - k
    part.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
  }
  if (o.fill !== false && part.length > 1) {
    const area: Array<[number, number]> = [...part, [part[part.length - 1]![0], top + o.h], [part[0]![0], top + o.h]]
    g.poly(area, { closed: true, fill: { type: 'linear', from: [0, top], to: [0, top + o.h], stops: [alpha(color, 0.35), alpha(color, 0)] } })
  }
  g.poly(part, { stroke: color, lineWidth: o.lineWidth ?? 5, smooth: true })
  if (o.dots) part.slice(0, k + 1).forEach(([x, y]) => g.circle({ x, y, r: 6, fill: g.color('bg'), stroke: color, lineWidth: 3 }))
  if (o.head !== false) {
    const [hx, hy] = part[part.length - 1]!
    g.glow({ x: hx, y: hy, r: 40, color, intensity: 0.6 })
    g.circle({ x: hx, y: hy, r: 8, fill: color, stroke: '#ffffff', lineWidth: 3 })
  }
}

/** Donut / ring chart; segments fill clockwise with progress. */
export function donut(g: Graphics, o: { x: number; y: number; r: number; thickness?: number; segments: Array<{ value: number; color?: string }>; progress: number; track?: string }) {
  const th = o.thickness ?? o.r * 0.22
  const total = o.segments.reduce((s, x) => s + x.value, 0)
  g.arc({ x: o.x, y: o.y, r: o.r, stroke: o.track ?? 'surface2', lineWidth: th })
  let acc = 0
  const p = clamp01(o.progress)
  const colors = [g.color('primary'), g.color('accent'), g.color('warning'), g.color('danger')]
  o.segments.forEach((s, i) => {
    const a0 = (acc / total) * 360
    acc += s.value
    const a1 = (acc / total) * 360
    const visEnd = Math.min(a1, p * 360)
    if (visEnd <= a0) return
    g.arc({ x: o.x, y: o.y, r: o.r, start: a0, end: visEnd, stroke: s.color ?? colors[i % colors.length]!, lineWidth: th, lineCap: 'butt' })
  })
}

/** Ring progress (single value 0..1) with a centered label. */
export function ring(g: Graphics, o: { x: number; y: number; r: number; value: number; color?: string; label?: string; thickness?: number }) {
  const th = o.thickness ?? o.r * 0.16
  g.arc({ x: o.x, y: o.y, r: o.r, stroke: 'surface2', lineWidth: th })
  if (o.value > 0) g.arc({ x: o.x, y: o.y, r: o.r, end: 360 * clamp01(o.value), stroke: o.color ?? 'accent', lineWidth: th })
  if (o.label) g.text(o.label, { x: o.x, y: o.y, size: o.r * 0.5, weight: 700, font: 'numeric' })
}

/** Big animated number ("40%", "3×", "$1.2M") with optional label underneath. */
export function counter(g: Graphics, o: { x: number; y: number; value: number; progress: number; size?: number; label?: string; color?: Paint; format?: Parameters<typeof formatNumber>[1]; align?: 'left' | 'center' | 'right' }) {
  const p = ease('expoOut')(clamp01(o.progress))
  const size = o.size ?? 140
  g.text(formatNumber(o.value * p, o.format), { x: o.x, y: o.y, style: 'number', size, color: o.color ?? 'text', align: o.align, opacity: clamp01(o.progress * 4) })
  if (o.label) g.text(o.label, { x: o.x, y: o.y + size * 0.72, style: 'label', color: 'muted', align: o.align, opacity: clamp01(o.progress * 2 - 0.3) })
}
