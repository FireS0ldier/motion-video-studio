import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Args } from '../lib/args.ts'
import { ffmpeg } from '../lib/ffmpeg.ts'
import { color, log } from '../lib/log.ts'
import { ensureDir, readJson, rel, ROOT, SHARED_SFX, writeJson } from '../lib/paths.ts'
import { LIBRARY, normalizePeak, renderMusicBed, SR } from '../lib/sfx-synth.ts'
import { writeWav } from '../lib/wav.ts'

export const sfxHelp = `mvs sfx [--list] [--music] [--only name]

The shared sound-effect library lives in assets/sfx/ (generated from code in
cli/lib/sfx-synth.ts, deterministic, no licensing issues).
  --list     show the sounds with descriptions and peak offsets
  (default)  regenerate all sounds + assets/sfx/library.json
  --music    also regenerate the demo music bed (assets/music/ambient-pulse.ogg)
  --only x   regenerate one sound
Use them in cues: c.cue('whoosh', at, { gain: -3, align: 'peak' }).
Project-specific files in projects/<id>/assets/sfx/ override library sounds with the same name.`

interface LibEntry {
  description: string
  tags: string[]
  peak: number
  duration: number
}

export async function sfxCommand(a: Args) {
  if (a.bool('list')) {
    const lib = readJson<Record<string, LibEntry>>(join(SHARED_SFX, 'library.json')) ?? {}
    for (const [name, e] of Object.entries(lib)) log.info(`${color.cyan(name.padEnd(13))} ${e.duration.toFixed(2)}s  peak ${e.peak.toFixed(2)}s  ${color.gray(e.description)}`)
    return
  }
  ensureDir(SHARED_SFX)
  const only = a.str('only')
  const lib: Record<string, LibEntry> = readJson<Record<string, LibEntry>>(join(SHARED_SFX, 'library.json')) ?? {}
  for (const s of LIBRARY) {
    if (only && s.name !== only) continue
    const ch = normalizePeak(s.render(), s.level)
    const file = join(SHARED_SFX, `${s.name}.wav`)
    writeWav(file, { rate: SR, channels: ch }, 16)
    lib[s.name] = { description: s.description, tags: s.tags, peak: s.peak, duration: Number((ch[0].length / SR).toFixed(3)) }
    log.ok(`${rel(file)}  ${(ch[0].length / SR).toFixed(2)}s`)
  }
  const ordered = Object.fromEntries(LIBRARY.filter((s) => lib[s.name]).map((s) => [s.name, lib[s.name]!]))
  writeJson(join(SHARED_SFX, 'library.json'), ordered)
  if (a.bool('music')) {
    const dir = ensureDir(join(ROOT, 'assets', 'music'))
    const tmp = join(dir, 'ambient-pulse.tmp.wav')
    log.step('Rendering music bed (75 s)')
    writeWav(tmp, { rate: SR, channels: renderMusicBed(75) }, 16)
    const out = join(dir, 'ambient-pulse.ogg')
    await ffmpeg(['-i', tmp, '-c:a', 'libopus', '-b:a', '112k', '-vbr', 'on', '-map_metadata', '-1', '-fflags', '+bitexact', out])
    unlinkSync(tmp)
    log.ok(rel(out))
  }
}
