/**
 * Easing curves. Every function maps 0..1 -> 0..1 (back/elastic overshoot).
 *
 * Rule of thumb for professional motion:
 *  - entrances decelerate  (`out`, `expoOut`, `quintOut`, `emphasized`)
 *  - exits accelerate      (`in`, `quintIn`, `expoIn`) and are ~30% faster than entrances
 *  - moves / camera        (`inOut`, `smooth`)
 *  - overshoot sparingly   (`backOut`, springs) for small, playful UI elements
 */

export type EaseFn = (t: number) => number
export type BezierTuple = readonly [number, number, number, number]
export type Ease = EaseName | EaseFn | BezierTuple

/** CSS-compatible cubic-bezier(x1, y1, x2, y2). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  if (x1 === y1 && x2 === y2) return linear
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const solve = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-7) return t
      const d = sampleDX(t)
      if (Math.abs(d) < 1e-7) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t)
      if (Math.abs(v - x) < 1e-7) return t
      if (x > v) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solve(x)))
}

export const linear: EaseFn = (t) => t

const pow = (p: number) => ({
  in: (t: number) => t ** p,
  out: (t: number) => 1 - (1 - t) ** p,
  inOut: (t: number) => (t < 0.5 ? 2 ** (p - 1) * t ** p : 1 - (-2 * t + 2) ** p / 2),
})
const quad = pow(2)
const cubic = pow(3)
const quart = pow(4)
const quint = pow(5)

const expoIn: EaseFn = (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10))
const expoOut: EaseFn = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))
const expoInOut: EaseFn = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2

const circIn: EaseFn = (t) => 1 - Math.sqrt(1 - t * t)
const circOut: EaseFn = (t) => Math.sqrt(1 - (t - 1) ** 2)
const circInOut: EaseFn = (t) =>
  t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2

const sineIn: EaseFn = (t) => 1 - Math.cos((t * Math.PI) / 2)
const sineOut: EaseFn = (t) => Math.sin((t * Math.PI) / 2)
const sineInOut: EaseFn = (t) => -(Math.cos(Math.PI * t) - 1) / 2

export const backOut =
  (s = 1.70158): EaseFn =>
  (t) =>
    1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
export const backIn =
  (s = 1.70158): EaseFn =>
  (t) =>
    (s + 1) * t ** 3 - s * t ** 2

const elasticOut: EaseFn = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1

export const eases = {
  linear,
  // generic aliases (what you usually want)
  in: cubic.in,
  out: cubic.out,
  inOut: cubic.inOut,
  smooth: cubicBezier(0.45, 0, 0.2, 1),
  /** Material-style emphasized decelerate: fast start, long soft landing. */
  emphasized: cubicBezier(0.05, 0.7, 0.1, 1),
  /** Material-style standard curve for UI moves. */
  standard: cubicBezier(0.2, 0, 0, 1),
  /** Strong acceleration for exits. */
  accelerate: cubicBezier(0.3, 0, 0.8, 0.15),
  /** Snappy UI curve, good for buttons, toggles, chips. */
  snappy: cubicBezier(0.2, 0.9, 0.1, 1),
  /** Slow-in slow-out for camera dollies. */
  camera: cubicBezier(0.65, 0, 0.35, 1),
  quadIn: quad.in,
  quadOut: quad.out,
  quadInOut: quad.inOut,
  cubicIn: cubic.in,
  cubicOut: cubic.out,
  cubicInOut: cubic.inOut,
  quartIn: quart.in,
  quartOut: quart.out,
  quartInOut: quart.inOut,
  quintIn: quint.in,
  quintOut: quint.out,
  quintInOut: quint.inOut,
  expoIn,
  expoOut,
  expoInOut,
  circIn,
  circOut,
  circInOut,
  sineIn,
  sineOut,
  sineInOut,
  backIn: backIn(),
  backOut: backOut(),
  backOutSoft: backOut(1.1),
  elasticOut,
} satisfies Record<string, EaseFn>

export type EaseName = keyof typeof eases

const bezierCache = new Map<string, EaseFn>()

/** Resolve an ease name, function or cubic-bezier tuple to a function. */
export function ease(e: Ease | undefined, fallback: EaseFn = eases.out): EaseFn {
  if (e === undefined) return fallback
  if (typeof e === 'function') return e
  if (typeof e === 'string') {
    const fn = (eases as Record<string, EaseFn>)[e]
    if (!fn) throw new Error(`Unknown ease "${e}". Known: ${Object.keys(eases).join(', ')}`)
    return fn
  }
  const key = e.join(',')
  let fn = bezierCache.get(key)
  if (!fn) {
    fn = cubicBezier(e[0], e[1], e[2], e[3])
    bezierCache.set(key, fn)
  }
  return fn
}
