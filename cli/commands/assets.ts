import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { frameDirName } from '../../engine/assets/store.ts'
import type { Args } from '../lib/args.ts'
import { ffmpeg, probe } from '../lib/ffmpeg.ts'
import { log } from '../lib/log.ts'
import { ensureDir, readJson, rel, requireProject, writeJson, type ProjectPaths } from '../lib/paths.ts'

export const assetsHelp = `mvs assets <project> [--force]

Scan projects/<project>/assets/ and prepare everything for rendering:
  - screen recordings (mp4/mov/webm/mkv) → frame sequences in build/frames/ (frame-exact playback)
  - images → size report (warns about missing or oversized files)
Per-recording options: put a JSON next to the video, e.g. demo.mp4.json: { "fps": 60, "maxWidth": 2560 }
Runs automatically before dev/still/render.`

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i
const IMAGE = /\.(png|jpe?g|webp|avif|gif|svg)$/i

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

interface FrameMeta {
  fps: number
  frames: number
  width: number
  height: number
  duration: number
  pattern: string
  source: string
  sourceSize: number
  sourceMtime: number
  maxWidth: number
}

export async function prepareAssets(p: ProjectPaths, o: { force?: boolean; quiet?: boolean } = {}) {
  const files = walk(p.assets)
  const videos = files.filter((f) => VIDEO.test(f) && !relative(p.assets, f).startsWith('audio'))
  for (const file of videos) {
    const relPath = relative(p.assets, file).replace(/\\/g, '/')
    const dir = join(p.frames, frameDirName(relPath))
    const st = statSync(file)
    const opts = readJson<{ fps?: number; maxWidth?: number }>(file + '.json') ?? {}
    const fpsWanted = opts.fps ?? 30
    const maxWidth = opts.maxWidth ?? 1920
    const meta = readJson<FrameMeta>(join(dir, 'meta.json'))
    if (!o.force && meta && meta.sourceSize === st.size && Math.abs(meta.sourceMtime - st.mtimeMs) < 1 && meta.fps === fpsWanted && meta.maxWidth === maxWidth) continue
    log.step(`Extracting frames of ${relPath}`)
    const info = await probe(file)
    if (!info.video) {
      log.warn(`${relPath} has no video stream — skipped`)
      continue
    }
    const fps = Math.min(fpsWanted, Math.round(info.video.fps) || fpsWanted)
    rmSync(dir, { recursive: true, force: true })
    ensureDir(dir)
    await ffmpeg(['-i', file, '-an', '-vf', `fps=${fps},scale='min(iw,${maxWidth})':-2:flags=lanczos`, '-q:v', '2', '-start_number', '1', join(dir, '%06d.jpg')])
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).length
    const first = await probe(join(dir, '000001.jpg'))
    const m: FrameMeta = {
      fps,
      frames,
      width: first.video?.width ?? 0,
      height: first.video?.height ?? 0,
      duration: frames / fps,
      pattern: '%06d.jpg',
      source: relPath,
      sourceSize: st.size,
      sourceMtime: st.mtimeMs,
      maxWidth,
    }
    writeJson(join(dir, 'meta.json'), m)
    log.ok(`${relPath}: ${frames} frames @ ${fps} fps, ${m.width}x${m.height}`)
  }
  if (!o.quiet) {
    const images = files.filter((f) => IMAGE.test(f))
    for (const f of images) {
      const size = statSync(f).size
      if (size > 15 * 1024 * 1024) log.warn(`${rel(f)} is ${(size / 1048576).toFixed(1)} MB — consider downscaling/compressing it`)
      if (!f.endsWith('.svg')) {
        const info = await probe(f).catch(() => null)
        if (info?.video && Math.max(info.video.width, info.video.height) > 5000) log.warn(`${rel(f)} is ${info.video.width}x${info.video.height} — larger than useful, it slows loading`)
      }
    }
    log.ok(`${images.length} image(s), ${videos.length} recording(s) ready in ${rel(p.assets)}`)
  }
}

export async function assetsCommand(a: Args) {
  const p = requireProject(a._[0])
  await prepareAssets(p, { force: a.bool('force') })
}
