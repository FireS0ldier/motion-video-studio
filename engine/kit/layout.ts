/**
 * Layout helpers so scenes adapt to every format (16:9, 9:16, 1:1, 4K)
 * without magic numbers.
 */

import type { Rect, Stage } from '../core/types.ts'

export interface Responsive {
  /** Size multiplier for type and UI (1 at 1920x1080; larger on 4K-native, ≥0.72 on mobile formats). */
  s: number
  portrait: boolean
  square: boolean
  landscape: boolean
  /** Content area (title-safe). */
  area: Rect
}

export function responsive(stage: Stage): Responsive {
  const s = Math.max(0.72, Math.min(2, Math.min(stage.w / 1920, stage.h / 1080)))
  return { s, portrait: stage.portrait, square: stage.square, landscape: stage.landscape, area: stage.title }
}

/** Centers of n items in a row of width w centered on x (or fixed item width with gap). */
export function row(n: number, o: { x: number; w: number; gap?: number; item?: number }): number[] {
  if (n <= 0) return []
  if (o.item !== undefined) {
    const gap = o.gap ?? 0
    const total = n * o.item + (n - 1) * gap
    return Array.from({ length: n }, (_, i) => o.x - total / 2 + o.item! / 2 + i * (o.item! + gap))
  }
  const step = o.w / n
  return Array.from({ length: n }, (_, i) => o.x - o.w / 2 + step * (i + 0.5))
}

/** Cells of a grid inside a rect (row-major). */
export function grid(n: number, cols: number, r: Rect, gap = 24): Rect[] {
  const rows = Math.ceil(n / cols)
  const cw = (r.w - gap * (cols - 1)) / cols
  const ch = (r.h - gap * (rows - 1)) / rows
  return Array.from({ length: n }, (_, i) => ({ x: r.x + (i % cols) * (cw + gap), y: r.y + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }))
}

/** Split a rect into two parts (side by side on landscape, stacked on portrait). */
export function split(r: Rect, ratio: number, gap: number, vertical: boolean): [Rect, Rect] {
  if (vertical) {
    const h1 = (r.h - gap) * ratio
    return [
      { x: r.x, y: r.y, w: r.w, h: h1 },
      { x: r.x, y: r.y + h1 + gap, w: r.w, h: r.h - h1 - gap },
    ]
  }
  const w1 = (r.w - gap) * ratio
  return [
    { x: r.x, y: r.y, w: w1, h: r.h },
    { x: r.x + w1 + gap, y: r.y, w: r.w - w1 - gap, h: r.h },
  ]
}

export const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2]

/** Fit a w×h box into a rect keeping aspect ratio. */
export function fitBox(w: number, h: number, into: Rect, mode: 'contain' | 'cover' = 'contain'): Rect {
  const k = mode === 'contain' ? Math.min(into.w / w, into.h / h) : Math.max(into.w / w, into.h / h)
  const ww = w * k
  const hh = h * k
  return { x: into.x + (into.w - ww) / 2, y: into.y + (into.h - hh) / 2, w: ww, h: hh }
}

export function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d }
}
