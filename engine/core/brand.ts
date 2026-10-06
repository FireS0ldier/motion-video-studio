/**
 * Brand system: every visual decision that should be consistent across a
 * video lives in one Brand object (colors, fonts, type scale, radii, spacing,
 * shadows, motion style, post-processing look, logo).
 *
 * Projects call `defineBrand({...})` with only what differs from the default.
 */

import type { Brand, DeepPartial, FontSpec, Look, MotionStyle } from './types.ts'

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

/** Font helper for @fontsource packages installed in node_modules. */
function fontsource(pkg: string, file: (subset: string) => string, weight: string, style: 'normal' | 'italic' = 'normal') {
  return [
    { url: `/node_modules/${pkg}/files/${file('latin')}`, weight, style, unicodeRange: LATIN },
    { url: `/node_modules/${pkg}/files/${file('latin-ext')}`, weight, style, unicodeRange: LATIN_EXT },
  ]
}

/**
 * Bundled open-source fonts (SIL OFL). Families are prefixed with "MVS" so a
 * font installed on the machine can never replace them: renders are identical
 * everywhere.
 */
export const bundledFonts = {
  inter: {
    family: 'MVS Inter',
    sources: [
      ...fontsource('@fontsource-variable/inter', (s) => `inter-${s}-opsz-normal.woff2`, '100 900'),
      ...fontsource('@fontsource-variable/inter', (s) => `inter-${s}-opsz-italic.woff2`, '100 900', 'italic'),
    ],
    fallback: 'system-ui, sans-serif',
    features: '"cv11", "ss03"',
  },
  /** Inter with tabular figures: counters and numbers that do not jitter while animating. */
  interTabular: {
    family: 'MVS Inter Tabular',
    sources: [...fontsource('@fontsource-variable/inter', (s) => `inter-${s}-opsz-normal.woff2`, '100 900')],
    fallback: 'system-ui, sans-serif',
    features: '"tnum", "cv11"',
  },
  jetbrainsMono: {
    family: 'MVS JetBrains Mono',
    sources: [
      ...fontsource('@fontsource-variable/jetbrains-mono', (s) => `jetbrains-mono-${s}-wght-normal.woff2`, '100 800'),
      ...fontsource('@fontsource-variable/jetbrains-mono', (s) => `jetbrains-mono-${s}-wght-italic.woff2`, '100 800', 'italic'),
    ],
    fallback: 'ui-monospace, monospace',
  },
  instrumentSerif: {
    family: 'MVS Instrument Serif',
    sources: [
      ...fontsource('@fontsource/instrument-serif', (s) => `instrument-serif-${s}-400-normal.woff2`, '400'),
      ...fontsource('@fontsource/instrument-serif', (s) => `instrument-serif-${s}-400-italic.woff2`, '400', 'italic'),
    ],
    fallback: 'Georgia, serif',
  },
} satisfies Record<string, FontSpec>

/** Ready-made motion personalities. Pick one in your brand: `motion: motionPresets.snappy`. */
export const motionPresets = {
  /** Calm, premium, Apple-keynote-like. Long decelerations, little overshoot. */
  smooth: {
    enter: 'expoOut',
    exit: 'quintIn',
    move: 'smooth',
    durations: { fast: 0.32, base: 0.7, slow: 1.1 },
    stagger: 0.06,
    spring: { stiffness: 140, damping: 22, mass: 1 },
    distance: 36,
    text: { preset: 'rise', by: 'word' },
  },
  /** Energetic SaaS / social. Short, punchy, slight overshoot. */
  snappy: {
    enter: 'emphasized',
    exit: 'accelerate',
    move: 'standard',
    durations: { fast: 0.2, base: 0.42, slow: 0.7 },
    stagger: 0.04,
    spring: { stiffness: 300, damping: 22, mass: 1 },
    distance: 48,
    text: { preset: 'mask', by: 'word' },
  },
  /** Playful consumer apps. Springs and pops. */
  bouncy: {
    enter: 'backOutSoft',
    exit: 'quintIn',
    move: 'smooth',
    durations: { fast: 0.25, base: 0.5, slow: 0.85 },
    stagger: 0.05,
    spring: { stiffness: 320, damping: 15, mass: 1 },
    distance: 56,
    text: { preset: 'pop', by: 'word' },
  },
  /** Slow, dramatic, trailer-like. */
  cinematic: {
    enter: 'quintOut',
    exit: 'expoIn',
    move: 'camera',
    durations: { fast: 0.45, base: 0.95, slow: 1.6 },
    stagger: 0.09,
    spring: { stiffness: 90, damping: 20, mass: 1.4 },
    distance: 24,
    text: { preset: 'blur', by: 'word' },
  },
} satisfies Record<string, MotionStyle>

export const defaultLook: Look = {
  bloom: { strength: 0.35, radius: 0.65, threshold: 0.72 },
  vignette: { strength: 0.28, softness: 0.65 },
  grain: { amount: 0.035, size: 1.15 },
  aberration: 0.6,
  grade: { exposure: 0, contrast: 1.03, saturation: 1.02, temperature: 0, tint: 0, lift: 0 },
  motionBlur: { shutter: 0.5, samples: 'auto', maxSamples: 10 },
}

export const defaultBrand: Brand = {
  name: 'Studio',
  colors: {
    bg: '#0a0b10',
    surface: '#13151d',
    surface2: '#1b1e29',
    border: 'rgba(255,255,255,0.09)',
    text: '#f4f5f9',
    muted: '#8b91a3',
    primary: '#6d5efc',
    accent: '#22d3b6',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
  },
  gradients: {
    brand: ['#6d5efc', '#22d3b6'],
    warm: ['#ff7a59', '#ffcc66'],
    night: ['#0a0b10', '#151833'],
  },
  fonts: {
    display: bundledFonts.inter,
    body: bundledFonts.inter,
    mono: bundledFonts.jetbrainsMono,
    serif: bundledFonts.instrumentSerif,
    numeric: bundledFonts.interTabular,
  },
  type: {
    hero: { font: 'display', size: 148, weight: 720, tracking: -0.045, leading: 0.95 },
    h1: { font: 'display', size: 96, weight: 700, tracking: -0.035, leading: 1.0 },
    h2: { font: 'display', size: 64, weight: 650, tracking: -0.025, leading: 1.08 },
    h3: { font: 'display', size: 44, weight: 620, tracking: -0.015, leading: 1.15 },
    body: { font: 'body', size: 34, weight: 450, tracking: -0.005, leading: 1.4 },
    label: { font: 'body', size: 26, weight: 560, tracking: 0, leading: 1.25 },
    caption: { font: 'body', size: 22, weight: 500, tracking: 0.005, leading: 1.3 },
    eyebrow: { font: 'body', size: 22, weight: 640, tracking: 0.16, leading: 1.2, uppercase: true },
    code: { font: 'mono', size: 28, weight: 450, tracking: 0, leading: 1.55 },
    serif: { font: 'serif', size: 110, weight: 400, tracking: -0.02, leading: 1.0, italic: true },
    number: { font: 'numeric', size: 120, weight: 700, tracking: -0.04, leading: 1.0 },
  },
  radius: { sm: 10, md: 18, lg: 28, xl: 44, pill: 999 },
  space: { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, xxl: 112 },
  shadows: {
    sm: [{ x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.28)' }],
    md: [
      { x: 0, y: 10, blur: 28, color: 'rgba(0,0,0,0.38)' },
      { x: 0, y: 2, blur: 6, color: 'rgba(0,0,0,0.22)' },
    ],
    lg: [
      { x: 0, y: 40, blur: 90, color: 'rgba(0,0,0,0.55)' },
      { x: 0, y: 12, blur: 28, color: 'rgba(0,0,0,0.3)' },
    ],
    glow: [{ x: 0, y: 0, blur: 60, color: 'rgba(109,94,252,0.45)' }],
  },
  motion: motionPresets.smooth,
  look: defaultLook,
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep merge (objects merge, arrays and primitives replace). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  if (!isPlainObject(base)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

/** Create a brand from the defaults plus your overrides. */
export function defineBrand(patch: DeepPartial<Brand> & { name: string }): Brand {
  const b = deepMerge(defaultBrand, patch)
  // fonts are replaced wholesale per role (sources must not merge index-wise)
  if (patch.fonts) for (const [role, spec] of Object.entries(patch.fonts)) if (spec) (b.fonts as Record<string, unknown>)[role] = spec
  return b
}
