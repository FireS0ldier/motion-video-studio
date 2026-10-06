/**
 * WebGL2 compositor.
 *
 * Per sample: each visible scene's display list (2D canvases + 3D layers) is
 * drawn into a scene target; two scene targets are combined by a transition
 * shader; samples are accumulated for motion blur; then a single post pass
 * adds bloom, aberration, grading, vignette, grain and dither.
 *
 * Everything is premultiplied alpha. Scenes are expected to paint their own
 * background; anything left transparent shows the project background color.
 */

import type { Look, TransitionType } from '../core/types.ts'
import { parseColor } from '../gfx/color.ts'
import { multiply, scaling, translation, type Mat4 } from './mat4.ts'
import { BLUR_FS, COPY_FS, DIFF_FS, DOWN_FS, FULL_VS, POST_FS, QUAD_VS, TEX_FS, TRANSITION_FS, UP_FS } from './shaders.ts'

export type CanvasLike = HTMLCanvasElement | OffscreenCanvas

export interface FlatItem {
  kind: 'flat'
  canvas: CanvasLike
}

export interface LayerItem {
  kind: 'layer'
  /** Null when the texture is served from the cache. */
  canvas: CanvasLike | null
  cacheKey: string | null
  /** Physical texture size. */
  w: number
  h: number
  /** Maps the unit quad to stage pixels (world space). */
  model: Mat4
  /** Use the screen camera instead of the scene camera. */
  screen: boolean
  opacity: number
  /** Gaussian sigma in physical px. */
  blur: number
  blend: 'normal' | 'add' | 'screen' | 'multiply'
  shade: number
  /** Generate mipmaps (layer is minified on screen). */
  mip: boolean
}

export type DisplayItem = FlatItem | LayerItem

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
  float: boolean
}

interface CachedTex {
  tex: WebGLTexture
  w: number
  h: number
  bytes: number
  used: number
  mip: boolean
}

const TRANSITION_IDS: Record<TransitionType, number> = {
  cut: 0,
  fade: 1,
  dip: 2,
  slide: 3,
  push: 4,
  zoom: 5,
  wipe: 6,
  iris: 7,
  blur: 8,
  glitch: 9,
  whip: 10,
}

class Program {
  readonly prog: WebGLProgram
  private readonly locs = new Map<string, WebGLUniformLocation | null>()
  constructor(
    private readonly gl: WebGL2RenderingContext,
    vs: string,
    fs: string,
  ) {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader compile error: ${gl.getShaderInfoLog(sh)}`)
      return sh
    }
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link error: ${gl.getProgramInfoLog(p)}`)
    this.prog = p
  }
  use(): this {
    this.gl.useProgram(this.prog)
    return this
  }
  loc(name: string): WebGLUniformLocation | null {
    if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.prog, name))
    return this.locs.get(name)!
  }
  f(name: string, ...v: number[]): this {
    const l = this.loc(name)
    if (v.length === 1) this.gl.uniform1f(l, v[0]!)
    else if (v.length === 2) this.gl.uniform2f(l, v[0]!, v[1]!)
    else if (v.length === 3) this.gl.uniform3f(l, v[0]!, v[1]!, v[2]!)
    else this.gl.uniform4f(l, v[0]!, v[1]!, v[2]!, v[3]!)
    return this
  }
  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v)
    return this
  }
  m4(name: string, m: Mat4): this {
    this.gl.uniformMatrix4fv(this.loc(name), false, m)
    return this
  }
}

const FLAT_MVP = (() => {
  // unit quad -> clip, v=0 at the top
  const m = new Float32Array(16)
  m[0] = 2
  m[5] = -2
  m[10] = 1
  m[12] = -1
  m[13] = 1
  m[15] = 1
  return m
})()

export interface CompositorStats {
  uploads: number
  uploadedBytes: number
  cacheHits: number
}

export class Compositor {
  readonly gl: WebGL2RenderingContext
  readonly floatTargets: boolean
  width = 0
  height = 0
  private readonly quad: WebGLVertexArrayObject
  private readonly pTex: Program
  private readonly pCopy: Program
  private readonly pBlur: Program
  private readonly pDown: Program
  private readonly pUp: Program
  private readonly pTransition: Program
  private readonly pPost: Program
  private readonly pDiff: Program
  private sceneFull: Target[] = []
  private frameFull!: Target
  private sceneProbe: Target[] = []
  private frameProbe!: Target
  /** Active target set: full resolution, or the 1/4 resolution motion probe. */
  private scene: Target[] = []
  private frame!: Target
  probing = false
  private accum!: Target
  private out!: Target
  private bloom: Target[] = []
  /** The composited result of the last sample (scene slot 0, or `frame` after a transition). */
  private current!: Target
  private probeA!: Target
  private probeB!: Target
  private diffT!: Target
  private blurPool = new Map<string, Target[]>()
  private readonly noise: WebGLTexture
  private uploadPool: WebGLTexture[] = []
  private uploadIndex = 0
  private readonly cache = new Map<string, CachedTex>()
  private cacheBytes = 0
  private tick = 0
  private accumCount = 0
  stats: CompositorStats = { uploads: 0, uploadedBytes: 0, cacheHits: 0 }
  /** When set, GPU work is synchronized after each stage and timed (slow; diagnostics only). */
  profile: Map<string, number> | null = null
  private profT = 0
  private readonly px1 = new Uint8Array(4)

  /** Close a profiling section: wait for the GPU and add the elapsed time under `label`. */
  mark(label: string) {
    if (!this.profile) return
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.px1)
    const now = performance.now()
    this.profile.set(label, (this.profile.get(label) ?? 0) + (now - this.profT))
    this.profT = now
  }

  markStart() {
    if (this.profile) this.profT = performance.now()
  }
  /** Max bytes of cached layer textures before least-recently-used ones are evicted. */
  cacheBudget = 768 * 1024 * 1024

  constructor(readonly canvas: CanvasLike, width: number, height: number) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available in this browser. Run `mvs doctor`.')
    this.gl = gl
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')
    this.quad = gl.createVertexArray()!
    gl.bindVertexArray(this.quad)
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.pTex = new Program(gl, QUAD_VS, TEX_FS)
    this.pCopy = new Program(gl, FULL_VS, COPY_FS)
    this.pBlur = new Program(gl, FULL_VS, BLUR_FS)
    this.pDown = new Program(gl, FULL_VS, DOWN_FS)
    this.pUp = new Program(gl, FULL_VS, UP_FS)
    this.pTransition = new Program(gl, FULL_VS, TRANSITION_FS)
    this.pPost = new Program(gl, FULL_VS, POST_FS)
    this.pDiff = new Program(gl, FULL_VS, DIFF_FS)
    gl.disable(gl.DEPTH_TEST)
    // deterministic white-noise texture for grain and dither (one fetch instead of hashing)
    this.noise = gl.createTexture()!
    const data = new Uint8Array(256 * 256 * 4)
    let seed = 0x9e3779b9
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      data[i] = seed & 255
    }
    gl.bindTexture(gl.TEXTURE_2D, this.noise)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    this.resize(width, height)
  }

  // ------------------------------------------------------------ resources

  private makeTarget(w: number, h: number, float = this.floatTargets, mip = false): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    const levels = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1
    gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete (0x${status.toString(16)})`)
    return { fbo, tex, w, h, float }
  }

  private freeTarget(t: Target | undefined) {
    if (!t) return
    this.gl.deleteFramebuffer(t.fbo)
    this.gl.deleteTexture(t.tex)
  }

  resize(width: number, height: number) {
    width = Math.max(2, Math.round(width))
    height = Math.max(2, Math.round(height))
    if (width === this.width && height === this.height) return
    for (const t of [...this.sceneFull, ...this.sceneProbe]) this.freeTarget(t)
    for (const t of this.bloom) this.freeTarget(t)
    for (const list of this.blurPool.values()) for (const t of list) this.freeTarget(t)
    this.blurPool.clear()
    ;[this.frameFull, this.frameProbe, this.accum, this.out, this.probeA, this.probeB, this.diffT].forEach((t) => this.freeTarget(t))
    this.width = width
    this.height = height
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    // 8-bit targets for compositing (fast everywhere, incl. software GL); float only where
    // precision matters: motion-blur accumulation and the bloom chain.
    this.sceneFull = [this.makeTarget(width, height, false), this.makeTarget(width, height, false)]
    this.frameFull = this.makeTarget(width, height, false)
    this.accum = this.makeTarget(width, height, this.floatTargets)
    // motion probes are low resolution: they only decide how many samples a frame needs
    const pw = Math.max(16, Math.round(width / 4))
    const ph = Math.max(16, Math.round(height / 4))
    this.sceneProbe = [this.makeTarget(pw, ph, false), this.makeTarget(pw, ph, false)]
    this.frameProbe = this.makeTarget(pw, ph, false)
    this.probeA = this.makeTarget(pw, ph, false)
    this.probeB = this.makeTarget(pw, ph, false)
    this.out = this.makeTarget(width, height, false)
    this.diffT = this.makeTarget(96, Math.max(8, Math.round((96 * height) / width)), false)
    this.setProbing(false)
    // bloom chain starts at quarter resolution in 8-bit targets: bloom is soft by nature,
    // and this keeps it cheap even with software GL
    this.bloom = []
    let w = width >> 2
    let h = height >> 2
    for (let i = 0; i < 5 && w >= 8 && h >= 8; i++) {
      this.bloom.push(this.makeTarget(w, h, false))
      w >>= 1
      h >>= 1
    }
  }

  /** Switch between full-resolution targets and the low-resolution motion-probe targets. */
  setProbing(on: boolean) {
    this.probing = on
    this.scene = on ? this.sceneProbe : this.sceneFull
    this.frame = on ? this.frameProbe : this.frameFull
    this.current = this.scene[0]!
  }

  /** Resolution factor of the probe targets relative to full resolution. */
  get probeFactor(): number {
    return this.sceneProbe[0]!.w / this.width
  }

  private bindTarget(t: Target | null) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null)
    gl.viewport(0, 0, t ? t.w : this.width, t ? t.h : this.height)
  }

  private draw() {
    this.gl.bindVertexArray(this.quad)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  private blend(mode: LayerItem['blend'] | 'none' | 'add-raw') {
    const gl = this.gl
    if (mode === 'none') {
      gl.disable(gl.BLEND)
      return
    }
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    if (mode === 'add' || mode === 'add-raw') gl.blendFunc(gl.ONE, gl.ONE)
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR)
    else if (mode === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** Upload a canvas into a texture (reusing per-frame upload textures). */
  private upload(canvas: CanvasLike, into?: WebGLTexture, mip = false): WebGLTexture {
    const gl = this.gl
    let tex = into
    if (!tex) {
      tex = this.uploadPool[this.uploadIndex]
      if (!tex) {
        tex = gl.createTexture()!
        this.uploadPool[this.uploadIndex] = tex
      }
      this.uploadIndex++
    }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas as TexImageSource)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }
    this.stats.uploads++
    this.stats.uploadedBytes += canvas.width * canvas.height * 4
    return tex
  }

  hasCached(key: string, w: number, h: number): boolean {
    const c = this.cache.get(key)
    return !!c && c.w === w && c.h === h
  }

  private cached(key: string, canvas: CanvasLike | null, w: number, h: number, mip: boolean): WebGLTexture | null {
    const gl = this.gl
    const hit = this.cache.get(key)
    if (hit && hit.w === w && hit.h === h) {
      hit.used = this.tick
      if (mip && !hit.mip) {
        gl.bindTexture(gl.TEXTURE_2D, hit.tex)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        hit.mip = true
      }
      this.stats.cacheHits++
      return hit.tex
    }
    if (!canvas) return null
    if (hit) {
      gl.deleteTexture(hit.tex)
      this.cacheBytes -= hit.bytes
      this.cache.delete(key)
    }
    const tex = this.upload(canvas, gl.createTexture()!, true)
    const bytes = Math.round(w * h * 4 * 1.34)
    this.cache.set(key, { tex, w, h, bytes, used: this.tick, mip: true })
    this.cacheBytes += bytes
    this.evict()
    return tex
  }

  private evict() {
    if (this.cacheBytes <= this.cacheBudget) return
    const entries = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used)
    for (const [k, v] of entries) {
      if (this.cacheBytes <= this.cacheBudget * 0.8) break
      if (v.used === this.tick) continue
      this.gl.deleteTexture(v.tex)
      this.cacheBytes -= v.bytes
      this.cache.delete(k)
    }
  }

  clearCache() {
    for (const v of this.cache.values()) this.gl.deleteTexture(v.tex)
    this.cache.clear()
    this.cacheBytes = 0
  }

  private blurTargets(w: number, h: number): [Target, Target] {
    const key = `${w}x${h}`
    let list = this.blurPool.get(key)
    if (!list) {
      list = [this.makeTarget(w, h), this.makeTarget(w, h)]
      this.blurPool.set(key, list)
    }
    return [list[0]!, list[1]!]
  }

  /**
   * Gaussian blur of a texture region into a padded target. Returns the
   * blurred texture and the padding (in source px) added on each side.
   */
  private blurTexture(src: WebGLTexture, w: number, h: number, sigma: number): { tex: WebGLTexture; pad: number } {
    const gl = this.gl
    const down = sigma > 24 ? 4 : sigma > 8 ? 2 : 1
    const pad = Math.ceil(sigma * 3)
    const bw = Math.max(4, Math.ceil((w + 2 * pad) / down / 8) * 8)
    const bh = Math.max(4, Math.ceil((h + 2 * pad) / down / 8) * 8)
    const [a, b] = this.blurTargets(bw, bh)
    // copy source into the padded target
    this.bindTarget(a)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.blend('none')
    const sx = w / (bw * down)
    const sy = h / (bh * down)
    const ox = pad / (bw * down)
    const oy = pad / (bh * down)
    const mvp = multiply(FLAT_MVP, multiply(translation(ox, oy, 0), scaling(sx, sy, 1)))
    this.pTex.use().m4('uMVP', mvp).f('uUV', 0, 0, 1, 1).f('uOpacity', 1).f('uShade', 1).i('uTex', 0)
    this.bindTex(0, src)
    this.draw()
    const s = sigma / down
    this.pBlur.use().i('uTex', 0).f('uSigma', s)
    this.bindTarget(b)
    this.bindTex(0, a.tex)
    this.pBlur.f('uDir', 1 / bw, 0)
    this.draw()
    this.bindTarget(a)
    this.bindTex(0, b.tex)
    this.pBlur.f('uDir', 0, 1 / bh)
    this.draw()
    // the target covers (bw*down) x (bh*down) source px with the content `pad` px in from the top-left
    return { tex: a.tex, pad }
  }

  // ------------------------------------------------------------ scenes

  beginFrame() {
    this.tick++
    this.uploadIndex = 0
    this.stats = { uploads: 0, uploadedBytes: 0, cacheHits: 0 }
  }

  /** Draw a scene's display list into scene slot 0 or 1. */
  renderScene(slot: 0 | 1, items: DisplayItem[], worldVP: Mat4, screenVP: Mat4, clearColor: string | null = null) {
    const gl = this.gl
    const target = this.scene[slot]!
    this.bindTarget(target)
    if (clearColor) {
      const c = parseColor(clearColor)
      gl.clearColor((c[0] / 255) * c[3], (c[1] / 255) * c[3], (c[2] / 255) * c[3], c[3])
    } else gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (const item of items) {
      if (item.kind === 'flat') {
        const tex = this.upload(item.canvas)
        this.bindTarget(target)
        this.blend('normal')
        this.pTex.use().m4('uMVP', FLAT_MVP).f('uUV', 0, 0, 1, 1).f('uOpacity', 1).f('uShade', 1).i('uTex', 0)
        this.bindTex(0, tex)
        this.draw()
        this.mark('flat')
        continue
      }
      if (item.opacity <= 0.001) continue
      let tex: WebGLTexture | null
      if (item.cacheKey) tex = this.cached(item.cacheKey, item.canvas, item.w, item.h, item.mip)
      else tex = item.canvas ? this.upload(item.canvas, undefined, item.mip) : null
      if (!tex) continue
      let model = item.model
      // uploaded canvases have v=0 at the top; render-target textures have v=0 at the bottom
      let uv: [number, number, number, number] = [0, 0, 1, 1]
      if (item.blur > 0.5) {
        uv = [0, 1, 1, 0]
        const r = this.blurTexture(tex, item.w, item.h, item.blur)
        tex = r.tex
        const [bw, bh] = this.lastBlurSize(item.w, item.h, item.blur)
        // expand the quad so the padded, blurred texture maps onto the right area
        const pu = r.pad / item.w
        const pv = r.pad / item.h
        const su = bw / item.w
        const sv = bh / item.h
        model = multiply(model, multiply(translation(-pu, -pv, 0), scaling(su, sv, 1)))
      }
      this.bindTarget(target)
      this.blend(item.blend)
      const mvp = multiply(item.screen ? screenVP : worldVP, model)
      this.pTex.use().m4('uMVP', mvp).f('uUV', ...uv).f('uOpacity', item.opacity).f('uShade', item.shade).i('uTex', 0)
      this.bindTex(0, tex)
      this.draw()
      this.mark(item.blur > 0.5 ? 'layer+blur' : 'layer')
    }
  }

  /** Size (in source px) covered by the padded blur target for a given blur. */
  private lastBlurSize(w: number, h: number, sigma: number): [number, number] {
    const down = sigma > 24 ? 4 : sigma > 8 ? 2 : 1
    const pad = Math.ceil(sigma * 3)
    const bw = Math.max(4, Math.ceil((w + 2 * pad) / down / 8) * 8)
    const bh = Math.max(4, Math.ceil((h + 2 * pad) / down / 8) * 8)
    return [bw * down, bh * down]
  }

  /**
   * Combine scene slots into the frame target. With no transition the incoming
   * slot (0) is copied. `outgoing` is slot 1.
   */
  composeFrame(transition: { type: TransitionType; p: number; raw: number; dir: [number, number]; color: string; center: [number, number]; seed: number } | null) {
    const gl = this.gl
    if (!transition) {
      // no copy needed: post / accumulation read the scene target directly
      this.current = this.scene[0]!
      return
    }
    this.current = this.frame
    this.bindTarget(this.frame)
    this.blend('none')
    if (transition.type === 'blur') {
      for (const s of this.scene) {
        gl.bindTexture(gl.TEXTURE_2D, s.tex)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      }
    }
    const c = parseColor(transition.color)
    this.bindTarget(this.frame)
    this.pTransition
      .use()
      .i('uA', 0)
      .i('uB', 1)
      .f('uP', transition.p)
      .f('uRaw', transition.raw)
      .i('uType', TRANSITION_IDS[transition.type] ?? 1)
      .f('uDir', transition.dir[0], transition.dir[1])
      .f('uColor', (c[0] / 255) * c[3], (c[1] / 255) * c[3], (c[2] / 255) * c[3], c[3])
      .f('uCenter', transition.center[0], transition.center[1])
      .f('uAspect', this.width / this.height)
      .f('uSeed', transition.seed)
    this.bindTex(0, this.scene[1]!.tex)
    this.bindTex(1, this.scene[0]!.tex)
    this.draw()
    this.mark('transition')
    if (transition.type === 'blur') {
      for (const s of this.scene) {
        gl.bindTexture(gl.TEXTURE_2D, s.tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      }
    }
  }

  // ------------------------------------------------------------ motion blur

  beginAccumulation() {
    const gl = this.gl
    this.bindTarget(this.accum)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.accumCount = 0
  }

  /** Add the current frame target into the accumulation buffer. */
  accumulate() {
    this.bindTarget(this.accum)
    this.blend('add-raw')
    this.pCopy.use().i('uTex', 0).f('uScale', 1)
    this.bindTex(0, this.current.tex)
    this.draw()
    this.accumCount++
  }

  /** Keep a low-resolution copy of the current frame for the adaptive-sampling probe. */
  snapshotProbe(which: 'a' | 'b') {
    const t = which === 'a' ? this.probeA : this.probeB
    this.bindTarget(t)
    this.blend('none')
    this.pCopy.use().i('uTex', 0).f('uScale', 1)
    this.bindTex(0, this.current.tex)
    this.draw()
  }

  /** Mean absolute difference between the two probes (0..1). Used to pick the motion-blur sample count. */
  probeDifference(): number {
    const gl = this.gl
    const t = this.diffT
    this.bindTarget(t)
    this.blend('none')
    this.pDiff.use().i('uA', 0).i('uB', 1).f('uTexel', 1 / t.w, 1 / t.h)
    this.bindTex(0, this.probeA.tex)
    this.bindTex(1, this.probeB.tex)
    this.draw()
    const px = new Uint8Array(t.w * t.h * 4)
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let sum = 0
    let max = 0
    for (let i = 0; i < px.length; i += 4) {
      const v = (px[i]! + px[i + 1]! + px[i + 2]!) / 765
      sum += v
      if (v > max) max = v
    }
    const mean = sum / (t.w * t.h)
    // weight the max so small fast elements (a cursor, a ticker) still get samples
    return Math.max(mean * 4, max * 0.5)
  }

  // ------------------------------------------------------------ post

  private renderBloom(src: WebGLTexture, scale: number, look: Look, unit: number) {
    const gl = this.gl
    if (look.bloom.strength <= 0 || this.bloom.length === 0) return
    this.blend('none')
    let prev = src
    let pw = this.width
    let ph = this.height
    for (let i = 0; i < this.bloom.length; i++) {
      const t = this.bloom[i]!
      this.bindTarget(t)
      this.pDown
        .use()
        .i('uTex', 0)
        // the first pass reads the full-res frame: spread the taps over the 4x4 footprint
        .f('uTexel', (i === 0 ? 2 : 1) / pw, (i === 0 ? 2 : 1) / ph)
        .f('uThreshold', i === 0 ? look.bloom.threshold / Math.max(1e-3, scale) : -1)
        .f('uKnee', 0.25 / Math.max(1e-3, scale))
      this.bindTex(0, prev)
      this.draw()
      prev = t.tex
      pw = t.w
      ph = t.h
    }
    // upsample and accumulate back up the chain
    this.blend('add-raw')
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const src2 = this.bloom[i]!
      const dst = this.bloom[i - 1]!
      this.bindTarget(dst)
      this.pUp
        .use()
        .i('uTex', 0)
        .f('uTexel', 1 / src2.w, 1 / src2.h)
        .f('uRadius', 0.5 + look.bloom.radius * unit)
      this.bindTex(0, src2.tex)
      this.draw()
    }
    gl.disable(gl.BLEND)
  }

  /**
   * Final pass. `source` is 'frame' (single sample) or 'accum' (motion blur).
   * `target` 'screen' draws to the canvas, 'readback' to an RGBA8 target that
   * readPixels() returns top-down.
   */
  post(look: Look, opts: { source: 'frame' | 'accum'; target: 'screen' | 'readback'; seed: number; unit: number; background: string; draft?: boolean }) {
    const gl = this.gl
    const src = opts.source === 'accum' ? this.accum : this.current
    const scale = opts.source === 'accum' ? 1 / Math.max(1, this.accumCount) : 1
    const bloomOn = look.bloom.strength > 0 && this.bloom.length > 0
    this.markStart()
    if (bloomOn) this.renderBloom(src.tex, scale, look, opts.unit)
    this.mark('bloom')
    this.bindTarget(opts.target === 'screen' ? null : this.out)
    this.blend('none')
    const bg = parseColor(opts.background)
    this.pPost
      .use()
      .i('uScene', 0)
      .i('uBloom', 1)
      .f('uScale', scale)
      .f('uBloomStrength', bloomOn ? look.bloom.strength * scale : 0)
      .f('uRes', this.width, this.height)
      .f('uUnit', opts.unit)
      .f('uExposure', look.grade.exposure)
      .f('uContrast', look.grade.contrast)
      .f('uSaturation', look.grade.saturation)
      .f('uTemperature', look.grade.temperature)
      .f('uTint', look.grade.tint)
      .f('uLift', look.grade.lift)
      .f('uVignette', look.vignette.strength)
      .f('uVignetteSoft', look.vignette.softness)
      .f('uAberration', look.aberration)
      .f('uGrain', opts.draft ? 0 : look.grain.amount)
      .f('uGrainSize', look.grain.size)
      .f('uNoiseOffset', (opts.seed * 73) % 256, (opts.seed * 151) % 256)
      .i('uNoise', 2)
      .f('uFlipY', opts.target === 'readback' ? 1 : 0)
      .f('uBackground', bg[0] / 255, bg[1] / 255, bg[2] / 255, 1)
    this.bindTex(0, src.tex)
    this.bindTex(1, bloomOn ? this.bloom[0]!.tex : src.tex)
    this.bindTex(2, this.noise)
    this.draw()
    this.mark('post')
  }

  /** Read the last 'readback' post result as top-down RGBA rows. */
  readPixels(into?: Uint8Array): Uint8Array {
    const gl = this.gl
    const buf = into ?? new Uint8Array(this.width * this.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fbo)
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    return buf
  }

  /** Draw the last readback image to the canvas (used after rendering a still in the preview). */
  presentReadback() {
    this.bindTarget(null)
    this.blend('none')
    this.pCopy.use().i('uTex', 0).f('uScale', 1)
    this.bindTex(0, this.out.tex)
    this.draw()
  }
}
