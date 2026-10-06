/** Media templates: screenshots / screen recordings in 3D device frames, phone showcases. */

import { defineScene, type Anchor, type Frame, type SceneDefinition } from '../core/scene.ts'
import type { Rect } from '../core/types.ts'
import type { Graphics } from '../gfx/graphics.ts'
import { alpha } from '../gfx/color.ts'
import { background, sheen, type BackgroundOptions } from '../kit/backgrounds.ts'
import { combine, drift } from '../kit/camera.ts'
import { browser, phone } from '../kit/devices.ts'
import { headline } from '../kit/headline.ts'
import { fitBox, responsive } from '../kit/layout.ts'
import { check, pill } from '../kit/ui.ts'
import { ease } from '../motion/easing.ts'
import { spring } from '../motion/spring.ts'
import { clamp01, lerp } from '../motion/tween.ts'
import { cueWhen, when } from './common.ts'

export type Media = { image: string } | { video: string; rate?: number; from?: number; loop?: boolean }

export interface Callout {
  /** Position on the media, 0..1. */
  x: number
  y: number
  label: string
  /** Default: when the label is spoken, else staggered after the entrance. */
  at?: Anchor
  icon?: string
  color?: string
}

export interface ShowcaseOptions {
  name?: string
  media: Media
  device?: 'browser' | 'none'
  url?: string
  eyebrow?: string
  title?: string
  subtitle?: string
  /** Which side the text goes on (landscape). */
  side?: 'left' | 'right'
  /** Resting Y rotation in degrees (perspective tilt). 0 = flat. */
  tilt?: number
  callouts?: Callout[]
  /** Zoom the camera into a point of the media. */
  zoom?: { x: number; y: number; scale: number; at: Anchor; duration?: number }
  at?: Anchor
  background?: BackgroundOptions
}

function mediaSize(g: Graphics, m: Media): [number, number] {
  if ('image' in m) return g.assets.size(m.image) ?? [1600, 1000]
  const meta = g.assets.video(m.video)
  return meta ? [meta.width, meta.height] : [1600, 1000]
}

function drawMedia(g: Graphics, m: Media, r: Rect, start: number) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  if ('image' in m) g.image(m.image, { x: cx, y: cy, w: r.w, h: r.h, fit: 'cover', focus: [0.5, 0] })
  else g.video(m.video, { x: cx, y: cy, w: r.w, h: r.h, fit: 'cover', start: { at: start }, rate: m.rate, from: m.from, loop: m.loop })
}

/** Screenshot or screen recording presented as a floating 3D card with optional callouts and zoom. */
export function showcase(o: ShowcaseOptions): SceneDefinition {
  return defineScene({
    name: o.name ?? 'showcase',
    assets: 'image' in o.media ? [o.media.image] : [],
    render(f, g) {
      background(g, o.background ?? { kind: 'grid' })
      const { s, portrait, area } = responsive(f.stage)
      const t0 = f.at(o.at ?? 0.05)
      const hasText = !!(o.title || o.subtitle)
      const side = o.side ?? 'left'
      // layout
      let textBox: Rect | null = null
      let mediaBox: Rect
      if (!hasText) mediaBox = { x: area.x, y: area.y, w: area.w, h: area.h }
      else if (portrait) {
        textBox = { x: area.x, y: area.y + area.h * 0.62, w: area.w, h: area.h * 0.38 }
        mediaBox = { x: area.x, y: area.y + area.h * 0.04, w: area.w, h: area.h * 0.55 }
      } else {
        const tw = area.w * 0.36
        textBox = side === 'left' ? { x: area.x, y: area.y, w: tw, h: area.h } : { x: area.x + area.w - tw, y: area.y, w: tw, h: area.h }
        mediaBox = side === 'left' ? { x: area.x + tw + 40 * s, y: area.y, w: area.w - tw - 40 * s, h: area.h } : { x: area.x, y: area.y, w: area.w - tw - 40 * s, h: area.h }
      }
      const [mw, mh] = mediaSize(g, o.media)
      const bar = o.device === 'none' ? 0 : 52
      const box = fitBox(mw, mh + bar * (mw / Math.max(1, mediaBox.w)), mediaBox)
      const cardW = box.w
      const cardH = box.h
      const screenH = cardH - bar
      // camera: drift, plus optional zoom toward a point of the media
      const tiltBase = (o.tilt ?? (portrait ? 8 : 16)) * (side === 'left' ? -1 : 1) * (hasText ? 1 : 0.6)
      const enter = spring(f.t - t0, { stiffness: 110, damping: 18 })
      let zoomP = 0
      let cam = drift(f, { zoom: 0.03 })
      if (o.zoom) {
        zoomP = ease('camera')(clamp01(f.since(o.zoom.at) / (o.zoom.duration ?? 1.1)))
        const px = box.x + o.zoom.x * cardW
        const py = box.y + bar + o.zoom.y * screenH
        cam = combine(f, cam, { x: lerp(f.stage.cx, px, zoomP), y: lerp(f.stage.cy, py, zoomP), zoom: lerp(1, o.zoom.scale, zoomP) })
      }
      g.camera(cam)
      if (textBox) {
        g.group({ opacity: 1 - clamp01(zoomP * 3) }, () => headline(g, { x: portrait ? f.stage.cx : textBox.x, y: textBox.y + textBox.h / 2, eyebrow: o.eyebrow, title: o.title ?? '', subtitle: o.subtitle, align: portrait ? 'center' : 'left', size: 'h2', at: { at: t0 }, maxWidth: textBox.w, sync: true }))
      }
      const tilt = tiltBase * (1 - 0.3 * f.p) * (1 - zoomP)
      const layerOpts = {
        w: cardW,
        h: cardH,
        x: box.x + cardW / 2,
        y: box.y + cardH / 2 + (1 - Math.min(1, enter)) * 120,
        z: (1 - enter) * 700,
        rotateY: tilt + (1 - enter) * tiltBase * 1.6,
        rotateX: 5 * (1 - zoomP) + (1 - enter) * 10,
        opacity: clamp01(enter * 1.6),
        pad: 90,
        light: 0.5,
        res: o.zoom ? Math.max(1, Math.min(2, o.zoom.scale)) : 1,
      }
      const isImage = 'image' in o.media
      g.layer({ ...layerOpts, cache: isImage ? `showcase:${(o.media as { image: string }).image}:${o.device}:${o.url}` : false }, (lg) => {
        const frame = (screen: Rect) => drawMedia(lg, o.media, screen, t0)
        if (o.device === 'none') {
          lg.rect({ x: cardW / 2, y: cardH / 2, w: cardW, h: cardH, radius: 18, fill: 'surface', shadow: 'lg' })
          lg.group({ clip: { rect: [0, 0, cardW, cardH], radius: 18 } }, () => frame({ x: 0, y: 0, w: cardW, h: cardH }))
        } else browser(lg, { x: cardW / 2, y: cardH / 2, w: cardW, h: cardH, url: o.url }, frame)
      })
      // overlay layer with the same transform: sheen + callouts follow the 3D card
      const callouts = o.callouts ?? []
      const sheenP = clamp01((f.t - t0 - 0.25) / 1.1)
      if (callouts.length || (sheenP > 0 && sheenP < 1)) {
        g.layer({ ...layerOpts, light: 0 }, (lg) => {
          sheen(lg, { x: cardW / 2, y: cardH / 2, w: cardW, h: cardH, progress: sheenP, radius: 18, opacity: 0.16 })
          callouts.forEach((c, i) => {
            const at = when(f, c.at, c.label, 1 + i * 0.6)
            const p = spring(f.t - at, 'snappy')
            if (p <= 0.001) return
            const px = c.x * cardW
            const py = bar + c.y * screenH
            const color = lg.color(c.color ?? 'accent')
            const pulse = (f.t - at) % 1.4
            lg.circle({ x: px, y: py, r: 10 + 26 * (pulse / 1.4), fill: alpha(color, 0.35 * (1 - pulse / 1.4)) })
            lg.circle({ x: px, y: py, r: 9 * Math.min(1.2, p), fill: color, stroke: '#ffffff', lineWidth: 3 })
            const lx = px + 46
            const ly = py - 56
            lg.line({ from: [px, py], to: [lx, ly], stroke: color, lineWidth: 2.5, progress: clamp01(p) })
            lg.group({ x: lx, y: ly, scale: 0.7 + 0.3 * Math.min(1, p), opacity: clamp01(p * 2) }, () => {
              const size = 22
              const w = lg.measure(c.label, { size, weight: 600 }).w + size * 1.6 + (c.icon ? size * 1.2 : 0)
              lg.group({ x: w / 2 }, () => pill(lg, { x: 0, y: 0, label: c.label, icon: c.icon, color: c.color, size, filled: true }))
            })
          })
        })
      }
    },
    cues(c) {
      const t0 = cueWhen(c, o.at ?? 0.05, undefined, 0.05)
      const out = [c.cue('whoosh', { at: t0 + 0.12 }, { gain: -10, align: 'peak' })]
      ;(o.callouts ?? []).forEach((co, i) => out.push(c.cue('pop', { at: cueWhen(c, co.at, co.label, 1 + i * 0.6) }, { gain: -8 })))
      return out
    },
  })
}

/** Alias: a screenshot showcase. */
export const screenshot = (o: Omit<ShowcaseOptions, 'media'> & { image: string }) => showcase({ ...o, media: { image: o.image } })
/** Alias: a screen recording showcase. */
export const recording = (o: Omit<ShowcaseOptions, 'media'> & { video: string; rate?: number; from?: number }) => showcase({ ...o, media: { video: o.video, rate: o.rate, from: o.from } })

export interface PhoneShowcaseOptions {
  name?: string
  /** One or more screens (images or recordings) shown on the phone. */
  screens: Media[]
  eyebrow?: string
  title?: string
  bullets?: Array<{ text: string; at?: Anchor }>
  side?: 'left' | 'right'
  tilt?: number
  at?: Anchor
  background?: BackgroundOptions
}

/** A phone in 3D with switching screens and bullet points that tick in with the voiceover. */
export function phoneShowcase(o: PhoneShowcaseOptions): SceneDefinition {
  const bulletTimes = (f: Frame) => (o.bullets ?? []).map((b, i) => when(f, b.at, b.text, 0.8 + i * 0.9))
  return defineScene({
    name: o.name ?? 'phone',
    assets: o.screens.flatMap((m) => ('image' in m ? [m.image] : [])),
    render(f, g) {
      background(g, o.background ?? { kind: 'mesh' })
      g.camera(drift(f))
      const { s, portrait, area } = responsive(f.stage)
      const t0 = f.at(o.at ?? 0.05)
      const side = o.side ?? 'right'
      const ph = portrait ? area.h * 0.55 : area.h * 0.95
      const px = portrait ? f.stage.cx : side === 'right' ? area.x + area.w * 0.74 : area.x + area.w * 0.26
      const py = portrait ? area.y + ph / 2 : f.stage.cy
      const bt = bulletTimes(f)
      // which screen is visible: switch on bullets (or evenly)
      const switches = o.screens.map((_, i) => (i === 0 ? -Infinity : (bt[i] ?? f.start + (f.dur * i) / o.screens.length)))
      const cur = Math.max(0, switches.findLastIndex((x) => f.t >= x))
      const swP = ease('quintInOut')(clamp01((f.t - (switches[cur] ?? 0)) / 0.5))
      const enter = spring(f.t - t0, { stiffness: 120, damping: 17 })
      const pw = ph * 0.4615
      g.layer({ w: pw, h: ph, x: px, y: py + (1 - Math.min(1, enter)) * 200, rotateY: (o.tilt ?? -14) * (side === 'right' ? 1 : -1) * (1 - 0.4 * f.p) + (1 - enter) * 30, rotateX: 4, z: (1 - enter) * 500, opacity: clamp01(enter * 1.5), pad: 100, light: 0.6 }, (lg) => {
        phone(lg, { x: pw / 2, y: ph / 2, h: ph }, (screen) => {
          const showScreen = (m: Media, dx: number) => lg.group({ x: dx }, () => drawMedia(lg, m, screen, t0))
          if (cur > 0 && swP < 1) {
            showScreen(o.screens[cur - 1]!, -screen.w * swP * 0.35)
            lg.group({ x: screen.w * (1 - swP) }, () => drawMedia(lg, o.screens[cur]!, screen, t0))
          } else showScreen(o.screens[cur]!, 0)
        })
      })
      // text + bullets
      const tx = portrait ? f.stage.cx : side === 'right' ? area.x : area.x + area.w * 0.5
      const tw = portrait ? area.w : area.w * 0.48
      let y = portrait ? area.y + ph + 60 * s : f.stage.cy - (o.bullets?.length ?? 0) * 40 * s - 60 * s
      if (o.title) {
        headline(g, { x: portrait ? tx : tx, y, eyebrow: o.eyebrow, title: o.title, align: portrait ? 'center' : 'left', size: 'h2', at: { at: t0 }, maxWidth: tw, exit: false })
        y += 150 * s
      }
      ;(o.bullets ?? []).forEach((b, i) => {
        const p = clamp01((f.t - bt[i]!) / 0.5)
        if (p <= 0) return
        const active = i === (o.bullets!.length - 1 - [...bt].reverse().findIndex((x) => f.t >= x))
        const bx = portrait ? f.stage.cx - tw * 0.35 : tx
        check(g, { x: bx + 22 * s, y: y + i * 76 * s, size: 40 * s, progress: p })
        g.text(b.text, { x: bx + 62 * s, y: y + i * 76 * s, size: 34 * s, weight: 560, align: 'left', color: active ? 'text' : 'muted', anim: { preset: 'rise', at: { at: bt[i]! }, by: 'line' } })
      })
    },
    cues(c) {
      return (o.bullets ?? []).map((b, i) => c.cue('tap', { at: cueWhen(c, b.at, b.text, 0.8 + i * 0.9) }, { gain: -6 }))
    },
  })
}
