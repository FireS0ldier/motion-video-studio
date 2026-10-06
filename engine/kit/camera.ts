/**
 * Camera moves that keep shots alive. Pass the result to g.camera(...).
 *
 *   g.camera(kit.drift(f))                       subtle push-in + float (default for most scenes)
 *   g.camera({ ...kit.drift(f), ...kit.punch(f, 'faster') })
 */

import type { Anchor, Frame } from '../core/scene.ts'
import type { Camera } from '../gl/camera.ts'
import { ease, type Ease } from '../motion/easing.ts'
import { clamp01, lerp } from '../motion/tween.ts'

/** Slow push-in plus a gentle handheld float over the whole scene. */
export function drift(f: Frame, o: { zoom?: number; float?: number; rotate?: number } = {}): Partial<Camera> {
  const zoom = o.zoom ?? 0.045
  const float = o.float ?? 8
  return {
    zoom: 1 + zoom * ease('smooth')(f.p),
    x: f.stage.cx + f.wiggle(0.18, float, 1),
    y: f.stage.cy + f.wiggle(0.15, float * 0.7, 2),
    rotate: o.rotate ? f.wiggle(0.1, o.rotate, 3) : 0,
  }
}

/** Short zoom punch (on a beat or a key word). Returns a zoom multiplier to combine. */
export function punch(f: Frame, at: Anchor, strength = 0.06, duration = 0.45): Partial<Camera> {
  const s = f.since(at)
  if (s < 0 || s > duration) return {}
  const p = s / duration
  return { zoom: 1 + strength * Math.sin(Math.PI * Math.min(1, p * 1.2)) * (1 - p) }
}

/** A camera offset in px (added by combine()). */
export interface Offset {
  dx: number
  dy: number
}

/** Shake (impacts). Decays over `duration`. */
export function shake(f: Frame, at: Anchor, amount = 14, duration = 0.5): Offset {
  const s = f.since(at)
  if (s < 0 || s > duration) return { dx: 0, dy: 0 }
  const k = (1 - s / duration) ** 2
  return { dx: f.wiggle(22, amount * k, 11), dy: f.wiggle(19, amount * k, 12) }
}

/** Move the camera between two framings. */
export function move(f: Frame, from: Partial<Camera>, to: Partial<Camera>, at: Anchor, duration: number, e: Ease = 'camera'): Partial<Camera> {
  const p = ease(e)(clamp01(f.since(at) / duration))
  const out: Partial<Camera> = {}
  for (const k of ['x', 'y', 'z', 'zoom', 'rotate'] as const) {
    const a = from[k]
    const b = to[k]
    if (a !== undefined && b !== undefined) out[k] = lerp(a, b, p)
    else if (b !== undefined && p >= 1) out[k] = b
    else if (a !== undefined) out[k] = a
  }
  return out
}

/**
 * Merge camera moves: x/y are framings (their deviation from the stage center
 * adds up), zooms multiply, rotations and z add, Offsets (shake) add.
 */
export function combine(f: Frame, ...parts: Array<Partial<Camera> | Offset>): Partial<Camera> {
  const { cx, cy } = f.stage
  const out: Partial<Camera> = { x: cx, y: cy, zoom: 1, rotate: 0, z: 0 }
  for (const p of parts) {
    if ('dx' in p) {
      out.x! += p.dx
      out.y! += p.dy
      continue
    }
    if (p.x !== undefined) out.x! += p.x - cx
    if (p.y !== undefined) out.y! += p.y - cy
    if (p.zoom !== undefined) out.zoom! *= p.zoom
    if (p.rotate !== undefined) out.rotate! += p.rotate
    if (p.z !== undefined) out.z! += p.z
    if (p.focus !== undefined) out.focus = p.focus
    if (p.aperture !== undefined) out.aperture = p.aperture
    if (p.perspective !== undefined) out.perspective = p.perspective
  }
  return out
}
