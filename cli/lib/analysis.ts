/** Audio analysis used by `mvs analyze` and the aligners. Pure functions over PCM. */

import type { MusicAnalysis, VoiceAnalysis } from '../../engine/core/types.ts'
import { Biquad, gainToDb, rmsEnvelope } from './dsp.ts'
import { integratedLoudness } from './loudness.ts'

export const ENV_RATE = 100

function percentile(values: Float32Array | number[], p: number): number {
  const a = Array.from(values).sort((x, y) => x - y)
  if (!a.length) return 0
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))))]!
}

/** dB envelope at 100 Hz. */
export function dbEnvelope(mono: Float32Array, rate: number): Float32Array {
  const env = rmsEnvelope(mono, rate, 1 / ENV_RATE, 0.03)
  const out = new Float32Array(env.length)
  for (let i = 0; i < env.length; i++) out[i] = gainToDb(env[i]!)
  return out
}

export interface SpeechStats {
  floor: number
  peak: number
  threshold: number
}

export function speechStats(db: Float32Array): SpeechStats {
  const floor = Math.max(-90, percentile(db, 8))
  const peak = percentile(db, 98)
  return { floor, peak, threshold: floor + 0.33 * (peak - floor) }
}

/** Speech segments [start, end] in seconds (hysteresis + gap merging). */
export function speechSegments(db: Float32Array, minGap = 0.12, minLen = 0.06): Array<[number, number]> {
  const { threshold, floor } = speechStats(db)
  const low = floor + 0.6 * (threshold - floor)
  const segs: Array<[number, number]> = []
  let on = false
  let start = 0
  for (let i = 0; i < db.length; i++) {
    const v = db[i]!
    if (!on && v > threshold) {
      on = true
      start = i
    } else if (on && v < low) {
      on = false
      segs.push([start / ENV_RATE, i / ENV_RATE])
    }
  }
  if (on) segs.push([start / ENV_RATE, db.length / ENV_RATE])
  const merged: Array<[number, number]> = []
  for (const s of segs) {
    const last = merged[merged.length - 1]
    if (last && s[0] - last[1] < minGap) last[1] = s[1]
    else merged.push([s[0], s[1]])
  }
  return merged.filter((s) => s[1] - s[0] >= minLen)
}

export function analyzeVoice(mono: Float32Array, rate: number): VoiceAnalysis {
  const db = dbEnvelope(mono, rate)
  const { floor, peak, threshold } = speechStats(db)
  const range = Math.max(6, peak - floor)
  // smoothed 0..1 level
  const envelope: number[] = []
  let y = 0
  for (let i = 0; i < db.length; i++) {
    const x = Math.max(0, Math.min(1, (db[i]! - floor) / range))
    y += (x - y) * (x > y ? 0.6 : 0.25)
    envelope.push(Math.round(y * 1000) / 1000)
  }
  // onsets: sharp rises of the dB envelope inside speech
  const onsets: number[] = []
  let last = -1
  for (let i = 3; i < db.length - 1; i++) {
    const rise = db[i]! - db[i - 3]!
    if (rise > 6 && db[i]! > threshold && rise >= db[i + 1]! - db[i - 2]! && i - last > 9) {
      onsets.push(Math.round((i / ENV_RATE) * 1000) / 1000)
      last = i
    }
  }
  const segs = speechSegments(db)
  const silences: Array<[number, number]> = []
  let prev = 0
  for (const [a, b] of segs) {
    if (a - prev >= 0.15) silences.push([Math.round(prev * 100) / 100, Math.round(a * 100) / 100])
    prev = b
  }
  const dur = db.length / ENV_RATE
  if (dur - prev >= 0.15) silences.push([Math.round(prev * 100) / 100, Math.round(dur * 100) / 100])
  let pk = 0
  for (let i = 0; i < mono.length; i++) pk = Math.max(pk, Math.abs(mono[i]!))
  return {
    envelope,
    onsets,
    silences,
    lufs: Math.round(integratedLoudness([mono], rate) * 10) / 10,
    peakDb: Math.round(gainToDb(pk) * 10) / 10,
  }
}

export function analyzeMusic(mono: Float32Array, rate: number): MusicAnalysis {
  const db = dbEnvelope(mono, rate)
  const { floor, peak } = speechStats(db)
  const range = Math.max(6, peak - floor)
  const envelope = Array.from(db, (v) => Math.round(Math.max(0, Math.min(1, (v - floor) / range)) * 1000) / 1000)
  // onset strength from the low end (kick) and the full band
  const hp = new Biquad(rate, 'lowpass', 180)
  const low = hp.process(Float32Array.from(mono))
  const lowDb = dbEnvelope(low, rate)
  const strength = new Float32Array(db.length)
  for (let i = 1; i < db.length; i++) strength[i] = Math.max(0, db[i]! - db[i - 1]!) + 1.5 * Math.max(0, (lowDb[i] ?? 0) - (lowDb[i - 1] ?? 0))
  // remove the slow trend so sustained pads do not mask the pulses
  const win = Math.round(0.4 * ENV_RATE)
  const flux = new Float32Array(strength.length)
  let acc = 0
  for (let i = 0; i < strength.length; i++) {
    acc += strength[i]!
    if (i >= win) acc -= strength[i - win]!
    flux[i] = Math.max(0, strength[i]! - acc / Math.min(i + 1, win))
  }
  // comb search: for each tempo, the best phase of a beat grid over the onset function
  const pick = (x: number) => {
    const i = Math.round(x)
    return Math.max(flux[i - 1] ?? 0, flux[i] ?? 0, flux[i + 1] ?? 0)
  }
  let bpm = 120
  let bestOff = 0
  let best = -Infinity
  for (let cand = 70; cand <= 180; cand += 0.25) {
    const period = (60 * ENV_RATE) / cand
    const prior = Math.exp(-0.5 * (Math.log2(cand / 110) / 0.7) ** 2)
    for (let off = 0; off < period; off += 1) {
      let sum = 0
      let n = 0
      for (let x = off; x < flux.length; x += period) {
        sum += pick(x)
        n++
      }
      const score = (sum / Math.max(1, n)) * (0.75 + 0.25 * prior)
      if (score > best) {
        best = score
        bpm = cand
        bestOff = off
      }
    }
  }
  const period = (60 * ENV_RATE) / bpm
  const beats: number[] = []
  for (let i = bestOff; i < strength.length; i += period) beats.push(Math.round((i / ENV_RATE) * 1000) / 1000)
  const onsets: number[] = []
  const thr = percentile(strength, 95)
  for (let i = 1; i < strength.length - 1; i++) {
    if (strength[i]! > thr && strength[i]! >= strength[i - 1]! && strength[i]! >= strength[i + 1]!) onsets.push(Math.round((i / ENV_RATE) * 1000) / 1000)
  }
  return { envelope, bpm: Math.round(bpm * 10) / 10, beats, onsets }
}
