import type { Args } from '../lib/args.ts'
import { color, log } from '../lib/log.ts'
import { loadManifest } from '../lib/manifest.ts'
import { requireProject } from '../lib/paths.ts'

export const infoHelp = `mvs info <project> [--json]

Summary of a project as the renderer sees it: format, duration, scenes with
start/end/transition, timing source, audio, SFX cues and warnings.`

export async function infoCommand(a: Args) {
  const p = requireProject(a._[0])
  const m = await loadManifest(p)
  if (a.bool('json')) {
    console.log(JSON.stringify(m, null, 2))
    return
  }
  log.info(`${color.bold(m.title)} (${m.id})`)
  log.info(`  ${m.width}x${m.height} @ ${m.fps} fps · ${m.duration.toFixed(2)} s · ${m.frames} frames`)
  log.info(`  timing: ${m.timing.source}${m.timing.stale ? color.yellow(' (stale)') : ''} · ${m.timing.words} words · voice ${m.timing.voiceStart.toFixed(2)}–${m.timing.voiceEnd.toFixed(2)} s`)
  const au = m.audio
  log.info(`  audio: voice ${au.voiceover?.src ?? '—'}${au.voiceover?.offset ? ` (+${au.voiceover.offset}s)` : ''} · music ${au.music?.src ?? '—'} · ${m.cues.length} sfx cues · target ${au.master?.lufs ?? -14} LUFS`)
  log.info('')
  log.info(color.gray('  scene              start     end     dur   transition'))
  for (const s of m.scenes) {
    const tr = s.transition ? `${s.transition.type} ${s.transition.duration?.toFixed(2)}s${s.transition.direction ? ' ' + s.transition.direction : ''}` : 'cut'
    log.info(`  ${s.id.padEnd(16)} ${s.start.toFixed(2).padStart(7)} ${s.end.toFixed(2).padStart(7)} ${(s.end - s.start).toFixed(2).padStart(7)}   ${tr}`)
  }
  if (m.cues.length) {
    const counts = new Map<string, number>()
    for (const c of m.cues) counts.set(c.sound, (counts.get(c.sound) ?? 0) + 1)
    log.info('')
    log.info(`  sfx: ${[...counts].map(([k, v]) => `${k}×${v}`).join(', ')}`)
  }
  for (const w of m.warnings) log.warn(w)
}
