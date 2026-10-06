/** Structured templates: features grid, stats, code, call to action, logo reveal. */

import { defineScene, type Anchor, type Frame, type SceneDefinition } from '../core/scene.ts'
import { alpha } from '../gfx/color.ts'
import { background, particles, type BackgroundOptions } from '../kit/backgrounds.ts'
import { combine, drift, punch } from '../kit/camera.ts'
import { counter, lineChart, type formatNumber } from '../kit/charts.ts'
import { codeBlock, terminal, type TerminalLine } from '../kit/code.ts'
import { headline } from '../kit/headline.ts'
import { grid, responsive } from '../kit/layout.ts'
import { logo, logoReveal } from '../kit/logo.ts'
import { button, card, cursor, cursorPath, pill } from '../kit/ui.ts'
import { ease } from '../motion/easing.ts'
import { spring } from '../motion/spring.ts'
import { clamp01 } from '../motion/tween.ts'
import { cueWhen, when } from './common.ts'

export interface Feature {
  icon: string
  title: string
  text?: string
  /** Default: when the title is spoken, else staggered. */
  at?: Anchor
}

export interface FeaturesOptions {
  name?: string
  eyebrow?: string
  title?: string
  features: Feature[]
  columns?: number
  at?: Anchor
  background?: BackgroundOptions
}

/** Feature cards that pop in (synced to the voiceover) and light up while being talked about. */
export function features(o: FeaturesOptions): SceneDefinition {
  const times = (f: Frame) => o.features.map((ft, i) => when(f, ft.at, ft.title, 0.5 + i * 0.35))
  return defineScene({
    name: o.name ?? 'features',
    render(f, g) {
      background(g, o.background ?? { kind: 'dots' })
      g.camera(drift(f))
      const { s, portrait, area } = responsive(f.stage)
      const t0 = f.at(o.at ?? 0)
      let top = area.y
      if (o.title) {
        const h = headline(g, { x: f.stage.cx, y: area.y + 70 * s, eyebrow: o.eyebrow, title: o.title, size: 'h2', at: { at: t0 }, exit: false })
        top = area.y + 70 * s + h / 2 + 50 * s
      }
      const n = o.features.length
      const cols = o.columns ?? (portrait ? 1 : n <= 3 ? n : n === 4 ? 2 : 3)
      const cells = grid(n, cols, { x: area.x, y: top, w: area.w, h: area.y + area.h - top }, 28 * s)
      const ts = times(f)
      const activeIdx = ts.findLastIndex((t) => f.t >= t)
      cells.forEach((c, i) => {
        const ft = o.features[i]!
        const p = spring(f.t - ts[i]!, 'snappy')
        if (p <= 0.001) return
        const active = i === activeIdx
        const lift = active ? ease('out')(clamp01((f.t - ts[i]!) / 0.4)) : 0
        const ch = Math.min(c.h, (portrait ? 190 : 300) * s)
        g.group({ x: c.x + c.w / 2, y: c.y + c.h / 2 - lift * 8, scale: 0.85 + 0.15 * Math.min(1.05, p), opacity: clamp01(p * 1.6) }, () => {
          card(g, { x: 0, y: 0, w: c.w, h: ch, radius: 'lg', glow: active ? 'primary' : undefined })
          const pad = 36 * s
          const ix = -c.w / 2 + pad + 32 * s
          const iy = portrait ? 0 : -ch / 2 + pad + 32 * s
          g.rect({ x: ix, y: iy, w: 64 * s, h: 64 * s, radius: 16 * s, fill: alpha(g.color('primary'), active ? 0.32 : 0.16) })
          g.icon(ft.icon, { x: ix, y: iy, size: 34 * s, color: active ? 'text' : 'primary', stroke: 2.2, progress: clamp01((f.t - ts[i]!) / 0.6) })
          const tx = portrait ? ix + 60 * s : -c.w / 2 + pad
          const ty = portrait ? -18 * s : iy + 70 * s
          g.text(ft.title, { x: tx, y: ty, style: 'h3', size: 38 * s, align: 'left', valign: 'top', maxWidth: c.w - pad * 2 - (portrait ? 60 * s : 0) })
          if (ft.text) g.text(ft.text, { x: tx, y: ty + 54 * s, style: 'body', size: 26 * s, color: 'muted', align: 'left', valign: 'top', maxWidth: c.w - pad * 2 - (portrait ? 60 * s : 0) })
        })
      })
    },
    cues(c) {
      return o.features.map((ft, i) => c.cue('pop', { at: cueWhen(c, ft.at, ft.title, 0.5 + i * 0.35) }, { gain: -9, pan: -0.3 + (0.6 * i) / Math.max(1, o.features.length - 1) }))
    },
  })
}

export interface Stat {
  value: number
  label: string
  format?: Parameters<typeof formatNumber>[1]
  /** Default: when the label (or its first words) is spoken. */
  at?: Anchor
  /** Phrase to sync to instead of the label, as written in script.md (e.g. "40%"). */
  say?: string
}

/** Big animated numbers, optionally over a growing line chart. */
export function stats(o: { name?: string; eyebrow?: string; title?: string; stats: Stat[]; chart?: number[]; background?: BackgroundOptions }): SceneDefinition {
  const times = (f: Frame) => o.stats.map((st, i) => when(f, st.at, st.say ?? st.label, 0.4 + i * 0.6))
  return defineScene({
    name: o.name ?? 'stats',
    render(f, g) {
      background(g, o.background ?? { kind: 'mesh', intensity: 0.45 })
      const ts = times(f)
      const cam = [drift(f, { zoom: 0.035 })]
      for (const t of ts) cam.push(punch(f, { at: t }, 0.035))
      g.camera(combine(f, ...cam))
      const { s, portrait, area } = responsive(f.stage)
      if (o.chart) {
        g.plane(300, () =>
          lineChart(g, { x: f.stage.cx, y: f.stage.cy + 120 * s, w: f.stage.w * 1.1, h: f.stage.h * 0.45, values: o.chart!, progress: clamp01((f.t - f.start) / Math.max(1, f.dur * 0.8)), color: f.brand.colors.primary, head: false }),
        )
        g.rect({ x: f.stage.cx, y: f.stage.cy, w: f.stage.w * 1.4, h: f.stage.h * 1.4, fill: alpha(g.color('bg'), 0.45) })
      }
      let top = area.y + area.h * 0.22
      if (o.title) {
        headline(g, { x: f.stage.cx, y: area.y + 80 * s, eyebrow: o.eyebrow, title: o.title, size: 'h2', exit: false })
        top = area.y + area.h * 0.3
      }
      const n = o.stats.length
      const cells = portrait ? grid(n, 1, { x: area.x, y: top, w: area.w, h: area.y + area.h - top }) : grid(n, n, { x: area.x, y: top, w: area.w, h: area.h * 0.6 })
      cells.forEach((c, i) => {
        const st = o.stats[i]!
        const p = clamp01((f.t - ts[i]!) / 1.1)
        if (f.t < ts[i]! - 0.05) return
        const size = (n >= 3 ? 130 : 170) * s
        counter(g, { x: c.x + c.w / 2, y: c.y + c.h * 0.42, value: st.value, progress: p, size, label: st.label, format: st.format, color: i % 2 ? 'accent' : 'text' })
      })
    },
    cues(c) {
      return o.stats.map((st, i) => c.cue('hit', { at: cueWhen(c, st.at, st.say ?? st.label, 0.4 + i * 0.6) }, { gain: -10 }))
    },
  })
}

export interface CodeSceneOptions {
  name?: string
  eyebrow?: string
  title?: string
  subtitle?: string
  code: string
  lang?: string
  file?: string
  /** When typing starts (default 0.4 s in). */
  typeAt?: Anchor
  cps?: number
  highlight?: number[]
  highlightAt?: Anchor
  terminal?: TerminalLine[]
  side?: 'left' | 'right'
  background?: BackgroundOptions
}

/** Code editor (typing) + optional terminal, with a headline. */
export function code(o: CodeSceneOptions): SceneDefinition {
  return defineScene({
    name: o.name ?? 'code',
    render(f, g) {
      background(g, o.background ?? { kind: 'grid', intensity: 0.6 })
      g.camera(drift(f, { zoom: 0.04 }))
      const { s, portrait, area } = responsive(f.stage)
      const hasText = !!o.title
      const side = o.side ?? 'left'
      const tw = portrait ? area.w : area.w * 0.32
      const avail = portrait ? area.w : area.w - (hasText ? tw + 70 * s : 0)
      const lines = o.code.split('\n')
      const longest = Math.max(...lines.map((l) => l.length), 20)
      // monospace glyphs are ~0.6em wide; leave room for gutter and padding
      const fontSize = Math.min(32 * s, (avail - 140 * s) / (longest * 0.62))
      const edW = Math.min(avail, longest * 0.62 * fontSize + 150 * s)
      const edH = 50 + fontSize * 1.55 * lines.length + fontSize * 2.2
      const termH = o.terminal ? 200 * s : 0
      const blockH = edH + (o.terminal ? termH * 0.7 : 0)
      const edX = portrait ? f.stage.cx : hasText ? (side === 'left' ? area.x + area.w - edW / 2 : area.x + edW / 2) : f.stage.cx
      const edY = portrait ? area.y + area.h * 0.62 - blockH / 2 + edH / 2 : f.stage.cy - blockH / 2 + edH / 2
      if (hasText) headline(g, { x: portrait ? f.stage.cx : side === 'left' ? area.x : area.x + area.w - tw, y: portrait ? area.y + 100 * s : f.stage.cy, eyebrow: o.eyebrow, title: o.title!, subtitle: o.subtitle, align: portrait ? 'center' : 'left', size: 'h1', maxWidth: tw, sync: true, exit: false })
      const enter = spring(f.lt - 0.05, 'gentle')
      g.layer({ w: edW, h: edH, x: edX, y: edY + (1 - Math.min(1, enter)) * 80, rotateY: (side === 'left' ? -7 : 7) * (1 - 0.5 * f.p) * (portrait ? 0 : 1), rotateX: 3, opacity: clamp01(enter * 1.5), pad: 90, light: 0.4 }, (lg) => {
        codeBlock(lg, { x: edW / 2, y: edH / 2, w: edW, h: edH, code: o.code, lang: o.lang ?? 'ts', title: o.file, typeAt: o.typeAt ?? { at: f.start + 0.4 }, cps: o.cps, highlight: o.highlight, highlightAt: o.highlightAt, fontSize })
      })
      if (o.terminal) {
        const tW = Math.min(edW * 0.72, 860 * s)
        const tp = spring(f.since(o.terminal[0]!.at), 'snappy')
        if (tp > 0.001) {
          g.layer({ w: tW, h: termH, x: edX + (portrait ? 0 : edW / 2 - tW / 2 + 60 * s), y: edY + edH / 2 + termH * 0.3, z: -60, rotateY: side === 'left' ? -5 : 5, opacity: clamp01(tp * 1.5), scale: 0.9 + 0.1 * Math.min(1, tp), pad: 80 }, (lg) => {
            terminal(lg, { x: tW / 2, y: termH / 2, w: tW, h: termH, lines: o.terminal!, title: 'zsh', fontSize: 22 * s })
          })
        }
      }
    },
    cues(c) {
      const out = [c.cue('type', { at: cueWhen(c, o.typeAt, undefined, 0.4) }, { gain: -12 })]
      for (const l of o.terminal ?? []) if (l.cmd) out.push(c.cue('type', { at: cueWhen(c, l.at, undefined, 0) }, { gain: -14 }))
      return out
    },
  })
}

export interface CtaOptions {
  name?: string
  title: string
  subtitle?: string
  button?: string
  url?: string
  /** Show the logo above the title. Default true. */
  logo?: boolean
  /** Animate a cursor clicking the button. Default true. */
  click?: boolean
  /** When the button gets clicked (default: when the button label is spoken, else 2.2 s in). */
  clickAt?: Anchor
  background?: BackgroundOptions
}

/** Closing call to action: logo, title, button with a cursor click, URL. */
export function cta(o: CtaOptions): SceneDefinition {
  return defineScene({
    name: o.name ?? 'cta',
    render(f, g) {
      background(g, o.background ?? { kind: 'mesh', intensity: 0.75 })
      g.camera(drift(f, { zoom: 0.05 }))
      particles(g, { count: 50, opacity: 0.3 })
      const { s } = responsive(f.stage)
      const cy = f.stage.cy
      if (o.logo !== false) logo(g, { x: f.stage.cx, y: cy - 230 * s, h: 72 * s, opacity: f.in(0.1, 0.6) })
      g.text(o.title, { x: f.stage.cx, y: cy - 60 * s, style: 'h1', size: 96 * s, maxWidth: f.stage.title.w, anim: { preset: 'mask', at: 0.25, by: 'word', sync: 'voice' } })
      if (o.subtitle) g.text(o.subtitle, { x: f.stage.cx, y: cy + 40 * s, style: 'body', size: 34 * s, color: 'muted', anim: { preset: 'rise', at: 0.6, by: 'line' } })
      const by = cy + 160 * s
      if (o.button) {
        const p = f.spring(0.8, 'bouncy')
        const tc = Math.max(1.4, when(f, o.clickAt, o.button, 2.2) - f.start)
        const cur = cursorPath(f, [
          { t: tc - 0.9, at: [f.stage.cx + 420 * s, by + 260 * s] },
          { t: tc, at: [f.stage.cx + 30 * s, by + 8 * s], click: true },
        ])
        g.group({ opacity: clamp01(p * 2), scale: 0.6 + 0.4 * Math.min(1.05, p), x: f.stage.cx, y: by }, () =>
          button(g, { x: 0, y: 0, label: o.button!, size: 30 * s, variant: 'gradient', press: o.click !== false ? cur.press : 0, hover: o.click !== false ? clamp01((f.lt - tc + 0.3) / 0.3) : 0, icon: 'arrow-right' }),
        )
        if (o.click !== false && f.lt > tc - 1) cursor(g, { ...cur, opacity: clamp01((f.lt - tc + 1) / 0.2) })
      }
      if (o.url) pill(g, { x: f.stage.cx, y: by + (o.button ? 110 : 0) * s, label: o.url, icon: 'globe', size: 24 * s, opacity: clamp01((f.lt - 1.1) / 0.5) })
    },
    cues(c) {
      return o.button && o.click !== false ? [c.cue('click', { at: Math.max(c.start + 1.4, cueWhen(c, o.clickAt, o.button, 2.2)) }, { gain: -4 })] : []
    },
  })
}

/** Logo reveal with an optional tagline. */
export function logoScene(o: { name?: string; tagline?: string; at?: Anchor; background?: BackgroundOptions }): SceneDefinition {
  return defineScene({
    name: o.name ?? 'logo',
    render(f, g) {
      background(g, o.background ?? { kind: 'spotlight' })
      const at = f.at(o.at ?? 0.2)
      g.camera(combine(f, drift(f, { zoom: 0.04 }), punch(f, { at }, 0.05)))
      const { s } = responsive(f.stage)
      particles(g, { count: 40, opacity: 0.22 })
      // halo: thin rings that settle around the logo
      const ly = f.stage.cy - (o.tagline ? 40 * s : 0)
      const halo = ease('expoOut')(clamp01(f.since({ at: at - 0.2 }) / 1.6))
      for (let i = 0; i < 3; i++) {
        const rx = (420 + i * 170) * s * (0.6 + 0.4 * halo)
        g.ellipse({ x: f.stage.cx, y: ly, rx, ry: rx * 0.32, rotate: -14 + i * 4 + f.lt * (2 + i), stroke: alpha(g.color(i === 1 ? 'accent' : 'primary'), 0.28 - i * 0.07), lineWidth: 1.5, opacity: halo })
        const a = f.lt * (0.5 + i * 0.22) + i * 2
        const rot = ((-14 + i * 4 + f.lt * (2 + i)) * Math.PI) / 180
        const ex = Math.cos(a) * rx
        const ey = Math.sin(a) * rx * 0.32
        g.circle({ x: f.stage.cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: ly + ex * Math.sin(rot) + ey * Math.cos(rot), r: (5 - i) * s, fill: i === 1 ? 'accent' : 'primary', opacity: halo })
      }
      logoReveal(g, { x: f.stage.cx, y: ly, h: 140 * s, at: { at } })
      if (o.tagline) g.text(o.tagline, { x: f.stage.cx, y: f.stage.cy + 120 * s, style: 'h3', size: 44 * s, color: 'muted', maxWidth: f.stage.title.w, anim: { preset: 'blur', at: { at: at + 0.7 }, by: 'word', sync: 'voice' } })
    },
    cues(c) {
      const at = cueWhen(c, o.at ?? 0.2, undefined, 0.2)
      return [c.cue('reverse', { at: at - 0.02 }, { align: 'peak', gain: -6 }), c.cue('impact', { at }, { gain: -4 }), c.cue('shimmer', { at: at + 0.1 }, { gain: -10 })]
    },
  })
}
