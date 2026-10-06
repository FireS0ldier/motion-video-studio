import type { AudioAnalysisData } from './types.ts'

export interface AudioSample {
  /** Voice loudness 0..1 (smoothed RMS). */
  level: number
  /** 1 at each speech onset, decaying to 0 (~150 ms). */
  pulse: number
  /** Music loudness 0..1. */
  music: number
  /** 1 on each music beat, decaying. */
  beat: number
  /** Position inside the current beat, 0..1. */
  beatPhase: number
  /** Index of the current music beat (-1 before the first). */
  beatIndex: number
}

const SILENT: AudioSample = { level: 0, pulse: 0, music: 0, beat: 0, beatPhase: 0, beatIndex: -1 }

function sampleEnvelope(env: number[] | undefined, rate: number, t: number): number {
  if (!env || env.length === 0 || t < 0) return 0
  const x = t * rate
  const i = Math.floor(x)
  if (i >= env.length - 1) return env[env.length - 1] ?? 0
  const f = x - i
  return env[i]! * (1 - f) + env[i + 1]! * f
}

function lastBefore(sorted: number[], t: number): number {
  let lo = 0
  let hi = sorted.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Audio-reactive values for a timeline time. Pure lookups into data/audio.json. */
export class AudioFeatures {
  constructor(
    private readonly data: AudioAnalysisData | null,
    private readonly voiceOffset = 0,
    private readonly musicOffset = 0,
  ) {}

  get available(): boolean {
    return !!this.data
  }

  at(t: number, pulseDecay = 0.15): AudioSample {
    const d = this.data
    if (!d) return SILENT
    const vt = t - this.voiceOffset
    const mt = t - this.musicOffset
    let pulse = 0
    if (d.voice) {
      const i = lastBefore(d.voice.onsets, vt)
      if (i >= 0) pulse = Math.exp(-(vt - d.voice.onsets[i]!) / pulseDecay)
    }
    let beat = 0
    let beatPhase = 0
    let beatIndex = -1
    if (d.music && d.music.beats.length) {
      const b = d.music.beats
      beatIndex = lastBefore(b, mt)
      if (beatIndex >= 0) {
        const t0 = b[beatIndex]!
        const t1 = b[beatIndex + 1] ?? t0 + 60 / Math.max(1, d.music.bpm)
        beatPhase = Math.min(1, (mt - t0) / Math.max(1e-3, t1 - t0))
        beat = Math.exp(-(mt - t0) / pulseDecay)
      }
    }
    return {
      level: sampleEnvelope(d.voice?.envelope, d.rate, vt),
      pulse,
      music: sampleEnvelope(d.music?.envelope, d.rate, mt),
      beat,
      beatPhase,
      beatIndex,
    }
  }
}
