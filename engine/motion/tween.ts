import { mixColor } from '../gfx/color.ts'
import { ease, type Ease } from './easing.ts'

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v)
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const mix = lerp
/** Inverse lerp: where `v` sits between a and b (unclamped). */
export const invLerp = (a: number, b: number, v: number) => (a === b ? 0 : (v - a) / (b - a))
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01(invLerp(a, b, v))
  return t * t * (3 - 2 * t)
}

/** Map v from [a, b] to [c, d]. Clamped by default. */
export function remap(v: number, a: number, b: number, c: number, d: number, clampIt = true): number {
  const t = invLerp(a, b, v)
  return lerp(c, d, clampIt ? clamp01(t) : t)
}

/** Eased 0..1 progress of an animation that starts at `start` and lasts `duration` (same time base as t). */
export function progress(t: number, start: number, duration: number, e?: Ease): number {
  if (duration <= 0) return t >= start ? 1 : 0
  const p = clamp01((t - start) / duration)
  return ease(e)(p)
}

/** Remotion-style interpolate: piecewise linear (or eased) mapping of t through input -> output ranges. */
export function interpolate(
  t: number,
  input: readonly number[],
  output: readonly number[],
  opts: { ease?: Ease; clamp?: boolean } = {},
): number {
  if (input.length !== output.length || input.length < 2) throw new Error('interpolate: ranges must match and have >= 2 entries')
  const doClamp = opts.clamp ?? true
  const fn = ease(opts.ease, (x) => x)
  if (t <= input[0]!) {
    if (doClamp) return output[0]!
  }
  if (t >= input[input.length - 1]!) {
    if (doClamp) return output[output.length - 1]!
  }
  let i = 1
  while (i < input.length - 1 && t > input[i]!) i++
  const a = input[i - 1]!
  const b = input[i]!
  const local = invLerp(a, b, t)
  return lerp(output[i - 1]!, output[i]!, fn(doClamp ? clamp01(local) : local))
}

export type KeyValue = number | string | readonly number[]
/** A keyframe: [time, value, ease-into-this-key?]. */
export type Keyframe<V extends KeyValue> = readonly [time: number, value: V, ease?: Ease]

/**
 * Keyframe interpolation for numbers, colors (strings) or number arrays.
 * The ease on a key controls the segment that *arrives* at that key.
 *
 *   keyframes(f.lt, [[0, 0], [0.6, 1, 'expoOut'], [2.4, 1], [2.8, 0, 'in']])
 */
export function keyframes<V extends KeyValue>(t: number, keys: ReadonlyArray<Keyframe<V>>): V {
  if (keys.length === 0) throw new Error('keyframes: need at least one key')
  if (t <= keys[0]![0]) return keys[0]![1]
  const last = keys[keys.length - 1]!
  if (t >= last[0]) return last[1]
  let i = 1
  while (i < keys.length - 1 && t > keys[i]![0]) i++
  const [t0, v0] = keys[i - 1]!
  const [t1, v1, e] = keys[i]!
  const p = ease(e, (x) => x)(clamp01(invLerp(t0, t1, t)))
  return mixValue(v0, v1, p) as V
}

export function mixValue(a: KeyValue, b: KeyValue, t: number): KeyValue {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t)
  if (typeof a === 'string' && typeof b === 'string') return mixColor(a, b, t)
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v: number, i: number) => lerp(v, (b as number[])[i] ?? v, t))
  throw new Error('keyframes: cannot mix values of different types')
}

/** Start offset for item i of n when staggering by `each` seconds (optionally from the center or end). */
export function stagger(i: number, n: number, each: number, from: 'start' | 'center' | 'end' = 'start'): number {
  if (from === 'start') return i * each
  if (from === 'end') return (n - 1 - i) * each
  return Math.abs(i - (n - 1) / 2) * each
}

/** 0 -> 1 -> 0 over the interval. */
export const pingpong = (t: number) => 1 - Math.abs(((t % 2) + 2) % 2 - 1)
/** Wrap t into [0, period). */
export const loop = (t: number, period: number) => ((t % period) + period) % period
/** Quantize to n steps (stop-motion / ticking counters). */
export const steps = (t: number, n: number) => Math.floor(t * n) / n
/** Shortest-path angle lerp in degrees. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return a + d * t
}
