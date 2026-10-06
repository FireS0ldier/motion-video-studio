/**
 * Deterministic randomness. Never use Math.random() in scenes: a frame must
 * look identical every time it is rendered. Use these seeded helpers instead.
 */

/** 32-bit hash of numbers and/or strings (FNV-1a mixed with murmur finalizer). */
export function hash32(...parts: Array<number | string>): number {
  let h = 0x811c9dc5
  for (const p of parts) {
    const s = typeof p === 'number' ? String(Math.fround(p)) : p
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x9e3779b9
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Hash to a float in [0, 1). */
export function hash01(...parts: Array<number | string>): number {
  return hash32(...parts) / 4294967296
}

export interface Rng {
  (): number
  range(min: number, max: number): number
  int(min: number, maxExclusive: number): number
  pick<T>(items: readonly T[]): T
  sign(): 1 | -1
  gaussian(mean?: number, sd?: number): number
}

/** Seeded PRNG (mulberry32). Same seed, same sequence, on every machine. */
export function rng(seed: number | string): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hash32(seed)
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  next.range = (min, max) => min + (max - min) * next()
  next.int = (min, max) => Math.floor(min + (max - min) * next())
  next.pick = (items) => items[Math.floor(next() * items.length)]!
  next.sign = () => (next() < 0.5 ? -1 : 1)
  next.gaussian = (mean = 0, sd = 1) => {
    const u = Math.max(1e-12, next())
    const v = next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return next
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** Smooth 1D gradient noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const g0 = hash01(i, seed) * 2 - 1
  const g1 = hash01(i + 1, seed) * 2 - 1
  const v = g0 * f + (g1 * (f - 1) - g0 * f) * fade(f)
  return Math.max(-1, Math.min(1, v * 2))
}

/** Smooth 2D gradient noise in roughly [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const grad = (ix: number, iy: number, dx: number, dy: number) => {
    const a = hash01(ix, iy, seed) * Math.PI * 2
    return Math.cos(a) * dx + Math.sin(a) * dy
  }
  const u = fade(xf)
  const v = fade(yf)
  const n00 = grad(xi, yi, xf, yf)
  const n10 = grad(xi + 1, yi, xf - 1, yf)
  const n01 = grad(xi, yi + 1, xf, yf - 1)
  const n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
  const nx0 = n00 + u * (n10 - n00)
  const nx1 = n01 + u * (n11 - n01)
  return (nx0 + v * (nx1 - nx0)) * 1.414
}

/** Fractal noise (octaves of noise1). */
export function fbm1(x: number, seed = 0, octaves = 3): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * freq, seed + o * 17)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/**
 * After Effects style wiggle: smooth random drift around 0.
 * `freq` wiggles per second, `amp` maximum amplitude.
 */
export function wiggle(t: number, freq: number, amp: number, seed = 0): number {
  return fbm1(t * freq, seed, 2) * amp
}
