import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { CheckReport } from '../../engine/player/bridge.ts'
import type { Manifest } from '../../engine/core/types.ts'
import type { Args } from '../lib/args.ts'
import { probe } from '../lib/ffmpeg.ts'
import { color, log } from '../lib/log.ts'
import { rel, requireProject, writeJson, type ProjectPaths } from '../lib/paths.ts'
import { openSession } from '../lib/session.ts'
import { prepareAssets } from './assets.ts'
import { resolveSound } from './mix.ts'

export const checkHelp = `mvs check <project> [--step 0.5] [--strict]

Validates a project and reports problems an agent should fix before rendering:
  static   stale/missing timing, missing voiceover/assets/SFX files, voice longer
           than the video, very short/long scenes, non-deterministic code
           (Math.random, Date.now, timers)
  runtime  renders a frame every --step seconds (low resolution) and reports scene
           crashes, missing voiceover phrases, asset load errors, blank frames,
           text that leaves the frame, and the slowest scenes
Writes out/<project>/check.json. Exit code 1 on errors (and on warnings with --strict).`

interface Finding {
  level: 'error' | 'warn' | 'info'
  message: string
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    if (n === 'build' || n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

async function staticChecks(p: ProjectPaths, m: Manifest): Promise<Finding[]> {
  const f: Finding[] = []
  if (!existsSync(p.script)) f.push({ level: 'warn', message: 'no script.md — voiceover lookups (f.word, cut, section) cannot work' })
  if (m.timing.stale) f.push({ level: 'error', message: 'data/timing.json is stale (script.md changed) — run `mvs align`' })
  if (m.timing.source === 'estimate' && m.audio.voiceover && existsSync(join(p.dir, m.audio.voiceover.src))) f.push({ level: 'warn', message: 'timing is an estimate although a voiceover exists — run `mvs align`' })
  if (m.audio.voiceover) {
    const vo = join(p.dir, m.audio.voiceover.src)
    if (!existsSync(vo)) f.push({ level: 'error', message: `voiceover file missing: ${rel(vo)}` })
    else {
      const info = await probe(vo)
      const end = info.duration + (m.audio.voiceover.offset ?? 0)
      if (end > m.duration + 0.05) f.push({ level: 'error', message: `voiceover ends at ${end.toFixed(2)}s but the video ends at ${m.duration.toFixed(2)}s — the last words would be cut (extend the last scene: end: end(1.2))` })
    }
  }
  if (m.audio.music && !existsSync(join(p.dir, m.audio.music.src))) f.push({ level: 'error', message: `music file missing: ${m.audio.music.src}` })
  const missingSfx = [...new Set(m.cues.map((c) => c.sound).filter((s) => !resolveSound(p, s)))]
  if (missingSfx.length) f.push({ level: 'error', message: `SFX not found: ${missingSfx.join(', ')} (see \`mvs sfx --list\`)` })
  for (const s of m.scenes) {
    const d = s.end - s.start
    if (d < 0.6) f.push({ level: 'warn', message: `scene "${s.id}" lasts only ${d.toFixed(2)}s` })
    if (d > 20) f.push({ level: 'info', message: `scene "${s.id}" lasts ${d.toFixed(1)}s — long static shots feel slow; consider splitting it` })
  }
  // source scan
  const sources = walk(p.dir).filter((x) => /\.(ts|tsx|js)$/.test(x))
  const assetsList = walk(p.assets).map((x) => relative(p.assets, x).replace(/\\/g, '/'))
  const stems = new Set(assetsList.flatMap((x) => [x, x.replace(/\.[^.\/]+$/, '')]))
  for (const file of sources) {
    const src = readFileSync(file, 'utf8')
    const r = rel(file)
    const bad: Array<[RegExp, string]> = [
      [/Math\.random\s*\(/, 'Math.random() — use f.rand() for reproducible frames'],
      [/Date\.now\s*\(|new Date\s*\(/, 'Date — frames must depend only on f.t'],
      [/performance\.now\s*\(/, 'performance.now() — frames must depend only on f.t'],
      [/set(Timeout|Interval)\s*\(/, 'timers — render() must be synchronous and pure'],
    ]
    for (const [re, msg] of bad) if (re.test(src)) f.push({ level: 'warn', message: `${r}: ${msg}` })
    for (const mm of src.matchAll(/\b(?:image|video)\(\s*['"`]([^'"`$]+)['"`]/g)) {
      const ref = mm[1]!.replace(/^\.?\/*(assets\/)?/, '')
      if (!stems.has(ref)) f.push({ level: 'error', message: `${r}: asset "${mm[1]}" not found in ${rel(p.assets)}/` })
    }
  }
  return f
}

function runtimeFindings(m: Manifest, r: CheckReport): Finding[] {
  const f: Finding[] = []
  for (const w of r.warnings) f.push({ level: /threw|crashed|failed/.test(w) ? 'error' : 'warn', message: w })
  for (const e of r.assetErrors) f.push({ level: 'error', message: e })
  if (r.blankFrames.length) {
    const times = r.blankFrames.map((fr) => (fr / m.fps).toFixed(1) + 's')
    f.push({ level: 'warn', message: `uniform (blank-looking) frames at ${times.slice(0, 8).join(', ')}${times.length > 8 ? ' …' : ''}` })
  }
  const seen = new Set<string>()
  for (const t of r.text) {
    const outside = t.box.x < -2 || t.box.y < -2 || t.box.x + t.box.w > m.width + 2 || t.box.y + t.box.h > m.height + 2
    if (!outside || t.box.w <= 0) continue
    const key = `${t.scene}|${t.label}`
    if (seen.has(key)) continue
    seen.add(key)
    f.push({ level: 'warn', message: `[${t.scene}] text "${t.label}" extends outside the frame at ${t.t.toFixed(2)}s` })
  }
  return f
}

export async function checkCommand(a: Args) {
  const p = requireProject(a._[0])
  const step = a.num('step', 0.5)!
  await prepareAssets(p, { quiet: true })
  const session = await openSession({ project: p.id, scale: 0.25, quality: 'draft', workers: 1, verbose: a.bool('verbose') })
  let report: CheckReport
  let m: Manifest
  try {
    m = session.manifest
    log.step(`Rendering ${Math.ceil(m.duration / step)} sample frames (every ${step}s)`)
    report = await session.check(step)
  } finally {
    await session.close()
  }
  const findings = [...(await staticChecks(p, m)), ...runtimeFindings(m, report)]
  const uniq = [...new Map(findings.map((x) => [x.message, x])).values()]
  const icon = { error: color.red('✗'), warn: color.yellow('!'), info: color.gray('i') }
  for (const x of uniq) log.info(`${icon[x.level]} ${x.message}`)
  log.info('')
  log.info(color.gray('  slowest scenes (ms per frame at 1/4 resolution, preview quality):'))
  for (const [id, s] of Object.entries(report.perScene).sort((x, y) => y[1].avgMs - x[1].avgMs).slice(0, 5)) log.info(color.gray(`    ${id.padEnd(16)} avg ${s.avgMs.toFixed(1)}  max ${s.maxMs.toFixed(1)}`))
  writeJson(join(p.out, 'check.json'), { findings: uniq, runtime: report })
  const errors = uniq.filter((x) => x.level === 'error').length
  const warns = uniq.filter((x) => x.level === 'warn').length
  if (errors || (a.bool('strict') && warns)) {
    log.error(`${errors} error(s), ${warns} warning(s) — details in ${rel(join(p.out, 'check.json'))}`)
    process.exitCode = 1
  } else log.ok(`No errors (${warns} warning(s)). ${m.scenes.length} scenes, ${m.duration.toFixed(1)}s.`)
}
