import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Args } from '../lib/args.ts'
import { CliError, log } from '../lib/log.ts'
import { ensureDir, rel, requireProject } from '../lib/paths.ts'
import { encodePng } from '../lib/png.ts'
import { openSession } from '../lib/session.ts'
import { prepareAssets } from './assets.ts'

export const stillHelp = `mvs still <project> [--t 12.5,40.2] [--scene <id>] [--frame 750] [--scale 1] [--samples auto|1|8] [--out dir]

Render single frames to PNG (final quality, motion blur included).
  --t        timeline seconds (comma separated). With --scene they are relative to the scene start.
  --scene    only this scene; without --t renders it at 15%, 50% and 85%.
  --only     alias of --scene (as in the original workflow guide)
  --frame    frame indices instead of times
  --scale    0.5 = half size, 2 = 4K
  --format   render another format (landscape | vertical | square | ...)`

export async function stillCommand(a: Args) {
  const p = requireProject(a._[0])
  const scale = a.num('scale', 1)!
  const samplesArg = a.str('samples', 'auto')!
  const samples = samplesArg === 'auto' ? 'auto' : Number(samplesArg)
  const outDir = ensureDir(a.str('out') ? join(process.cwd(), a.str('out')!) : join(p.out, 'stills'))
  await prepareAssets(p, { quiet: true })
  const session = await openSession({ project: p.id, scale, quality: 'final', workers: 1, format: a.str('format'), verbose: a.bool('verbose') })
  try {
    const m = session.manifest
    const sceneId = a.str('scene') ?? a.str('only')
    const scene = sceneId ? m.scenes.find((s) => s.id === sceneId) : undefined
    if (sceneId && !scene) throw new CliError(`Scene "${sceneId}" not found.`, `Scenes: ${m.scenes.map((s) => s.id).join(', ')}`)
    let times: number[]
    if (a.str('frame')) times = a.str('frame')!.split(',').map((x) => Number(x) / m.fps)
    else if (a.str('t')) {
      times = a.str('t')!.split(',').map(Number)
      if (scene) times = times.map((t) => scene.start + t)
    } else if (scene) times = [0.15, 0.5, 0.85].map((k) => scene.start + (scene.end - scene.start) * k)
    else times = [m.duration * 0.1, m.duration * 0.5, m.duration * 0.9]
    if (times.some((t) => !Number.isFinite(t))) throw new CliError('Invalid --t / --frame value.')
    const w = Math.round(m.width * scale)
    const h = Math.round(m.height * scale)
    let current = ''
    const url = session.sink('still', (body) => {
      if (body.length !== w * h * 4) throw new Error(`unexpected frame size ${body.length}`)
      writeFileSync(current, encodePng(body, w, h))
    })
    const written: string[] = []
    for (const t of times) {
      const time = Math.max(0, Math.min(m.duration - 1 / m.fps, t))
      const frame = Math.round(time * m.fps)
      const sceneAt = m.scenes.find((s) => time >= s.start && time < s.end)?.id ?? 'end'
      current = join(outDir, `${p.id}_${time.toFixed(2)}s_${sceneAt}${scale !== 1 ? `_x${scale}` : ''}.png`)
      const stats = await session.workers[0]!.send(frame, url, { samples, time: frame / m.fps })
      written.push(current)
      log.ok(`${rel(current)}  ${color(stats.ms)}`)
    }
    const warnings = await session.workers[0]!.page.evaluate(() => window.__MVS__!.warnings())
    for (const w2 of warnings) log.warn(w2)
  } finally {
    await session.close()
  }
}

function color(ms: number) {
  return `(${ms.toFixed(0)} ms)`
}
