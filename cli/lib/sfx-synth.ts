/**
 * Procedural sound-effect library and music bed.
 *
 * Every sound is synthesized from code with a seeded noise source, so the
 * library is reproducible, license-free and editable: tweak a recipe and run
 * `mvs sfx`. Output: 48 kHz stereo.
 */

import { Biquad, noise } from './dsp.ts'

export const SR = 48000

export interface Sound {
  name: string
  description: string
  tags: string[]
  /** Time (s) of the perceptual peak; the mixer aligns this with the cue when align: 'peak'. */
  peak: number
  /** Target peak level (dBFS) after normalization. */
  level: number
  render(): [Float32Array, Float32Array]
}

const buf = (sec: number) => new Float32Array(Math.ceil(sec * SR))
const TAU = Math.PI * 2

/** Small stereo Schroeder reverb. Returns a new stereo pair (dry + wet). */
function reverb(L: Float32Array, R: Float32Array, wet = 0.2, size = 1, tail = 1.2): [Float32Array, Float32Array] {
  const n = L.length + Math.round(tail * SR)
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  const process = (input: Float32Array, out: Float32Array, spread: number) => {
    const combs = [1557, 1617, 1491, 1422].map((d) => Math.round((d + spread) * size))
    const fb = 0.8
    const damp = 0.25
    const lines = combs.map((d) => ({ b: new Float32Array(d), i: 0, f: 0 }))
    const aps = [225, 556].map((d) => ({ b: new Float32Array(Math.round((d + spread) * size)), i: 0 }))
    for (let k = 0; k < n; k++) {
      const x = k < input.length ? input[k]! : 0
      let y = 0
      for (const c of lines) {
        const o = c.b[c.i]!
        c.f = o * (1 - damp) + c.f * damp
        c.b[c.i] = x + c.f * fb
        c.i = (c.i + 1) % c.b.length
        y += o
      }
      y *= 0.25
      for (const a of aps) {
        const o = a.b[a.i]!
        const v = -y + o
        a.b[a.i] = y + o * 0.5
        a.i = (a.i + 1) % a.b.length
        y = v
      }
      out[k] = x + y * wet
    }
  }
  process(L, outL, 0)
  process(R, outR, 23)
  return [outL, outR]
}

function pan(mono: Float32Array, p: number | ((i: number) => number)): [Float32Array, Float32Array] {
  const L = new Float32Array(mono.length)
  const R = new Float32Array(mono.length)
  for (let i = 0; i < mono.length; i++) {
    const v = typeof p === 'number' ? p : p(i)
    const a = ((Math.max(-1, Math.min(1, v)) + 1) * Math.PI) / 4
    L[i] = mono[i]! * Math.cos(a) * Math.SQRT2
    R[i] = mono[i]! * Math.sin(a) * Math.SQRT2
  }
  return [L, R]
}

/** Band-passed noise whose center frequency and gain follow functions of time. */
function sweptNoise(sec: number, seed: number, freq: (t: number) => number, gain: (t: number) => number, q = 1.2, type: 'bandpass' | 'lowpass' | 'highpass' = 'bandpass'): Float32Array {
  const out = buf(sec)
  const rnd = noise(seed)
  const f = new Biquad(SR, type, freq(0), q)
  const f2 = new Biquad(SR, type, freq(0), q)
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    if (i % 32 === 0) {
      f.set(type, freq(t), q)
      f2.set(type, freq(t), q)
    }
    out[i] = f2.tick(f.tick(rnd())) * gain(t)
  }
  return out
}

const bell = (t: number, peak: number, len: number, sharp = 2) => {
  if (t < 0 || t > len) return 0
  if (t < peak) return Math.sin(((t / peak) * Math.PI) / 2) ** sharp
  return Math.cos((((t - peak) / (len - peak)) * Math.PI) / 2) ** (sharp * 0.8)
}
const expDecay = (t: number, tau: number) => (t < 0 ? 0 : Math.exp(-t / tau))
const expSweep = (a: number, b: number, t: number, len: number) => a * (b / a) ** Math.min(1, Math.max(0, t / len))

function sine(sec: number, freq: (t: number) => number, amp: (t: number) => number): Float32Array {
  const out = buf(sec)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    ph += (TAU * freq(t)) / SR
    out[i] = Math.sin(ph) * amp(t)
  }
  return out
}

const add = (a: Float32Array, b: Float32Array, k = 1, offset = 0) => {
  for (let i = 0; i < b.length && i + offset < a.length; i++) if (i + offset >= 0) a[i + offset]! += b[i]! * k
  return a
}

function whoosh(name: string, sec: number, peak: number, lo: number, hi: number, seed: number, description: string): Sound {
  return {
    name,
    description,
    tags: ['transition', 'whoosh'],
    peak,
    level: -3,
    render() {
      const f = (t: number) => (t < peak ? expSweep(lo, hi, t, peak) : expSweep(hi, lo * 2, t - peak, sec - peak))
      const g = (t: number) => bell(t, peak, sec, 2.2)
      const a = sweptNoise(sec, seed, f, g, 1.1)
      const body = sweptNoise(sec, seed + 7, (t) => f(t) * 0.45, (t) => g(t) * 0.6, 0.8, 'lowpass')
      add(a, body)
      const [L, R] = pan(a, (i) => -0.55 + (1.1 * i) / a.length)
      return reverb(L, R, 0.18, 0.9, 0.6)
    },
  }
}

export const LIBRARY: Sound[] = [
  whoosh('whoosh', 0.75, 0.42, 260, 2400, 11, 'Airy medium whoosh for slides and pushes'),
  whoosh('whoosh-fast', 0.4, 0.2, 500, 4200, 12, 'Short bright whoosh for whip pans and quick cuts'),
  {
    ...whoosh('whoosh-deep', 1.0, 0.55, 110, 900, 13, 'Deep whoosh with sub for zoom-through transitions'),
    render() {
      const sec = 1.0
      const peak = 0.55
      const f = (t: number) => (t < peak ? expSweep(110, 900, t, peak) : expSweep(900, 200, t - peak, sec - peak))
      const g = (t: number) => bell(t, peak, sec, 2)
      const a = sweptNoise(sec, 13, f, g, 0.9)
      add(a, sine(sec, (t) => 45 + 40 * (t / sec), (t) => bell(t, peak, sec, 1.5) * 0.35))
      const [L, R] = pan(a, (i) => -0.4 + (0.8 * i) / a.length)
      return reverb(L, R, 0.25, 1.1, 0.9)
    },
  },
  {
    name: 'swipe',
    description: 'Short bright swipe for wipes, iris and UI panels',
    tags: ['transition', 'ui'],
    peak: 0.12,
    level: -6,
    render() {
      const a = sweptNoise(0.3, 21, (t) => expSweep(1500, 7000, t, 0.16), (t) => bell(t, 0.12, 0.3, 1.6), 1.4)
      return pan(a, (i) => 0.3 - (0.6 * i) / a.length)
    },
  },
  {
    name: 'reverse',
    description: 'Reverse swell that ends abruptly: lead-in to a slam or a hard cut',
    tags: ['transition', 'riser'],
    peak: 0.78,
    level: -4,
    render() {
      const sec = 0.8
      const a = sweptNoise(sec, 31, (t) => expSweep(300, 5000, t, sec), (t) => (t / sec) ** 3 * (t > sec - 0.02 ? (sec - t) / 0.02 : 1), 0.7)
      add(a, sine(sec, (t) => expSweep(80, 160, t, sec), (t) => (t / sec) ** 4 * 0.4))
      const [L, R] = pan(a, 0)
      return reverb(L, R, 0.15, 0.8, 0.3)
    },
  },
  {
    name: 'riser',
    description: 'Two-second tension riser (noise + rising tone), peaks at the end',
    tags: ['build', 'riser'],
    peak: 2.15,
    level: -4,
    render() {
      const sec = 2.2
      const a = sweptNoise(sec, 41, (t) => expSweep(300, 9000, t, sec), (t) => (t / sec) ** 2.2 * (t > sec - 0.03 ? (sec - t) / 0.03 : 1), 0.8, 'lowpass')
      for (const det of [-0.6, 0, 0.7]) add(a, sine(sec, (t) => expSweep(110 + det, 440 + det * 4, t, sec), (t) => (t / sec) ** 3 * 0.12))
      const [L, R] = pan(a, (i) => Math.sin((i / SR) * 3) * 0.3)
      return reverb(L, R, 0.2, 1, 0.8)
    },
  },
  {
    name: 'impact',
    description: 'Cinematic low impact with sub drop and tail (logo hits, big reveals)',
    tags: ['hit', 'impact'],
    peak: 0.01,
    level: -1,
    render() {
      const sec = 1.6
      const sub = sine(sec, (t) => expSweep(72, 36, t, 0.5), (t) => expDecay(t, 0.42))
      const body = sweptNoise(sec, 51, () => 380, (t) => expDecay(t, 0.12) * 0.7, 0.7, 'lowpass')
      const click = sweptNoise(0.01, 52, () => 4000, (t) => expDecay(t, 0.002), 0.7, 'highpass')
      add(sub, body)
      add(sub, click, 0.8)
      for (let i = 0; i < sub.length; i++) sub[i] = Math.tanh(sub[i]! * 1.6)
      const [L, R] = pan(sub, 0)
      return reverb(L, R, 0.22, 1.3, 1.2)
    },
  },
  {
    name: 'hit',
    description: 'Punchy short hit (text slams, counters landing)',
    tags: ['hit'],
    peak: 0.005,
    level: -2,
    render() {
      const sec = 0.6
      const a = sine(sec, (t) => expSweep(190, 70, t, 0.08), (t) => expDecay(t, 0.12))
      add(a, sweptNoise(sec, 61, () => 1300, (t) => expDecay(t, 0.035) * 0.8, 0.9))
      for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i]! * 1.4)
      const [L, R] = pan(a, 0)
      return reverb(L, R, 0.12, 0.7, 0.4)
    },
  },
  {
    name: 'click',
    description: 'Crisp UI click (buttons, cursor clicks, toggles)',
    tags: ['ui'],
    peak: 0.002,
    level: -6,
    render() {
      const a = sweptNoise(0.06, 71, () => 3200, (t) => expDecay(t, 0.005), 3)
      add(a, sine(0.06, () => 1800, (t) => expDecay(t, 0.009) * 0.5))
      return pan(a, 0)
    },
  },
  {
    name: 'tap',
    description: 'Soft UI tap (cards appearing, list items, hovers)',
    tags: ['ui'],
    peak: 0.003,
    level: -9,
    render() {
      const a = sweptNoise(0.09, 81, () => 1800, (t) => expDecay(t, 0.01), 2)
      add(a, sine(0.09, () => 900, (t) => expDecay(t, 0.02) * 0.6))
      return pan(a, 0)
    },
  },
  {
    name: 'pop',
    description: 'Bubbly pop (badges, icons, notifications popping in)',
    tags: ['ui'],
    peak: 0.01,
    level: -6,
    render() {
      const a = sine(0.18, (t) => expSweep(1100, 340, t, 0.045), (t) => expDecay(t, 0.05) * Math.min(1, t / 0.002))
      add(a, sweptNoise(0.18, 91, () => 2500, (t) => expDecay(t, 0.006) * 0.25, 1.5))
      return pan(a, 0)
    },
  },
  {
    name: 'tick',
    description: 'Tiny tick (counters, progress steps, typing on screen)',
    tags: ['ui'],
    peak: 0.001,
    level: -10,
    render() {
      const a = sine(0.03, () => 2600, (t) => expDecay(t, 0.004))
      add(a, sweptNoise(0.03, 101, () => 5000, (t) => expDecay(t, 0.002) * 0.4, 2))
      return pan(a, 0)
    },
  },
  {
    name: 'ding',
    description: 'Bright two-note success chime (done, sent, achievement)',
    tags: ['ui', 'success'],
    peak: 0.01,
    level: -6,
    render() {
      const sec = 1.6
      const a = buf(sec)
      const partials = [
        [1, 1, 0.9],
        [2, 0.4, 0.5],
        [2.76, 0.25, 0.35],
        [5.4, 0.1, 0.2],
      ] as const
      for (const [f0, at] of [
        [1318.5, 0],
        [1975.5, 0.11],
      ] as const) {
        for (const [r, amp, tau] of partials) add(a, sine(sec - at, () => f0 * r, (t) => amp * expDecay(t, tau) * Math.min(1, t / 0.002) * 0.35), 1, Math.round(at * SR))
      }
      const [L, R] = pan(a, 0.1)
      return reverb(L, R, 0.25, 1, 1)
    },
  },
  {
    name: 'notify',
    description: 'Soft two-tone notification',
    tags: ['ui'],
    peak: 0.01,
    level: -8,
    render() {
      const sec = 0.9
      const a = sine(sec, () => 880, (t) => expDecay(t, 0.22) * Math.min(1, t / 0.006) * 0.5)
      add(a, sine(sec - 0.09, () => 1174.7, (t) => expDecay(t, 0.3) * Math.min(1, t / 0.006) * 0.5), 1, Math.round(0.09 * SR))
      const [L, R] = pan(a, 0)
      return reverb(L, R, 0.2, 0.9, 0.7)
    },
  },
  {
    name: 'type',
    description: 'Keyboard typing burst, 1.4 s (code / prompt typing)',
    tags: ['ui', 'typing'],
    peak: 0.01,
    level: -9,
    render() {
      const sec = 1.4
      const L = buf(sec)
      const R = buf(sec)
      const rnd = noise(111)
      let t = 0.01
      let k = 0
      while (t < sec - 0.1) {
        const amp = 0.6 + 0.4 * Math.abs(rnd())
        const click = sweptNoise(0.05, 120 + k, () => 2600 + 1400 * Math.abs(rnd()), (x) => expDecay(x, 0.004) * amp, 2.5)
        add(click, sine(0.05, () => 170 + 40 * rnd(), (x) => expDecay(x, 0.015) * 0.5 * amp))
        const p = rnd() * 0.25
        const [cl, cr] = pan(click, p)
        add(L, cl, 1, Math.round(t * SR))
        add(R, cr, 1, Math.round(t * SR))
        t += 0.065 + 0.06 * Math.abs(rnd())
        k++
      }
      return [L, R]
    },
  },
  {
    name: 'glitch',
    description: 'Digital glitch burst (glitch transitions, errors, data)',
    tags: ['transition', 'glitch'],
    peak: 0.15,
    level: -6,
    render() {
      const sec = 0.45
      const a = buf(sec)
      const rnd = noise(131)
      let i = 0
      while (i < a.length) {
        const len = Math.round((0.015 + 0.03 * Math.abs(rnd())) * SR)
        const on = rnd() > -0.3
        const freq = 200 + 1800 * Math.abs(rnd())
        const crush = 4 + Math.floor(Math.abs(rnd()) * 12)
        let held = 0
        for (let k = 0; k < len && i < a.length; k++, i++) {
          if (!on) continue
          if (k % crush === 0) held = (Math.sin((TAU * freq * k) / SR) > 0 ? 0.5 : -0.5) + rnd() * 0.4
          a[i] = held * (1 - i / a.length) ** 0.5
        }
      }
      const hp = new Biquad(SR, 'highpass', 150)
      hp.process(a)
      return pan(a, (k) => Math.sin(k / 900) * 0.5)
    },
  },
  {
    name: 'shimmer',
    description: 'Sparkle / shimmer (magic moments, AI features, highlights)',
    tags: ['accent'],
    peak: 0.2,
    level: -8,
    render() {
      const sec = 1.3
      const L = buf(sec)
      const R = buf(sec)
      const rnd = noise(141)
      for (let k = 0; k < 10; k++) {
        const f = 2200 + 5500 * Math.abs(rnd())
        const start = 0.02 + 0.5 * Math.abs(rnd())
        const s = sine(sec - start, (t) => f * (1 + 0.004 * Math.sin(t * 40)), (t) => expDecay(t, 0.25) * Math.min(1, t / 0.01) * 0.18)
        const [l, r] = pan(s, rnd() * 0.8)
        add(L, l, 1, Math.round(start * SR))
        add(R, r, 1, Math.round(start * SR))
      }
      return reverb(L, R, 0.35, 1.2, 1)
    },
  },
]

export function normalizePeak(ch: [Float32Array, Float32Array], db: number): [Float32Array, Float32Array] {
  let m = 0
  for (const c of ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]!))
  const k = m > 0 ? 10 ** (db / 20) / m : 1
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i]! *= k
  // trim trailing near-silence
  let end = ch[0].length
  while (end > 1 && Math.abs(ch[0][end - 1]!) < 1e-4 && Math.abs(ch[1][end - 1]!) < 1e-4) end--
  return [ch[0].slice(0, end), ch[1].slice(0, end)]
}

// ------------------------------------------------------------------ music bed

const NOTE = (n: string) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n)!
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C']
  const semis = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12 - 9
  return 440 * 2 ** (semis / 12)
}

function wavetable(harmonics: number[]): Float32Array {
  const n = 4096
  const t = new Float32Array(n + 1)
  for (let i = 0; i <= n; i++) {
    let v = 0
    harmonics.forEach((a, h) => (v += a * Math.sin((TAU * (h + 1) * i) / n)))
    t[i] = v
  }
  let m = 0
  for (const v of t) m = Math.max(m, Math.abs(v))
  for (let i = 0; i <= n; i++) t[i]! /= m
  return t
}

/**
 * Calm, modern "product video" bed: warm pad chords, soft sub pulse, gentle
 * plucked arpeggio and light percussion that builds after the intro.
 * 100 BPM, A minor / C major colors. Deterministic.
 */
export function renderMusicBed(sec = 75): [Float32Array, Float32Array] {
  const n = Math.ceil(sec * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const bpm = 100
  const beat = 60 / bpm
  const bar = beat * 4
  const chordLen = bar * 2
  const chords = [
    ['A2', ['A3', 'C4', 'E4', 'G4', 'B4']],
    ['F2', ['F3', 'A3', 'C4', 'E4', 'G4']],
    ['C3', ['G3', 'C4', 'E4', 'G4', 'B4']],
    ['G2', ['G3', 'B3', 'D4', 'E4', 'A4']],
  ] as const
  const padTable = wavetable([1, 0.5, 0.3, 0.18, 0.1, 0.06, 0.03])
  const tableLen = padTable.length - 1
  const lfoL = new Biquad(SR, 'lowpass', 1200, 0.7)
  const lfoR = new Biquad(SR, 'lowpass', 1200, 0.7)
  const rnd = noise(777)
  // pad
  const padL = new Float32Array(n)
  const padR = new Float32Array(n)
  for (let c = 0; c * chordLen < sec + chordLen; c++) {
    const [, notes] = chords[c % chords.length]!
    const t0 = c * chordLen
    const start = Math.max(0, Math.round((t0 - 0.6) * SR))
    const end = Math.min(n, Math.round((t0 + chordLen + 1.2) * SR))
    notes.forEach((note, k) => {
      const f = NOTE(note)
      for (const det of [-0.0035, 0, 0.0042]) {
        let ph = (((k * 0.137 + det * 50) % 1) + 1) % 1
        const inc = (f * (1 + det)) / SR
        const panv = (k / (notes.length - 1) - 0.5) * 0.6 + det * 40
        const gl = Math.cos(((panv + 1) * Math.PI) / 4)
        const gr = Math.sin(((panv + 1) * Math.PI) / 4)
        for (let i = start; i < end; i++) {
          const t = i / SR - (t0 - 0.6)
          const env = Math.min(1, t / 1.4) * Math.min(1, (end / SR - i / SR) / 1.6)
          ph += inc
          if (ph >= 1) ph -= 1
          const x = ph * tableLen
          const j = x | 0
          const v = (padTable[j]! + (padTable[j + 1]! - padTable[j]!) * (x - j)) * env * 0.035
          padL[i]! += v * gl
          padR[i]! += v * gr
        }
      }
    })
  }
  for (let i = 0; i < n; i++) {
    if (i % 64 === 0) {
      const cut = 900 + 500 * Math.sin((TAU * i) / SR / 9)
      lfoL.set('lowpass', cut, 0.7)
      lfoR.set('lowpass', cut * 1.04, 0.7)
    }
    L[i]! += lfoL.tick(padL[i]!)
    R[i]! += lfoR.tick(padR[i]!)
  }
  // sub bass: one continuous oscillator (no clicks), gliding between chord roots,
  // with a smooth sidechain-style dip on every beat
  {
    let ph = 0
    let f = NOTE(chords[0]![0]) * 0.5
    for (let i = 0; i < n; i++) {
      const t = i / SR
      const target = NOTE(chords[Math.floor(t / chordLen) % chords.length]![0]) * 0.5
      f += (target - f) * 0.0008
      ph += (TAU * f) / SR
      const tb = t % beat
      const dip = Math.exp(-tb / 0.14) * Math.min(1, tb / 0.012)
      const v = Math.sin(ph) * 0.1 * (1 - 0.6 * dip) * Math.min(1, t / 3)
      L[i]! += v
      R[i]! += v
    }
  }
  // plucks and drums
  const pluckTable = wavetable([1, 0.25, 0.12, 0.05])
  for (let b = 0; b * beat < sec; b++) {
    const t = b * beat
    const barIdx = Math.floor(b / 4)
    const chord = chords[Math.floor(t / chordLen) % chords.length]!
    const intensity = Math.min(1, Math.max(0, (barIdx - 1) / 6))
    const s0 = Math.round(t * SR)
    // kick on 1 and 3 after bar 2
    if (barIdx >= 2 && b % 2 === 0) {
      let kp = 0
      for (let i = 0; i < 0.35 * SR && s0 + i < n; i++) {
        const tt = i / SR
        kp += (TAU * (45 + 60 * Math.exp(-tt / 0.03))) / SR
        const v = Math.sin(kp) * Math.exp(-tt / 0.16) * 0.28 * (0.6 + 0.4 * intensity)
        L[s0 + i]! += v
        R[s0 + i]! += v
      }
    }
    // offbeat hats after bar 4
    if (barIdx >= 4) {
      const h0 = Math.round((t + beat / 2) * SR)
      const hp = new Biquad(SR, 'highpass', 7500, 0.9)
      for (let i = 0; i < 0.06 * SR && h0 + i < n; i++) {
        const v = hp.tick(rnd()) * Math.exp(-(i / SR) / 0.018) * 0.035 * intensity
        L[h0 + i]! += v * 0.8
        R[h0 + i]! += v
      }
    }
    // clap on 2 and 4 after bar 8
    if (barIdx >= 8 && b % 2 === 1) {
      const bp = new Biquad(SR, 'bandpass', 1600, 1.1)
      for (let i = 0; i < 0.18 * SR && s0 + i < n; i++) {
        const tt = i / SR
        const env = (Math.exp(-tt / 0.012) + 0.5 * Math.exp(-Math.max(0, tt - 0.012) / 0.07)) * 0.07
        const v = bp.tick(rnd()) * env
        L[s0 + i]! += v
        R[s0 + i]! += v
      }
    }
    // plucked arpeggio on 8ths after bar 1
    if (barIdx >= 1) {
      for (let e = 0; e < 2; e++) {
        const notes = chord[1]
        const idx = (b * 2 + e) % notes.length
        const f = NOTE(notes[idx]!) * 2
        const p0 = Math.round((t + (e * beat) / 2) * SR)
        const panv = idx % 2 ? 0.35 : -0.35
        let pp = 0
        for (let i = 0; i < 0.5 * SR && p0 + i < n; i++) {
          const tt = i / SR
          pp += f / SR
          if (pp >= 1) pp -= 1
          const x = pp * (pluckTable.length - 1)
          const j = x | 0
          const v = (pluckTable[j]! + (pluckTable[j + 1]! - pluckTable[j]!) * (x - j)) * Math.exp(-tt / 0.16) * Math.min(1, tt / 0.003) * 0.03 * (0.5 + 0.5 * intensity)
          L[p0 + i]! += v * (1 - panv)
          R[p0 + i]! += v * (1 + panv)
        }
      }
    }
  }
  const [wl, wr] = reverb(L, R, 0.3, 1.25, 0)
  // fades
  const fi = 2 * SR
  const fo = 3.5 * SR
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fi, (n - i) / fo)
    wl[i]! *= g
    wr[i]! *= g
  }
  return normalizePeak([wl.slice(0, n), wr.slice(0, n)], -3)
}
