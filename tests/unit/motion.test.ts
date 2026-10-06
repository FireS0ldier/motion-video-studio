import { describe, expect, it } from 'vitest'
import { cubicBezier, ease, eases } from '../../engine/motion/easing.ts'
import { fbm1, hash32, noise1, noise2, rng, wiggle } from '../../engine/motion/noise.ts'
import { spring, springSettle } from '../../engine/motion/spring.ts'
import { interpolate, keyframes, lerpAngle, progress, remap, stagger } from '../../engine/motion/tween.ts'
import { arc, followPath } from '../../engine/motion/path.ts'
import { contrast, mixColor, parseColor, shade } from '../../engine/gfx/color.ts'

describe('easing', () => {
  it('every named ease maps 0→0 and 1→1', () => {
    for (const [name, fn] of Object.entries(eases)) {
      expect(fn(0), name).toBeCloseTo(0, 5)
      expect(fn(1), name).toBeCloseTo(1, 5)
    }
  })
  it('cubicBezier matches the CSS "ease" curve', () => {
    const cssEase = cubicBezier(0.25, 0.1, 0.25, 1)
    expect(cssEase(0.5)).toBeCloseTo(0.8024, 3)
    expect(cssEase(0.25)).toBeCloseTo(0.4085, 3)
  })
  it('resolves names, functions and tuples', () => {
    expect(ease('linear')(0.3)).toBe(0.3)
    expect(ease((t) => t * t)(0.5)).toBe(0.25)
    expect(ease([0, 0, 1, 1])(0.4)).toBeCloseTo(0.4, 4)
    expect(() => ease('nope' as never)).toThrow(/Unknown ease/)
  })
})

describe('spring', () => {
  it('starts at 0, settles at 1 and is pure', () => {
    expect(spring(0)).toBe(0)
    expect(spring(-1)).toBe(0)
    expect(spring(5, 'snappy')).toBeCloseTo(1, 4)
    expect(spring(0.123, 'bouncy')).toBe(spring(0.123, 'bouncy'))
  })
  it('bouncy overshoots, gentle does not', () => {
    const peak = (cfg: 'bouncy' | 'gentle') => Math.max(...Array.from({ length: 300 }, (_, i) => spring(i / 100, cfg)))
    expect(peak('bouncy')).toBeGreaterThan(1.05)
    expect(peak('gentle')).toBeLessThan(1.02)
  })
  it('handles critically and over-damped springs', () => {
    expect(spring(3, { stiffness: 100, damping: 20 })).toBeCloseTo(1, 3)
    expect(spring(6, { stiffness: 100, damping: 60 })).toBeCloseTo(1, 2)
    expect(springSettle('snappy')).toBeGreaterThan(0.2)
  })
})

describe('determinism helpers', () => {
  it('rng is seeded and repeatable', () => {
    const a = rng('seed')
    const b = rng('seed')
    const xs = Array.from({ length: 5 }, () => a())
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs)
    expect(rng('other')()).not.toBe(xs[0])
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0)
  })
  it('hash32 is stable across runs', () => {
    expect(hash32('orbit', 1)).toBe(hash32('orbit', 1))
    expect(hash32('orbit', 1)).not.toBe(hash32('orbit', 2))
  })
  it('noise stays in range and is smooth', () => {
    for (let x = 0; x < 20; x += 0.37) {
      expect(Math.abs(noise1(x, 3))).toBeLessThanOrEqual(1)
      expect(Math.abs(noise2(x, x * 0.5, 3))).toBeLessThanOrEqual(1.5)
      expect(Math.abs(noise1(x + 0.001, 3) - noise1(x, 3))).toBeLessThan(0.02)
    }
    expect(Math.abs(fbm1(1.5))).toBeLessThanOrEqual(1)
    expect(Math.abs(wiggle(2, 1, 10))).toBeLessThanOrEqual(10)
  })
})

describe('tween', () => {
  it('progress, remap, interpolate', () => {
    expect(progress(1, 0, 2)).toBeCloseTo(eases.out(0.5))
    expect(progress(-1, 0, 2)).toBe(0)
    expect(remap(5, 0, 10, 100, 200)).toBe(150)
    expect(interpolate(0.5, [0, 1, 2], [0, 10, 0])).toBe(5)
    expect(interpolate(3, [0, 1], [0, 10])).toBe(10)
    expect(interpolate(3, [0, 1], [0, 10], { clamp: false })).toBe(30)
  })
  it('keyframes interpolate numbers, arrays and colors', () => {
    const k = keyframes(1, [
      [0, 0],
      [2, 10],
    ])
    expect(k).toBe(5)
    expect(keyframes(1, [[0, [0, 0]], [2, [10, 20]]] as const)).toEqual([5, 10])
    expect(keyframes(0, [[0, '#000000'], [1, '#ffffff']] as const)).toBe('#000000')
  })
  it('stagger and angles', () => {
    expect(stagger(2, 5, 0.1)).toBeCloseTo(0.2)
    expect(stagger(0, 5, 0.1, 'end')).toBeCloseTo(0.4)
    expect(stagger(2, 5, 0.1, 'center')).toBe(0)
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360)
  })
  it('paths arrive at their waypoints', () => {
    expect(arc([0, 0], [100, 0], 1)).toEqual([100, 0])
    const p = followPath(5, [
      { t: 0, at: [0, 0] },
      { t: 1, at: [10, 10] },
    ])
    expect(p).toEqual([10, 10])
  })
})

describe('color', () => {
  it('parses css colors', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 0.5])
    expect(parseColor('hsl(0, 100%, 50%)').slice(0, 3).map(Math.round)).toEqual([255, 0, 0])
    expect(() => parseColor('nope')).toThrow()
  })
  it('mixes perceptually and shades', () => {
    const mid = parseColor(mixColor('#000000', '#ffffff', 0.5))
    expect(mid[0]).toBeGreaterThan(90)
    expect(mid[0]).toBeLessThan(140)
    expect(parseColor(shade('#808080', 0.2))[0]).toBeGreaterThan(128)
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 0)
  })
})
