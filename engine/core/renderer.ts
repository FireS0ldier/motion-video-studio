/**
 * Frame renderer: turns (project, time) into pixels.
 *
 * For each sample time it renders the visible scene(s) into display lists,
 * composites them (with a transition when two scenes overlap) and, for motion
 * blur, accumulates several sub-frame samples across the shutter interval.
 */

import type { AssetStore } from '../assets/store.ts'
import { CanvasPool } from '../gfx/canvas-pool.ts'
import { Graphics, type GraphicsHost } from '../gfx/graphics.ts'
import { defaultCamera, viewProjection } from '../gl/camera.ts'
import type { Compositor } from '../gl/compositor.ts'
import { ease } from '../motion/easing.ts'
import { hash32, rng } from '../motion/noise.ts'
import { deepMerge } from './brand.ts'
import type { ResolvedProject } from './project.ts'
import { createFrame, type Quality } from './scene.ts'
import type { ResolvedEntry } from './timeline.ts'
import type { DeepPartial, Look, Rect } from './types.ts'

export interface RenderOptions {
  /** Motion-blur samples: 1 (off), a fixed number, or 'auto' (adaptive). */
  samples?: number | 'auto'
  /** Shutter as a fraction of the frame interval (default from the look). */
  shutter?: number
  target: 'screen' | 'readback'
  /** Override the time instead of deriving it from the frame index. */
  time?: number
}

export interface FrameStats {
  frame: number
  time: number
  ms: number
  samples: number
  misses: number
  uploads: number
  cacheHits: number
}

export interface TextReport {
  scene: string
  t: number
  box: Rect
  label: string
}

const DIRS: Record<string, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
}

export class Renderer {
  readonly pool = new CanvasPool()
  readonly warnings = new Set<string>()
  onWarn: ((message: string) => void) | null = null
  /** When set, text boxes are collected for `mvs check`. */
  textReports: TextReport[] | null = null
  private currentScene = ''
  private currentTime = 0

  constructor(
    readonly project: ResolvedProject,
    readonly compositor: Compositor,
    readonly assets: AssetStore,
    public opts: { scale: number; quality: Quality },
  ) {
    for (const w of project.warnings) this.warn(w)
    compositor.resize(project.stage.w * opts.scale, project.stage.h * opts.scale)
  }

  setScale(scale: number) {
    this.opts.scale = scale
    this.compositor.resize(this.project.stage.w * scale, this.project.stage.h * scale)
    this.compositor.clearCache()
  }

  warn(message: string) {
    if (this.warnings.has(message)) return
    this.warnings.add(message)
    this.onWarn?.(message)
  }

  private host(): GraphicsHost {
    const p = this.project
    return {
      stage: p.stage,
      brand: p.brand,
      scale: this.compositor.probing ? this.opts.scale * this.compositor.probeFactor : this.opts.scale,
      quality: this.opts.quality,
      assets: this.assets,
      pool: this.pool,
      hasCached: (k, w, h) => this.compositor.hasCached(k, w, h),
      display: [],
      warn: (m) => this.warn(m),
      report: this.textReports
        ? (_kind, box, label) => this.textReports!.push({ scene: this.currentScene, t: this.currentTime, box, label })
        : undefined,
    }
  }

  private renderEntry(entry: ResolvedEntry, slot: 0 | 1, t: number, frameIndex: number, sample: number, phase: 'in' | 'out' | null, tp: number): DeepPartial<Look> | null {
    const p = this.project
    const host = this.host()
    this.currentScene = entry.id
    this.currentTime = t
    const f = createFrame({
      id: entry.id,
      t,
      start: entry.start,
      end: entry.end,
      frame: frameIndex,
      stage: p.stage,
      brand: p.brand,
      quality: this.opts.quality,
      timing: p.timing,
      audio: p.features,
      transition: { phase, p: tp },
      seed: p.seed,
      warn: (m) => this.warn(m),
    })
    const g = new Graphics(host, f)
    // Math.random is replaced by a seeded generator while a scene renders, so
    // even accidental use stays reproducible between renders.
    const realRandom = Math.random
    Math.random = rng(hash32(p.seed, entry.id, frameIndex, sample))
    let look: DeepPartial<Look> | null = null
    this.compositor.markStart()
    try {
      entry.scene.render(f, g)
      look = g.finish()
    } catch (e) {
      g.finish()
      const err = e as Error
      this.warn(`scene "${entry.id}" threw: ${err.message}`)
      this.drawError(host, f, entry.id, err)
    } finally {
      Math.random = realRandom
    }
    this.compositor.mark('scene-js')
    const cam = g.currentCamera
    this.compositor.renderScene(slot, host.display, viewProjection(cam, p.stage), viewProjection(defaultCamera(p.stage), p.stage))
    return look
  }

  private drawError(host: GraphicsHost, f: ReturnType<typeof createFrame>, id: string, err: Error) {
    const g = new Graphics(host, f)
    g.screen(() => {
      const ctx = g.ctx
      ctx.fillStyle = 'rgba(120,0,20,0.92)'
      ctx.fillRect(0, 0, this.project.stage.w, 150)
      ctx.fillStyle = '#fff'
      ctx.font = '600 30px system-ui, sans-serif'
      ctx.fillText(`Scene "${id}" crashed`, 40, 56)
      ctx.font = '400 22px ui-monospace, monospace'
      ctx.fillText(String(err.message).slice(0, 140), 40, 100)
    })
    g.finish()
  }

  /** Render one sample (all visible scenes + transition) into the compositor's frame target. */
  private drawSample(t: number, frameIndex: number, sample: number): DeepPartial<Look> | null {
    const act = this.project.active(t)
    this.compositor.beginFrame()
    let look: DeepPartial<Look> | null
    if (!act.b) {
      look = this.renderEntry(act.a, 0, t, frameIndex, sample, null, 1)
      this.compositor.composeFrame(null)
    } else {
      const tr = act.a.transition
      const eased = ease(tr.ease)(act.p)
      const lookOut = this.renderEntry(act.b, 1, t, frameIndex, sample, 'out', act.p)
      const lookIn = this.renderEntry(act.a, 0, t, frameIndex, sample, 'in', act.p)
      look = lookOut || lookIn ? { ...(act.p < 0.5 ? lookOut : lookIn) } : null
      const stage = this.project.stage
      const c = tr.center ?? [stage.cx, stage.cy]
      this.compositor.composeFrame({
        type: tr.type,
        p: eased,
        raw: act.p,
        dir: DIRS[tr.direction ?? 'left'] ?? [-1, 0],
        color: tr.color ?? this.project.brand.colors.bg,
        center: [c[0] / stage.w, 1 - c[1] / stage.h],
        seed: frameIndex,
      })
    }
    this.pool.releaseAll()
    return look
  }

  /** Render a complete output frame (synchronous; assets that are still loading are skipped). */
  renderFrame(frameIndex: number, o: RenderOptions): FrameStats {
    const t0 = performance.now()
    const p = this.project
    const fps = p.format.fps
    const t = o.time ?? frameIndex / fps
    const baseLook = p.look
    const shutter = o.shutter ?? baseLook.motionBlur.shutter
    let samples = o.samples ?? 1
    // glitches are meant to be crisp and stuttery: never motion-blur them
    const act = p.active(t)
    if (act.b && act.a.transition.type === 'glitch') samples = 1
    const maxSamples = Math.max(2, baseLook.motionBlur.maxSamples)
    let look: DeepPartial<Look> | null = null
    let used = 1
    let uploads = 0
    let hits = 0
    const tally = () => {
      uploads += this.compositor.stats.uploads
      hits += this.compositor.stats.cacheHits
    }
    if (samples === 1 || shutter <= 0) {
      look = this.drawSample(t, frameIndex, 0)
      tally()
      this.post(look, frameIndex, 'frame', o.target)
    } else {
      const dt = shutter / fps
      if (samples === 'auto') {
        // probe: render the two shutter endpoints at 1/4 resolution and compare them;
        // static frames then cost one full sample, moving frames get 3..maxSamples
        this.compositor.setProbing(true)
        try {
          this.drawSample(t - dt / 2, frameIndex, 100)
          this.compositor.snapshotProbe('a')
          this.drawSample(t + dt / 2, frameIndex, 101)
          this.compositor.snapshotProbe('b')
        } finally {
          this.compositor.setProbing(false)
        }
        const diff = this.compositor.probeDifference()
        const n = diff < 0.004 ? 1 : Math.min(maxSamples, Math.max(3, Math.round(2 + diff * 16)))
        if (n === 1) {
          look = this.drawSample(t, frameIndex, 0)
          tally()
          this.post(look, frameIndex, 'frame', o.target)
          return { frame: frameIndex, time: t, ms: performance.now() - t0, samples: 1, misses: this.assets.misses, uploads, cacheHits: hits }
        }
        this.compositor.beginAccumulation()
        for (let i = 0; i < n; i++) {
          const l = this.drawSample(t - dt / 2 + (dt * i) / (n - 1), frameIndex, i)
          tally()
          if (i === Math.floor(n / 2)) look = l
          this.compositor.accumulate()
        }
        used = n
      } else {
        samples = Math.max(1, Math.min(32, Math.round(samples)))
        this.compositor.beginAccumulation()
        for (let i = 0; i < samples; i++) {
          const ts = samples === 1 ? t : t - dt / 2 + (dt * i) / (samples - 1)
          const l = this.drawSample(ts, frameIndex, i)
          tally()
          if (i === Math.floor(samples / 2)) look = l
          this.compositor.accumulate()
        }
        used = samples
      }
      this.post(look, frameIndex, 'accum', o.target)
    }
    return { frame: frameIndex, time: t, ms: performance.now() - t0, samples: used, misses: this.assets.misses, uploads, cacheHits: hits }
  }

  private post(override: DeepPartial<Look> | null, frameIndex: number, source: 'frame' | 'accum', target: 'screen' | 'readback') {
    const look = override ? deepMerge(this.project.look, override) : this.project.look
    this.compositor.post(look, {
      source,
      target,
      seed: frameIndex + 1,
      unit: this.opts.scale * this.project.stage.unit,
      background: this.project.brand.colors.bg,
      draft: this.opts.quality === 'draft',
    })
  }

  /**
   * Render a frame and, if any asset was still loading, wait for it and render
   * again. Exported frames are therefore always complete.
   */
  async renderFrameComplete(frameIndex: number, o: RenderOptions): Promise<FrameStats> {
    let stats: FrameStats | null = null
    for (let attempt = 0; attempt < 30; attempt++) {
      this.assets.misses = 0
      stats = this.renderFrame(frameIndex, o)
      if (this.assets.misses === 0) return stats
      await this.assets.idle()
    }
    this.warn(`frame ${frameIndex}: assets were still loading after 30 attempts`)
    return stats!
  }
}
