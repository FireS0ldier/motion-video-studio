/**
 * Interactive preview (http://localhost:5173/?project=<id>).
 *
 * Keys: space play/pause · ←/→ 1 s (shift 5 s) · , . one frame · [ ] previous/next scene ·
 * l loop scene · h hide UI · g safe areas · m motion blur (paused) · q quality ·
 * s save still · w warnings · ? help.  URL: ?t=35 start time, ?scene=<id>, ?scale=0.5
 */

import type { ResolvedProject } from '../core/project.ts'
import { Renderer } from '../core/renderer.ts'
import { Compositor } from '../gl/compositor.ts'
import { listProjects, loadProject, type LoadedProject } from './loader.ts'

const SCENE_COLORS = ['#ff6a3d', '#6d5efc', '#22d3b6', '#fbbf24', '#f472b6', '#38bdf8', '#a3e635', '#fb7185', '#c084fc', '#2dd4bf']

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  for (const c of children) e.append(c)
  return e
}

function fmt(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

const STORE_KEY = 'mvs-preview'

interface Saved {
  project: string
  t: number
  loop: boolean
  scale: number
  safe: boolean
}

function loadSaved(): Partial<Saved> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Partial<Saved>
  } catch {
    return {}
  }
}

export function renderHome(root: HTMLElement) {
  const projects = listProjects()
  const home = el('div', { class: 'home' }, el('h1', {}, 'Motion Video Studio'), el('p', { class: 'muted' }, 'Pick a project to preview:'))
  for (const p of projects) home.append(el('a', { href: `?project=${encodeURIComponent(p)}` }, p))
  if (!projects.length) home.append(el('p', {}, 'No projects yet. Create one with: npx mvs new my-video'))
  root.replaceChildren(home)
}

export async function startPreview(root: HTMLElement, projectId: string, params: URLSearchParams) {
  const saved = loadSaved()
  const sameProject = saved.project === projectId
  let loaded: LoadedProject
  try {
    loaded = await loadProject(projectId)
  } catch (e) {
    root.replaceChildren(el('div', { class: 'error' }, `Could not load project "${projectId}":\n\n${(e as Error).stack ?? e}`))
    throw e
  }
  const project: ResolvedProject = loaded.project
  const { stage, format } = project
  const fps = format.fps

  // ------------------------------------------------------------ DOM
  const sceneSelect = el('select', { title: 'Project' })
  for (const p of listProjects()) {
    const o = el('option', { value: p }, p)
    if (p === projectId) o.selected = true
    sceneSelect.append(o)
  }
  sceneSelect.onchange = () => (location.search = `?project=${encodeURIComponent(sceneSelect.value)}`)
  const timeLabel = el('span', { class: 'mono' })
  const sceneLabel = el('span', { class: 'pill scene' })
  const statsLabel = el('span', { class: 'pill mono' })
  const sourceLabel = el('span', { class: 'pill', title: 'Where the word timing comes from' }, `timing: ${project.timingSource}${project.timingStale ? ' (stale)' : ''}`)
  const warnBtn = el('span', { class: 'pill warn hidden' })
  const qualityBtn = el('button', { title: 'Render resolution (q)' })
  const helpBtn = el('button', { title: 'Shortcuts (?)' }, '?')
  const bar = el(
    'div',
    { class: 'bar' },
    el('span', { class: 'title' }, project.title),
    sceneSelect,
    sceneLabel,
    el('span', { class: 'spacer' }),
    sourceLabel,
    statsLabel,
    warnBtn,
    qualityBtn,
    helpBtn,
  )
  const canvas = el('canvas')
  const safeAction = el('div', { class: 'overlay safe hidden' })
  const safeTitle = el('div', { class: 'overlay safe title hidden' })
  const stageEl = el('div', { class: 'stage' }, canvas, safeAction, safeTitle)
  const playBtn = el('button', { title: 'Play / pause (space)' }, '▶')
  const loopLabel = el('span', { class: 'pill' }, 'loop off')
  const durLabel = el('span', { class: 'mono' }, ` / ${fmt(project.duration)} · ${stage.w}×${stage.h} @ ${fps}`)
  const trackCanvas = el('canvas')
  const track = el('div', { class: 'track' }, trackCanvas)
  const timeline = el('div', { class: 'timeline' }, el('div', { class: 'transport' }, playBtn, timeLabel, durLabel, loopLabel), track)
  const panel = el('div', { class: 'panel hidden' })
  const app = el('div', { id: 'app' }, bar, stageEl, timeline, panel)
  root.replaceChildren(app)

  // ------------------------------------------------------------ renderer
  let scale = Number(params.get('scale') ?? (sameProject ? saved.scale : undefined) ?? 0)
  const fitScale = () => {
    const r = stageEl.getBoundingClientRect()
    const s = Math.min((r.width - 32) / stage.w, (r.height - 32) / stage.h) * devicePixelRatio
    return Math.max(0.25, Math.min(1, Math.round(s * 20) / 20))
  }
  if (!scale) scale = fitScale()
  const compositor = new Compositor(canvas, stage.w * scale, stage.h * scale)
  const renderer = new Renderer(project, compositor, loaded.assets, { scale, quality: 'preview' })
  loaded.assets.prefetch = 8
  loaded.assets.onLoad = () => (dirty = true)
  renderer.onWarn = () => updateWarnings()
  qualityBtn.textContent = `${Math.round(scale * 100)}%`

  // ------------------------------------------------------------ audio
  const audio = new Audio()
  audio.preload = 'auto'
  let audioOffset = 0
  let audioOk = false
  ;(async () => {
    for (const src of loaded.audio) {
      try {
        const res = await fetch(src.url, { method: 'HEAD' })
        if (!res.ok) continue
        audio.src = src.url
        audioOffset = src.offset
        audioOk = true
        sourceLabel.title = `audio: ${src.url}`
        return
      } catch {
        /* try next */
      }
    }
  })()

  // ------------------------------------------------------------ state
  let t = 0
  const startScene = params.get('scene')
  if (params.has('t')) t = Number(params.get('t'))
  else if (startScene) t = project.entries.find((e) => e.id === startScene)?.start ?? 0
  else if (sameProject && saved.t !== undefined) t = saved.t
  t = Math.max(0, Math.min(project.duration - 1 / fps, t))
  let playing = false
  let loop = sameProject ? !!saved.loop : false
  let motionBlur = false
  let dirty = true
  let clockStart = 0
  let clockT = 0
  let safe = sameProject ? !!saved.safe : false
  let lastStats = { ms: 0 }

  const save = () => {
    const s: Saved = { project: projectId, t, loop, scale, safe }
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s))
    const u = new URL(location.href)
    u.searchParams.set('t', t.toFixed(2))
    u.searchParams.delete('scene')
    history.replaceState(null, '', u)
  }
  window.addEventListener('beforeunload', save)

  const entryAt = (time: number) => project.active(time).a
  const frameOf = (time: number) => Math.min(project.frames - 1, Math.max(0, Math.floor(time * fps + 1e-6)))

  const seek = (time: number) => {
    t = Math.max(0, Math.min(project.duration - 1 / fps, time))
    if (playing) startClock()
    dirty = true
  }

  const startClock = () => {
    clockStart = performance.now()
    clockT = t
    if (audioOk) {
      const at = t - audioOffset
      if (at >= 0) {
        audio.currentTime = at
        audio.play().catch(() => (audioOk = false))
      } else audio.pause()
    }
  }

  const play = () => {
    if (playing) return
    if (t >= project.duration - 1 / fps) t = 0
    playing = true
    playBtn.textContent = '❚❚'
    startClock()
  }
  const pause = () => {
    playing = false
    playBtn.textContent = '▶'
    audio.pause()
    dirty = true
    save()
  }
  playBtn.onclick = () => (playing ? pause() : play())

  // ------------------------------------------------------------ timeline drawing
  const words = project.timing.words
  const env = (() => {
    const fx = project.features
    if (!fx.available) return null
    const n = 1200
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = fx.at((i / n) * project.duration).level
    return out
  })()

  const drawTrack = () => {
    const r = track.getBoundingClientRect()
    const dpr = devicePixelRatio
    if (trackCanvas.width !== Math.round(r.width * dpr) || trackCanvas.height !== Math.round(r.height * dpr)) {
      trackCanvas.width = Math.round(r.width * dpr)
      trackCanvas.height = Math.round(r.height * dpr)
    }
    const c = trackCanvas.getContext('2d')!
    const W = r.width
    const H = r.height
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, W, H)
    const x = (time: number) => (time / project.duration) * W
    // scenes
    project.entries.forEach((e, i) => {
      const color = SCENE_COLORS[i % SCENE_COLORS.length]!
      c.fillStyle = color + '33'
      c.fillRect(x(e.start), 0, x(e.end) - x(e.start), 26)
      c.fillStyle = color
      c.fillRect(x(e.start), 0, 2, 26)
      if (e.window) {
        c.fillStyle = 'rgba(255,255,255,0.18)'
        c.fillRect(x(e.window[0]), 0, x(e.window[1]) - x(e.window[0]), 26)
      }
      c.fillStyle = '#e9ebf1'
      c.font = '600 11px system-ui, sans-serif'
      c.save()
      c.beginPath()
      c.rect(x(e.start), 0, x(e.end) - x(e.start) - 4, 26)
      c.clip()
      c.fillText(e.id, x(e.start) + 6, 17)
      c.restore()
    })
    // waveform
    const wy = 52
    if (env) {
      c.fillStyle = 'rgba(255,255,255,0.22)'
      for (let i = 0; i < env.length; i++) {
        const h = env[i]! * 22
        c.fillRect((i / env.length) * W, wy - h, Math.max(1, W / env.length), h * 2)
      }
    }
    // words
    c.font = '10px system-ui, sans-serif'
    let lastX = -1e9
    for (const w of words) {
      const wx = x(w.start)
      c.fillStyle = 'rgba(255,106,61,0.7)'
      c.fillRect(wx, 78, Math.max(1, x(w.end) - wx), 3)
      if (wx - lastX > 34) {
        c.fillStyle = 'rgba(233,235,241,0.75)'
        c.fillText(w.text.slice(0, 12), wx, 93)
        lastX = wx
      }
    }
    // cues
    c.fillStyle = '#22d3b6'
    for (const cue of project.cues) c.fillRect(x(cue.at) - 1, 30, 2, 8)
    // playhead
    c.fillStyle = '#fff'
    c.fillRect(x(t) - 1, 0, 2, H)
  }

  let dragging = false
  const seekFromEvent = (ev: PointerEvent) => {
    const r = track.getBoundingClientRect()
    seek(((ev.clientX - r.left) / r.width) * project.duration)
  }
  track.onpointerdown = (ev) => {
    dragging = true
    track.setPointerCapture(ev.pointerId)
    seekFromEvent(ev)
  }
  track.onpointermove = (ev) => dragging && seekFromEvent(ev)
  track.onpointerup = () => (dragging = false)

  // ------------------------------------------------------------ overlays & panels
  const layoutOverlays = () => {
    const cr = canvas.getBoundingClientRect()
    const sr = stageEl.getBoundingClientRect()
    const k = cr.width / stage.w
    const place = (node: HTMLElement, rect: { x: number; y: number; w: number; h: number }) => {
      node.style.left = `${cr.left - sr.left + rect.x * k}px`
      node.style.top = `${cr.top - sr.top + rect.y * k}px`
      node.style.width = `${rect.w * k}px`
      node.style.height = `${rect.h * k}px`
    }
    place(safeAction, stage.safe)
    place(safeTitle, stage.title)
    safeAction.classList.toggle('hidden', !safe)
    safeTitle.classList.toggle('hidden', !safe)
  }

  const allWarnings = () => [...new Set([...project.warnings, ...renderer.warnings, ...[...loaded.assets.errors.values()]])]
  const updateWarnings = () => {
    const n = allWarnings().length
    warnBtn.textContent = `${n} warning${n === 1 ? '' : 's'}`
    warnBtn.classList.toggle('hidden', n === 0)
  }
  const showPanel = (title: string, items: Array<string | Node>) => {
    const ul = el('ul')
    for (const i of items) ul.append(el('li', {}, i))
    panel.replaceChildren(el('h3', {}, title), ul)
    panel.classList.remove('hidden')
  }
  const togglePanel = (fn: () => void) => (panel.classList.contains('hidden') ? fn() : panel.classList.add('hidden'))
  const help = () =>
    showPanel('Shortcuts', [
      'space — play / pause (audio plays with it)',
      '← → — seek 1 s (shift: 5 s)',
      ', . — one frame back / forward',
      '[ ] — previous / next scene',
      'l — loop the current scene',
      'h — hide the UI',
      'g — safe areas (dashed: action safe, orange: title safe)',
      'm — motion blur preview while paused',
      'q — cycle render resolution',
      's — save a PNG still of this frame',
      'w — warnings',
      'URL: ?project=id&t=12.5 or &scene=<id>&scale=0.5',
    ])
  warnBtn.onclick = () => togglePanel(() => showPanel('Warnings', allWarnings()))
  helpBtn.onclick = () => togglePanel(help)
  updateWarnings()

  const setScale = (s: number) => {
    scale = s
    renderer.setScale(s)
    qualityBtn.textContent = `${Math.round(s * 100)}%`
    dirty = true
  }
  qualityBtn.onclick = () => {
    const options = [...new Set([0.5, fitScale(), 1])].sort((a, b) => a - b)
    setScale(options[(options.indexOf(scale) + 1) % options.length] ?? 1)
  }

  const saveStill = () => {
    renderer.renderFrame(frameOf(t), { samples: 'auto', target: 'screen', time: frameOf(t) / fps })
    canvas.toBlob((b) => {
      if (!b) return
      const a = el('a', { href: URL.createObjectURL(b), download: `${projectId}-${t.toFixed(2)}s.png` })
      a.click()
    })
    dirty = true
  }

  // ------------------------------------------------------------ keys
  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'SELECT') return
    const step = 1 / fps
    const cur = entryAt(t)
    const idx = project.entries.indexOf(cur)
    switch (ev.key) {
      case ' ':
        ev.preventDefault()
        playing ? pause() : play()
        break
      case 'ArrowLeft':
        seek(t - (ev.shiftKey ? 5 : 1))
        break
      case 'ArrowRight':
        seek(t + (ev.shiftKey ? 5 : 1))
        break
      case ',':
        pause()
        seek(frameOf(t) / fps - step)
        break
      case '.':
        pause()
        seek(frameOf(t) / fps + step)
        break
      case '[':
        seek(t - cur.start > 0.3 || idx === 0 ? cur.start : project.entries[idx - 1]!.start)
        break
      case ']':
        if (idx < project.entries.length - 1) seek(project.entries[idx + 1]!.start)
        break
      case 'l':
        loop = !loop
        loopLabel.textContent = loop ? `loop ${cur.id}` : 'loop off'
        break
      case 'h':
        document.body.classList.toggle('hide-ui')
        dirty = true
        break
      case 'g':
        safe = !safe
        layoutOverlays()
        break
      case 'm':
        motionBlur = !motionBlur
        dirty = true
        break
      case 'q':
        qualityBtn.click()
        break
      case 's':
        saveStill()
        break
      case 'w':
        warnBtn.click()
        break
      case '?':
        helpBtn.click()
        break
      case 'Escape':
        panel.classList.add('hidden')
        break
      case 'Home':
      case '0':
        seek(0)
        break
      case 'End':
        seek(project.duration)
        break
    }
  })
  loopLabel.textContent = loop ? `loop ${entryAt(t).id}` : 'loop off'
  window.addEventListener('resize', () => {
    layoutOverlays()
    dirty = true
  })

  // ------------------------------------------------------------ loop
  let loopScene = entryAt(t)
  const tick = () => {
    if (playing) {
      const clock = audioOk && !audio.paused && t >= audioOffset ? audio.currentTime + audioOffset : clockT + (performance.now() - clockStart) / 1000
      // start audio when the playhead reaches the voiceover offset
      if (audioOk && audio.paused && clock >= audioOffset && clock - audioOffset < 0.25) {
        audio.currentTime = Math.max(0, clock - audioOffset)
        audio.play().catch(() => (audioOk = false))
      }
      t = clock
      if (loop) {
        if (t >= loopScene.end || t < loopScene.start - 0.05) seek(loopScene.start)
      } else if (t >= project.duration) {
        t = project.duration - 1 / fps
        pause()
      }
      dirty = true
    } else loopScene = entryAt(t)
    if (dirty) {
      dirty = false
      const frame = frameOf(t)
      const stats = renderer.renderFrame(frame, { samples: !playing && motionBlur ? 'auto' : 1, target: 'screen', time: frame / fps })
      lastStats = stats
      const e = entryAt(t)
      timeLabel.textContent = `${fmt(t)}  f ${frame}`
      sceneLabel.textContent = `${e.id} · ${(t - e.start).toFixed(2)}s`
      statsLabel.textContent = `${lastStats.ms.toFixed(1)} ms${motionBlur && !playing ? ` · mb ${stats.samples}` : ''}`
      drawTrack()
      layoutOverlays()
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  ;(window as unknown as { __MVS_PREVIEW__: unknown }).__MVS_PREVIEW__ = { seek, play, pause, renderer, project }
}
