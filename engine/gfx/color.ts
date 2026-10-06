/**
 * Color helpers (pure, no DOM). Interpolation happens in OKLab, which keeps
 * gradients and color tweens perceptually even (no muddy grey midpoints).
 */

export type RGBA = [r: number, g: number, b: number, a: number]

const cache = new Map<string, RGBA>()

const NAMED: Record<string, string> = {
  transparent: '#0000',
  black: '#000',
  white: '#fff',
  red: '#f00',
  green: '#008000',
  blue: '#00f',
}

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(). Channels 0..255, alpha 0..1. */
export function parseColor(input: string): RGBA {
  const hit = cache.get(input)
  if (hit) return hit
  const s = (NAMED[input.trim().toLowerCase()] ?? input).trim()
  let out: RGBA | null = null
  if (s.startsWith('#')) {
    const h = s.slice(1)
    const n = h.length
    if (n === 3 || n === 4) {
      out = [
        parseInt(h[0]! + h[0]!, 16),
        parseInt(h[1]! + h[1]!, 16),
        parseInt(h[2]! + h[2]!, 16),
        n === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1,
      ]
    } else if (n === 6 || n === 8) {
      out = [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        n === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      ]
    }
  } else {
    const m = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(s)
    if (m) {
      const parts = m[2]!.split(/[\s,/]+/).filter(Boolean)
      const num = (v: string, scale: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v))
      if (m[1]!.toLowerCase().startsWith('rgb')) {
        out = [num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255), parts[3] ? num(parts[3], 1) : 1]
      } else {
        const hh = parseFloat(parts[0]!)
        const ss = num(parts[1]!, 1)
        const ll = num(parts[2]!, 1)
        const [r, g, b] = hslToRgb(hh, ss, ll)
        out = [r, g, b, parts[3] ? num(parts[3], 1) : 1]
      }
    }
  }
  if (!out || out.some((v) => Number.isNaN(v))) throw new Error(`Cannot parse color "${input}"`)
  cache.set(input, out)
  return out
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

export function toCss([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return a >= 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${Math.max(0, a).toFixed(4)})`
}

/** Same color with alpha multiplied by `alpha`. */
export function alpha(color: string, alphaValue: number): string {
  const c = parseColor(color)
  return toCss([c[0], c[1], c[2], c[3] * alphaValue])
}

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return c * 255
}

function rgbToOklab([r, g, b]: RGBA): [number, number, number] {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** Perceptual mix of two colors, t in 0..1. */
export function mixColor(a: string, b: string, t: number): string {
  if (t <= 0) return a
  if (t >= 1) return b
  const ca = parseColor(a)
  const cb = parseColor(b)
  const la = rgbToOklab(ca)
  const lb = rgbToOklab(cb)
  const [r, g, bl] = oklabToRgb(la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t)
  return toCss([r, g, bl, ca[3] + (cb[3] - ca[3]) * t])
}

/** Lighten (amount > 0) or darken (amount < 0) in OKLab lightness, amount in -1..1. */
export function shade(color: string, amount: number): string {
  const c = parseColor(color)
  const [L, A, B] = rgbToOklab(c)
  const [r, g, b] = oklabToRgb(Math.max(0, Math.min(1, L + amount)), A, B)
  return toCss([r, g, b, c[3]])
}

/** Relative luminance 0..1 (WCAG). */
export function luminance(color: string): number {
  const [r, g, b] = parseColor(color)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function isColorString(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    parseColor(v)
    return true
  } catch {
    return false
  }
}
