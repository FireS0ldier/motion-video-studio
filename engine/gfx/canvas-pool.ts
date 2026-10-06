export type Ctx2D = OffscreenCanvasRenderingContext2D

export interface PooledCanvas {
  canvas: OffscreenCanvas
  ctx: Ctx2D
}

/** Reuses offscreen canvases between frames (allocation is the expensive part). */
export class CanvasPool {
  /**
   * CPU-backed 2D canvases (Skia raster) instead of GPU-backed ones. Much faster
   * when the GPU is emulated (SwiftShader in headless rendering); slower with a real GPU.
   */
  static software = false
  private free = new Map<string, PooledCanvas[]>()
  private used: Array<[string, PooledCanvas]> = []
  private created = 0

  acquire(w: number, h: number): PooledCanvas {
    w = Math.max(1, Math.ceil(w))
    h = Math.max(1, Math.ceil(h))
    const key = `${w}x${h}`
    let pc = this.free.get(key)?.pop()
    if (!pc) {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: CanvasPool.software })
      if (!ctx) throw new Error('Canvas 2D context unavailable')
      pc = { canvas, ctx }
      this.created++
    }
    pc.ctx.reset()
    pc.ctx.imageSmoothingEnabled = true
    pc.ctx.imageSmoothingQuality = 'high'
    this.used.push([key, pc])
    return pc
  }

  /** Return every canvas handed out since the last call. */
  releaseAll() {
    for (const [key, pc] of this.used) {
      let list = this.free.get(key)
      if (!list) this.free.set(key, (list = []))
      list.push(pc)
    }
    this.used = []
    // cap the number of idle sizes so odd one-off layer sizes do not pile up
    if (this.free.size > 48) {
      const keys = [...this.free.keys()]
      for (const k of keys.slice(0, keys.length - 32)) this.free.delete(k)
    }
  }

  get stats() {
    return { created: this.created, inUse: this.used.length }
  }
}
