import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseScript } from '../../engine/core/script.ts'
import type { Args } from '../lib/args.ts'
import { ffmpeg } from '../lib/ffmpeg.ts'
import { CliError, log } from '../lib/log.ts'
import { CACHE, ensureDir, rel, requireProject } from '../lib/paths.ts'
import { runPythonTool } from '../lib/python.ts'

export const voiceHelp = `mvs voice <project> [--voice am_michael] [--speed 1.0] [--lang en-us] [--out assets/audio/voiceover.wav]

Generate a voiceover from script.md with Kokoro-82M (local, free, CPU, Apache-2.0).
Good for drafts, placeholders and demos; replace it with a recorded or ElevenLabs
read any time (then run \`mvs align\`).
  --voice    af_heart, af_bella, af_nicole, am_michael, am_fenrir, bf_emma, bm_george, ... (--list)
  --speed    speaking rate multiplier (0.8 - 1.3)
  --lang     en-us, en-gb, es, fr-fr, it, pt-br, hi, ja, zh (no German)
  --list     print available voices
Front matter in script.md can set voice / speed / lang; [pause 0.5] adds silence.
Model files (~120 MB) are downloaded once into .cache/models/kokoro.`

export async function voiceCommand(a: Args) {
  const p = requireProject(a._[0])
  const models = ensureDir(join(CACHE, 'models', 'kokoro'))
  if (a.bool('list')) {
    const out = await runPythonTool('tts_kokoro.py', ['--models', models, '--list-voices'], ['kokoro-onnx'])
    log.info(out.trim())
    return
  }
  if (!existsSync(p.script)) throw new CliError(`${rel(p.script)} not found.`)
  const doc = parseScript(readFileSync(p.script, 'utf8'))
  const sentencePause = Number(doc.meta.sentencePause ?? 0.32)
  const sectionPause = Number(doc.meta.sectionPause ?? 0.65)
  const items: Array<{ text: string; pause: number }> = []
  doc.sections.forEach((sec, si) => {
    sec.sentences.forEach((s, k) => {
      const lastInSection = k === sec.sentences.length - 1
      const pause = (lastInSection && si < doc.sections.length - 1 ? sectionPause : sentencePause) + s.pauseAfter
      items.push({ text: s.tts, pause })
    })
  })
  const voice = a.str('voice') ?? String(doc.meta.voice ?? 'am_michael')
  const speed = a.num('speed') ?? Number(doc.meta.speed ?? 1)
  const lang = a.str('lang') ?? String(doc.meta.lang ?? (String(doc.meta.language ?? 'en').startsWith('en') ? 'en-us' : doc.meta.language))
  const work = ensureDir(join(CACHE, 'voice'))
  const scriptJson = join(work, `${p.id}-tts.json`)
  writeFileSync(scriptJson, JSON.stringify(items))
  const raw = join(work, `${p.id}-raw.wav`)
  const report = join(p.build, 'voice.json')
  ensureDir(p.build)
  log.step(`Synthesizing ${items.length} sentences with Kokoro (${voice}, speed ${speed}, ${lang})`)
  await runPythonTool('tts_kokoro.py', ['--script', scriptJson, '--out', raw, '--report', report, '--models', models, '--voice', voice, '--speed', String(speed), '--lang', lang], ['kokoro-onnx'])
  const out = join(p.dir, a.str('out') ?? 'assets/audio/voiceover.wav')
  ensureDir(join(out, '..'))
  // 48 kHz mono, gentle high-pass and de-click; loudness is handled by the mixer
  await ffmpeg(['-i', raw, '-af', 'highpass=f=70,aresample=48000:resampler=soxr', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out])
  log.ok(`${rel(out)} — next: \`mvs align ${p.id}\``)
  if (!a.str('out')) log.dim(`  make sure project.ts has  audio: { voiceover: { src: 'assets/audio/voiceover.wav' } }`)
}
