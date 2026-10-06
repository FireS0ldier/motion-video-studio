import { describe, expect, it } from 'vitest'
import { parseScript } from '../../engine/core/script.ts'
import { heuristicAlign, mapAsrToScript, refineTimes } from '../../cli/lib/align.ts'
import { analyzeMusic, dbEnvelope, speechSegments } from '../../cli/lib/analysis.ts'
import { Biquad, dbToGain, gainToDb, noise, rmsEnvelope } from '../../cli/lib/dsp.ts'
import { integratedLoudness, truePeakDb } from '../../cli/lib/loudness.ts'
import { encodeWav, readWav } from '../../cli/lib/wav.ts'
import { LIBRARY, normalizePeak } from '../../cli/lib/sfx-synth.ts'
import { createHash } from 'node:crypto'

const SR = 48000
const sine = (freq: number, amp: number, sec: number) => Float32Array.from({ length: SR * sec }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR))

describe('dsp', () => {
  it('converts dB', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2)
  })
  it('low-pass attenuates high frequencies', () => {
    const lp = new Biquad(SR, 'lowpass', 500)
    const out = lp.process(sine(5000, 1, 0.5).slice())
    const rms = Math.sqrt(out.slice(SR * 0.1).reduce((s, v) => s + v * v, 0) / (SR * 0.4))
    expect(rms).toBeLessThan(0.02)
  })
  it('rms envelope tracks level', () => {
    const env = rmsEnvelope(sine(440, 0.5, 1), SR)
    expect(env[50]).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})

describe('loudness (BS.1770)', () => {
  it('a full-scale 1 kHz sine in one channel measures about -3 LUFS', () => {
    expect(integratedLoudness([sine(1000, 1, 3)], SR)).toBeCloseTo(-3.01, 1)
  })
  it('scales with gain and channel count', () => {
    const s = sine(1000, 0.1, 3)
    expect(integratedLoudness([s], SR)).toBeCloseTo(-23.01, 1)
    expect(integratedLoudness([s, s], SR)).toBeCloseTo(-20.0, 1)
  })
  it('silence is gated', () => {
    expect(integratedLoudness([new Float32Array(SR * 2)], SR)).toBe(-70)
  })
  it('true peak is at least the sample peak', () => {
    expect(truePeakDb([sine(997, 0.5, 1)])).toBeGreaterThanOrEqual(-6.03)
  })
})

describe('wav', () => {
  it('round-trips 16/24/32-bit', () => {
    const ch = [sine(440, 0.5, 0.1), sine(220, 0.25, 0.1)]
    for (const bits of [16, 24, 32] as const) {
      const back = readWav(encodeWav({ rate: SR, channels: ch }, bits))
      expect(back.rate).toBe(SR)
      expect(back.channels.length).toBe(2)
      expect(back.channels[0]![123]).toBeCloseTo(ch[0]![123]!, bits === 16 ? 3 : 5)
    }
  })
})

/** Synthetic "speech": noise bursts per word, longer gaps between sentences. */
function fakeSpeech(words: number[], sentenceBreaks: Set<number>) {
  const rnd = noise(5)
  const out: number[] = []
  const starts: number[] = []
  out.push(...new Array(SR * 0.3).fill(0))
  words.forEach((dur, i) => {
    if (sentenceBreaks.has(i)) out.push(...new Array(Math.round(SR * 0.6)).fill(0))
    starts.push(out.length / SR)
    for (let k = 0; k < dur * SR; k++) out.push(rnd() * 0.3)
    out.push(...new Array(Math.round(SR * 0.05)).fill(0))
  })
  out.push(...new Array(SR * 0.3).fill(0))
  return { pcm: Float32Array.from(out), starts }
}

describe('alignment', () => {
  const doc = parseScript('## s\nOne two three four. Five six seven. Eight nine ten.')
  const { pcm, starts } = fakeSpeech([0.25, 0.25, 0.3, 0.3, 0.3, 0.25, 0.4, 0.3, 0.3, 0.25], new Set([4, 7]))
  const db = dbEnvelope(pcm, SR)
  it('detects speech segments', () => {
    const segs = speechSegments(db)
    expect(segs.length).toBeGreaterThanOrEqual(3)
    expect(segs[0]![0]).toBeCloseTo(0.3, 1)
  })
  it('heuristic aligner places sentence starts near the real onsets', () => {
    const times = heuristicAlign(doc, db)
    expect(times.length).toBe(10)
    for (const i of [0, 4, 7]) expect(Math.abs(times[i]!.start - starts[i]!)).toBeLessThan(0.15)
    for (let i = 1; i < times.length; i++) expect(times[i]!.start).toBeGreaterThan(times[i - 1]!.start)
  })
  it('refineTimes fills gaps and keeps order', () => {
    const partial = heuristicAlign(doc, db).map((t, i) => (i % 3 === 1 ? null : t))
    const out = refineTimes(doc, partial, db, pcm.length / SR)
    expect(out.every((t) => t && t.end > t.start)).toBe(true)
    for (let i = 1; i < out.length; i++) expect(out[i]!.start).toBeGreaterThan(out[i - 1]!.start)
  })
  it('maps ASR words (with numbers and insertions) onto the script', () => {
    const d = parseScript('## s\nTeams ship {40%|forty percent} faster today.')
    const asr = [
      { word: 'Teams', start: 1, end: 1.3 },
      { word: 'uh', start: 1.3, end: 1.4 },
      { word: 'ship', start: 1.4, end: 1.6 },
      { word: '40%', start: 1.6, end: 2.2 },
      { word: 'faster', start: 2.2, end: 2.6 },
      { word: 'today.', start: 2.6, end: 3.0 },
    ]
    const m = mapAsrToScript(d, asr)
    expect(m.map((t) => t?.start)).toEqual([1, 1.4, 1.6, 2.2, 2.6])
  })
})

describe('music analysis', () => {
  it('finds the tempo of a click track', () => {
    const sec = 20
    const x = new Float32Array(SR * sec)
    const beat = 60 / 100
    for (let t = 0.1; t < sec; t += beat) for (let k = 0; k < 2000; k++) x[Math.round(t * SR) + k] = Math.sin(k / 6) * Math.exp(-k / 400)
    const m = analyzeMusic(x, SR)
    expect(m.bpm).toBeGreaterThan(98)
    expect(m.bpm).toBeLessThan(102)
    expect(Math.abs(m.beats[0]! - 0.1)).toBeLessThan(0.05)
  })
})

describe('sfx synthesizer', () => {
  it('is deterministic and normalized', () => {
    for (const s of LIBRARY.slice(0, 4)) {
      const a = normalizePeak(s.render(), s.level)
      const b = normalizePeak(s.render(), s.level)
      const h = (x: Float32Array[]) => createHash('sha1').update(Buffer.from(x[0]!.buffer)).update(Buffer.from(x[1]!.buffer)).digest('hex')
      expect(h(a)).toBe(h(b))
      let peak = 0
      for (const c of a) for (const v of c) peak = Math.max(peak, Math.abs(v))
      expect(gainToDb(peak)).toBeCloseTo(s.level, 1)
    }
  })
})
