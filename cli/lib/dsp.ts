/** Small, dependency-free DSP toolkit used by the mixer, the analyzer and the SFX synthesizer. */

export const dbToGain = (db: number) => 10 ** (db / 20)
export const gainToDb = (g: number) => (g <= 1e-12 ? -240 : 20 * Math.log10(g))

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch'

/** RBJ cookbook biquad (direct form I). */
export class Biquad {
  b0 = 1
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(
    readonly rate: number,
    type?: FilterType,
    freq?: number,
    q = Math.SQRT1_2,
    gainDb = 0,
  ) {
    if (type && freq) this.set(type, freq, q, gainDb)
  }

  set(type: FilterType, freq: number, q = Math.SQRT1_2, gainDb = 0): this {
    const w0 = (2 * Math.PI * Math.min(freq, this.rate * 0.49)) / this.rate
    const cos = Math.cos(w0)
    const sin = Math.sin(w0)
    const alpha = sin / (2 * q)
    const A = 10 ** (gainDb / 40)
    let b0 = 1
    let b1 = 0
    let b2 = 0
    let a0 = 1
    let a1 = 0
    let a2 = 0
    switch (type) {
      case 'lowpass':
        b0 = (1 - cos) / 2
        b1 = 1 - cos
        b2 = (1 - cos) / 2
        a0 = 1 + alpha
        a1 = -2 * cos
        a2 = 1 - alpha
        break
      case 'highpass':
        b0 = (1 + cos) / 2
        b1 = -(1 + cos)
        b2 = (1 + cos) / 2
        a0 = 1 + alpha
        a1 = -2 * cos
        a2 = 1 - alpha
        break
      case 'bandpass':
        b0 = alpha
        b1 = 0
        b2 = -alpha
        a0 = 1 + alpha
        a1 = -2 * cos
        a2 = 1 - alpha
        break
      case 'notch':
        b0 = 1
        b1 = -2 * cos
        b2 = 1
        a0 = 1 + alpha
        a1 = -2 * cos
        a2 = 1 - alpha
        break
      case 'peaking':
        b0 = 1 + alpha * A
        b1 = -2 * cos
        b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        a1 = -2 * cos
        a2 = 1 - alpha / A
        break
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 - (A - 1) * cos + s)
        b1 = 2 * A * (A - 1 - (A + 1) * cos)
        b2 = A * (A + 1 - (A - 1) * cos - s)
        a0 = A + 1 + (A - 1) * cos + s
        a1 = -2 * (A - 1 + (A + 1) * cos)
        a2 = A + 1 + (A - 1) * cos - s
        break
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 + (A - 1) * cos + s)
        b1 = -2 * A * (A - 1 + (A + 1) * cos)
        b2 = A * (A + 1 + (A - 1) * cos - s)
        a0 = A + 1 - (A - 1) * cos + s
        a1 = 2 * (A - 1 - (A + 1) * cos)
        a2 = A + 1 - (A - 1) * cos - s
        break
      }
    }
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
    return this
  }

  coeffs(b0: number, b1: number, b2: number, a1: number, a2: number): this {
    Object.assign(this, { b0, b1, b2, a1, a2 })
    return this
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }

  process(buf: Float32Array, out: Float32Array = buf): Float32Array {
    for (let i = 0; i < buf.length; i++) out[i] = this.tick(buf[i]!)
    return out
  }
}

/** Windowed RMS (linear) at `hop` seconds per value. */
export function rmsEnvelope(x: Float32Array, rate: number, hop = 0.01, win = 0.03): Float32Array {
  const h = Math.max(1, Math.round(hop * rate))
  const w = Math.max(h, Math.round(win * rate))
  const n = Math.ceil(x.length / h)
  const out = new Float32Array(n)
  // prefix sums of squares for O(n)
  const pre = new Float64Array(x.length + 1)
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i]! + x[i]! * x[i]!
  for (let k = 0; k < n; k++) {
    const c = k * h
    const a = Math.max(0, c - (w >> 1))
    const b = Math.min(x.length, c + (w >> 1))
    out[k] = b > a ? Math.sqrt((pre[b]! - pre[a]!) / (b - a)) : 0
  }
  return out
}

/** Attack/release smoothing of an envelope (values per step of `dt` seconds). */
export function smoothEnvelope(env: Float32Array, dt: number, attack: number, release: number): Float32Array {
  const out = new Float32Array(env.length)
  const ka = 1 - Math.exp(-dt / Math.max(1e-4, attack))
  const kr = 1 - Math.exp(-dt / Math.max(1e-4, release))
  let y = 0
  for (let i = 0; i < env.length; i++) {
    const x = env[i]!
    y += (x - y) * (x > y ? ka : kr)
    out[i] = y
  }
  return out
}

/** Deterministic white noise generator (xorshift32), output -1..1. */
export function noise(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

/** Linear-interpolated read with a playback-rate factor. */
export function resampleRate(x: Float32Array, rate: number): Float32Array {
  if (rate === 1) return x
  const n = Math.floor(x.length / rate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * rate
    const j = Math.floor(p)
    const f = p - j
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? 0) * f
  }
  return out
}
