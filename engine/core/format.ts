import type { Format, Stage } from './types.ts'

/**
 * Output formats. Scenes are authored in the composition's own pixel space
 * (e.g. 1920x1080). 4K is the same composition rendered at scale 2, so a
 * 1080p project exports to 2160p without any scene changes.
 */
export const formats = {
  landscape: { width: 1920, height: 1080, fps: 60 },
  landscape30: { width: 1920, height: 1080, fps: 30 },
  vertical: { width: 1080, height: 1920, fps: 60 },
  vertical30: { width: 1080, height: 1920, fps: 30 },
  square: { width: 1080, height: 1080, fps: 60 },
  portrait45: { width: 1080, height: 1350, fps: 60 },
  uhd: { width: 3840, height: 2160, fps: 60 },
} satisfies Record<string, Format>

export type FormatName = keyof typeof formats

export function resolveFormat(f: Format | FormatName): Format {
  if (typeof f === 'string') {
    const hit = formats[f]
    if (!hit) throw new Error(`Unknown format "${f}". Known: ${Object.keys(formats).join(', ')}`)
    return { ...hit }
  }
  if (!(f.width > 0 && f.height > 0 && f.fps > 0)) throw new Error(`Invalid format ${JSON.stringify(f)}`)
  if (f.width % 2 || f.height % 2) throw new Error(`Format ${f.width}x${f.height}: width and height must be even (yuv420p)`)
  return { ...f }
}

export function makeStage(f: Format): Stage {
  const w = f.width
  const h = f.height
  const aspect = w / h
  const portrait = aspect < 0.95
  const square = aspect >= 0.95 && aspect <= 1.05
  const sx = w * 0.05
  const sy = h * 0.05
  const tx = w * (portrait ? 0.12 : 0.1)
  const ty = h * 0.1
  return {
    w,
    h,
    cx: w / 2,
    cy: h / 2,
    fps: f.fps,
    aspect,
    portrait,
    landscape: aspect > 1.05,
    square,
    unit: Math.min(w, h) / 1080,
    safe: { x: sx, y: sy, w: w - 2 * sx, h: h - 2 * sy },
    title: { x: tx, y: ty, w: w - 2 * tx, h: h - 2 * ty },
  }
}
