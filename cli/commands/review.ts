import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Args } from '../lib/args.ts'
import { log } from '../lib/log.ts'
import { encodePng } from '../lib/png.ts'
import { ensureDir, rel, requireProject } from '../lib/paths.ts'
import { openSession } from '../lib/session.ts'
import { prepareAssets } from './assets.ts'

export const reviewHelp = `mvs review <project> [--thumbs 24] [--cols 6]

Visual review pack for humans and agents (open the PNGs to judge the video):
  out/<project>/review/contact.png        grid of thumbnails across the whole video
  out/<project>/review/scene-<id>.png     one half-resolution still per scene (at 60%)
  out/<project>/review/transition-<id>.png  the middle of every transition
Run \`mvs check\` for the problem report.`

export async function reviewCommand(a: Args) {
  const p = requireProject(a._[0])
  const dir = ensureDir(join(p.out, 'review'))
  await prepareAssets(p, { quiet: true })
  // contact sheet at 1/4 scale
  const s1 = await openSession({ project: p.id, scale: 0.25, quality: 'final', workers: 1 })
  try {
    const m = s1.manifest
    const n = Math.max(4, a.num('thumbs', 24)!)
    const times = Array.from({ length: n }, (_, i) => ((i + 0.5) * m.duration) / n)
    const file = join(dir, 'contact.png')
    let png: Buffer | null = null
    const url = s1.sink('contact', (body) => {
      png = body
    })
    const size = await s1.contact(times, a.num('cols', 6)!, url)
    if (png) writeFileSync(file, png)
    log.ok(`${rel(file)} (${size.width}x${size.height}, ${n} frames)`)
  } finally {
    await s1.close()
  }
  // per-scene stills at half scale
  const s2 = await openSession({ project: p.id, scale: 0.5, quality: 'final', workers: 1 })
  try {
    const m = s2.manifest
    const w = Math.round(m.width * 0.5)
    const h = Math.round(m.height * 0.5)
    let target = ''
    const url = s2.sink('still', (body) => writeFileSync(target, encodePng(body, w, h)))
    const shots: Array<[string, number]> = []
    for (const s of m.scenes) {
      shots.push([`scene-${s.id}.png`, s.start + (s.end - s.start) * 0.6])
      if (s.transition) shots.push([`transition-${s.id}.png`, s.start])
    }
    for (const [name, t] of shots) {
      target = join(dir, name)
      const frame = Math.min(m.frames - 1, Math.round(t * m.fps))
      await s2.workers[0]!.send(frame, url, { samples: 'auto', time: frame / m.fps })
      log.ok(rel(target))
    }
  } finally {
    await s2.close()
  }
}
