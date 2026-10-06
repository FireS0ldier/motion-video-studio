import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseScript, scriptHash, scriptWordCount, type ScriptDoc } from '../../engine/core/script.ts'
import { buildTiming, estimateTiming } from '../../engine/core/timing.ts'
import type { TimingData, TimingSource } from '../../engine/core/types.ts'
import type { Args } from '../lib/args.ts'
import { decodeAudio } from '../lib/audio-io.ts'
import { ctcAlign, heuristicAlign, refineTimes, ttsAlign, whisperxAlign, type MaybeTime, type TtsReport } from '../lib/align.ts'
import { dbEnvelope } from '../lib/analysis.ts'
import { CliError, log } from '../lib/log.ts'
import { loadManifest } from '../lib/manifest.ts'
import { rel, requireProject, writeJson, type ProjectPaths } from '../lib/paths.ts'
import { findPythonRunner } from '../lib/python.ts'
import { toMono } from '../lib/wav.ts'

export const alignHelp = `mvs align <project> [--engine auto|tts|ctc|whisperx|heuristic|estimate] [--audio file] [--language en]

Word-level timing of the voiceover against script.md → data/timing.json.
  auto       (default) tts when the voiceover came from \`mvs voice\` with Piper and nothing changed since;
             else ctc for English when uv/Python is available, else heuristic; estimate without audio
  tts        word timings reported by the TTS itself (Piper phoneme durations; exact, instant)
  ctc        wav2vec2 CTC forced alignment (CPU, ~95 MB model downloaded once to .cache/models)
  whisperx   WhisperX ASR + alignment mapped onto the script (multilingual; large download; GPU optional)
  heuristic  voice-activity based, no ML (sentence-accurate, word-approximate)
  estimate   no audio needed: timing from speaking rate (to build the video before the voiceover exists)
  --estimate shorthand for --engine estimate
  --wpm 155  speaking rate for estimate
  --model small  WhisperX model size
Scenes look words up by content, so after re-aligning they re-time automatically.`

export async function runAlign(p: ProjectPaths, engineArg: string, opts: { audio?: string; language?: string; wpm?: number; model?: string } = {}): Promise<TimingData> {
  if (!existsSync(p.script)) throw new CliError(`${rel(p.script)} not found.`, 'Write the voiceover script there first (see docs/script-format.md).')
  const doc = parseScript(readFileSync(p.script, 'utf8'))
  if (scriptWordCount(doc) === 0) throw new CliError('script.md contains no words.')
  let audioRel = opts.audio
  if (!audioRel && engineArg !== 'estimate') {
    const m = await loadManifest(p)
    audioRel = m.audio.voiceover?.src
  }
  const audioPath = audioRel ? (existsSync(audioRel) ? audioRel : join(p.dir, audioRel)) : null
  let engine = engineArg
  const language = opts.language ?? String(doc.meta.language ?? 'en')
  if (engine === 'auto') {
    if (!audioPath || !existsSync(audioPath)) engine = 'estimate'
    else if (ttsReportFor(p, audioPath, doc)) engine = 'tts'
    else if (language.startsWith('en') && findPythonRunner()) engine = 'ctc'
    else engine = 'heuristic'
    log.step(`Engine: ${engine}${engine === 'heuristic' && !language.startsWith('en') ? ' (non-English: try --engine whisperx for word accuracy)' : ''}`)
  }
  if (engine === 'estimate') {
    const data = estimateTiming(doc, { wpm: opts.wpm })
    writeJson(p.timing, data)
    log.ok(`${rel(p.timing)} · estimate · ${data.words.length} words · ${data.audioDuration?.toFixed(1)} s`)
    return data
  }
  if (!audioPath || !existsSync(audioPath)) throw new CliError('No voiceover file found.', 'Set audio.voiceover.src in project.ts, pass --audio <file>, or use --engine estimate.')
  log.step(`Decoding ${rel(audioPath)}`)
  const a16 = await decodeAudio(audioPath, 16000, 1)
  const mono = toMono(a16)
  const duration = mono.length / 16000
  const db = dbEnvelope(mono, 16000)
  let times: MaybeTime
  if (engine === 'ctc') {
    if (!language.startsWith('en')) log.warn(`The CTC model is English-only (script language: ${language}). Results may be poor; consider --engine whisperx.`)
    times = await ctcAlign(doc, mono)
  } else if (engine === 'whisperx') {
    times = await whisperxAlign(doc, audioPath, language, opts.model ?? 'small')
  } else if (engine === 'heuristic') {
    times = heuristicAlign(doc, db)
  } else if (engine === 'tts') {
    const rep = ttsReportFor(p, audioPath, doc)
    if (!rep) throw new CliError('No TTS word timing matches this voiceover and script.', 'It is written by `mvs voice` with a Piper voice; the audio or script changed since. Use another --engine.')
    times = ttsAlign(doc, rep)
  } else throw new CliError(`Unknown engine "${engine}".`)
  const missing = times.filter((t) => !t).length
  // TTS timings are exact: only fill gaps and keep order, no energy-based nudging
  const refined = refineTimes(doc, times, engine === 'tts' ? null : db, duration)
  const source: TimingSource = engine as TimingSource
  const data = buildTiming(doc, refined, source, { audio: rel(audioPath).replace(`projects/${p.id}/`, ''), audioDuration: duration })
  writeJson(p.timing, data)
  const lowConf = data.words.filter((w) => w.conf !== undefined && w.conf < 0.25).length
  log.ok(`${rel(p.timing)} · ${engine} · ${data.words.length} words · ${duration.toFixed(1)} s${missing ? ` · ${missing} interpolated` : ''}${lowConf ? ` · ${lowConf} low-confidence` : ''}`)
  for (const s of data.sections) log.dim(`  ${s.id.padEnd(16)} ${s.start.toFixed(2)}–${s.end.toFixed(2)} s`)
  return data
}

export async function alignCommand(a: Args) {
  const p = requireProject(a._[0])
  const engine = a.bool('estimate') ? 'estimate' : (a.str('engine') ?? 'auto')
  await runAlign(p, engine, { audio: a.str('audio'), language: a.str('language'), wpm: a.num('wpm'), model: a.str('model') })
}

/** build/voice.json from `mvs voice`, if it has word timings for exactly this audio file and script. */
export function ttsReportFor(p: ProjectPaths, audioPath: string, doc: ScriptDoc): TtsReport | null {
  const file = join(p.build, 'voice.json')
  if (!existsSync(file)) return null
  try {
    const rep = JSON.parse(readFileSync(file, 'utf8')) as TtsReport
    const sentences = doc.sections.reduce((n, s) => n + s.sentences.length, 0)
    if (rep.scriptHash !== scriptHash(doc) || rep.sentences?.length !== sentences) return null
    if (!rep.sentences.some((s) => s.words?.length)) return null
    if (rep.audioSha256 !== createHash('sha256').update(readFileSync(audioPath)).digest('hex')) return null
    return rep
  } catch {
    return null
  }
}
