/**
 * Typography: style resolution, cached layout (wrapping, balancing, optical
 * vertical centering) and animated drawing (per line / word / character).
 *
 * Markup: `**word**` renders in the accent paint, `\n` forces a line break.
 */

import type { Anchor, Frame } from '../core/scene.ts'
import type { Brand, ShadowSpec, TextPreset, TypeStyle } from '../core/types.ts'
import { ease, type Ease } from '../motion/easing.ts'
import { hash01 } from '../motion/noise.ts'
import { spring } from '../motion/spring.ts'
import { clamp01 } from '../motion/tween.ts'
import { mixColor } from './color.ts'

export type TypeToken = 'hero' | 'h1' | 'h2' | 'h3' | 'body' | 'label' | 'caption' | 'eyebrow' | 'code' | (string & {})

export interface TextStyleOptions {
  /** Brand type token ('hero', 'h1', 'body', ...) or an inline style. */
  style?: TypeToken | TypeStyle
  font?: string
  size?: number
  weight?: number
  /** Letter spacing in em. */
  tracking?: number
  /** Line height multiplier. */
  leading?: number
  italic?: boolean
  uppercase?: boolean
}

export interface ResolvedTextStyle {
  family: string
  fallback: string
  size: number
  weight: number
  tracking: number
  leading: number
  italic: boolean
  uppercase: boolean
  color: string | undefined
}

export function resolveTextStyle(brand: Brand, o: TextStyleOptions): ResolvedTextStyle {
  const base: TypeStyle =
    typeof o.style === 'object' ? o.style : (brand.type[(o.style ?? 'body') as string] ?? brand.type.body)
  const fontKey = o.font ?? base.font
  // unknown roles fall back sensibly so a brand that only defines display/body still works
  const spec = brand.fonts[fontKey] ?? (fontKey === 'numeric' ? brand.fonts.body : undefined)
  return {
    family: spec ? spec.family : fontKey,
    fallback: spec?.fallback ?? 'sans-serif',
    size: o.size ?? base.size,
    weight: o.weight ?? base.weight ?? 400,
    tracking: o.tracking ?? base.tracking ?? 0,
    leading: o.leading ?? base.leading ?? 1.2,
    italic: o.italic ?? base.italic ?? false,
    uppercase: o.uppercase ?? base.uppercase ?? false,
    color: base.color,
  }
}

export function fontString(s: ResolvedTextStyle): string {
  return `${s.italic ? 'italic ' : ''}${Math.round(s.weight)} ${s.size}px "${s.family}", ${s.fallback}`
}

// ------------------------------------------------------------------ layout

export interface LayoutChar {
  ch: string
  x: number
  w: number
}

export interface LayoutWord {
  text: string
  /** x offset from the line start */
  x: number
  w: number
  accent: boolean
  /** Index across the whole block. */
  index: number
  line: number
  chars: LayoutChar[]
}

export interface LayoutLine {
  words: LayoutWord[]
  width: number
}

export interface TextLayout {
  lines: LayoutLine[]
  words: LayoutWord[]
  maxLineWidth: number
  size: number
  lineHeight: number
  ascent: number
  descent: number
  capHeight: number
  space: number
}

interface Token {
  text: string
  accent: boolean
  br: boolean
}

function tokenize(text: string): Token[] {
  const out: Token[] = []
  let accent = false
  for (const part of text.split(/(\*\*|\n)/)) {
    if (part === '**') {
      accent = !accent
      continue
    }
    if (part === '\n') {
      out.push({ text: '', accent, br: true })
      continue
    }
    for (const w of part.split(/[ \t]+/)) if (w) out.push({ text: w, accent, br: false })
  }
  return out
}

const layoutCache = new Map<string, TextLayout>()
let measureCtx: OffscreenCanvasRenderingContext2D | null = null

function mctx(): OffscreenCanvasRenderingContext2D {
  if (!measureCtx) measureCtx = new OffscreenCanvas(8, 8).getContext('2d')!
  return measureCtx
}

/** Clear cached layouts (call after fonts change). */
export function clearTextCache() {
  layoutCache.clear()
}

export function layoutText(text: string, style: ResolvedTextStyle, maxWidth = Infinity, balance = true): TextLayout {
  const key = `${text}\u0001${fontString(style)}\u0001${style.tracking}\u0001${style.leading}\u0001${style.uppercase}\u0001${maxWidth}\u0001${balance}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  const ctx = mctx()
  ctx.font = fontString(style)
  const spacing = style.tracking * style.size
  ctx.letterSpacing = `${spacing}px`
  const src = style.uppercase ? text.toUpperCase() : text
  const tokens = tokenize(src)
  const measure = (s: string) => (s ? ctx.measureText(s).width - spacing : 0)
  const widths = tokens.map((t) => measure(t.text))
  const space = ctx.measureText(' ').width
  const metrics = ctx.measureText('Hg')
  const ascent = metrics.fontBoundingBoxAscent || style.size * 0.9
  const descent = metrics.fontBoundingBoxDescent || style.size * 0.25
  const capHeight = ctx.measureText('H').actualBoundingBoxAscent || style.size * 0.7

  const breakLines = (limit: number): number[][] => {
    const lines: number[][] = []
    let cur: number[] = []
    let w = 0
    tokens.forEach((t, i) => {
      if (t.br) {
        lines.push(cur)
        cur = []
        w = 0
        return
      }
      const add = cur.length ? space + widths[i]! : widths[i]!
      if (cur.length && w + add > limit) {
        lines.push(cur)
        cur = [i]
        w = widths[i]!
      } else {
        cur.push(i)
        w += add
      }
    })
    lines.push(cur)
    return lines
  }
  const lineWidth = (idx: number[]) => idx.reduce((s, i, k) => s + widths[i]! + (k ? space : 0), 0)

  let lines = breakLines(maxWidth)
  if (balance && Number.isFinite(maxWidth) && lines.length > 1) {
    // CSS `text-wrap: balance`: shrink the width while the line count stays the same
    const count = lines.length
    let lo = Math.max(...tokens.map((_, i) => widths[i]!)) * 0.5
    let hi = maxWidth
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2
      if (breakLines(mid).length > count) lo = mid
      else hi = mid
    }
    lines = breakLines(hi)
  }

  const words: LayoutWord[] = []
  const outLines: LayoutLine[] = lines.map((idx, li) => {
    let x = 0
    const lw: LayoutWord[] = idx.map((i, k) => {
      if (k) x += space
      const t = tokens[i]!
      const chars: LayoutChar[] = []
      let prev = 0
      const glyphs = [...t.text]
      for (let c = 0; c < glyphs.length; c++) {
        const end = measure(glyphs.slice(0, c + 1).join(''))
        chars.push({ ch: glyphs[c]!, x: prev, w: end - prev })
        prev = end + spacing
      }
      const word: LayoutWord = { text: t.text, x, w: widths[i]!, accent: t.accent, index: words.length, line: li, chars }
      x += widths[i]!
      words.push(word)
      return word
    })
    return { words: lw, width: lineWidth(idx) }
  })
  const layout: TextLayout = {
    lines: outLines,
    words,
    maxLineWidth: Math.max(0, ...outLines.map((l) => l.width)),
    size: style.size,
    lineHeight: style.size * style.leading,
    ascent,
    descent,
    capHeight,
    space,
  }
  if (layoutCache.size > 4000) layoutCache.clear()
  layoutCache.set(key, layout)
  return layout
}

// ------------------------------------------------------------------ animation

export interface TextAnimation {
  preset?: TextPreset
  by?: 'char' | 'word' | 'line'
  /** When the reveal starts (default: scene start). */
  at?: Anchor
  /** Duration of each unit's animation (s). */
  duration?: number
  /** Delay between units (s). */
  stagger?: number
  ease?: Ease
  /** 'voice': each word appears when it is spoken (needs the words in the voiceover). */
  sync?: 'voice'
  /** Manual override: overall reveal progress 0..1. */
  progress?: number
  /** Travel distance for rise/blur (px). */
  distance?: number
  /** Exit animation. 'end' = finish at the scene end. */
  exit?: { at?: Anchor | 'end'; duration?: number; preset?: TextPreset; stagger?: number } | false
}

export interface TextMark {
  /** Word or phrase inside the text to mark. */
  text: string
  style?: 'marker' | 'underline' | 'pill' | 'color' | 'box'
  color?: string
  /** When the mark animates in (default: when spoken, else after the reveal). */
  at?: Anchor
  duration?: number
}

export interface TextBox {
  x: number
  y: number
  w: number
  h: number
}

export interface TextResult extends TextBox {
  lines: Array<TextBox & { baseline: number }>
  words: Array<TextBox & { text: string }>
  /** 0..1: how much of the reveal is complete. */
  revealed: number
}

export interface DrawTextOptions {
  x: number
  y: number
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom' | 'baseline'
  maxWidth?: number
  balance?: boolean
  color: string | CanvasGradient | CanvasPattern
  accent: string | CanvasGradient | CanvasPattern
  muted: string
  opacity: number
  shadow?: ShadowSpec
  stroke?: { color: string; width: number }
  anim?: TextAnimation | false
  marks?: TextMark[]
  caret?: boolean
}

interface UnitState {
  alpha: number
  dx: number
  dy: number
  scale: number
  blur: number
  mix: number
}

const REST: UnitState = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, mix: 1 }
const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=?'

function enterState(preset: TextPreset, p: number, elapsed: number, dist: number, lh: number, size: number): UnitState {
  if (elapsed <= 0 && preset !== 'karaoke' && preset !== 'none') return { ...REST, alpha: 0 }
  switch (preset) {
    case 'none':
      return REST
    case 'fade':
      return { ...REST, alpha: p }
    case 'rise':
      return { ...REST, alpha: clamp01(p * 1.7), dy: (1 - p) * dist }
    case 'blur':
      return { ...REST, alpha: clamp01(p * 1.4), dy: (1 - p) * dist * 0.4, blur: (1 - p) * size * 0.22, scale: 1 + (1 - p) * 0.05 }
    case 'mask':
      return { ...REST, dy: (1 - p) * lh * 1.05 }
    case 'pop':
      return { ...REST, alpha: clamp01(elapsed / 0.1), scale: 0.35 + 0.65 * spring(elapsed, 'bouncy') }
    case 'slam':
      return { ...REST, alpha: clamp01(p * 3), scale: 1 + (1 - p) * 1.4, blur: (1 - p) * size * 0.1 }
    case 'type':
    case 'scramble':
      return { ...REST, alpha: 1 }
    case 'karaoke':
      return { ...REST, mix: p }
  }
}

function exitState(preset: TextPreset, e: number, dist: number, lh: number, size: number): UnitState {
  if (e <= 0) return REST
  switch (preset) {
    case 'rise':
      return { ...REST, alpha: 1 - e, dy: -e * dist }
    case 'blur':
      return { ...REST, alpha: 1 - e, blur: e * size * 0.22, dy: -e * dist * 0.4 }
    case 'mask':
      return { ...REST, dy: -e * lh * 1.05 }
    case 'pop':
      return { ...REST, alpha: 1 - e, scale: 1 - e * 0.5 }
    case 'slam':
      return { ...REST, alpha: 1 - e, scale: 1 + e * 0.25 }
    default:
      return { ...REST, alpha: 1 - e }
  }
}

function combine(a: UnitState, b: UnitState): UnitState {
  return { alpha: a.alpha * b.alpha, dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale, blur: a.blur + b.blur, mix: Math.min(a.mix, b.mix) }
}

/**
 * Draw (animated) text. `ctx` is already transformed into scene space;
 * `frame` provides time and voiceover lookups.
 */
export function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: Frame,
  text: string,
  style: ResolvedTextStyle,
  o: DrawTextOptions,
): TextResult {
  const L = layoutText(text, style, o.maxWidth ?? Infinity, o.balance ?? true)
  const n = L.lines.length
  const lh = L.lineHeight
  const halfLeading = (lh - (L.ascent + L.descent)) / 2
  const valign = o.valign ?? 'middle'
  let firstBaseline: number
  if (valign === 'baseline') firstBaseline = o.y
  else if (valign === 'top') firstBaseline = o.y + halfLeading + L.ascent
  else if (valign === 'bottom') firstBaseline = o.y - halfLeading - L.descent - (n - 1) * lh
  else firstBaseline = o.y - ((n - 1) * lh - L.capHeight) / 2
  const align = o.align ?? 'center'
  const lineX = (w: number) => (align === 'left' ? o.x : align === 'right' ? o.x - w : o.x - w / 2)

  const brandMotion = frame.brand.motion
  const anim = o.anim === false ? null : (o.anim ?? null)
  const preset: TextPreset = anim ? (anim.preset ?? brandMotion.text.preset) : 'none'
  const by = preset === 'type' || preset === 'scramble' ? 'char' : (anim?.by ?? brandMotion.text.by)
  const t = frame.t
  const dist = anim?.distance ?? brandMotion.distance
  const ez = ease(anim?.ease ?? brandMotion.enter)

  // ---- unit timing
  type Unit = { line: number; word: number; char: number }
  const units: Unit[] = []
  if (by === 'line') L.lines.forEach((_, li) => units.push({ line: li, word: -1, char: -1 }))
  else if (by === 'word') L.words.forEach((w) => units.push({ line: w.line, word: w.index, char: -1 }))
  else L.words.forEach((w) => w.chars.forEach((_, ci) => units.push({ line: w.line, word: w.index, char: ci })))

  const defaultStagger = by === 'char' ? (preset === 'type' ? 0.035 : brandMotion.stagger * 0.35) : by === 'line' ? brandMotion.stagger * 2.2 : brandMotion.stagger
  const stagger = anim?.stagger ?? defaultStagger
  const duration = anim?.duration ?? (preset === 'type' ? 0.001 : preset === 'karaoke' ? 0.12 : brandMotion.durations.base)
  const t0 = anim ? frame.at(anim.at ?? 0) : -Infinity

  // voice sync: map block words onto voiceover words
  let wordStarts: number[] | null = null
  if (anim?.sync === 'voice') {
    const phrase = L.words.map((w) => w.text).join(' ')
    const span = frame.timing.find(phrase, { from: frame.start - 1, to: frame.end })
    if (span) {
      const first = frame.timing.words.findIndex((w) => Math.abs(w.start - span.start) < 1e-6)
      wordStarts = L.words.map((_, i) => frame.timing.words[first + i]?.start ?? span.start)
    } else {
      // the on-screen text may skip or reorder little words ("every journey" vs "every user
      // journey"): match it as an in-order subsequence of the words spoken in this scene
      const spoken = frame.timing.words
      let k = spoken.findIndex((w) => w.start >= frame.start - 0.6)
      const found: number[] = []
      for (const w of L.words) {
        const norm = w.text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
        if (k < 0) break
        let j = k
        while (j < spoken.length && spoken[j]!.start < frame.end + 0.5 && spoken[j]!.norm !== norm) j++
        if (j >= spoken.length || spoken[j]!.start >= frame.end + 0.5) break
        found.push(spoken[j]!.start)
        k = j + 1
      }
      if (found.length === L.words.length) wordStarts = found
      else frame.warn(`text "${text.slice(0, 40)}": sync:'voice' could not find all words in the voiceover`)
    }
  }

  const unitStart = (u: Unit, idx: number): number => {
    if (wordStarts) {
      const ws = by === 'line' ? wordStarts[L.lines[u.line]!.words[0]!.index]! : wordStarts[u.word]!
      if (u.char >= 0) {
        const word = L.words[u.word]!
        const next = wordStarts[u.word + 1] ?? ws + 0.4
        return ws + (Math.min(0.5, next - ws) * u.char) / Math.max(1, word.chars.length)
      }
      return ws
    }
    return t0 + idx * stagger
  }
  const totalReveal = units.length ? unitStart(units[units.length - 1]!, units.length - 1) + duration - unitStart(units[0]!, 0) : 0

  const exit = anim && anim.exit ? anim.exit : null
  const exitDur = exit?.duration ?? brandMotion.durations.fast
  const exitStagger = exit?.stagger ?? stagger * 0.5
  const exitT0 = exit ? (exit.at === undefined || exit.at === 'end' ? frame.end - exitDur - exitStagger * Math.max(0, units.length - 1) : frame.at(exit.at)) : Infinity
  const exitPreset = exit?.preset ?? preset
  const exitEase = ease(brandMotion.exit)

  const stateOf = (u: Unit, idx: number): UnitState => {
    if (!anim) return REST
    // seconds since this unit started animating
    const elapsed =
      anim.progress !== undefined
        ? anim.progress * (Math.max(0, units.length - 1) * stagger + duration) - idx * stagger
        : t - unitStart(u, idx)
    const p = elapsed <= 0 ? 0 : ez(clamp01(elapsed / Math.max(1e-6, duration)))
    let s = enterState(preset, p, elapsed, dist, lh, style.size)
    if (exit) {
      const e = exitEase(clamp01((t - (exitT0 + idx * exitStagger)) / Math.max(1e-6, exitDur)))
      s = combine(s, exitState(exitPreset, e, dist, lh, style.size))
    }
    return s
  }

  // ---- geometry results
  const result: TextResult = { x: Infinity, y: firstBaseline - L.ascent - halfLeading, w: 0, h: n * lh, lines: [], words: [], revealed: 1 }
  L.lines.forEach((line, li) => {
    const x = lineX(line.width)
    const baseline = firstBaseline + li * lh
    result.lines.push({ x, y: baseline - L.ascent - halfLeading, w: line.width, h: lh, baseline })
    result.x = Math.min(result.x, x)
    for (const w of line.words) result.words.push({ text: w.text, x: x + w.x, y: baseline - L.capHeight, w: w.w, h: L.capHeight + L.descent * 0.6 })
  })
  if (!Number.isFinite(result.x)) result.x = o.x
  result.w = L.maxLineWidth
  if (anim && anim.progress === undefined && totalReveal > 0) result.revealed = clamp01((t - unitStart(units[0]!, 0)) / totalReveal)
  else if (anim?.progress !== undefined) result.revealed = anim.progress

  if (o.opacity <= 0) return result

  ctx.save()
  ctx.font = fontString(style)
  ctx.letterSpacing = `${style.tracking * style.size}px`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const baseAlpha = ctx.globalAlpha * o.opacity

  // ---- marks (behind text)
  const markWordColor = new Map<number, { color: string; p: number }>()
  for (const m of o.marks ?? []) {
    const tokens = m.text.toLowerCase().split(/\s+/)
    const idx = L.words.findIndex((_, i) => tokens.every((tok, k) => L.words[i + k]?.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === tok.replace(/[^\p{L}\p{N}]/gu, '')))
    if (idx < 0) {
      frame.warn(`text mark "${m.text}" not found in "${text.slice(0, 40)}"`)
      continue
    }
    const span = L.words.slice(idx, idx + tokens.length)
    let at: number
    if (m.at !== undefined) at = frame.at(m.at)
    else if (frame.has(m.text)) at = frame.word(m.text).start
    else at = (anim ? unitStart(units[0]!, 0) : frame.start) + totalReveal
    const p = ease(brandMotion.enter)(clamp01((t - at) / (m.duration ?? 0.45)))
    if (p <= 0) continue
    const color = m.color ?? (typeof o.accent === 'string' ? o.accent : frame.brand.colors.accent)
    const style2 = m.style ?? 'marker'
    // group consecutive words per line
    const byLine = new Map<number, typeof span>()
    for (const w of span) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w])
    for (const [li, ws] of byLine) {
      const lx = lineX(L.lines[li]!.width)
      const baseline = firstBaseline + li * lh
      const x0 = lx + ws[0]!.x
      const x1 = lx + ws[ws.length - 1]!.x + ws[ws.length - 1]!.w
      const padX = style.size * 0.14
      ctx.globalAlpha = baseAlpha
      if (style2 === 'marker') {
        ctx.fillStyle = color
        ctx.globalAlpha = baseAlpha * 0.32
        const h = L.capHeight * 1.25
        ctx.beginPath()
        ctx.roundRect(x0 - padX, baseline - L.capHeight - h * 0.12, (x1 - x0 + 2 * padX) * p, h, h * 0.2)
        ctx.fill()
      } else if (style2 === 'underline') {
        ctx.fillStyle = color
        const th = Math.max(2, style.size * 0.07)
        ctx.fillRect(x0, baseline + style.size * 0.12, (x1 - x0) * p, th)
      } else if (style2 === 'pill') {
        ctx.fillStyle = color
        const h = L.capHeight + style.size * 0.5
        const cx = (x0 + x1) / 2
        const w = (x1 - x0 + 2 * padX * 1.6) * (0.6 + 0.4 * p)
        ctx.globalAlpha = baseAlpha * p
        ctx.beginPath()
        ctx.roundRect(cx - w / 2, baseline - L.capHeight - style.size * 0.25, w, h, h / 2)
        ctx.fill()
        for (const w2 of ws) markWordColor.set(w2.index, { color: frame.brand.colors.bg, p })
      } else if (style2 === 'box') {
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(2, style.size * 0.04)
        ctx.globalAlpha = baseAlpha * p
        ctx.beginPath()
        ctx.roundRect(x0 - padX, baseline - L.capHeight - style.size * 0.2, x1 - x0 + 2 * padX, L.capHeight + style.size * 0.42, style.size * 0.12)
        ctx.stroke()
      } else {
        for (const w2 of ws) markWordColor.set(w2.index, { color, p })
      }
    }
  }

  if (o.shadow) {
    ctx.shadowColor = o.shadow.color
    ctx.shadowBlur = o.shadow.blur
    ctx.shadowOffsetX = o.shadow.x
    ctx.shadowOffsetY = o.shadow.y
  }
  if (o.stroke) {
    ctx.strokeStyle = o.stroke.color
    ctx.lineWidth = o.stroke.width
    ctx.lineJoin = 'round'
  }

  const fillFor = (w: LayoutWord, st: UnitState): string | CanvasGradient | CanvasPattern => {
    const mark = markWordColor.get(w.index)
    let base = w.accent ? o.accent : o.color
    if (preset === 'karaoke' && typeof base === 'string') base = mixColor(o.muted, base, st.mix)
    if (mark && typeof base === 'string') return mixColor(base, mark.color, mark.p)
    return base
  }

  const drawGlyphs = (s: string, x: number, baseline: number, cx: number, st: UnitState, fill: string | CanvasGradient | CanvasPattern) => {
    if (st.alpha <= 0.002) return
    ctx.globalAlpha = baseAlpha * Math.min(1, st.alpha)
    ctx.fillStyle = fill
    const transformed = st.scale !== 1 || st.dx !== 0 || st.dy !== 0
    if (st.blur > 0.4) ctx.filter = `blur(${st.blur.toFixed(2)}px)`
    if (transformed) {
      ctx.save()
      ctx.translate(cx + st.dx, baseline - L.capHeight / 2 + st.dy)
      if (st.scale !== 1) ctx.scale(st.scale, st.scale)
      ctx.translate(-cx, -(baseline - L.capHeight / 2))
    }
    if (o.stroke) ctx.strokeText(s, x, baseline)
    ctx.fillText(s, x, baseline)
    if (transformed) ctx.restore()
    if (st.blur > 0.4) ctx.filter = 'none'
  }

  let unitIdx = 0
  let lastVisible: { x: number; baseline: number } | null = null
  L.lines.forEach((line, li) => {
    const lx = lineX(line.width)
    const baseline = firstBaseline + li * lh
    const clipLine = preset === 'mask' || exitPreset === 'mask'
    if (clipLine && anim) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(lx - style.size, baseline - L.ascent * 1.08, line.width + style.size * 2, L.ascent * 1.08 + L.descent * 1.15)
      ctx.clip()
    }
    if (by === 'line') {
      const st = stateOf(units[unitIdx]!, unitIdx)
      unitIdx++
      for (const w of line.words) drawGlyphs(w.text, lx + w.x, baseline, lx + line.width / 2, st, fillFor(w, st))
      if (st.alpha > 0) lastVisible = { x: lx + line.width, baseline }
    } else if (by === 'word') {
      for (const w of line.words) {
        const st = stateOf(units[unitIdx]!, unitIdx)
        unitIdx++
        drawGlyphs(w.text, lx + w.x, baseline, lx + w.x + w.w / 2, st, fillFor(w, st))
        if (st.alpha > 0) lastVisible = { x: lx + w.x + w.w, baseline }
      }
    } else {
      for (const w of line.words) {
        for (let ci = 0; ci < w.chars.length; ci++) {
          const c = w.chars[ci]!
          const st = stateOf(units[unitIdx]!, unitIdx)
          let ch = c.ch
          if (preset === 'scramble' && anim) {
            const start = unitStart(units[unitIdx]!, unitIdx)
            if (t < start + duration + 0.25 && t >= start && c.ch.trim()) {
              ch = SCRAMBLE[Math.floor(hash01(unitIdx, Math.floor(t * 24)) * SCRAMBLE.length)]!
            }
          }
          unitIdx++
          drawGlyphs(ch, lx + w.x + c.x, baseline, lx + w.x + c.x + c.w / 2, st, fillFor(w, st))
          if (st.alpha > 0) lastVisible = { x: lx + w.x + c.x + c.w, baseline }
        }
      }
    }
    if (clipLine && anim) ctx.restore()
  })

  if ((o.caret ?? preset === 'type') && anim) {
    const pos = lastVisible ?? { x: lineX(L.lines[0]?.width ?? 0), baseline: firstBaseline }
    const done = t > (exitT0 === Infinity ? Infinity : exitT0)
    const blink = result.revealed >= 1 ? (Math.floor((t - t0) * 2.2) % 2 === 0 ? 1 : 0) : 1
    if (!done && blink && t >= t0) {
      ctx.globalAlpha = baseAlpha
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = typeof o.accent === 'string' ? o.accent : frame.brand.colors.primary
      ctx.fillRect(pos.x + style.size * 0.06, pos.baseline - L.capHeight * 1.08, Math.max(2, style.size * 0.07), L.capHeight * 1.3)
    }
  }
  ctx.restore()
  return result
}
