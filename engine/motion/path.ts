import { ease, type Ease } from './easing.ts'
import { clamp01 } from './tween.ts'

export type Vec2 = readonly [number, number]

/** Point on a cubic bezier. */
export function cubicPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): [number, number] {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}

/**
 * Natural, slightly arced movement between two points (like a hand moving a
 * mouse). `bend` is the perpendicular arc amount relative to the distance.
 */
export function arc(from: Vec2, to: Vec2, t: number, bend = 0.18, e: Ease = 'inOut'): [number, number] {
  const p = ease(e)(clamp01(t))
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const nx = -dy * bend
  const ny = dx * bend
  const c1: Vec2 = [from[0] + dx * 0.3 + nx, from[1] + dy * 0.3 + ny]
  const c2: Vec2 = [from[0] + dx * 0.75 + nx * 0.6, from[1] + dy * 0.75 + ny * 0.6]
  return cubicPoint(from, c1, c2, to, p)
}

export interface Waypoint {
  /** Time (same base as `t`) at which the path arrives at `at`. */
  t: number
  at: Vec2
  ease?: Ease
  bend?: number
}

/** Follow a list of timed waypoints with arced segments. Holds at the ends. */
export function followPath(t: number, points: readonly Waypoint[]): [number, number] {
  if (points.length === 0) return [0, 0]
  if (t <= points[0]!.t) return [points[0]!.at[0], points[0]!.at[1]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (t <= b.t) {
      const local = (t - a.t) / Math.max(1e-6, b.t - a.t)
      return arc(a.at, b.at, local, b.bend ?? 0.12, b.ease ?? 'inOut')
    }
  }
  const last = points[points.length - 1]!
  return [last.at[0], last.at[1]]
}
