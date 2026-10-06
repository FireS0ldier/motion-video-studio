/** Logo rendering and the classic logo reveal. */

import type { Anchor } from '../core/scene.ts'
import type { Graphics } from '../gfx/graphics.ts'
import { ease } from '../motion/easing.ts'
import { clamp01 } from '../motion/tween.ts'

/**
 * Draw the brand logo (brand.logo.full or .mark, an SVG/PNG in the project's
 * assets) centered at (x, y) with height h. Falls back to the brand name as text.
 */
export function logo(g: Graphics, o: { x: number; y: number; h: number; variant?: 'full' | 'mark'; opacity?: number; color?: string }) {
  const brand = g.brand
  const variant = o.variant ?? 'full'
  const file = (p: string) => p.replace(/^assets\//, '')
  const drawFile = (p: string, x: number, h: number) => {
    const size = g.assets.size(file(p))
    const w = size ? (h * size[0]) / size[1] : h
    g.image(file(p), { x: x + w / 2, y: o.y, w, h, fit: 'contain' })
    return w
  }
  if (variant === 'full' && brand.logo?.full) {
    const size = g.assets.size(file(brand.logo.full))
    const w = size ? (o.h * size[0]) / size[1] : o.h
    g.group({ opacity: o.opacity }, () => drawFile(brand.logo!.full!, o.x - w / 2, o.h))
    return w
  }
  if (brand.logo?.mark) {
    if (variant === 'mark') {
      g.group({ opacity: o.opacity }, () => drawFile(brand.logo!.mark!, o.x - o.h / 2, o.h))
      return o.h
    }
    // mark + wordmark set in the display font
    const size = o.h * 0.78
    const tw = g.measure(brand.name, { size, weight: 760, tracking: -0.045 }).w
    const gap = o.h * 0.32
    const total = o.h + gap + tw
    g.group({ opacity: o.opacity }, () => {
      drawFile(brand.logo!.mark!, o.x - total / 2, o.h)
      g.text(brand.name, { x: o.x - total / 2 + o.h + gap, y: o.y, size, weight: 760, tracking: -0.045, align: 'left', color: o.color ?? 'text' })
    })
    return total
  }
  g.text(brand.name, { x: o.x, y: o.y, size: o.h * 0.9, weight: 760, tracking: -0.04, color: o.color ?? 'text', opacity: o.opacity })
  return g.measure(brand.name, { size: o.h * 0.9, weight: 760 }).w
}

/**
 * Logo reveal: the mark springs in with a light burst, then the wordmark
 * slides out from behind it. Uses brand.logo.mark + a text wordmark when
 * there is no full logo file.
 */
export function logoReveal(g: Graphics, o: { x: number; y: number; h: number; at: Anchor; wordmark?: string; glow?: boolean }) {
  const f = g.f
  const s = f.spring(o.at, 'bouncy')
  if (s <= 0.001) return
  const since = f.since(o.at)
  const name = o.wordmark ?? g.brand.name
  const size = o.h * 0.78
  const textW = g.measure(name, { size, weight: 760, tracking: -0.045 }).w
  const gap = o.h * 0.35
  const slide = ease('expoOut')(clamp01((since - 0.25) / 0.7))
  const total = o.h + gap + textW
  const markX = o.x - (total / 2 - o.h / 2) * slide
  if (o.glow !== false) {
    const burst = clamp01(1 - since / 1.2)
    g.glow({ x: markX, y: o.y, r: o.h * (1.2 + 2 * (1 - burst)), color: 'primary', intensity: 0.9 * burst })
  }
  const textX = markX + o.h / 2 + gap
  g.group({ clip: { rect: [markX + o.h * 0.45, o.y - o.h, total + o.h, o.h * 2] } }, () => {
    g.text(name, { x: textX - (1 - slide) * textW * 0.6, y: o.y, size, weight: 760, tracking: -0.045, align: 'left', opacity: slide })
  })
  g.group({ x: markX, y: o.y, scale: s, rotate: (1 - Math.min(1, s)) * -25 }, () => {
    if (g.brand.logo?.mark) logo(g, { x: 0, y: 0, h: o.h, variant: 'mark' })
    else {
      g.rect({ x: 0, y: 0, w: o.h, h: o.h, radius: o.h * 0.28, fill: 'gradient:brand' })
      g.text(name.slice(0, 1), { x: 0, y: 0, size: o.h * 0.6, weight: 800, color: '#ffffff' })
    }
  })
  // a short flash ring
  const ring = clamp01(since / 0.6)
  if (ring < 1) g.circle({ x: markX, y: o.y, r: o.h * (0.6 + ring * 1.4), stroke: 'primary', lineWidth: 3 * (1 - ring), opacity: 1 - ring })
}
