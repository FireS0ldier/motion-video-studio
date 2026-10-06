/**
 * Backgrounds: animated, cheap (gradients only, no blur filters), brand-aware.
 * Call one first in render(): kit.background(g, { kind: 'mesh' }).
 */

import type { Graphics } from '../gfx/graphics.ts'
import { alpha, mixColor } from '../gfx/color.ts'
import { hash01, noise1, rng } from '../motion/noise.ts'

export type BackgroundKind = 'mesh' | 'grid' | 'dots' | 'spotlight' | 'gradient' | 'solid' | 'aurora'

export interface BackgroundOptions {
  kind?: BackgroundKind
  /** Base color (default brand bg). */
  base?: string
  /** Accent colors for blobs / glows (default brand primary + accent). */
  colors?: string[]
  /** 0..1 strength of colored light. */
  intensity?: number
  /** Motion speed multiplier (0 = static). */
  speed?: number
  /** Grid cell size for 'grid' / 'dots'. */
  cell?: number
  seed?: number
  /** Draw on a parallax plane this far behind (default 0 = screen-locked). */
  depth?: number
}

/** Large soft color blobs drifting slowly (premium SaaS look). */
export function meshGradient(g: Graphics, o: BackgroundOptions = {}) {
  const { stage, brand } = g
  const t = g.f.t * (o.speed ?? 1)
  const colors = o.colors ?? [brand.colors.primary, brand.colors.accent, brand.gradients.brand?.[0] ?? brand.colors.primary]
  const k = o.intensity ?? 0.55
  const seed = o.seed ?? 7
  const r = rng(seed)
  const big = Math.max(stage.w, stage.h)
  colors.forEach((c, i) => {
    const bx = stage.w * (0.2 + 0.6 * r()) + noise1(t * 0.07 + i * 10, seed) * stage.w * 0.18
    const by = stage.h * (0.15 + 0.7 * r()) + noise1(t * 0.06 + i * 20, seed + 1) * stage.h * 0.2
    const rad = big * (0.42 + 0.2 * r())
    g.circle({
      x: bx,
      y: by,
      r: rad,
      fill: { type: 'radial', at: [bx, by], r: rad, stops: [[0, alpha(c, 0.42 * k)], [0.45, alpha(c, 0.16 * k)], [1, alpha(c, 0)]] },
      blend: 'screen',
    })
  })
}

/** Thin grid lines with a radial fade (tech / developer look). */
export function gridLines(g: Graphics, o: BackgroundOptions = {}) {
  const { stage, brand } = g
  const cell = o.cell ?? 80
  const ctx = g.ctx
  const shift = ((g.f.t * (o.speed ?? 1) * 12) % cell) * (o.speed ? 1 : 0)
  ctx.strokeStyle = alpha(brand.colors.text, 0.06 * (o.intensity ?? 1))
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = (stage.w / 2) % cell; x <= stage.w; x += cell) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, stage.h)
  }
  for (let y = ((stage.h / 2) % cell) + shift; y <= stage.h; y += cell) {
    ctx.moveTo(0, y)
    ctx.lineTo(stage.w, y)
  }
  ctx.stroke()
  // fade the edges into the background
  const base = o.base ?? brand.colors.bg
  g.rect({
    x: stage.cx,
    y: stage.cy,
    w: stage.w,
    h: stage.h,
    fill: { type: 'radial', at: [stage.cx, stage.cy], r: Math.max(stage.w, stage.h) * 0.62, stops: [[0, alpha(base, 0)], [0.55, alpha(base, 0.35)], [1, alpha(base, 1)]] },
  })
}

/** Dot matrix with a soft fade. */
export function dots(g: Graphics, o: BackgroundOptions = {}) {
  const { stage, brand } = g
  const cell = o.cell ?? 36
  const ctx = g.ctx
  ctx.fillStyle = alpha(brand.colors.text, 0.13 * (o.intensity ?? 1))
  for (let y = cell / 2; y < stage.h; y += cell) for (let x = cell / 2; x < stage.w; x += cell) ctx.fillRect(x - 1, y - 1, 2, 2)
  const base = o.base ?? brand.colors.bg
  g.rect({ x: stage.cx, y: stage.cy, w: stage.w, h: stage.h, fill: { type: 'radial', at: [stage.cx, stage.cy], r: Math.max(stage.w, stage.h) * 0.6, stops: [[0, alpha(base, 0)], [1, alpha(base, 0.95)]] } })
}

/** Soft aurora ribbons (organic, calm). */
export function aurora(g: Graphics, o: BackgroundOptions = {}) {
  const { stage, brand } = g
  const t = g.f.t * (o.speed ?? 1)
  const colors = o.colors ?? [brand.colors.primary, brand.colors.accent]
  const ctx = g.ctx
  ctx.globalCompositeOperation = 'screen'
  colors.forEach((c, i) => {
    const grad = ctx.createLinearGradient(0, 0, stage.w, stage.h)
    grad.addColorStop(0, alpha(c, 0))
    grad.addColorStop(0.5, alpha(c, 0.22 * (o.intensity ?? 1)))
    grad.addColorStop(1, alpha(c, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    const amp = stage.h * 0.12
    const base = stage.h * (0.35 + i * 0.25)
    ctx.moveTo(0, base)
    for (let x = 0; x <= stage.w; x += 40) ctx.lineTo(x, base + Math.sin(x / 300 + t * 0.4 + i) * amp + noise1(x / 500 + t * 0.2, i) * amp)
    ctx.lineTo(stage.w, base + stage.h * 0.3)
    for (let x = stage.w; x >= 0; x -= 40) ctx.lineTo(x, base + stage.h * 0.3 + Math.sin(x / 260 + t * 0.3) * amp * 0.6)
    ctx.closePath()
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * Full background in one call. Default 'mesh'. Always paints the base color
 * first, so scenes never show through to black.
 */
export function background(g: Graphics, o: BackgroundOptions = {}) {
  const { stage, brand } = g
  const base = o.base ?? brand.colors.bg
  const draw = () => {
    g.fill(base)
    switch (o.kind ?? 'mesh') {
      case 'solid':
        break
      case 'gradient':
        g.fill({ type: 'linear', from: [0, 0], to: [stage.w, stage.h], stops: [mixColor(base, (o.colors ?? [brand.colors.primary])[0]!, 0.18 * (o.intensity ?? 1)), base] })
        break
      case 'spotlight':
        g.fill({ type: 'radial', at: [stage.cx, stage.h * 0.38], r: Math.max(stage.w, stage.h) * 0.7, stops: [[0, mixColor(base, (o.colors ?? [brand.colors.primary])[0]!, 0.25 * (o.intensity ?? 1))], [1, base]] })
        break
      case 'grid':
        meshGradient(g, { ...o, intensity: (o.intensity ?? 0.5) * 0.7 })
        gridLines(g, o)
        break
      case 'dots':
        meshGradient(g, { ...o, intensity: (o.intensity ?? 0.5) * 0.7 })
        dots(g, o)
        break
      case 'aurora':
        aurora(g, o)
        break
      case 'mesh':
        meshGradient(g, o)
        break
    }
  }
  if (o.depth) g.plane(o.depth, draw)
  else g.screen(draw)
}

/** Deterministic floating particles / bokeh. */
export function particles(g: Graphics, o: { count?: number; color?: string; size?: [number, number]; speed?: number; seed?: number; opacity?: number; area?: { x: number; y: number; w: number; h: number } } = {}) {
  const { stage, brand } = g
  const area = o.area ?? { x: 0, y: 0, w: stage.w, h: stage.h }
  const n = o.count ?? 40
  const t = g.f.t * (o.speed ?? 1)
  const color = g.color(o.color ?? brand.colors.text)
  const [s0, s1] = o.size ?? [1.5, 4]
  for (let i = 0; i < n; i++) {
    const px = area.x + ((hash01(i, 1, o.seed ?? 3) * area.w + noise1(t * 0.1 + i, 9) * 60 + t * 6 * (hash01(i, 2) - 0.5)) % area.w + area.w) % area.w
    const py = area.y + ((hash01(i, 3, o.seed ?? 3) * area.h - t * 14 * (0.3 + hash01(i, 4))) % area.h + area.h) % area.h
    const size = s0 + (s1 - s0) * hash01(i, 5)
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * (0.8 + hash01(i, 6)) + i))
    g.circle({ x: px, y: py, r: size, fill: alpha(color, (o.opacity ?? 0.35) * tw) })
  }
}

/** Light sweep (sheen) across a rect, e.g. over a card or a logo. progress 0..1 moves it across. */
export function sheen(g: Graphics, o: { x: number; y: number; w: number; h: number; progress: number; radius?: number; width?: number; color?: string; opacity?: number }) {
  if (o.progress <= 0 || o.progress >= 1) return
  const left = o.x - o.w / 2
  const top = o.y - o.h / 2
  const band = (o.width ?? 0.35) * o.w
  const cx = left - band + (o.w + band * 2) * o.progress
  const color = g.color(o.color ?? '#ffffff')
  g.group({ clip: { rect: [left, top, o.w, o.h], radius: o.radius ?? 0 } }, () => {
    g.rect({
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      blend: 'screen',
      fill: { type: 'linear', from: [cx - band, top], to: [cx + band, top + o.h * 0.4], stops: [[0, alpha(color, 0)], [0.5, alpha(color, o.opacity ?? 0.22)], [1, alpha(color, 0)]] },
    })
  })
}
