/**
 * Timeline: the ordered list of scenes and where they cut.
 *
 * Starts are usually anchored to the voiceover by content, so a new read of
 * the script re-times the whole video automatically:
 *
 *   export default defineTimeline(({ cut, section, end }) => [
 *     { scene: hook, start: 0 },
 *     { scene: intro, start: section('intro'), transition: 'zoom' },
 *     { scene: ui, start: cut('Every event'), transition: { type: 'slide', direction: 'left' } },
 *     { scene: cta, start: section('cta'), end: end(1.5) },
 *   ])
 */

import type { Ease } from '../motion/easing.ts'
import type { SceneDefinition } from './scene.ts'
import type { Timing } from './timing.ts'
import type { Span, TransitionSpec, TransitionType } from './types.ts'

export interface TimelineEntry {
  scene: SceneDefinition
  /** Unique id (defaults to scene.name). */
  id?: string
  /** Timeline seconds. Use the helpers to anchor it to the voiceover. */
  start: number
  /** Only needed on the last entry (others end where the next starts). */
  end?: number
  /** How this scene comes in. */
  transition?: TransitionSpec | TransitionType
}

export interface TimelineHelpers {
  /** Cut just before a phrase is spoken (inside the preceding pause). */
  cut(phrase: string, opts?: { lead?: number; nth?: number; after?: number }): number
  /** Cut just before the first word of a script section (## heading). */
  section(id: string, opts?: { lead?: number }): number
  /** Span of a phrase (start/end in timeline seconds). */
  word(phrase: string, nth?: number): Span
  /** Absolute seconds (for videos without voiceover). */
  at(seconds: number): number
  /** End of the voiceover plus `tail` seconds (default 1.2). */
  end(tail?: number): number
  readonly voiceStart: number
  readonly voiceEnd: number
}

export type TimelineDefinition = (h: TimelineHelpers) => TimelineEntry[]

export function defineTimeline(fn: TimelineDefinition): TimelineDefinition {
  return fn
}

export interface ResolvedEntry {
  id: string
  scene: SceneDefinition
  start: number
  end: number
  /** Transition into this entry (normalized), if any. */
  transition: Required<Pick<TransitionSpec, 'type' | 'duration'>> & TransitionSpec & { ease: Ease }
  /** Overlap window [from, to] of the incoming transition, if any. */
  window: [number, number] | null
}

const DEFAULT_DURATION: Record<TransitionType, number> = {
  cut: 0,
  fade: 0.6,
  dip: 0.7,
  slide: 0.55,
  push: 0.6,
  zoom: 0.55,
  wipe: 0.6,
  iris: 0.7,
  blur: 0.6,
  glitch: 0.32,
  whip: 0.38,
}

const DEFAULT_EASE: Record<TransitionType, Ease> = {
  cut: 'linear',
  fade: 'inOut',
  dip: 'inOut',
  slide: 'quintInOut',
  push: 'quintInOut',
  zoom: 'expoInOut',
  wipe: 'quartInOut',
  iris: 'quartInOut',
  blur: 'inOut',
  glitch: 'linear',
  whip: 'expoInOut',
}

export function normalizeTransition(t: TransitionSpec | TransitionType | undefined): ResolvedEntry['transition'] {
  const spec: TransitionSpec = typeof t === 'string' ? { type: t } : (t ?? { type: 'cut' })
  if (!(spec.type in DEFAULT_DURATION)) throw new Error(`Unknown transition "${spec.type}". Known: ${Object.keys(DEFAULT_DURATION).join(', ')}`)
  return {
    ...spec,
    type: spec.type,
    duration: spec.type === 'cut' ? 0 : Math.max(0, spec.duration ?? DEFAULT_DURATION[spec.type]),
    ease: spec.ease ?? DEFAULT_EASE[spec.type],
  }
}

export function makeTimelineHelpers(timing: Timing, warn: (m: string) => void): TimelineHelpers {
  const voiceStart = timing.start
  const voiceEnd = timing.end
  let fallback = 0
  const miss = (what: string) => {
    warn(`timeline: ${what} not found in the voiceover timing — using a placeholder time`)
    fallback += 3
    return fallback
  }
  return {
    cut(phrase, opts = {}) {
      const t = timing.cutBefore(phrase, opts.lead ?? 0.15, { nth: opts.nth, from: opts.after })
      if (t === null) return miss(`cut("${phrase}")`)
      fallback = t
      return t
    },
    section(id, opts = {}) {
      const s = timing.section(id)
      if (!s) return miss(`section("${id}")`)
      const t = timing.cutAt(s.start, opts.lead ?? 0.15)
      fallback = t
      return t
    },
    word(phrase, nth) {
      const s = timing.find(phrase, { nth })
      if (!s) {
        const t = miss(`word("${phrase}")`)
        return { start: t, end: t + 0.3 }
      }
      return s
    },
    at: (s) => s,
    end: (tail = 1.2) => voiceEnd + tail,
    voiceStart,
    voiceEnd,
  }
}

/** Evaluate the timeline definition into absolute, validated entries. */
export function resolveTimeline(
  def: TimelineDefinition,
  timing: Timing,
  warn: (m: string) => void,
  defaultTail = 1.2,
): ResolvedEntry[] {
  const helpers = makeTimelineHelpers(timing, warn)
  const raw = def(helpers)
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('timeline: the definition must return at least one entry')
  const ids = new Set<string>()
  const entries: ResolvedEntry[] = raw.map((e, i) => {
    if (!e?.scene?.render) throw new Error(`timeline entry #${i}: missing scene (did you import the scene file's default export?)`)
    let id = e.id ?? e.scene.name
    if (ids.has(id)) {
      let n = 2
      while (ids.has(`${id}-${n}`)) n++
      id = `${id}-${n}`
    }
    ids.add(id)
    if (!Number.isFinite(e.start)) throw new Error(`timeline entry "${id}": start is not a number (${e.start})`)
    return { id, scene: e.scene, start: Math.max(0, e.start), end: NaN, transition: normalizeTransition(i === 0 ? undefined : e.transition), window: null }
  })
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i]!
    const next = entries[i + 1]
    if (next) {
      if (next.start <= cur.start + 0.05) {
        warn(`timeline: "${next.id}" starts at ${next.start.toFixed(2)}s, not after "${cur.id}" (${cur.start.toFixed(2)}s) — check its anchor`)
        next.start = cur.start + 0.5
      }
      cur.end = next.start
    } else {
      const explicit = raw[i]!.end
      cur.end = explicit !== undefined && Number.isFinite(explicit) ? explicit : helpers.end(defaultTail)
      if (cur.end <= cur.start + 0.1) {
        warn(`timeline: last scene "${cur.id}" ends before it starts — extending to 2s`)
        cur.end = cur.start + 2
      }
    }
  }
  // transition windows, clamped so neighbours keep enough solo time
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!
    const cur = entries[i]!
    const tr = cur.transition
    if (tr.type === 'cut' || tr.duration <= 0) continue
    const maxD = 0.8 * Math.min(prev.end - prev.start, cur.end - cur.start)
    if (tr.duration > maxD) tr.duration = maxD
    const b = cur.start
    const align = tr.align ?? 'center'
    const from = align === 'center' ? b - tr.duration / 2 : align === 'start' ? b : b - tr.duration
    cur.window = [Math.max(prev.start, from), Math.min(cur.end, from + tr.duration)]
  }
  return entries
}

export interface ActiveScenes {
  /** Main entry (the incoming one during a transition). */
  a: ResolvedEntry
  /** Outgoing entry during a transition. */
  b: ResolvedEntry | null
  /** Transition progress 0..1 (eased later by the compositor). */
  p: number
}

/** Which scene(s) are visible at time t. */
export function activeAt(entries: ResolvedEntry[], t: number): ActiveScenes {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.window && t >= e.window[0] && t < e.window[1]) {
      return { a: e, b: entries[i - 1]!, p: (t - e.window[0]) / (e.window[1] - e.window[0]) }
    }
  }
  let idx = entries.findIndex((e) => t >= e.start && t < e.end)
  if (idx < 0) idx = t < entries[0]!.start ? 0 : entries.length - 1
  return { a: entries[idx]!, b: null, p: 1 }
}
