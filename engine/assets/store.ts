/**
 * Asset store: images, SVGs and screen recordings (as pre-extracted frame
 * sequences, see `mvs assets`). Everything is loaded once and cached.
 *
 * Lookups are synchronous (render functions are synchronous). A lookup that
 * is not ready yet returns null and counts as a "miss"; the offline renderer
 * waits for pending loads and re-renders the frame, so exported frames never
 * contain half-loaded assets.
 */

export interface VideoMeta {
  fps: number
  frames: number
  width: number
  height: number
  duration: number
  pattern: string
}

type Img = ImageBitmap | HTMLImageElement

interface Entry<T> {
  value: T | null
  promise: Promise<void>
  error?: string
}

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i

export interface AssetStoreOptions {
  /** e.g. '/projects/orbit-launch/' */
  projectBase: string
  /** Asset paths relative to the project's assets/ folder (from the file system scan). */
  known: string[]
  /** Max decoded video frames kept in memory. */
  videoCache?: number
  /** Prefetch this many frames ahead for video (preview playback). */
  prefetch?: number
}

export function frameDirName(path: string): string {
  return path.replace(/\.[^.\/]+$/, '').replace(/[\\/]+/g, '__')
}

export class AssetStore {
  private readonly images = new Map<string, Entry<Img>>()
  private readonly metas = new Map<string, Entry<VideoMeta>>()
  private readonly frames = new Map<string, Entry<ImageBitmap>>()
  private readonly inflight = new Set<Promise<void>>()
  private readonly known: Set<string>
  private readonly byStem = new Map<string, string>()
  readonly errors = new Map<string, string>()
  /** Lookups that returned null since the last reset. */
  misses = 0
  /** Called whenever something finishes loading (preview uses it to redraw). */
  onLoad: (() => void) | null = null
  prefetch: number
  private readonly videoCache: number

  constructor(private readonly opts: AssetStoreOptions) {
    this.known = new Set(opts.known)
    for (const k of opts.known) {
      const stem = k.replace(/\.[^.\/]+$/, '')
      if (!this.byStem.has(stem)) this.byStem.set(stem, k)
    }
    this.videoCache = opts.videoCache ?? 96
    this.prefetch = opts.prefetch ?? 0
  }

  /** All known asset paths (relative to assets/). */
  list(): string[] {
    return [...this.known]
  }

  /** Normalize 'screens/dashboard' or 'screens/dashboard.png' to a known path. */
  resolve(path: string): string {
    const clean = path.replace(/^\.?\/*(assets\/)?/, '')
    if (this.known.has(clean)) return clean
    return this.byStem.get(clean) ?? clean
  }

  url(path: string): string {
    if (path.startsWith('/') || /^https?:/.test(path)) return path
    return `${this.opts.projectBase}assets/${this.resolve(path)}`
  }

  get pending(): number {
    return this.inflight.size
  }

  /** Resolves when nothing is loading. */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight])
  }

  private track(p: Promise<void>): Promise<void> {
    this.inflight.add(p)
    p.finally(() => {
      this.inflight.delete(p)
      this.onLoad?.()
    })
    return p
  }

  private fail(key: string, msg: string) {
    this.errors.set(key, msg)
  }

  private loadImage(path: string): Entry<Img> {
    const url = this.url(path)
    const entry: Entry<Img> = { value: null, promise: Promise.resolve() }
    entry.promise = this.track(
      (async () => {
        try {
          if (/\.svg$/i.test(url)) {
            const img = new Image()
            img.decoding = 'sync'
            img.src = url
            await img.decode()
            entry.value = img
          } else {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            entry.value = await createImageBitmap(await res.blob())
          }
        } catch (e) {
          entry.error = `cannot load image "${path}" (${url}): ${(e as Error).message}`
          this.fail(path, entry.error)
        }
      })(),
    )
    return entry
  }

  /** Decoded image, or null while loading / on error. */
  image(path: string): Img | null {
    const key = this.resolve(path)
    let e = this.images.get(key)
    if (!e) {
      if (!IMAGE_EXT.test(key) && !this.known.has(key)) {
        this.fail(path, `unknown image asset "${path}" (not found in assets/)`)
      }
      e = this.loadImage(key)
      this.images.set(key, e)
    }
    if (!e.value && !e.error) this.misses++
    return e.value
  }

  /** Natural size of a loaded image. */
  size(path: string): [number, number] | null {
    const img = this.image(path)
    if (!img) return null
    if (img instanceof HTMLImageElement) return [img.naturalWidth || 300, img.naturalHeight || 150]
    return [img.width, img.height]
  }

  async preloadImages(paths: string[]): Promise<void> {
    for (const p of paths) this.image(p)
    await this.idle()
  }

  private frameBase(path: string): string {
    return `${this.opts.projectBase}build/frames/${frameDirName(this.resolve(path))}/`
  }

  /** Metadata of a screen recording (requires `mvs assets` to have extracted its frames). */
  video(path: string): VideoMeta | null {
    const key = this.resolve(path)
    let e = this.metas.get(key)
    if (!e) {
      const entry: Entry<VideoMeta> = { value: null, promise: Promise.resolve() }
      entry.promise = this.track(
        (async () => {
          try {
            const res = await fetch(this.frameBase(key) + 'meta.json')
            if (!res.ok) throw new Error(`frames not extracted — run \`mvs assets\``)
            entry.value = (await res.json()) as VideoMeta
          } catch (err) {
            entry.error = `video "${path}": ${(err as Error).message}`
            this.fail(path, entry.error)
          }
        })(),
      )
      e = entry
      this.metas.set(key, e)
    }
    if (!e.value && !e.error) this.misses++
    return e.value
  }

  private requestFrame(key: string, meta: VideoMeta, index: number): Entry<ImageBitmap> {
    const id = `${key}#${index}`
    let e = this.frames.get(id)
    if (e) {
      // refresh LRU position
      this.frames.delete(id)
      this.frames.set(id, e)
      return e
    }
    const url = this.frameBase(key) + meta.pattern.replace('%06d', String(index + 1).padStart(6, '0'))
    const entry: Entry<ImageBitmap> = { value: null, promise: Promise.resolve() }
    entry.promise = this.track(
      (async () => {
        try {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          entry.value = await createImageBitmap(await res.blob())
        } catch (err) {
          entry.error = `video frame ${index} of "${key}": ${(err as Error).message}`
          this.fail(id, entry.error)
        }
      })(),
    )
    this.frames.set(id, entry)
    while (this.frames.size > this.videoCache) {
      const oldest = this.frames.keys().next().value as string
      const old = this.frames.get(oldest)!
      if (!old.value && !old.error) break
      old.value?.close()
      this.frames.delete(oldest)
    }
    return entry
  }

  /** Frame `index` (0-based) of a screen recording, or null while loading. */
  videoFrame(path: string, index: number): ImageBitmap | null {
    const key = this.resolve(path)
    const meta = this.video(key)
    if (!meta) return null
    const i = Math.max(0, Math.min(meta.frames - 1, Math.floor(index)))
    const e = this.requestFrame(key, meta, i)
    for (let k = 1; k <= this.prefetch && i + k < meta.frames; k++) this.requestFrame(key, meta, i + k)
    if (!e.value && !e.error) this.misses++
    if (e.value) return e.value
    // while loading in the preview, show the nearest frame we already have
    for (let d = 1; d < 8; d++) {
      const near = this.frames.get(`${key}#${i - d}`)?.value
      if (near) return near
    }
    return null
  }
}
