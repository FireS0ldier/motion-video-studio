/**
 * Graphics `g`: the immediate-mode drawing API scenes use.
 *
 * Conventions (consistent everywhere):
 *  - units are composition pixels (1920x1080 for a landscape project), at any render scale
 *  - boxes (rect, image, video, layer) are positioned by their CENTER unless `anchor` says otherwise
 *  - text is centered on (x, y) unless `align` / `valign` say otherwise
 *  - colors can be brand color names ('primary', 'text', 'muted', ...), CSS colors,
 *    'gradient:<name>' (a brand gradient across the shape) or gradient objects
 *  - angles are in degrees
 *
 * Plain 2D drawing goes onto full-frame canvases; `g.layer()` creates a
 * separate texture that the GPU compositor can place in 3D, blur, cache and
 * blend. Draw order is preserved.
 */

import type { Frame, Quality } from '../core/scene.ts'
import type { Brand, DeepPartial, Look, Rect, ShadowSpec, Stage } from '../core/types.ts'
import type { AssetStore } from '../assets/store.ts'
import { defaultCamera, defocus, depthScale, planeTransform, type Camera } from '../gl/camera.ts'
import type { DisplayItem } from '../gl/compositor.ts'
import { multiply, rotationX, rotationY, rotationZ, scaling, translation } from '../gl/mat4.ts'
import { clamp01 } from '../motion/tween.ts'
import type { CanvasPool, Ctx2D } from './canvas-pool.ts'
import { alpha as withAlpha } from './color.ts'
import { iconPaths } from './icons.ts'
import { drawText, layoutText, resolveTextStyle, type DrawTextOptions, type TextAnimation, type TextMark, type TextResult, type TextStyleOptions } from './text.ts'

// ------------------------------------------------------------------ types

export type GradientStops = string[] | Array<[number, string]>
export type Gradient =
  | { type: 'linear'; from: [number, number]; to: [number, number]; stops: GradientStops }
  | { type: 'radial'; at: [number, number]; r: number; r0?: number; stops: GradientStops }
  | { type: 'conic'; at: [number, number]; angle?: number; stops: GradientStops }
export type Paint = string | Gradient

export type Blend = 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'soft-light' | 'color-dodge' | 'lighten' | 'darken' | 'destination-in' | 'destination-out'

export type ShadowInput = ShadowSpec | ShadowSpec[] | 'sm' | 'md' | 'lg' | 'glow' | (string & {})

export type AnchorPoint = [number, number] | 'center' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'

export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** Which point of the box (x, y) refers to. Default 'center'. */
  anchor?: AnchorPoint
}

export interface ShapeStyle {
  fill?: Paint
  stroke?: Paint
  lineWidth?: number
  dash?: number[]
  lineCap?: CanvasLineCap
  lineJoin?: CanvasLineJoin
  shadow?: ShadowInput
  opacity?: number
  /** Gaussian blur of this primitive (px). */
  blur?: number
  blend?: Blend
}

export type RadiusInput = number | number[] | 'sm' | 'md' | 'lg' | 'xl' | 'pill'

export type ClipShape =
  | { rect: [x: number, y: number, w: number, h: number]; radius?: RadiusInput }
  | { circle: [cx: number, cy: number, r: number] }
  | Path2D
  | ((path: Path2D) => void)

export interface GroupOptions {
  x?: number
  y?: number
  scale?: number | [number, number]
  /** Degrees, clockwise. */
  rotate?: number
  skewX?: number
  /** Pivot for scale/rotate in local coordinates (default [0, 0] = the group's x/y). */
  origin?: [number, number]
  opacity?: number
  blend?: Blend
  clip?: ClipShape
  /** Blur applied to every primitive inside (use a layer to blur a group as a whole). */
  blur?: number
}

export interface TextOptions extends TextStyleOptions {
  x: number
  y: number
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom' | 'baseline'
  /** Wrap width (px). Lines are balanced by default. */
  maxWidth?: number
  balance?: boolean
  color?: Paint
  /** Paint for **marked** words. Default: brand primary. */
  accent?: Paint
  opacity?: number
  shadow?: ShadowInput
  stroke?: { color: string; width: number }
  anim?: TextAnimation | false
  marks?: TextMark[]
  caret?: boolean
}

export interface ImageOptions extends Partial<Box> {
  x: number
  y: number
  fit?: 'cover' | 'contain' | 'fill'
  /** Focus point for 'cover' cropping (0..1). */
  focus?: [number, number]
  radius?: RadiusInput
  opacity?: number
  shadow?: ShadowInput
  border?: { color: Paint; width: number }
  blur?: number
}

export interface VideoOptions extends ImageOptions {
  /** When playback starts (default: scene start). */
  start?: Parameters<Frame['at']>[0]
  /** Playback rate (default 1). */
  rate?: number
  /** Seconds into the clip at `start`. */
  from?: number
  loop?: boolean
}

export interface IconOptions {
  x: number
  y: number
  size?: number
  color?: Paint
  /** Stroke width in the icon's 24px grid (default 2). */
  stroke?: number
  fill?: Paint
  opacity?: number
  /** Draw-on progress 0..1. */
  progress?: number
}

export interface LayerOptions {
  /** Layer canvas size in px (default: full stage). */
  w?: number
  h?: number
  /** Position of the anchor point (default: stage center). */
  x?: number
  y?: number
  /** Depth (positive = farther away). */
  z?: number
  /** Anchor inside the layer, 0..1 (default center). */
  anchor?: [number, number]
  rotateX?: number
  rotateY?: number
  rotateZ?: number
  scale?: number | [number, number]
  opacity?: number
  /** Gaussian blur (px), added to camera depth-of-field. */
  blur?: number
  blend?: 'normal' | 'add' | 'screen' | 'multiply'
  /** Texture resolution multiplier (use >1 when zooming into a layer). */
  res?: number
  /** Static content: draw once, reuse the texture while the key stays the same. */
  cache?: string | false
  /** Transparent margin (px) so shadows/glows are not clipped. */
  pad?: number
  /** Ignore the camera (HUD / overlays). */
  screen?: boolean
  /** Fake lighting from the top-left on rotated layers, 0..1. */
  light?: number
}

export interface GraphicsHost {
  stage: Stage
  brand: Brand
  /** Physical px per composition px. */
  scale: number
  quality: Quality
  assets: AssetStore
  pool: CanvasPool
  hasCached(key: string, w: number, h: number): boolean
  display: DisplayItem[]
  warn(message: string): void
  /** Text bounding boxes reported for `mvs check` (safe-area checks). */
  report?(kind: 'text', box: Rect, label: string): void
}

interface ClipEntry {
  path: Path2D
  m: DOMMatrix
}

interface GState {
  m: DOMMatrix
  alpha: number
  blend: GlobalCompositeOperation
  blur: number
  clips: ClipEntry[]
  z: number
  screen: boolean
}

interface FlatTarget {
  ctx: Ctx2D
  canvas: OffscreenCanvas
  clipDepth: number
}

const BLEND_MAP: Record<Blend, GlobalCompositeOperation> = {
  normal: 'source-over',
  add: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  'color-dodge': 'color-dodge',
  lighten: 'lighten',
  darken: 'darken',
  'destination-in': 'destination-in',
  'destination-out': 'destination-out',
}

const ANCHORS: Record<Exclude<AnchorPoint, [number, number]>, [number, number]> = {
  center: [0.5, 0.5],
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
}

const MAX_TEXTURE = 8192
const pathLengths = new Map<string, number>()

export function anchorOf(a: AnchorPoint | undefined): [number, number] {
  if (!a) return [0.5, 0.5]
  return typeof a === 'string' ? ANCHORS[a] : a
}

/** Top-left rect of a box with an anchor. */
export function boxRect(b: Box): Rect {
  const [ax, ay] = anchorOf(b.anchor)
  return { x: b.x - ax * b.w, y: b.y - ay * b.h, w: b.w, h: b.h }
}

function matScale(m: DOMMatrix): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
}

export class Graphics {
  private state: GState
  private readonly stack: GState[] = []
  private flat: FlatTarget | null = null
  private cam: Camera
  private look: DeepPartial<Look> | null = null
  private readonly device: number
  private readonly layerTarget: FlatTarget | null
  private readonly layerPad: number

  constructor(
    private readonly host: GraphicsHost,
    readonly f: Frame,
    layer?: { target: FlatTarget; device: number; pad: number },
  ) {
    this.state = { m: new DOMMatrix(), alpha: 1, blend: 'source-over', blur: 0, clips: [], z: 0, screen: false }
    this.cam = defaultCamera(host.stage)
    this.device = layer ? layer.device : host.scale
    this.layerTarget = layer?.target ?? null
    this.layerPad = layer?.pad ?? 0
  }

  get stage(): Stage {
    return this.host.stage
  }
  get brand(): Brand {
    return this.host.brand
  }
  get assets(): AssetStore {
    return this.host.assets
  }
  /** True when drawing inside g.layer(). */
  get inLayer(): boolean {
    return !!this.layerTarget
  }

  // ---------------------------------------------------------------- targets & state

  private base(): DOMMatrix {
    const d = new DOMMatrix().scaleSelf(this.device, this.device)
    if (this.layerTarget) return d.translateSelf(this.layerPad, this.layerPad)
    if (this.state.screen) return d
    return d.multiplySelf(planeTransform(this.cam, this.host.stage, this.state.z))
  }

  private target(): FlatTarget {
    if (this.layerTarget) return this.layerTarget
    if (!this.flat) {
      const pc = this.host.pool.acquire(this.host.stage.w * this.host.scale, this.host.stage.h * this.host.scale)
      this.flat = { ...pc, clipDepth: 0 }
      for (const c of this.state.clips) this.applyClip(this.flat, c)
    }
    return this.flat
  }

  private applyClip(t: FlatTarget, c: ClipEntry) {
    t.ctx.save()
    t.ctx.setTransform(c.m)
    t.ctx.clip(c.path)
    t.clipDepth++
  }

  private seal() {
    if (this.flat) {
      this.host.display.push({ kind: 'flat', canvas: this.flat.canvas })
      this.flat = null
    }
  }

  /** Called by the renderer after render(): flushes the last canvas. */
  finish(): DeepPartial<Look> | null {
    this.seal()
    return this.look
  }

  private full(): DOMMatrix {
    return this.base().multiplySelf(this.state.m)
  }

  /** Prepare the canvas context for a primitive and return it. */
  private prep(opacity = 1, blend?: Blend, blur = 0): Ctx2D {
    const t = this.target()
    const ctx = t.ctx
    const m = this.full()
    ctx.setTransform(m)
    ctx.globalAlpha = clamp01(this.state.alpha * opacity)
    ctx.globalCompositeOperation = blend ? BLEND_MAP[blend] : this.state.blend
    const b = (this.state.blur + blur) * matScale(m)
    ctx.filter = b > 0.3 ? `blur(${b.toFixed(2)}px)` : 'none'
    ctx.shadowColor = 'transparent'
    ctx.setLineDash([])
    return ctx
  }

  /**
   * Raw Canvas 2D context, already transformed into the current group space.
   * Escape hatch for anything the helpers do not cover.
   */
  get ctx(): Ctx2D {
    return this.prep()
  }

  /** Current transform scale (device px per local px). */
  get pixelScale(): number {
    return matScale(this.full())
  }

  save() {
    this.stack.push({ ...this.state, clips: [...this.state.clips] })
  }

  restore() {
    const prev = this.stack.pop()
    if (!prev) return
    const t = this.layerTarget ?? this.flat
    if (t) {
      while (t.clipDepth > prev.clips.length) {
        t.ctx.restore()
        t.clipDepth--
      }
    }
    this.state = prev
  }

  /** Transform / opacity / clip group. Everything drawn inside inherits it. */
  group(o: GroupOptions, draw: () => void) {
    this.save()
    try {
      const s = this.state
      const m = DOMMatrix.fromMatrix(s.m)
      const [ox, oy] = o.origin ?? [0, 0]
      m.translateSelf(o.x ?? 0, o.y ?? 0)
      m.translateSelf(ox, oy)
      if (o.rotate) m.rotateSelf(0, 0, o.rotate)
      if (o.skewX) m.skewXSelf(o.skewX)
      if (o.scale !== undefined) {
        const [sx, sy] = typeof o.scale === 'number' ? [o.scale, o.scale] : o.scale
        m.scaleSelf(sx, sy)
      }
      m.translateSelf(-ox, -oy)
      s.m = m
      if (o.opacity !== undefined) s.alpha *= o.opacity
      if (o.blend) s.blend = BLEND_MAP[o.blend]
      if (o.blur) s.blur += o.blur
      if (o.clip) {
        const entry: ClipEntry = { path: this.clipPath(o.clip), m: this.full() }
        s.clips = [...s.clips, entry]
        const t = this.layerTarget ?? this.flat
        if (t) this.applyClip(t, entry)
      }
      if (s.alpha > 0.0005) draw()
    } finally {
      this.restore()
    }
  }

  /** Alias of group(). */
  with(o: GroupOptions, draw: () => void) {
    this.group(o, draw)
  }

  private clipPath(c: ClipShape): Path2D {
    if (c instanceof Path2D) return c
    if (typeof c === 'function') {
      const p = new Path2D()
      c(p)
      return p
    }
    const p = new Path2D()
    if ('rect' in c) p.roundRect(c.rect[0], c.rect[1], c.rect[2], c.rect[3], this.radius(c.radius ?? 0, Math.min(c.rect[2], c.rect[3])))
    else p.arc(c.circle[0], c.circle[1], Math.max(0, c.circle[2]), 0, Math.PI * 2)
    return p
  }

  // ---------------------------------------------------------------- camera / depth / post

  /**
   * Set the scene camera for this frame (call it before drawing). Values not
   * given keep their defaults (centered, zoom 1).
   */
  camera(c: Partial<Camera>): Camera {
    if (this.layerTarget) return this.cam
    this.seal()
    this.cam = { ...defaultCamera(this.host.stage), ...c }
    return this.cam
  }

  get currentCamera(): Camera {
    return this.cam
  }

  /** Draw on a parallax plane at depth z (positive = farther, moves less with the camera). */
  plane(z: number, draw: () => void) {
    this.save()
    this.state.z = z
    try {
      draw()
    } finally {
      this.restore()
    }
  }

  /** Draw in screen space, unaffected by the camera (HUD, captions, logo bugs). */
  screen(draw: () => void) {
    this.save()
    this.state.screen = true
    this.state.m = new DOMMatrix()
    try {
      draw()
    } finally {
      this.restore()
    }
  }

  /** Per-frame post-processing overrides (e.g. a flash: g.fx({ grade: { exposure: 0.6 } })). */
  fx(look: DeepPartial<Look>) {
    this.look = { ...(this.look ?? {}), ...look }
  }

  // ---------------------------------------------------------------- paint helpers

  /** Resolve brand color names. */
  color(name: string): string {
    if (name.startsWith('gradient:')) return this.brand.gradients[name.slice(9)]?.[0] ?? this.brand.colors.primary
    return this.brand.colors[name] ?? name
  }

  /** Brand gradient (or explicit stops) as a linear gradient between two points. */
  gradient(nameOrStops: string | GradientStops, from: [number, number], to: [number, number]): Gradient {
    const stops = typeof nameOrStops === 'string' ? (this.brand.gradients[nameOrStops] ?? [this.brand.colors.primary, this.brand.colors.accent]) : nameOrStops
    return { type: 'linear', from, to, stops }
  }

  private stops(g: CanvasGradient, stops: GradientStops) {
    if (stops.length === 0) return
    if (typeof stops[0] === 'string') {
      const list = stops as string[]
      list.forEach((c, i) => g.addColorStop(list.length === 1 ? 0 : i / (list.length - 1), this.color(c)))
    } else for (const [o, c] of stops as Array<[number, string]>) g.addColorStop(clamp01(o), this.color(c))
  }

  /** Resolve a Paint into something canvas can fill with. `box` positions 'gradient:<name>' paints. */
  paint(ctx: Ctx2D, p: Paint, box?: Rect): string | CanvasGradient {
    if (typeof p === 'string') {
      if (p.startsWith('gradient:')) {
        const b = box ?? { x: 0, y: 0, w: this.stage.w, h: this.stage.h }
        return this.paint(ctx, this.gradient(p.slice(9), [b.x, b.y], [b.x + b.w, b.y + b.h * 0.35]), b)
      }
      return this.color(p)
    }
    let g: CanvasGradient
    if (p.type === 'linear') g = ctx.createLinearGradient(p.from[0], p.from[1], p.to[0], p.to[1])
    else if (p.type === 'radial') g = ctx.createRadialGradient(p.at[0], p.at[1], p.r0 ?? 0, p.at[0], p.at[1], Math.max(0.01, p.r))
    else g = ctx.createConicGradient(((p.angle ?? 0) * Math.PI) / 180, p.at[0], p.at[1])
    this.stops(g, p.stops)
    return g
  }

  private shadows(s: ShadowInput | undefined): ShadowSpec[] {
    if (!s) return []
    if (typeof s === 'string') return this.brand.shadows[s] ?? []
    return Array.isArray(s) ? s : [s]
  }

  radius(r: RadiusInput | undefined, size = Infinity): number | number[] {
    if (r === undefined) return 0
    if (typeof r === 'string') return r === 'pill' ? size / 2 : this.brand.radius[r]
    if (Array.isArray(r)) return r.map((v) => Math.min(v, size / 2))
    return Math.min(r, size / 2)
  }

  /** Draw only the shadows of a shape (the shape itself is moved off-canvas). */
  private drawShadows(ctx: Ctx2D, specs: ShadowSpec[], shape: (c: Ctx2D) => void, fill: string | CanvasGradient = '#000') {
    if (!specs.length) return
    const m = ctx.getTransform()
    const k = matScale(m)
    const OFF = 100000
    ctx.save()
    ctx.setTransform(new DOMMatrix([1, 0, 0, 1, -OFF, 0]).multiplySelf(m))
    for (const s of specs) {
      ctx.shadowColor = this.color(s.color)
      ctx.shadowBlur = s.blur * k
      ctx.shadowOffsetX = OFF + s.x * k
      ctx.shadowOffsetY = s.y * k
      ctx.fillStyle = fill
      shape(ctx)
    }
    ctx.restore()
  }

  // ---------------------------------------------------------------- primitives

  /** Fill the whole frame (screen space, ignores camera and groups). */
  fill(p: Paint = 'bg') {
    const t = this.target()
    const ctx = t.ctx
    ctx.save()
    const w = this.layerTarget ? t.canvas.width / this.device : this.stage.w
    const h = this.layerTarget ? t.canvas.height / this.device : this.stage.h
    ctx.setTransform(this.device, 0, 0, this.device, 0, 0)
    ctx.globalAlpha = this.state.alpha
    ctx.globalCompositeOperation = this.state.blend
    ctx.filter = 'none'
    ctx.fillStyle = this.paint(ctx, p, { x: 0, y: 0, w, h })
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  /** Clear everything drawn so far on the current canvas. */
  clear() {
    const t = this.target()
    t.ctx.save()
    t.ctx.setTransform(1, 0, 0, 1, 0, 0)
    t.ctx.clearRect(0, 0, t.canvas.width, t.canvas.height)
    t.ctx.restore()
  }

  private shape(o: ShapeStyle, box: Rect, build: (c: Ctx2D) => void) {
    const ctx = this.prep(o.opacity ?? 1, o.blend, o.blur ?? 0)
    const fill = o.fill !== undefined ? this.paint(ctx, o.fill, box) : null
    const shadows = this.shadows(o.shadow)
    if (shadows.length) {
      const fs = fill && typeof fill === 'string' ? fill : '#000'
      this.drawShadows(
        ctx,
        shadows,
        (c) => {
          c.beginPath()
          build(c)
          c.fill()
        },
        fs,
      )
    }
    ctx.beginPath()
    build(ctx)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (o.stroke !== undefined) {
      ctx.strokeStyle = this.paint(ctx, o.stroke, box)
      ctx.lineWidth = o.lineWidth ?? 2
      ctx.lineCap = o.lineCap ?? 'round'
      ctx.lineJoin = o.lineJoin ?? 'round'
      if (o.dash) ctx.setLineDash(o.dash)
      ctx.stroke()
    }
  }

  /** Rectangle positioned by its center (or `anchor`). */
  rect(o: Box & ShapeStyle & { radius?: RadiusInput }): Rect {
    const r = boxRect(o)
    const rad = this.radius(o.radius, Math.min(r.w, r.h))
    this.shape(o, r, (c) => (rad ? c.roundRect(r.x, r.y, r.w, r.h, rad) : c.rect(r.x, r.y, r.w, r.h)))
    return r
  }

  circle(o: { x: number; y: number; r: number } & ShapeStyle): Rect {
    const box = { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 }
    if (o.r <= 0) return box
    this.shape(o, box, (c) => c.arc(o.x, o.y, o.r, 0, Math.PI * 2))
    return box
  }

  ellipse(o: { x: number; y: number; rx: number; ry: number; rotate?: number } & ShapeStyle): Rect {
    const box = { x: o.x - o.rx, y: o.y - o.ry, w: o.rx * 2, h: o.ry * 2 }
    this.shape(o, box, (c) => c.ellipse(o.x, o.y, Math.max(0, o.rx), Math.max(0, o.ry), ((o.rotate ?? 0) * Math.PI) / 180, 0, Math.PI * 2))
    return box
  }

  /** Arc (degrees, 0 = 12 o'clock, clockwise). `progress` animates the sweep. */
  arc(o: { x: number; y: number; r: number; start?: number; end?: number; progress?: number } & ShapeStyle) {
    const a0 = (((o.start ?? 0) - 90) * Math.PI) / 180
    const a1 = (((o.end ?? 360) - 90) * Math.PI) / 180
    const p = o.progress ?? 1
    if (p <= 0) return
    this.shape({ ...o, fill: o.fill }, { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 }, (c) => c.arc(o.x, o.y, o.r, a0, a0 + (a1 - a0) * p))
  }

  /** Straight line with optional draw-on `progress`. */
  line(o: { from: [number, number]; to: [number, number]; progress?: number } & ShapeStyle) {
    const p = o.progress ?? 1
    if (p <= 0) return
    const [x0, y0] = o.from
    const x1 = x0 + (o.to[0] - x0) * p
    const y1 = y0 + (o.to[1] - y0) * p
    this.shape({ stroke: 'text', ...o, fill: undefined }, { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }, (c) => {
      c.moveTo(x0, y0)
      c.lineTo(x1, y1)
    })
  }

  /** Polyline / polygon through points, with optional draw-on `progress`. */
  poly(points: Array<[number, number]>, o: ShapeStyle & { closed?: boolean; progress?: number; smooth?: boolean } = {}) {
    if (points.length < 2) return
    const p = o.progress ?? 1
    let total = 0
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
    const xs = points.map((q) => q[0])
    const ys = points.map((q) => q[1])
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    this.shape({ ...o, dash: p < 1 ? [total * p, total + 1] : o.dash }, box, (c) => {
      c.moveTo(points[0]![0], points[0]![1])
      if (o.smooth && points.length > 2) {
        for (let i = 1; i < points.length - 1; i++) {
          const mx = (points[i]![0] + points[i + 1]![0]) / 2
          const my = (points[i]![1] + points[i + 1]![1]) / 2
          c.quadraticCurveTo(points[i]![0], points[i]![1], mx, my)
        }
        const last = points[points.length - 1]!
        c.lineTo(last[0], last[1])
      } else for (let i = 1; i < points.length; i++) c.lineTo(points[i]![0], points[i]![1])
      if (o.closed) c.closePath()
    })
  }

  /** SVG path data or Path2D. `progress` draws the stroke on (needs SVG path data). */
  path(d: string | Path2D, o: ShapeStyle & { x?: number; y?: number; scale?: number; progress?: number } = {}) {
    const p2 = typeof d === 'string' ? new Path2D(d) : d
    let dash = o.dash
    if (o.progress !== undefined && o.progress < 1 && typeof d === 'string') {
      const len = pathLength(d)
      dash = [len * Math.max(0, o.progress), len + 1]
    }
    this.group({ x: o.x ?? 0, y: o.y ?? 0, scale: o.scale ?? 1 }, () => {
      const ctx = this.prep(o.opacity ?? 1, o.blend, o.blur ?? 0)
      const shadows = this.shadows(o.shadow)
      if (shadows.length && o.fill) this.drawShadows(ctx, shadows, (c) => c.fill(p2), '#000')
      if (o.fill !== undefined) {
        ctx.fillStyle = this.paint(ctx, o.fill)
        ctx.fill(p2)
      }
      if (o.stroke !== undefined) {
        ctx.strokeStyle = this.paint(ctx, o.stroke)
        ctx.lineWidth = o.lineWidth ?? 2
        ctx.lineCap = o.lineCap ?? 'round'
        ctx.lineJoin = o.lineJoin ?? 'round'
        if (dash) ctx.setLineDash(dash)
        ctx.stroke(p2)
      }
    })
  }

  // ---------------------------------------------------------------- text

  /** Draw (animated) text. Returns its bounding boxes in local coordinates. */
  text(content: string, o: TextOptions): TextResult {
    const style = resolveTextStyle(this.brand, o)
    const ctx = this.prep(1)
    const layoutW = layoutText(content, style, o.maxWidth ?? Infinity, o.balance ?? true).maxLineWidth
    const align = o.align ?? 'center'
    const x0 = align === 'left' ? o.x : align === 'right' ? o.x - layoutW : o.x - layoutW / 2
    const box = { x: x0, y: o.y - style.size, w: layoutW, h: style.size * 2 }
    const colorPaint = o.color ?? style.color ?? 'text'
    const shadow = this.shadows(o.shadow)[0]
    const k = matScale(ctx.getTransform())
    const opts: DrawTextOptions = {
      x: o.x,
      y: o.y,
      align,
      valign: o.valign,
      maxWidth: o.maxWidth,
      balance: o.balance,
      color: this.paint(ctx, colorPaint, box),
      accent: this.paint(ctx, o.accent ?? 'primary', box),
      muted: this.color('muted'),
      opacity: o.opacity ?? 1,
      shadow: shadow ? { ...shadow, color: this.color(shadow.color), blur: shadow.blur * k, x: shadow.x * k, y: shadow.y * k } : undefined,
      stroke: o.stroke,
      anim: o.anim,
      marks: o.marks,
      caret: o.caret,
    }
    const res = drawText(ctx, this.f, content, style, opts)
    if (this.host.report && !this.layerTarget && (o.opacity ?? 1) * this.state.alpha > 0.3) {
      // report in stage space for safe-area checks
      const m = this.state.screen ? this.state.m : planeTransform(this.cam, this.stage, this.state.z).multiply(this.state.m)
      const p0 = m.transformPoint(new DOMPoint(res.x, res.y))
      const p1 = m.transformPoint(new DOMPoint(res.x + res.w, res.y + res.h))
      this.host.report('text', { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) }, content.slice(0, 40))
    }
    return res
  }

  /** Measure text without drawing it. */
  measure(content: string, o: TextStyleOptions & { maxWidth?: number } = {}): { w: number; h: number; lines: number } {
    const style = resolveTextStyle(this.brand, o)
    const l = layoutText(content, style, o.maxWidth ?? Infinity)
    return { w: l.maxLineWidth, h: l.lines.length * l.lineHeight, lines: l.lines.length }
  }

  // ---------------------------------------------------------------- images & video

  private drawPlaceholder(r: Rect, label: string) {
    if (this.host.quality !== 'preview') return
    const ctx = this.prep(0.6)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.setLineDash([8, 8])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fill()
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '500 20px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2)
  }

  private drawSource(src: CanvasImageSource | null, natural: [number, number] | null, o: ImageOptions, label: string): Rect {
    let w = o.w
    let h = o.h
    if (natural) {
      const [nw, nh] = natural
      if (w === undefined && h === undefined) {
        w = nw
        h = nh
      } else if (w === undefined) w = (h! * nw) / nh
      else if (h === undefined) h = (w * nh) / nw
    }
    w ??= 400
    h ??= 300
    const r = boxRect({ x: o.x, y: o.y, w, h, anchor: o.anchor })
    if (!src || !natural) {
      this.drawPlaceholder(r, label)
      return r
    }
    const rad = this.radius(o.radius, Math.min(w, h))
    const ctx = this.prep(o.opacity ?? 1, undefined, o.blur ?? 0)
    const shadows = this.shadows(o.shadow)
    const shapePath = (c: Ctx2D) => (rad ? c.roundRect(r.x, r.y, r.w, r.h, rad) : c.rect(r.x, r.y, r.w, r.h))
    if (shadows.length) {
      this.drawShadows(ctx, shadows, (c) => {
        c.beginPath()
        shapePath(c)
        c.fill()
      })
    }
    // source rect for the fit mode
    const [nw, nh] = natural
    let sx = 0
    let sy = 0
    let sw = nw
    let sh = nh
    let dx = r.x
    let dy = r.y
    let dw = r.w
    let dh = r.h
    const fit = o.fit ?? 'cover'
    if (fit === 'cover') {
      const s = Math.max(r.w / nw, r.h / nh)
      sw = r.w / s
      sh = r.h / s
      const [fx, fy] = o.focus ?? [0.5, 0.5]
      sx = (nw - sw) * fx
      sy = (nh - sh) * fy
    } else if (fit === 'contain') {
      const s = Math.min(r.w / nw, r.h / nh)
      dw = nw * s
      dh = nh * s
      dx = r.x + (r.w - dw) / 2
      dy = r.y + (r.h - dh) / 2
    }
    if (rad) {
      ctx.save()
      ctx.beginPath()
      shapePath(ctx)
      ctx.clip()
    }
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)
    if (rad) ctx.restore()
    if (o.border) {
      ctx.beginPath()
      shapePath(ctx)
      ctx.strokeStyle = this.paint(ctx, o.border.color, r)
      ctx.lineWidth = o.border.width
      ctx.stroke()
    }
    return r
  }

  /** Image from the project's assets/ folder (e.g. 'screens/dashboard.png'). Positioned by its center. */
  image(src: string, o: ImageOptions): Rect {
    const img = this.host.assets.image(src)
    return this.drawSource(img, img ? this.host.assets.size(src) : null, o, src)
  }

  /** Screen recording (frames extracted by `mvs assets`). Plays from `start` at `rate`. */
  video(src: string, o: VideoOptions): Rect {
    const meta = this.host.assets.video(src)
    if (!meta) return this.drawSource(null, null, o, `${src} (run mvs assets)`)
    const start = this.f.at(o.start ?? 0)
    let clipT = Math.max(0, (this.f.t - start) * (o.rate ?? 1) + (o.from ?? 0))
    if (o.loop) clipT %= meta.duration
    const frame = this.host.assets.videoFrame(src, clipT * meta.fps)
    return this.drawSource(frame, [meta.width, meta.height], o, src)
  }

  /** Lucide icon by name (https://lucide.dev/icons), centered on (x, y). */
  icon(name: string, o: IconOptions) {
    const paths = iconPaths(name)
    const size = o.size ?? 48
    if (!paths) {
      this.f.warn(`unknown icon "${name}" (see https://lucide.dev/icons)`)
      return
    }
    const p = o.progress ?? 1
    if (p <= 0) return
    this.group({ x: o.x - size / 2, y: o.y - size / 2, scale: size / 24 }, () => {
      const ctx = this.prep(o.opacity ?? 1)
      if (o.fill !== undefined) {
        ctx.fillStyle = this.paint(ctx, o.fill)
        for (const path of paths) ctx.fill(path)
      }
      ctx.strokeStyle = this.paint(ctx, o.color ?? 'text')
      ctx.lineWidth = o.stroke ?? 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (p < 1) ctx.setLineDash([80 * p, 80])
      for (const path of paths) ctx.stroke(path)
    })
  }

  // ---------------------------------------------------------------- layers

  /**
   * A separate texture composited by the GPU: 3D rotation and depth, blur,
   * blend modes, opacity, caching. Draw inside with local coordinates
   * (0,0) .. (w,h).
   */
  layer(o: LayerOptions, draw: (lg: Graphics) => void) {
    const stage = this.stage
    const w = o.w ?? stage.w
    const h = o.h ?? stage.h
    if (this.layerTarget) {
      // nested layers are drawn inline (no 3D)
      this.host.warn('g.layer() inside a layer is drawn inline without 3D')
      const [ax, ay] = o.anchor ?? [0.5, 0.5]
      this.group({ x: (o.x ?? 0) - ax * w, y: (o.y ?? 0) - ay * h, opacity: o.opacity }, () => draw(this))
      return
    }
    const pad = Math.max(2 / this.host.scale, o.pad ?? 0)
    let device = this.host.scale * (o.res ?? 1)
    const maxDim = Math.max(w + 2 * pad, h + 2 * pad) * device
    if (maxDim > MAX_TEXTURE) device *= MAX_TEXTURE / maxDim
    const physW = Math.ceil((w + 2 * pad) * device)
    const physH = Math.ceil((h + 2 * pad) * device)

    // placement: group transform applies to position, scale and z-rotation
    const sm = this.state.m
    const pos = sm.transformPoint(new DOMPoint(o.x ?? stage.cx, o.y ?? stage.cy))
    const gScale = matScale(sm)
    const gRot = (Math.atan2(sm.b, sm.a) * 180) / Math.PI
    const [sx, sy] = o.scale === undefined ? [1, 1] : typeof o.scale === 'number' ? [o.scale, o.scale] : o.scale
    const z = this.state.z + (o.z ?? 0)
    const [ax, ay] = o.anchor ?? [0.5, 0.5]
    const rx = ((o.rotateX ?? 0) * Math.PI) / 180
    const ry = ((o.rotateY ?? 0) * Math.PI) / 180
    const rz = (((o.rotateZ ?? 0) + gRot) * Math.PI) / 180
    const model = [
      translation(pos.x, pos.y, z),
      rotationZ(rz),
      rotationY(ry),
      rotationX(rx),
      scaling(sx * gScale, sy * gScale, 1),
      translation(-pad - ax * w, -pad - ay * h, 0),
      scaling(w + 2 * pad, h + 2 * pad, 1),
    ].reduce((a, b) => multiply(a, b))

    const screen = o.screen ?? this.state.screen
    const opacity = (o.opacity ?? 1) * this.state.alpha
    const blurLogical = (o.blur ?? 0) + (screen ? 0 : defocus(this.cam, z))
    let shade = 1
    if (o.light) {
      // normal of the rotated plane vs a light from the top-left-front
      const nx = Math.sin(ry) * Math.cos(rx)
      const ny = -Math.sin(rx)
      const nz = Math.cos(rx) * Math.cos(ry)
      const l = [-0.35, -0.45, 0.82]
      const dot = -nx * l[0]! - ny * l[1]! + nz * l[2]!
      shade = 1 + o.light * (dot - 0.82) * 0.9
    }
    const projected = (screen ? 1 : depthScale(this.cam, z)) * Math.max(sx, sy) * gScale * Math.cos(Math.max(Math.abs(rx), Math.abs(ry)) * 0.5)
    const mip = projected * this.host.scale < device * 0.8

    let cacheKey = o.cache ? `${o.cache}|${physW}x${physH}` : null
    let canvas: OffscreenCanvas | null = null
    if (!(cacheKey && this.host.hasCached(cacheKey, physW, physH))) {
      const pc = this.host.pool.acquire(physW, physH)
      const lg = new Graphics(this.host, this.f, { target: { ...pc, clipDepth: 0 }, device, pad })
      const missesBefore = this.host.assets.misses
      draw(lg)
      if (cacheKey && this.host.assets.misses !== missesBefore) cacheKey = null
      canvas = pc.canvas
    }
    this.seal()
    if (opacity <= 0.001) return
    this.host.display.push({
      kind: 'layer',
      canvas,
      cacheKey,
      w: physW,
      h: physH,
      model,
      screen,
      opacity,
      blur: blurLogical * device,
      blend: o.blend ?? 'normal',
      shade,
      mip,
    })
  }

  /** Soft glow behind something: a blurred, additive layer (cheap way to add light). */
  glow(o: { x: number; y: number; r: number; color?: string; intensity?: number }) {
    const color = this.color(o.color ?? 'primary')
    this.circle({
      x: o.x,
      y: o.y,
      r: o.r,
      fill: { type: 'radial', at: [o.x, o.y], r: o.r, stops: [[0, withAlpha(color, o.intensity ?? 0.6)], [0.45, withAlpha(color, (o.intensity ?? 0.6) * 0.35)], [1, withAlpha(color, 0)]] },
      blend: 'add',
    })
  }
}

/** Total length of SVG path data (cached). */
export function pathLength(d: string): number {
  let len = pathLengths.get(d)
  if (len === undefined) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    el.setAttribute('d', d)
    len = el.getTotalLength()
    pathLengths.set(d, len)
  }
  return len
}
