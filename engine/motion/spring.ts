/**
 * Closed-form damped spring. Because it is analytic (not simulated step by
 * step) it is a pure function of time: any frame can be rendered in any order.
 */

export interface SpringConfig {
  /** Stiffness k. Higher = faster. */
  stiffness?: number
  /** Damping c. Lower = more bounce. */
  damping?: number
  mass?: number
  /** Initial velocity in "progress units" per second. */
  velocity?: number
}

export const springs = {
  /** Calm, no overshoot. Large panels, camera settles. */
  gentle: { stiffness: 120, damping: 22, mass: 1 },
  /** Default UI spring: quick with a hint of overshoot. */
  snappy: { stiffness: 260, damping: 24, mass: 1 },
  /** Playful pop for icons, badges, counters. */
  bouncy: { stiffness: 320, damping: 14, mass: 1 },
  /** Heavy, slow, cinematic. */
  heavy: { stiffness: 90, damping: 20, mass: 1.6 },
} satisfies Record<string, SpringConfig>

export type SpringName = keyof typeof springs

/**
 * Spring progress from 0 to 1 after `t` seconds (t <= 0 returns 0).
 * The result may overshoot above 1 when the spring is under-damped.
 */
export function spring(t: number, config: SpringConfig | SpringName = 'snappy'): number {
  if (t <= 0) return 0
  const c: SpringConfig = typeof config === 'string' ? springs[config] : config
  const k = c.stiffness ?? 260
  const d = c.damping ?? 24
  const m = c.mass ?? 1
  const v0 = c.velocity ?? 0
  const w0 = Math.sqrt(k / m)
  const zeta = d / (2 * Math.sqrt(k * m))
  const x0 = -1
  let x: number
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t))
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t)
  } else {
    const s = Math.sqrt(zeta * zeta - 1)
    const r1 = -w0 * (zeta - s)
    const r2 = -w0 * (zeta + s)
    const c2 = (v0 - r1 * x0) / (r2 - r1)
    const c1 = x0 - c2
    x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t)
  }
  return 1 + x
}

/** Time (s) after which the spring stays within `epsilon` of its target. */
export function springSettle(config: SpringConfig | SpringName = 'snappy', epsilon = 0.002): number {
  let last = 0
  for (let t = 0; t < 10; t += 1 / 240) {
    if (Math.abs(spring(t, config) - 1) > epsilon) last = t
  }
  return last
}
