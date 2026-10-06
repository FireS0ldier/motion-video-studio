import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AudioAnalysisData } from '../../engine/core/types.ts'
import type { Args } from '../lib/args.ts'
import { decodeAudio } from '../lib/audio-io.ts'
import { analyzeMusic, analyzeVoice, ENV_RATE } from '../lib/analysis.ts'
import { CliError, log } from '../lib/log.ts'
import { loadManifest } from '../lib/manifest.ts'
import { rel, requireProject, writeJson, type ProjectPaths } from '../lib/paths.ts'
import { toMono } from '../lib/wav.ts'

export const analyzeHelp = `mvs analyze <project>

Analyze the voiceover (loudness envelope, speech onsets, silences, LUFS) and
the music (envelope, BPM, beat grid) → data/audio.json. Scenes read it via
f.audio.level / f.audio.pulse / f.audio.beat for audio-reactive motion.`

export async function runAnalyze(p: ProjectPaths): Promise<AudioAnalysisData> {
  const m = await loadManifest(p)
  const data: AudioAnalysisData = { version: 1, rate: ENV_RATE, duration: 0 }
  const vo = m.audio.voiceover?.src
  if (vo) {
    const file = join(p.dir, vo)
    if (!existsSync(file)) throw new CliError(`Voiceover not found: ${rel(file)}`)
    const a = await decodeAudio(file, 48000, 1)
    data.voice = analyzeVoice(toMono(a), 48000)
    data.duration = Math.max(data.duration, a.channels[0]!.length / 48000)
    log.ok(`voice: ${data.voice.lufs} LUFS, ${data.voice.onsets.length} onsets, ${data.voice.silences.length} pauses`)
  }
  const mu = m.audio.music?.src
  if (mu) {
    const file = join(p.dir, mu)
    if (!existsSync(file)) throw new CliError(`Music not found: ${rel(file)}`)
    const a = await decodeAudio(file, 48000, 1)
    data.music = analyzeMusic(toMono(a), 48000)
    data.duration = Math.max(data.duration, a.channels[0]!.length / 48000)
    log.ok(`music: ~${data.music.bpm} BPM, ${data.music.beats.length} beats`)
  }
  if (!vo && !mu) log.warn('No voiceover or music configured in project.ts — nothing to analyze.')
  data.duration = Math.round(data.duration * 1000) / 1000
  writeJson(p.analysis, data)
  log.ok(rel(p.analysis))
  return data
}

export async function analyzeCommand(a: Args) {
  await runAnalyze(requireProject(a._[0]))
}
