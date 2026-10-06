/**
 * UI building blocks with built-in microinteractions. All positioned by center.
 * Progress values (0..1) come from f.in(...) / f.spring(...) in the scene.
 */

import type { Anchor } from '../core/scene.ts'
import type { Graphics, Paint, RadiusInput, ShadowInput } from '../gfx/graphics.ts'
import { alpha, contrast, mixColor, shade } from '../gfx/color.ts'
import { ease } from '../motion/easing.ts'
import { followPath, type Waypoint } from '../motion/path.ts'
import { spring } from '../motion/spring.ts'
import { clamp01 } from '../motion/tween.ts'

export function card(g: Graphics, o: { x: number; y: number; w: number; h: number; radius?: RadiusInput; fill?: Paint; border?: boolean; shadow?: ShadowInput; glow?: string; opacity?: number }) {
  g.group({ opacity: o.opacity }, () => {
    // glow: the shadow of a same-size shape, which the card body then covers
    if (o.glow) g.rect({ x: o.x, y: o.y, w: o.w, h: o.h, radius: o.radius ?? 'lg', fill: 'surface', shadow: [{ x: 0, y: 0, blur: 70, color: alpha(g.color(o.glow), 0.55) }] })
    g.rect({ x: o.x, y: o.y, w: o.w, h: o.h, radius: o.radius ?? 'lg', fill: o.fill ?? 'surface', shadow: o.shadow ?? 'md' })
    if (o.border !== false) g.rect({ x: o.x, y: o.y, w: o.w - 1, h: o.h - 1, radius: o.radius ?? 'lg', stroke: 'border', lineWidth: 1.5 })
  })
}

export interface ButtonOptions {
  x: number
  y: number
  label: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'gradient'
  size?: number
  icon?: string
  /** 0..1 press amount (scale down + darken), e.g. from kit.clickPulse(). */
  press?: number
  /** 0..1 hover glow. */
  hover?: number
  opacity?: number
  w?: number
}

export function button(g: Graphics, o: ButtonOptions) {
  const size = o.size ?? 30
  const m = g.measure(o.label, { size, weight: 620 })
  const padX = size * 1.1
  const iconW = o.icon ? size * 1.1 : 0
  const w = o.w ?? m.w + padX * 2 + iconW
  const h = size * 2.2
  const v = o.variant ?? 'primary'
  const press = o.press ?? 0
  const base = v === 'secondary' ? g.color('surface2') : v === 'ghost' ? 'rgba(0,0,0,0)' : g.color('primary')
  const fill: Paint = v === 'gradient' ? `gradient:brand` : mixColor(base, '#000000', press * 0.18)
  const textColor = v === 'primary' || v === 'gradient' ? (contrast(g.color('primary'), '#ffffff') > 3 ? '#ffffff' : '#0b0c10') : g.color('text')
  g.group({ x: o.x, y: o.y, scale: 1 - press * 0.06, opacity: o.opacity }, () => {
    if (o.hover) g.rect({ x: 0, y: 0, w, h, radius: 'pill', fill, shadow: [{ x: 0, y: 8, blur: 40, color: alpha(g.color('primary'), 0.55 * o.hover) }] })
    g.rect({ x: 0, y: 0, w, h, radius: 'pill', fill, stroke: v === 'secondary' || v === 'ghost' ? 'border' : undefined, lineWidth: 1.5, shadow: v === 'ghost' ? undefined : 'sm' })
    // top highlight
    if (v === 'primary' || v === 'gradient') g.rect({ x: 0, y: -h * 0.25, w: w - h * 0.5, h: h * 0.4, radius: 'pill', fill: { type: 'linear', from: [0, -h / 2], to: [0, 0], stops: [alpha('#ffffff', 0.22), alpha('#ffffff', 0)] } })
    if (o.icon) g.icon(o.icon, { x: -w / 2 + padX + size * 0.45, y: 0, size: size * 0.9, color: textColor, stroke: 2.4 })
    g.text(o.label, { x: iconW / 2, y: 0, size, weight: 620, color: textColor })
  })
}

export function pill(g: Graphics, o: { x: number; y: number; label: string; color?: string; icon?: string; size?: number; opacity?: number; filled?: boolean }) {
  const size = o.size ?? 22
  const color = g.color(o.color ?? 'accent')
  const m = g.measure(o.label, { size, weight: 600 })
  const iconW = o.icon ? size * 1.2 : 0
  const w = m.w + size * 1.6 + iconW
  const h = size * 1.9
  g.group({ x: o.x, y: o.y, opacity: o.opacity }, () => {
    g.rect({ x: 0, y: 0, w, h, radius: 'pill', fill: o.filled ? color : alpha(color, 0.14), stroke: o.filled ? undefined : alpha(color, 0.45), lineWidth: 1.5 })
    if (o.icon) g.icon(o.icon, { x: -w / 2 + size * 0.8 + size * 0.45, y: 0, size: size * 0.95, color: o.filled ? '#ffffff' : color, stroke: 2.4 })
    g.text(o.label, { x: iconW / 2, y: 0, size, weight: 600, color: o.filled ? '#ffffff' : color })
  })
  return { w, h }
}

/** Animated toggle switch; `on` 0..1. */
export function toggle(g: Graphics, o: { x: number; y: number; on: number; size?: number; color?: string }) {
  const s = o.size ?? 44
  const w = s * 1.75
  const on = clamp01(o.on)
  g.rect({ x: o.x, y: o.y, w, h: s, radius: 'pill', fill: mixColor(g.color('surface2'), g.color(o.color ?? 'success'), on) })
  const knob = o.x - w / 2 + s / 2 + (w - s) * on
  g.circle({ x: knob, y: o.y, r: s * 0.42, fill: '#ffffff', shadow: 'sm' })
}

export function avatar(g: Graphics, o: { x: number; y: number; r: number; initials?: string; color?: string; image?: string; ring?: string }) {
  if (o.ring) g.circle({ x: o.x, y: o.y, r: o.r + 3, fill: g.color(o.ring) })
  if (o.image) {
    g.group({ clip: { circle: [o.x, o.y, o.r] } }, () => g.image(o.image!, { x: o.x, y: o.y, w: o.r * 2, h: o.r * 2, fit: 'cover' }))
    return
  }
  const c = g.color(o.color ?? 'primary')
  g.circle({ x: o.x, y: o.y, r: o.r, fill: { type: 'linear', from: [o.x - o.r, o.y - o.r], to: [o.x + o.r, o.y + o.r], stops: [shade(c, 0.12), shade(c, -0.08)] } })
  if (o.initials) g.text(o.initials, { x: o.x, y: o.y, size: o.r * 0.8, weight: 650, color: '#ffffff' })
}

export function progressBar(g: Graphics, o: { x: number; y: number; w: number; h?: number; value: number; color?: Paint; track?: string }) {
  const h = o.h ?? 10
  g.rect({ x: o.x, y: o.y, w: o.w, h, radius: 'pill', fill: o.track ?? 'surface2' })
  const v = clamp01(o.value)
  if (v > 0) g.rect({ x: o.x - o.w / 2, y: o.y, w: Math.max(h, o.w * v), h, radius: 'pill', fill: o.color ?? 'gradient:brand', anchor: 'left' })
}

/** Circle with a check mark drawn on; progress 0..1. */
export function check(g: Graphics, o: { x: number; y: number; size?: number; progress: number; color?: string }) {
  const s = o.size ?? 40
  const p = clamp01(o.progress)
  if (p <= 0) return
  const c = g.color(o.color ?? 'success')
  g.circle({ x: o.x, y: o.y, r: (s / 2) * Math.min(1, spring(p * 0.6, 'bouncy')), fill: c })
  const pts: Array<[number, number]> = [
    [o.x - s * 0.22, o.y + s * 0.01],
    [o.x - s * 0.06, o.y + s * 0.17],
    [o.x + s * 0.24, o.y - s * 0.16],
  ]
  g.poly(pts, { stroke: '#ffffff', lineWidth: s * 0.1, progress: clamp01((p - 0.35) / 0.65) })
}

/** Notification / toast card that slides in at `at` and out before `until`. */
export function toast(g: Graphics, o: { x: number; y: number; w?: number; title: string; body?: string; icon?: string; iconColor?: string; at: Anchor; until?: Anchor; from?: 'top' | 'right' | 'bottom' }) {
  const f = g.f
  const w = o.w ?? 520
  const h = o.body ? 104 : 76
  const pin = f.spring(o.at, 'snappy')
  const out = o.until !== undefined ? ease('quintIn')(clamp01(f.since(o.until) / 0.35)) : 0
  if (pin <= 0.001 || out >= 1) return
  const dir = o.from ?? 'top'
  const dx = dir === 'right' ? (1 - pin) * (w + 80) + out * (w + 80) : 0
  const dy = dir === 'top' ? -(1 - pin) * (h + 60) - out * (h + 60) : dir === 'bottom' ? (1 - pin) * (h + 60) + out * (h + 60) : 0
  g.group({ x: o.x + dx, y: o.y + dy, opacity: clamp01(pin * 1.5) * (1 - out) }, () => {
    card(g, { x: 0, y: 0, w, h, radius: 22, shadow: 'lg' })
    const ic = g.color(o.iconColor ?? 'primary')
    g.rect({ x: -w / 2 + 20 + 26, y: 0, w: 52, h: 52, radius: 14, fill: alpha(ic, 0.16) })
    g.icon(o.icon ?? 'bell', { x: -w / 2 + 46, y: 0, size: 28, color: ic, stroke: 2.2 })
    g.text(o.title, { x: -w / 2 + 88, y: o.body ? -16 : 0, align: 'left', size: 24, weight: 650 })
    if (o.body) g.text(o.body, { x: -w / 2 + 88, y: 18, align: 'left', size: 19, color: 'muted', maxWidth: w - 110 })
  })
}

// ------------------------------------------------------------------ cursor

export interface CursorState {
  x: number
  y: number
  /** 0..1 press amount right now. */
  press: number
  /** Seconds since the last click (Infinity before the first). */
  sinceClick: number
}

/**
 * Cursor movement along timed waypoints with clicks.
 *   const c = kit.cursorPath(f, [{ t: 0.5, at: [800, 600] }, { t: 1.4, at: [1200, 520], click: true }])
 *   ... kit.button(g, { ..., press: c.press }); kit.cursor(g, c)
 * Waypoint times are local scene seconds.
 */
export function cursorPath(f: { lt: number }, points: Array<Waypoint & { click?: boolean }>): CursorState {
  const [x, y] = followPath(f.lt, points)
  let press = 0
  let sinceClick = Infinity
  for (const p of points) {
    if (!p.click) continue
    const d = f.lt - p.t
    if (d >= -0.08 && d < 0.25) press = Math.max(press, d < 0 ? (d + 0.08) / 0.08 : 1 - d / 0.25)
    if (d >= 0) sinceClick = Math.min(sinceClick, d)
  }
  return { x, y, press: clamp01(press), sinceClick }
}

/** macOS-style arrow cursor with click ripple. */
export function cursor(g: Graphics, c: CursorState & { size?: number; color?: string; opacity?: number; kind?: 'arrow' | 'hand' }) {
  const s = (c.size ?? 34) / 24
  if (c.sinceClick < 0.6) {
    const p = c.sinceClick / 0.6
    g.circle({ x: c.x, y: c.y, r: 14 + 40 * ease('expoOut')(p), stroke: g.color(c.color ?? 'primary'), lineWidth: 3 * (1 - p), opacity: 1 - p })
  }
  g.group({ x: c.x, y: c.y, scale: s * (1 - c.press * 0.12), opacity: c.opacity }, () => {
    if ((c.kind ?? 'arrow') === 'hand') {
      g.icon('pointer', { x: 6, y: 10, size: 24, color: '#111', fill: '#ffffff', stroke: 1.6 })
      return
    }
    const path = 'M0 0 L0 17.5 L4.4 13.4 L7.4 20.2 L10.3 18.9 L7.4 12.3 L13.2 12.3 Z'
    g.path(path, { fill: '#111111', stroke: '#ffffff', lineWidth: 1.6, shadow: [{ x: 0, y: 2, blur: 6, color: 'rgba(0,0,0,0.45)' }] })
  })
}
