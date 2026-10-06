/** Text-driven scene templates: title card, kinetic typography, quote, montage. */

import { defineScene, type Anchor, type SceneDefinition } from '../core/scene.ts'
import type { TextPreset } from '../core/types.ts'
import { alpha } from '../gfx/color.ts'
import type { TypeToken } from '../gfx/text.ts'
import type { BackgroundOptions } from '../kit/backgrounds.ts'
import { background, particles } from '../kit/backgrounds.ts'
import { combine, drift, punch } from '../kit/camera.ts'
import { headline } from '../kit/headline.ts'
import { responsive } from '../kit/layout.ts'
import { avatar } from '../kit/ui.ts'
import { clamp01 } from '../motion/tween.ts'
import { cueWhen, plain, when } from './common.ts'

export interface TitleOptions {
  name?: string
  eyebrow?: string
  title: string
  subtitle?: string
  /** Title words appear exactly when spoken. Default true. */
  sync?: boolean
  at?: Anchor
  size?: 'hero' | 'h1' | 'h2'
  background?: BackgroundOptions
  particles?: boolean
  align?: 'left' | 'center'
}

/** Big centered title (hooks, chapter cards, statements). */
export function title(o: TitleOptions): SceneDefinition {
  return defineScene({
    name: o.name ?? 'title',
    render(f, g) {
      background(g, o.background ?? { kind: 'mesh' })
      g.camera(drift(f))
      if (o.particles !== false) particles(g, { count: 34, opacity: 0.25 })
      const { area } = responsive(f.stage)
      headline(g, {
        x: o.align === 'left' ? area.x : f.stage.cx,
        y: f.stage.cy,
        eyebrow: o.eyebrow,
        title: o.title,
        subtitle: o.subtitle,
        align: o.align ?? 'center',
        size: o.size ?? 'hero',
        sync: o.sync ?? true,
        at: o.at ?? when(f, undefined, o.title, 0.15) - f.start,
        exit: false,
      })
    },
  })
}

export interface KineticLine {
  text: string
  /** Default: when the line is spoken (else spread over the scene). */
  at?: Anchor
  preset?: TextPreset
  style?: TypeToken
  color?: string
}

export interface KineticOptions {
  name?: string
  lines: KineticLine[]
  /** 'replace': one line at a time (punchy). 'stack': lines accumulate. */
  mode?: 'replace' | 'stack'
  background?: BackgroundOptions
  /** Camera punch on every line. Default true. */
  punch?: boolean
  /** SFX per line ('hit', 'pop', 'tick' ... or false). */
  sfx?: string | false
}

/** Kinetic typography synced to the voiceover. */
export function kinetic(o: KineticOptions): SceneDefinition {
  const mode = o.mode ?? 'replace'
  const starts = (f: Parameters<SceneDefinition['render']>[0]) => o.lines.map((l, i) => when(f, l.at, l.text, 0.2 + (i * (f.dur - 0.4)) / o.lines.length))
  return defineScene({
    name: o.name ?? 'kinetic',
    render(f, g) {
      background(g, o.background ?? { kind: 'spotlight' })
      const t = starts(f)
      const current = Math.max(0, t.findLastIndex((x) => f.t >= x))
      const cam = [drift(f, { zoom: 0.03 })]
      if (o.punch !== false && f.t >= t[current]!) cam.push(punch(f, { at: t[current]! }, 0.05))
      g.camera(combine(f, ...cam))
      const { s } = responsive(f.stage)
      if (mode === 'replace') {
        o.lines.forEach((l, i) => {
          if (Math.abs(i - current) > 1) return
          const next = t[i + 1]
          g.text(l.text, {
            x: f.stage.cx,
            y: f.stage.cy,
            style: l.style ?? 'hero',
            size: f.brand.type[l.style ?? 'hero']!.size * s,
            maxWidth: f.stage.title.w,
            color: l.color,
            anim: { preset: l.preset ?? 'slam', by: 'word', at: { at: t[i]! }, duration: 0.45, stagger: 0.07, exit: next !== undefined ? { at: { at: next - 0.12 }, duration: 0.14, preset: 'fade' } : false },
          })
        })
      } else {
        const size = f.brand.type.h1.size * s
        const lh = size * 1.15
        const y0 = f.stage.cy - ((o.lines.length - 1) * lh) / 2
        o.lines.forEach((l, i) => {
          const active = i === current
          g.text(l.text, {
            x: f.stage.cx,
            y: y0 + i * lh,
            style: l.style ?? 'h1',
            size,
            color: l.color ?? (active ? 'text' : alpha(g.color('text'), 0.4)),
            anim: { preset: l.preset ?? 'mask', at: { at: t[i]! }, by: 'word' },
          })
        })
      }
    },
    cues(c) {
      if (o.sfx === false) return []
      return o.lines.map((l, i) => c.cue(o.sfx || 'hit', { at: cueWhen(c, l.at, l.text, 0.2 + (i * (c.end - c.start - 0.4)) / o.lines.length) }, { gain: -9 }))
    },
  })
}

export interface QuoteOptions {
  name?: string
  quote: string
  author: string
  role?: string
  avatar?: string
  at?: Anchor
}

/** Testimonial / quote card. */
export function quote(o: QuoteOptions): SceneDefinition {
  return defineScene({
    name: o.name ?? 'quote',
    render(f, g) {
      background(g, { kind: 'mesh', intensity: 0.4 })
      g.camera(drift(f))
      const { s } = responsive(f.stage)
      const t0 = when(f, o.at, o.quote, 0.2)
      g.text('“', { x: f.stage.cx, y: f.stage.cy - 230 * s, style: 'serif', size: 220 * s, color: 'primary', anim: { preset: 'pop', at: { at: t0 - 0.1 } } })
      g.text(o.quote, { x: f.stage.cx, y: f.stage.cy - 20 * s, style: 'serif', size: 76 * s, maxWidth: f.stage.title.w * 0.85, anim: { preset: 'blur', at: { at: t0 }, by: 'word', sync: 'voice' } })
      const p = clamp01(f.since({ at: t0 + 0.6 }) / 0.6)
      g.group({ y: f.stage.cy + 200 * s, opacity: p }, () => {
        avatar(g, { x: f.stage.cx - 170 * s, y: 0, r: 34 * s, initials: plain(o.author).split(' ').map((w) => w[0]).join('').slice(0, 2), image: o.avatar })
        g.text(o.author, { x: f.stage.cx - 120 * s, y: -14 * s, size: 28 * s, weight: 650, align: 'left' })
        if (o.role) g.text(o.role, { x: f.stage.cx - 120 * s, y: 20 * s, size: 22 * s, color: 'muted', align: 'left' })
      })
    },
  })
}

export interface MontageWord {
  text: string
  at?: Anchor
  icon?: string
  color?: string
}

/** Fast cuts: one word per beat of the voiceover, each on its own color field. */
export function montage(o: { name?: string; words: MontageWord[]; colors?: string[]; sfx?: string | false }): SceneDefinition {
  const times = (f: Parameters<SceneDefinition['render']>[0]) => o.words.map((w, i) => when(f, w.at, w.text, (i * f.dur) / o.words.length))
  return defineScene({
    name: o.name ?? 'montage',
    render(f, g) {
      const t = times(f)
      const i = Math.max(0, t.findLastIndex((x) => f.t >= x - 0.08))
      const w = o.words[i]!
      const palette = o.colors ?? [f.brand.colors.primary, f.brand.colors.surface2, f.brand.colors.accent, f.brand.colors.bg]
      const bg = w.color ?? palette[i % palette.length]!
      g.fill(bg)
      const since = f.t - (t[i]! - 0.08)
      g.camera({ zoom: 1.12 - 0.12 * clamp01(since / 0.5) ** 0.5 })
      const { s } = responsive(f.stage)
      const fg = bg === f.brand.colors.accent ? f.brand.colors.bg : '#ffffff'
      if (w.icon) g.icon(w.icon, { x: f.stage.cx, y: f.stage.cy - 150 * s, size: 120 * s, color: fg, stroke: 2.2, progress: clamp01(since / 0.3) })
      g.text(w.text, { x: f.stage.cx, y: f.stage.cy + (w.icon ? 60 * s : 0), style: 'hero', size: 170 * s, color: fg, anim: { preset: 'slam', at: { at: t[i]! - 0.08 }, duration: 0.3, by: 'line' } })
      // short exposure kick on each cut (subtle: bloom amplifies it)
      const flash = clamp01(1 - since / 0.1) ** 2
      if (flash > 0) g.fx({ grade: { exposure: 0.35 * flash } })
    },
    cues(c) {
      if (o.sfx === false) return []
      return o.words.map((w, i) => c.cue(o.sfx || 'hit', { at: cueWhen(c, w.at, w.text, (i * (c.end - c.start)) / o.words.length) - 0.08 }, { gain: -6 }))
    },
  })
}
