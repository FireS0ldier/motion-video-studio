/**
 * Device frames for screenshots and screen recordings. Each takes a content
 * callback that receives the screen rect (already clipped), so anything can be
 * shown inside: g.image(), g.video(), live UI drawn with the kit.
 */

import type { Rect } from '../core/types.ts'
import type { Graphics, ShadowInput } from '../gfx/graphics.ts'
import { alpha, shade } from '../gfx/color.ts'

export interface BrowserOptions {
  x: number
  y: number
  w: number
  h: number
  url?: string
  title?: string
  theme?: 'dark' | 'light'
  radius?: number
  shadow?: ShadowInput
  /** Hide the toolbar (minimal window). */
  minimal?: boolean
  opacity?: number
}

/** Desktop browser window centered on (x, y). Returns the content rect. */
export function browser(g: Graphics, o: BrowserOptions, content?: (screen: Rect) => void): Rect {
  const dark = (o.theme ?? 'dark') === 'dark'
  const r = o.radius ?? 18
  const bar = o.minimal ? 34 : 52
  const left = o.x - o.w / 2
  const top = o.y - o.h / 2
  const chrome = dark ? '#1b1d24' : '#eceef2'
  const screen: Rect = { x: left, y: top + bar, w: o.w, h: o.h - bar }
  g.group({ opacity: o.opacity }, () => {
    g.rect({ x: o.x, y: o.y, w: o.w, h: o.h, radius: r, fill: chrome, shadow: o.shadow ?? 'lg' })
    // traffic lights
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => g.circle({ x: left + 24 + i * 22, y: top + bar / 2, r: 6.5, fill: c }))
    if (!o.minimal) {
      const pillW = Math.min(o.w * 0.46, 560)
      g.rect({ x: o.x, y: top + bar / 2, w: pillW, h: 30, radius: 'pill', fill: dark ? '#2a2d36' : '#ffffff' })
      g.icon('lock', { x: o.x - pillW / 2 + 22, y: top + bar / 2, size: 15, color: dark ? '#9aa0ad' : '#6b7280', stroke: 2.4 })
      g.text(o.url ?? 'app.example.com', { x: o.x - pillW / 2 + 38, y: top + bar / 2 + 1, align: 'left', size: 16, weight: 500, color: dark ? '#c9ccd4' : '#374151' })
    } else if (o.title) {
      g.text(o.title, { x: o.x, y: top + bar / 2, size: 15, weight: 600, color: dark ? '#c9ccd4' : '#374151' })
    }
    g.group({ clip: { rect: [screen.x, screen.y, screen.w, screen.h], radius: [0, 0, r, r] } }, () => {
      g.rect({ x: o.x, y: screen.y + screen.h / 2, w: o.w, h: screen.h, fill: dark ? '#0f1116' : '#ffffff' })
      content?.(screen)
    })
    g.rect({ x: o.x, y: o.y, w: o.w, h: o.h, radius: r, stroke: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)', lineWidth: 1.5 })
  })
  return screen
}

export interface PhoneOptions {
  x: number
  y: number
  /** Height of the phone; width follows a modern 19.5:9 aspect. */
  h: number
  color?: string
  shadow?: ShadowInput
  /** Draw the status bar (time, battery). */
  statusBar?: boolean
  theme?: 'dark' | 'light'
  opacity?: number
}

/** Modern phone with dynamic island, centered on (x, y). Returns the screen rect. */
export function phone(g: Graphics, o: PhoneOptions, content?: (screen: Rect) => void): Rect {
  const h = o.h
  const w = h * 0.4615
  const bezel = h * 0.018
  const r = h * 0.075
  const left = o.x - w / 2
  const top = o.y - h / 2
  const body = o.color ?? '#1c1d22'
  const screen: Rect = { x: left + bezel, y: top + bezel, w: w - 2 * bezel, h: h - 2 * bezel }
  const dark = (o.theme ?? 'dark') === 'dark'
  g.group({ opacity: o.opacity }, () => {
    // side buttons
    g.rect({ x: left - 2, y: top + h * 0.22, w: 5, h: h * 0.05, radius: 2, fill: shade(body, 0.08), anchor: 'left' })
    g.rect({ x: left - 2, y: top + h * 0.3, w: 5, h: h * 0.08, radius: 2, fill: shade(body, 0.08), anchor: 'left' })
    g.rect({ x: left + w + 2, y: top + h * 0.28, w: 5, h: h * 0.11, radius: 2, fill: shade(body, 0.08), anchor: 'right' })
    g.rect({ x: o.x, y: o.y, w, h, radius: r, fill: { type: 'linear', from: [left, top], to: [left + w, top + h], stops: [shade(body, 0.1), body, shade(body, -0.04)] }, shadow: o.shadow ?? 'lg' })
    g.rect({ x: o.x, y: o.y, w: w - 3, h: h - 3, radius: r - 1.5, stroke: 'rgba(255,255,255,0.14)', lineWidth: 1.5 })
    g.group({ clip: { rect: [screen.x, screen.y, screen.w, screen.h], radius: r - bezel } }, () => {
      g.rect({ x: o.x, y: o.y, w: screen.w, h: screen.h, fill: dark ? '#0b0c10' : '#f7f7f9' })
      content?.(screen)
      if (o.statusBar !== false) {
        const sy = screen.y + h * 0.032
        const col = dark ? '#ffffff' : '#111111'
        g.text('9:41', { x: screen.x + screen.w * 0.17, y: sy, size: h * 0.022, weight: 650, color: col })
        g.rect({ x: screen.x + screen.w * 0.86, y: sy, w: h * 0.034, h: h * 0.016, radius: h * 0.004, stroke: col, lineWidth: 1.5 })
        g.rect({ x: screen.x + screen.w * 0.86 - 1, y: sy, w: h * 0.026, h: h * 0.011, radius: h * 0.003, fill: col })
      }
    })
    // dynamic island
    g.rect({ x: o.x, y: screen.y + h * 0.032, w: w * 0.3, h: h * 0.036, radius: 'pill', fill: '#000' })
  })
  return screen
}

/** Floating glass panel (frosted look without real blur: layered translucent fills). */
export function glass(g: Graphics, o: { x: number; y: number; w: number; h: number; radius?: number; tint?: string; opacity?: number; shadow?: ShadowInput }) {
  const tint = g.color(o.tint ?? 'surface')
  g.rect({ x: o.x, y: o.y, w: o.w, h: o.h, radius: o.radius ?? 'lg', fill: alpha(tint, 0.72 * (o.opacity ?? 1)), shadow: o.shadow ?? 'md' })
  g.rect({
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    radius: o.radius ?? 'lg',
    fill: { type: 'linear', from: [o.x - o.w / 2, o.y - o.h / 2], to: [o.x + o.w / 2, o.y + o.h / 2], stops: [alpha('#ffffff', 0.07), alpha('#ffffff', 0.01)] },
    stroke: alpha('#ffffff', 0.12),
    lineWidth: 1.5,
  })
}
