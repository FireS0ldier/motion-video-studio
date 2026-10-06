import type { Anchor, CueContext, Frame } from '../core/scene.ts'
import type { Timing } from '../core/timing.ts'

/** Plain text of a string with **markup** removed. */
export const plain = (s: string) => s.replace(/\*\*/g, '').replace(/\n/g, ' ')

/** First few words of a phrase, used to find it in the voiceover. */
export const lead = (s: string, n = 3) => plain(s).split(/\s+/).slice(0, n).join(' ')

function findInScene(timing: Timing, phrase: string, start: number, end: number): number | null {
  for (const n of [3, 2, 1]) {
    const p = lead(phrase, n)
    if (!p) continue
    const s = timing.find(p, { from: start - 0.5, to: end })
    if (s && s.start >= start - 0.6 && s.start <= end) return s.start
  }
  return null
}

/**
 * When something should appear: the explicit anchor if given, else when its
 * text is spoken inside this scene, else `fallback` seconds into the scene.
 */
export function when(f: Frame, anchor: Anchor | undefined, phrase: string | undefined, fallback: number): number {
  if (anchor !== undefined) return f.at(anchor)
  if (phrase) {
    const t = findInScene(f.timing, phrase, f.start, f.end)
    if (t !== null) return t
  }
  return f.start + fallback
}

/** Same as when(), for cue sheets. */
export function cueWhen(c: CueContext, anchor: Anchor | undefined, phrase: string | undefined, fallback: number): number {
  if (anchor !== undefined) {
    if (typeof anchor === 'number') return c.start + anchor
    if (typeof anchor === 'string') return c.word(anchor).start
    if ('at' in anchor) return anchor.at
    return anchor.start
  }
  if (phrase) {
    const t = findInScene(c.timing, phrase, c.start, c.end)
    if (t !== null) return t
  }
  return c.start + fallback
}
