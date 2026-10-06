/**
 * Captions / subtitles from the voiceover timing. Social formats watch muted,
 * so word-synced captions are often essential (and they look great).
 */

import type { TimedWord } from '../core/types.ts'
import type { Graphics } from '../gfx/graphics.ts'
import { alpha } from '../gfx/color.ts'
import { spring } from '../motion/spring.ts'
import { clamp01 } from '../motion/tween.ts'

export interface CaptionOptions {
  /** Vertical position (default: lower third, higher on portrait). */
  y?: number
  /** 'karaoke' highlights the spoken word, 'word' shows one word at a time, 'line' plain subtitles. */
  style?: 'karaoke' | 'word' | 'line'
  /** Max words per caption chunk. */
  maxWords?: number
  size?: number
  color?: string
  highlight?: string
  /** Draw a dark box behind the text for legibility. */
  box?: boolean
  uppercase?: boolean
}

/** Split words into caption chunks at sentence ends, pauses and the word limit. */
export function chunkWords(words: TimedWord[], maxWords: number): TimedWord[][] {
  const out: TimedWord[][] = []
  let cur: TimedWord[] = []
  words.forEach((w, i) => {
    cur.push(w)
    const next = words[i + 1]
    const pause = next ? next.start - w.end : 1
    if (cur.length >= maxWords || /[.!?…:]$/.test(w.text) || pause > 0.35 || !next || next.sentence !== w.sentence) {
      out.push(cur)
      cur = []
    }
  })
  if (cur.length) out.push(cur)
  return out
}

/** Draw the caption for the current time (screen space). */
export function captions(g: Graphics, o: CaptionOptions = {}) {
  const f = g.f
  const words = f.timing.words
  if (!words.length) return
  const style = o.style ?? 'karaoke'
  const maxWords = o.maxWords ?? (style === 'word' ? 1 : f.stage.portrait ? 3 : 6)
  const chunks = chunkWords(words, maxWords)
  const t = f.t
  const chunk = chunks.find((c) => t >= c[0]!.start - 0.05 && t < c[c.length - 1]!.end + 0.25)
  if (!chunk) return
  const size = o.size ?? (f.stage.portrait ? 64 : 46)
  const y = o.y ?? (f.stage.portrait ? f.stage.h * 0.72 : f.stage.h * 0.86)
  const hl = g.color(o.highlight ?? 'accent')
  const base = g.color(o.color ?? 'text')
  const text = chunk.map((w) => w.text).join(' ')
  const appear = spring(t - chunk[0]!.start + 0.05, 'snappy')
  g.screen(() => {
    g.group({ x: f.stage.cx, y, scale: 0.92 + 0.08 * Math.min(1, appear), opacity: clamp01(appear * 2) }, () => {
      const m = g.measure(o.uppercase ? text.toUpperCase() : text, { size, weight: 750 })
      if (o.box !== false) g.rect({ x: 0, y: 0, w: m.w + size * 1.1, h: size * 1.75, radius: size * 0.4, fill: alpha('#000000', 0.55) })
      if (style === 'line') {
        g.text(text, { x: 0, y: 0, size, weight: 750, color: base, uppercase: o.uppercase })
        return
      }
      // draw word by word so the active word can be highlighted / popped
      let x = -m.w / 2
      const space = g.measure(' ', { size, weight: 750 }).w
      for (const w of chunk) {
        const ww = g.measure(o.uppercase ? w.text.toUpperCase() : w.text, { size, weight: 750 }).w
        const active = t >= w.start && t < w.end + 0.08
        const said = t >= w.start
        const pop = active ? 1 + 0.08 * Math.max(0, 1 - (t - w.start) / 0.15) : 1
        g.group({ x: x + ww / 2, y: 0, scale: pop }, () =>
          g.text(w.text, { x: 0, y: 0, size, weight: 750, uppercase: o.uppercase, color: active ? hl : said || style === 'word' ? base : alpha(base, 0.55) }),
        )
        x += ww + space
      }
    })
  })
}
