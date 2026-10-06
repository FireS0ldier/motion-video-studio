import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { parseScript, scriptHash } from '../../engine/core/script.ts'
import type { Args } from '../lib/args.ts'
import { ffmpeg } from '../lib/ffmpeg.ts'
import { CliError, color, log } from '../lib/log.ts'
import { loadManifest } from '../lib/manifest.ts'
import { CACHE, ensureDir, rel, requireProject, type ProjectPaths } from '../lib/paths.ts'
import { runPythonTool } from '../lib/python.ts'
import { chooseVoice, formatPiperVoices, isPiperVoice, piperCatalog } from '../lib/tts.ts'
import { runAlign } from './align.ts'

export const voiceHelp = `mvs voice <project> [--voice <id>] [--engine auto|kokoro|piper] [--speed 1.0] [--out assets/audio/voiceover.wav]

Generate a voiceover from script.md with a local, free TTS engine (CPU, no account):
  kokoro   Kokoro-82M (Apache-2.0): English, Spanish, French, Italian, Portuguese, Hindi, Japanese, Chinese
  piper    Piper (GPL-3.0, downloaded on demand): German and many more languages; also writes exact
           word timing (data/timing.json), so no separate \`mvs align\` is needed
The engine follows the script language (front matter \`language: de\` → Piper) or the voice id.
Good for drafts, placeholders and demos; replace it with a recorded read any time (then \`mvs align\`).
  --voice    Kokoro: af_heart, am_michael, bf_emma, ...   Piper: de_DE-thorsten-high (German default),
             de_DE-thorsten-medium, de_DE-thorsten_emotional-medium, de_DE-kerstin-low
  --speaker  Piper multi-speaker voices, by name: thorsten_emotional → neutral, amused, surprised, whisper, ...
  --speed    speaking rate multiplier (0.8 - 1.3)
  --seed     Piper: sampling seed (default 1). Same script + seed = same read; change it for another take
  --lang     Kokoro language: en-us, en-gb, es, fr-fr, it, pt-br, hi, ja, zh
  --list     print the available voices (--engine piper: only Piper, no download;
             --voice <piper id>: the speakers of that voice)
  --out      write the audio elsewhere (e.g. assets/audio/take2.wav to compare takes); the project's
             timing is only updated when the file is the voiceover the project plays
Front matter in script.md can set voice / speaker / speed / seed / lang; [pause 0.5] adds silence.
Models are downloaded once into .cache/models (Kokoro ~120 MB, a Piper voice 20-115 MB).`

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

export async function voiceCommand(a: Args) {
  if (a.bool('list')) {
    const voice = a.str('voice')
    if (voice && isPiperVoice(voice)) {
      // speakers of one (multi-speaker) Piper voice
      const out = await runPythonTool('tts_piper.py', ['--models', ensureDir(join(CACHE, 'models', 'piper')), '--voice', voice, '--speakers'], [piperCatalog().package])
      log.info(`${voice} speakers (--speaker <name>):\n  ${out.trim().split('\n').join('  ')}`)
      return
    }
    log.info(formatPiperVoices())
    if (a.str('engine') !== 'piper') {
      log.info('\nKokoro voices (prefix = language/gender: a = US English, b = British, e = Spanish, f = French, ...):')
      const out = await runPythonTool('tts_kokoro.py', ['--models', ensureDir(join(CACHE, 'models', 'kokoro')), '--list-voices'], ['kokoro-onnx'])
      const ids = out.trim().split('\n')
      for (let i = 0; i < ids.length; i += 8) log.info('  ' + ids.slice(i, i + 8).join('  '))
    }
    return
  }
  const p = requireProject(a._[0])
  if (!existsSync(p.script)) throw new CliError(`${rel(p.script)} not found.`)
  const doc = parseScript(readFileSync(p.script, 'utf8'))
  const choice = chooseVoice({
    engine: a.str('engine'),
    voice: a.str('voice') ?? (doc.meta.voice !== undefined ? String(doc.meta.voice) : undefined),
    voiceFromFlag: a.has('voice'),
    language: doc.language,
    lang: a.str('lang') ?? (doc.meta.lang !== undefined ? String(doc.meta.lang) : undefined),
  })
  if (choice.note) log.warn(choice.note)
  const speaker = a.str('speaker') ?? (doc.meta.speaker !== undefined ? String(doc.meta.speaker) : undefined)
  const speed = a.num('speed') ?? Number(doc.meta.speed ?? 1)
  const seed = Math.trunc(a.num('seed') ?? Number(doc.meta.seed ?? 1))
  const sentencePause = Number(doc.meta.sentencePause ?? 0.32)
  const sectionPause = Number(doc.meta.sectionPause ?? 0.65)
  const items: Array<{ text: string; pause: number; words: string[] }> = []
  doc.sections.forEach((sec, si) => {
    sec.sentences.forEach((s, k) => {
      const lastInSection = k === sec.sentences.length - 1
      const pause = (lastInSection && si < doc.sections.length - 1 ? sectionPause : sentencePause) + s.pauseAfter
      // per-word TTS text lets the Piper tool map its phonemes back onto script words
      items.push({ text: s.tts, pause, words: s.words.map((w) => w.tts ?? w.text) })
    })
  })
  const work = ensureDir(join(CACHE, 'voice'))
  const scriptJson = join(work, `${p.id}-tts.json`)
  writeFileSync(scriptJson, JSON.stringify(items))
  const raw = join(work, `${p.id}-raw.wav`)
  const report = join(work, `${p.id}-report.json`)

  if (choice.engine === 'piper') {
    const entry = piperCatalog().voices[choice.voice]
    log.step(`Synthesizing ${items.length} sentences with Piper (${choice.voice}${speaker ? `, ${speaker}` : ''}, speed ${speed}, seed ${seed})`)
    if (entry) log.dim(`  voice: ${entry.dataLicense} data, ${entry.base} · engine: piper-tts (GPL-3.0) via uv`)
    const args = ['--script', scriptJson, '--out', raw, '--report', report, '--models', ensureDir(join(CACHE, 'models', 'piper')), '--voice', choice.voice, '--speed', String(speed), '--seed', String(seed)]
    if (speaker) args.push('--speaker', speaker)
    await runPythonTool('tts_piper.py', args, [piperCatalog().package])
  } else {
    if (speaker) log.warn('--speaker only applies to Piper voices; ignored.')
    log.step(`Synthesizing ${items.length} sentences with Kokoro (${choice.voice}, speed ${speed}, ${choice.lang})`)
    const models = ensureDir(join(CACHE, 'models', 'kokoro'))
    await runPythonTool('tts_kokoro.py', ['--script', scriptJson, '--out', raw, '--report', report, '--models', models, '--voice', choice.voice, '--speed', String(speed), '--lang', choice.lang!], ['kokoro-onnx'])
  }

  const out = resolve(p.dir, a.str('out') ?? 'assets/audio/voiceover.wav')
  ensureDir(join(out, '..'))
  // 48 kHz mono, gentle high-pass and de-click; loudness is handled by the mixer
  await ffmpeg(['-i', raw, '-af', 'highpass=f=70,aresample=48000:resampler=soxr', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out])
  log.ok(`${rel(out)} (${choice.engine} · ${choice.voice})`)

  // remember which audio + script the report describes, so `mvs align` can reuse its word timings
  const rep = JSON.parse(readFileSync(report, 'utf8')) as Record<string, unknown>
  Object.assign(rep, { engine: choice.engine, voice: choice.voice, audio: rel(out), audioSha256: sha256(out), scriptHash: scriptHash(doc) })
  const hasWords = Array.isArray(rep.sentences) && (rep.sentences as Array<{ words?: unknown[] }>).some((s) => s.words?.length)
  // the convention path when the project cannot be loaded (the render would fail anyway; keep the timing in step)
  const playing = await projectVoiceover(p).catch(() => resolve(p.dir, 'assets/audio/voiceover.wav'))
  const isProjectVoice = playing !== null && playing === out
  // the project voice's report lives in data/ (committed, survives `mvs clean`), other takes in build/
  const reportFile = isProjectVoice ? join(ensureDir(join(p.dir, 'data')), 'voice.json') : join(ensureDir(p.build), `voice-${basename(out).replace(/\.[^.]+$/, '')}.json`)
  writeFileSync(reportFile, JSON.stringify(rep))

  if (hasWords && isProjectVoice) {
    // Piper knows when every word is spoken: write the timing right away
    await runAlign(p, 'tts', { audio: out })
  } else if (!isProjectVoice) {
    log.dim(`  not the voiceover the project plays${playing ? ` (${rel(playing)})` : ''}: data/timing.json unchanged.`)
    log.dim(`  To use it: audio: { voiceover: { src: '${relative(p.dir, out).split(sep).join('/')}' } } in project.ts, then \`npx mvs align ${p.id}\`${hasWords ? ' (reuses its word timing)' : ''}.`)
  } else {
    log.dim(`  next: ${color.cyan(`npx mvs align ${p.id}`)} (word timing)`)
  }
}

/** Absolute path of the voiceover the project plays (audio.voiceover.src or the auto-detected file), or null. */
async function projectVoiceover(p: ProjectPaths): Promise<string | null> {
  const m = await loadManifest(p)
  const src = m.audio.voiceover?.src
  return src ? resolve(p.dir, src) : null
}
