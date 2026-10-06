/**
 * Project definition and resolution.
 *
 * A project is a folder in projects/<id>/ with a `project.ts` that default-
 * exports `defineProject({...})`. Everything else (script.md, data/timing.json,
 * data/audio.json, assets/) is discovered by convention.
 */

import { AudioFeatures } from './audio-features.ts'
import { defaultBrand, defaultLook, deepMerge } from './brand.ts'
import { makeStage, resolveFormat, type FormatName } from './format.ts'
import type { Anchor, CueContext, SceneDefinition } from './scene.ts'
import { parseScript, scriptHash, type ScriptDoc } from './script.ts'
import { activeAt, resolveTimeline, type ResolvedEntry, type TimelineDefinition } from './timeline.ts'
import { estimateTiming, shiftTiming, Timing } from './timing.ts'
import type {
  AudioAnalysisData,
  AudioConfig,
  Brand,
  Cue,
  DeepPartial,
  Format,
  Look,
  Manifest,
  Span,
  Stage,
  TimingData,
  TransitionType,
} from './types.ts'

export type CueSheet = (c: CueContext) => Cue[]

export interface ProjectDefinition {
  title: string
  /** Output format (default 'landscape' = 1920x1080 @ 60 fps). */
  format?: Format | FormatName
  brand?: Brand
  timeline: TimelineDefinition
  /** Project-level sound-effect cue sheet. */
  cues?: CueSheet
  audio?: AudioConfig
  /** Post-processing overrides on top of brand.look. */
  look?: DeepPartial<Look>
  /** Default tail after the voiceover ends (s). */
  tail?: number
  /** Seed for all deterministic randomness. */
  seed?: number
}

export function defineProject(def: ProjectDefinition): ProjectDefinition {
  if (!def?.timeline) throw new Error('defineProject: a project needs a timeline')
  return def
}

export interface ProjectInputs {
  id: string
  def: ProjectDefinition
  /** Raw script.md contents (optional). */
  script?: string | null
  timing?: TimingData | null
  analysis?: AudioAnalysisData | null
  /** Override the format (e.g. render a vertical cut of a landscape project). */
  format?: Format | FormatName
}

export interface ResolvedProject {
  id: string
  title: string
  format: Format
  stage: Stage
  brand: Brand
  look: Look
  audio: AudioConfig
  script: ScriptDoc | null
  timing: Timing
  timingSource: TimingData['source']
  timingStale: boolean
  features: AudioFeatures
  entries: ResolvedEntry[]
  duration: number
  frames: number
  seed: number
  cues: Cue[]
  warnings: string[]
  manifest(): Manifest
  active(t: number): ReturnType<typeof activeAt>
}

/** Default sound for each transition type (shared SFX library names). */
export const transitionSfx: Partial<Record<TransitionType, string>> = {
  slide: 'whoosh',
  push: 'whoosh',
  whip: 'whoosh-fast',
  zoom: 'whoosh-deep',
  glitch: 'glitch',
  wipe: 'swipe',
  iris: 'swipe',
}

export function resolveProject(inputs: ProjectInputs): ResolvedProject {
  const warnings: string[] = []
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m)
  }
  const { def } = inputs
  const format = resolveFormat(inputs.format ?? def.format ?? 'landscape')
  const stage = makeStage(format)
  const brand = def.brand ?? defaultBrand
  const look = deepMerge(deepMerge(defaultLook, brand.look), def.look ?? {})
  const audio: AudioConfig = def.audio ?? {}
  const voiceOffset = audio.voiceover?.offset ?? 0

  let script: ScriptDoc | null = null
  if (inputs.script) {
    try {
      script = parseScript(inputs.script)
    } catch (e) {
      warn(`script.md: ${(e as Error).message}`)
    }
  }

  let data = inputs.timing ?? null
  let stale = false
  if (!data && script) {
    data = estimateTiming(script)
    warn('No data/timing.json yet: using an estimated timing from script.md. Run `mvs align` once a voiceover exists.')
  }
  if (data && script && data.scriptHash && data.scriptHash !== scriptHash(script)) {
    stale = true
    warn('data/timing.json is stale: script.md changed since it was aligned. Run `mvs align` (or `mvs align --estimate`).')
  }
  if (!data) data = { version: 1, source: 'manual', words: [], sentences: [], sections: [] }
  const timing = new Timing(shiftTiming(data, voiceOffset))

  const features = new AudioFeatures(inputs.analysis ?? null, voiceOffset, audio.music?.offset ?? 0)
  const entries = resolveTimeline(def.timeline, timing, warn, def.tail ?? 1.2)
  const duration = entries[entries.length - 1]!.end
  const frames = Math.max(1, Math.round(duration * format.fps))
  const seed = def.seed ?? 1

  const cues = collectCues(def, entries, timing, warn)

  const resolved: ResolvedProject = {
    id: inputs.id,
    title: def.title,
    format,
    stage,
    brand,
    look,
    audio,
    script,
    timing,
    timingSource: data.source,
    timingStale: stale,
    features,
    entries,
    duration,
    frames,
    seed,
    cues,
    warnings,
    active: (t) => activeAt(entries, t),
    manifest: () => ({
      id: inputs.id,
      title: def.title,
      width: format.width,
      height: format.height,
      fps: format.fps,
      duration,
      frames,
      scenes: entries.map((e) => ({
        id: e.id,
        name: e.scene.name,
        start: e.start,
        end: e.end,
        ...(e.transition.type !== 'cut' ? { transition: { ...e.transition, ease: typeof e.transition.ease === 'string' ? e.transition.ease : undefined } } : {}),
      })),
      audio,
      cues,
      timing: { source: data!.source, words: timing.words.length, stale, voiceStart: timing.start, voiceEnd: timing.end },
      look,
      warnings: [...warnings],
    }),
  }
  return resolved
}

function makeCueContext(timing: Timing, entries: ResolvedEntry[], start: number, end: number, warn: (m: string) => void): CueContext {
  const find = (text: string, nth = 0): Span => {
    const s = timing.find(text, { from: start, to: end, nth })
    if (s) return s
    warn(`cues: phrase "${text}" not found in the voiceover timing`)
    return { start, end: start }
  }
  const at = (a: Anchor): number => {
    if (typeof a === 'number') return start + a
    if (typeof a === 'string') return find(a).start
    if ('at' in a) return a.at
    return a.start
  }
  return {
    timing,
    start,
    end,
    word: find,
    phrase: find,
    section(id) {
      const s = timing.section(id)
      if (!s) {
        warn(`cues: section "${id}" not found`)
        return { start, end }
      }
      return { start: s.start, end: s.end }
    },
    scene(id) {
      const e = entries.find((x) => x.id === id)
      if (!e) {
        warn(`cues: scene "${id}" not found`)
        return { start, end }
      }
      return { start: e.start, end: e.end }
    },
    cue: (sound, a, opts = {}) => ({ sound, at: at(a), ...opts }),
  }
}

function collectCues(def: ProjectDefinition, entries: ResolvedEntry[], timing: Timing, warn: (m: string) => void): Cue[] {
  const duration = entries[entries.length - 1]!.end
  const cues: Cue[] = []
  for (const e of entries) {
    const tr = e.transition
    if (tr.type !== 'cut' && e.window && tr.sfx !== false) {
      const sound = tr.sfx ?? transitionSfx[tr.type]
      if (sound) cues.push({ sound, at: (e.window[0] + e.window[1]) / 2, align: 'peak', gain: -3, label: `${tr.type} → ${e.id}` })
    }
    const scene: SceneDefinition = e.scene
    if (scene.cues) {
      try {
        cues.push(...scene.cues(makeCueContext(timing, entries, e.start, e.end, warn)))
      } catch (err) {
        warn(`cues of scene "${e.id}" failed: ${(err as Error).message}`)
      }
    }
  }
  if (def.cues) {
    try {
      cues.push(...def.cues(makeCueContext(timing, entries, 0, duration, warn)))
    } catch (err) {
      warn(`project cues failed: ${(err as Error).message}`)
    }
  }
  for (const c of cues) {
    if (!Number.isFinite(c.at)) warn(`cue "${c.sound}" has an invalid time`)
  }
  return cues.filter((c) => Number.isFinite(c.at) && c.at >= -0.5 && c.at <= duration + 1).sort((a, b) => a.at - b.at)
}
