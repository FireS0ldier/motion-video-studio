/**
 * Headless render API (window.__MVS__) used by the CLI through Playwright.
 * Frames are rendered here and POSTed as raw RGBA to the CLI's frame sink.
 */

import type { Quality } from '../core/scene.ts'
import { Renderer, type FrameStats, type TextReport } from '../core/renderer.ts'
import type { Manifest } from '../core/types.ts'
import { Compositor } from '../gl/compositor.ts'
import { CanvasPool } from '../gfx/canvas-pool.ts'
import { loadProject } from './loader.ts'

export interface BridgeRenderOptions {
  samples?: number | 'auto'
  shutter?: number
  time?: number
}

export interface CheckReport {
  frames: number
  slowest: Array<{ frame: number; t: number; ms: number; scene: string }>
  perScene: Record<string, { frames: number; avgMs: number; maxMs: number }>
  warnings: string[]
  text: TextReport[]
  assetErrors: string[]
  blankFrames: number[]
}

export interface MvsBridge {
  manifest(): Manifest
  /** Render a frame and POST its pixels to `url`. */
  send(frame: number, url: string, opts?: BridgeRenderOptions): Promise<FrameStats>
  /** Render a frame and return a few statistics (no pixel transfer). */
  render(frame: number, opts?: BridgeRenderOptions): Promise<FrameStats>
  /** Sample the timeline and report problems. */
  check(step: number): Promise<CheckReport>
  /** Render a grid of thumbnails with labels and POST it as PNG to `url`. */
  contact(times: number[], cols: number, url: string): Promise<{ width: number; height: number }>
  warnings(): string[]
  /** Accumulated GPU stage timings (ms) when the page was opened with &profile=1. */
  profile(): Record<string, number>
}

declare global {
  interface Window {
    __MVS__?: MvsBridge
    __MVS_READY__?: Promise<Manifest>
    __MVS_ERROR__?: string
  }
}

export async function startBridge(params: URLSearchParams): Promise<Manifest> {
  const id = params.get('project')
  if (!id) throw new Error('render mode needs ?project=<id>')
  const scale = Number(params.get('scale') ?? 1)
  const quality = (params.get('quality') ?? 'final') as Quality
  const format = params.get('format') ?? undefined
  const loaded = await loadProject(id, { format: format as never })
  const { project, assets } = loaded
  CanvasPool.software = params.get('canvas') === 'cpu'
  const canvas = document.createElement('canvas')
  canvas.style.display = 'none'
  document.body.appendChild(canvas)
  const compositor = new Compositor(canvas, project.stage.w * scale, project.stage.h * scale)
  const renderer = new Renderer(project, compositor, assets, { scale, quality })
  if (params.get('profile')) compositor.profile = new Map()
  let pixels: Uint8Array | null = null

  const renderOpts = (o: BridgeRenderOptions = {}) => ({ samples: o.samples ?? 1, shutter: o.shutter, time: o.time, target: 'readback' as const })

  const bridge: MvsBridge = {
    manifest() {
      const m = project.manifest()
      m.warnings = [...new Set([...m.warnings, ...renderer.warnings])]
      return m
    },
    async send(frame, url, o) {
      const stats = await renderer.renderFrameComplete(frame, renderOpts(o))
      pixels = compositor.readPixels(pixels && pixels.length === compositor.width * compositor.height * 4 ? pixels : undefined)
      // a Blob body streams far faster than a typed-array body in Chromium
      const res = await fetch(url, { method: 'POST', body: new Blob([pixels as BlobPart]), headers: { 'content-type': 'application/octet-stream' } })
      if (!res.ok) throw new Error(`frame sink rejected frame ${frame}: HTTP ${res.status}`)
      return stats
    },
    async render(frame, o) {
      return renderer.renderFrameComplete(frame, renderOpts(o))
    },
    async check(step) {
      renderer.textReports = []
      const fps = project.format.fps
      const stepFrames = Math.max(1, Math.round(step * fps))
      const perScene: CheckReport['perScene'] = {}
      const timings: Array<{ frame: number; t: number; ms: number; scene: string }> = []
      const blank: number[] = []
      const probe = new Uint8Array(compositor.width * compositor.height * 4)
      for (let f = 0; f < project.frames; f += stepFrames) {
        const stats = await renderer.renderFrameComplete(f, renderOpts())
        const scene = project.active(stats.time).a.id
        timings.push({ frame: f, t: stats.time, ms: stats.ms, scene })
        const s = (perScene[scene] ??= { frames: 0, avgMs: 0, maxMs: 0 })
        s.avgMs = (s.avgMs * s.frames + stats.ms) / (s.frames + 1)
        s.frames++
        s.maxMs = Math.max(s.maxMs, stats.ms)
        // detect fully uniform frames (often a crashed or empty scene)
        compositor.readPixels(probe)
        let min = 255
        let max = 0
        for (let i = 0; i < probe.length; i += 4 * 97) {
          const v = probe[i]! + probe[i + 1]! + probe[i + 2]!
          if (v < min) min = v
          if (v > max) max = v
        }
        if (max - min < 6) blank.push(f)
      }
      const report: CheckReport = {
        frames: timings.length,
        slowest: [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5),
        perScene,
        warnings: [...new Set([...project.warnings, ...renderer.warnings])],
        text: renderer.textReports,
        assetErrors: [...assets.errors.values()],
        blankFrames: blank,
      }
      renderer.textReports = null
      return report
    },
    async contact(times, cols, url) {
      const tw = compositor.width
      const th = compositor.height
      const rows = Math.ceil(times.length / cols)
      const gap = 6
      const label = 26
      const sheet = new OffscreenCanvas(cols * (tw + gap) + gap, rows * (th + label + gap) + gap)
      const ctx = sheet.getContext('2d')!
      ctx.fillStyle = '#111318'
      ctx.fillRect(0, 0, sheet.width, sheet.height)
      const buf = new Uint8ClampedArray(tw * th * 4)
      for (let i = 0; i < times.length; i++) {
        const t = times[i]!
        const frame = Math.min(project.frames - 1, Math.round(t * project.format.fps))
        await renderer.renderFrameComplete(frame, renderOpts())
        compositor.readPixels(new Uint8Array(buf.buffer))
        const x = gap + (i % cols) * (tw + gap)
        const y = gap + Math.floor(i / cols) * (th + label + gap)
        ctx.putImageData(new ImageData(buf, tw, th), x, y + label)
        ctx.fillStyle = '#e8eaf0'
        ctx.font = '600 15px system-ui, sans-serif'
        const scene = project.active(frame / project.format.fps).a.id
        ctx.fillText(`${t.toFixed(2)}s  ·  ${scene}`, x + 4, y + 18)
      }
      const blob = await sheet.convertToBlob({ type: 'image/png' })
      const res = await fetch(url, { method: 'POST', body: blob })
      if (!res.ok) throw new Error(`contact sheet upload failed: HTTP ${res.status}`)
      return { width: sheet.width, height: sheet.height }
    },
    warnings: () => [...new Set([...project.warnings, ...renderer.warnings])],
    profile: () => Object.fromEntries(compositor.profile ?? []),
  }
  window.__MVS__ = bridge
  return bridge.manifest()
}
