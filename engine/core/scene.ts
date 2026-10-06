/**
 * Scenes ("plates") and the per-frame context `f` they receive.
 *
 * THE rule: render(f, g) must be a pure function of `f`. No Math.random(),
 * no Date.now(), no state carried between frames. That is what makes preview,
 * stills, parallel rendering and re-renders frame-identical.
 */

import type { Graphics } from '../gfx/graphics.ts'
import { ease, type Ease } from '../motion/easing.ts'
import { rng, wiggle, hash32, type Rng } from '../motion/noise.ts'
import { spring, type SpringConfig, type SpringName } from '../motion/spring.ts'
import { clamp01 } from '../motion/tween.ts'
import type { AudioFeatures, AudioSample } from './audio-features.ts'
import type { Timing } from './timing.ts'
import type { Brand, Cue, Span, Stage, TimedSection, TimedWord } from './types.ts'

export type Quality = 'preview' | 'draft' | 'final'

/**
 * A point in time:
 *  - number  → seconds since the scene started (local time)
 *  - string  → when that word/phrase of the voiceover starts ("Meet Orbit")
 *  - Span    → its start (e.g. `f.word('faster')`)
 *  - {at}    → absolute timeline seconds
 */
export type Anchor = number | string | Span | { at: number }

export interface Frame {
  /** Scene id in the timeline. */
  readonly id: string
  /** Timeline time (s). */
  readonly t: number
  /** Local time since this scene started (s). Can be < 0 or > dur during transitions. */
  readonly lt: number
  /** Scene duration (s). */
  readonly dur: number
  /** Progress through the scene, 0..1 (clamped). */
  readonly p: number
  /** Scene start / end in timeline time. */
  readonly start: number
  readonly end: number
  /** Output frame index and fps. */
  readonly frame: number
  readonly fps: number
  readonly stage: Stage
  readonly brand: Brand
  readonly quality: Quality
  readonly timing: Timing
  /** Audio-reactive values at this moment. */
  readonly audio: AudioSample
  /** Transition state: 'in' while this scene transitions in, 'out' while it transitions out. */
  readonly transition: { phase: 'in' | 'out' | null; p: number }

  /** Anchor → timeline seconds. */
  at(a: Anchor): number
  /** Anchor → local seconds. */
  local(a: Anchor): number
  /** Seconds elapsed since an anchor (negative before it). */
  since(a: Anchor): number
  /** Eased 0..1 progress of an animation that starts at `a` and lasts `duration`. */
  in(a: Anchor, duration?: number, e?: Ease): number
  /** Eased 0..1 progress of a ramp that finishes `before` seconds before the scene ends. */
  out(duration?: number, e?: Ease, before?: number): number
  /** Entrance with the brand's motion style (duration/ease defaults from brand.motion). */
  enter(a?: Anchor, duration?: number): number
  /** Exit with the brand's motion style. 0 until the exit starts, 1 when gone. */
  exit(duration?: number, before?: number): number
  /** Visibility helper: enter at `a`, exit at the scene end. Returns 0..1. */
  show(a?: Anchor, enterDuration?: number, exitDuration?: number): number
  /** Analytic spring progress starting at `a` (may overshoot above 1). */
  spring(a: Anchor, config?: SpringConfig | SpringName): number

  /** Voiceover lookups by content. Missing phrases fall back to the scene start and log a warning. */
  word(text: string, nth?: number): Span
  phrase(text: string, nth?: number): Span
  sentence(text: string): Span
  section(id: string): Span
  /** True when the phrase exists in the voiceover. */
  has(text: string): boolean
  /** The word being spoken right now (null in pauses). */
  speaking(): TimedWord | null
  /** All words spoken during this scene. */
  spoken(): TimedWord[]

  /** Deterministic RNG stream for this scene (same key → same sequence). */
  rand(key?: string | number): Rng
  /** Smooth deterministic drift around 0 (After Effects wiggle). */
  wiggle(freq: number, amp: number, seed?: number): number
  /** Report a problem (shown in the preview and in `mvs check`). */
  warn(message: string): void
}

export interface CueContext {
  readonly timing: Timing
  /** Scene start/end when called from a scene's `cues`; whole video otherwise. */
  readonly start: number
  readonly end: number
  word(text: string, nth?: number): Span
  phrase(text: string, nth?: number): Span
  section(id: string): Span
  /** Resolved span of another scene by id. */
  scene(id: string): Span
  /** Make a cue. `at` uses the same Anchor rules as scenes (numbers are relative to `start`). */
  cue(sound: string, at: Anchor, opts?: Omit<Cue, 'sound' | 'at'>): Cue
}

export interface SceneDefinition {
  /** Human readable name (also the default timeline id). */
  name: string
  render(f: Frame, g: Graphics): void
  /** Sound effects that belong to this scene. */
  cues?(c: CueContext): Cue[]
  /** Asset paths (relative to the project's assets/) to preload and validate. */
  assets?: string[]
}

export function defineScene(def: SceneDefinition): SceneDefinition {
  if (!def || typeof def.render !== 'function') throw new Error('defineScene: a scene needs a render(f, g) function')
  if (!def.name) throw new Error('defineScene: a scene needs a name')
  return def
}

export interface FrameInit {
  id: string
  t: number
  start: number
  end: number
  frame: number
  stage: Stage
  brand: Brand
  quality: Quality
  timing: Timing
  audio: AudioFeatures
  transition: { phase: 'in' | 'out' | null; p: number }
  seed: number
  warn: (message: string) => void
}

/** Build the frame context for one scene at one moment. */
export function createFrame(init: FrameInit): Frame {
  const { t, start, end, timing, brand } = init
  const dur = Math.max(1e-6, end - start)
  const lt = t - start
  const motion = brand.motion
  const warned = new Set<string>()
  const warnOnce = (msg: string) => {
    if (warned.has(msg)) return
    warned.add(msg)
    init.warn(msg)
  }
  const find = (text: string, nth = 0): Span => {
    const span = timing.find(text, { from: start, to: end, nth })
    if (span) return span
    warnOnce(`[${init.id}] phrase "${text}" not found in the voiceover timing`)
    return { start, end: start + 0.3, text }
  }
  const at = (a: Anchor): number => {
    if (typeof a === 'number') return start + a
    if (typeof a === 'string') return find(a).start
    if ('at' in a) return a.at
    return a.start
  }
  let audioSample: AudioSample | null = null
  const f: Frame = {
    id: init.id,
    t,
    lt,
    dur,
    p: clamp01(lt / dur),
    start,
    end,
    frame: init.frame,
    fps: init.stage.fps,
    stage: init.stage,
    brand,
    quality: init.quality,
    timing,
    get audio() {
      return (audioSample ??= init.audio.at(t))
    },
    transition: init.transition,
    at,
    local: (a) => at(a) - start,
    since: (a) => t - at(a),
    in(a, duration = motion.durations.base, e) {
      const s = at(a)
      if (duration <= 0) return t >= s ? 1 : 0
      return ease(e, ease(motion.enter))(clamp01((t - s) / duration))
    },
    out(duration = motion.durations.fast, e, before = 0) {
      const s = end - before - duration
      if (duration <= 0) return t >= s ? 1 : 0
      return ease(e, ease(motion.exit))(clamp01((t - s) / duration))
    },
    enter(a = 0, duration = motion.durations.base) {
      return f.in(a, duration, motion.enter)
    },
    exit(duration = motion.durations.fast, before = 0) {
      return f.out(duration, motion.exit, before)
    },
    show(a = 0, enterDuration = motion.durations.base, exitDuration = motion.durations.fast) {
      return f.in(a, enterDuration, motion.enter) * (1 - f.out(exitDuration, motion.exit))
    },
    spring(a, config = motion.spring) {
      return spring(t - at(a), config)
    },
    word: find,
    phrase: find,
    sentence(text) {
      const s = timing.sentence(text, { from: start, to: end })
      if (s) return { start: s.start, end: s.end, text: s.text }
      warnOnce(`[${init.id}] sentence containing "${text}" not found`)
      return { start, end, text }
    },
    section(id) {
      const s: TimedSection | null = timing.section(id)
      if (s) return { start: s.start, end: s.end, text: s.title }
      warnOnce(`[${init.id}] section "${id}" not found in script`)
      return { start, end }
    },
    has: (text) => timing.matches(text).length > 0,
    speaking: () => timing.wordAt(t),
    spoken: () => timing.wordsBetween(start, end),
    rand: (key = 0) => rng(hash32(init.seed, init.id, key)),
    wiggle: (freq, amp, seed = 0) => wiggle(t, freq, amp, hash32(init.seed, init.id, seed)),
    warn: warnOnce,
  }
  return f
}
