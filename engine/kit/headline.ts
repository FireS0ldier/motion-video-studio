/** Title blocks with a consistent motion hierarchy: eyebrow → title → subtitle. */

import type { Anchor } from '../core/scene.ts'
import type { Graphics } from '../gfx/graphics.ts'
import type { TextAnimation, TextMark } from '../gfx/text.ts'
import { responsive } from './layout.ts'

export interface HeadlineOptions {
  x: number
  y: number
  eyebrow?: string
  title: string
  subtitle?: string
  align?: 'left' | 'center' | 'right'
  /** When the block starts animating (default: scene start). */
  at?: Anchor
  /** Sync the title words to the voiceover. */
  sync?: boolean
  /** Title type token (default 'h1'). */
  size?: 'hero' | 'h1' | 'h2' | 'h3'
  maxWidth?: number
  marks?: TextMark[]
  /** Exit at the scene end. */
  exit?: boolean
  titleAnim?: TextAnimation
}

/**
 * Eyebrow, title and subtitle stacked around (x, y). The title leads, the
 * subtitle follows 0.25 s later (motion hierarchy). Returns the block height.
 */
export function headline(g: Graphics, o: HeadlineOptions): number {
  const f = g.f
  const { s } = responsive(f.stage)
  const align = o.align ?? 'center'
  const at = o.at ?? 0
  const t0 = f.at(at)
  const titleStyle = g.brand.type[o.size ?? 'h1']!
  const titleSize = titleStyle.size * s
  const maxWidth = (o.maxWidth ?? f.stage.title.w * (f.stage.portrait ? 1 : 0.8))
  const m = g.measure(o.title, { style: o.size ?? 'h1', size: titleSize, maxWidth })
  const eyebrowH = o.eyebrow ? 22 * s * 2.2 : 0
  const subH = o.subtitle ? 34 * s * 2.6 : 0
  const total = eyebrowH + m.h + subH
  let y = o.y - total / 2
  const exit = o.exit === false ? false : { at: 'end' as const }
  if (o.eyebrow) {
    g.text(o.eyebrow, { x: o.x, y: y + eyebrowH * 0.35, style: 'eyebrow', size: 22 * s, color: 'accent', align, anim: { preset: 'fade', at: { at: t0 }, by: 'line', exit } })
    y += eyebrowH
  }
  g.text(o.title, {
    x: o.x,
    y: y + m.h / 2,
    style: o.size ?? 'h1',
    size: titleSize,
    align,
    maxWidth,
    marks: o.marks,
    anim: o.titleAnim ?? { at: { at: t0 + (o.eyebrow ? 0.12 : 0) }, sync: o.sync ? 'voice' : undefined, exit },
  })
  y += m.h
  if (o.subtitle) {
    g.text(o.subtitle, {
      x: o.x,
      y: y + subH / 2,
      style: 'body',
      size: 34 * s,
      color: 'muted',
      align,
      maxWidth: maxWidth * 0.9,
      anim: { preset: 'rise', by: 'line', at: { at: t0 + 0.35 }, exit },
    })
  }
  return total
}
