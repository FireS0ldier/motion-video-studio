/**
 * Local text-to-speech engines for `mvs voice`:
 *
 *   kokoro  Kokoro-82M via kokoro-onnx (Apache-2.0): English, Spanish, French, Italian,
 *           Portuguese, Hindi, Japanese, Chinese. Most natural for those languages.
 *   piper   Piper via piper-tts (GPL-3.0, downloaded on demand): German and many other
 *           languages. Also returns exact word timings from the model's phoneme durations.
 *
 * Which engine and voice to use is decided here (pure logic, unit-tested).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from './log.ts'
import { TOOLS } from './paths.ts'

export type TtsEngine = 'kokoro' | 'piper'

export interface PiperVoiceEntry {
  path: string
  onnx: { sha256: string; size: number }
  config: { sha256: string }
  gender: string
  /** License of the voice's own recordings. */
  dataLicense: string
  /** Base model it was fine-tuned from (with that model's data terms). */
  base: string
  dataset: string
  notes?: string
  speakers?: string[]
}

export interface PiperCatalog {
  repo: string
  revision: string
  package: string
  defaults: Record<string, string>
  voices: Record<string, PiperVoiceEntry>
}

let catalog: PiperCatalog | null = null

/** tools/python/piper-voices.json: curated, checksum-pinned Piper voices. */
export function piperCatalog(): PiperCatalog {
  return (catalog ??= JSON.parse(readFileSync(join(TOOLS, 'python', 'piper-voices.json'), 'utf8')) as PiperCatalog)
}

/** Script language → Kokoro language code; null when Kokoro has no voice for it (e.g. German). */
export function kokoroLang(language: string): string | null {
  const l = language.toLowerCase()
  if (l === 'en-gb' || l === 'en_gb') return 'en-gb'
  const map: Record<string, string> = { en: 'en-us', es: 'es', fr: 'fr-fr', it: 'it', pt: 'pt-br', hi: 'hi', ja: 'ja', zh: 'zh' }
  return map[l.slice(0, 2)] ?? null
}

export const isPiperVoice = (v: string) => /^[a-z]{2,3}_[A-Z]{2}-[A-Za-z0-9_]+-(x_low|low|medium|high)$/.test(v)
export const isKokoroVoice = (v: string) => /^[a-z]{2}_[a-z0-9]+$/.test(v)

export interface VoiceRequest {
  /** --engine (auto when missing). */
  engine?: string
  /** --voice, else script front matter `voice:`. */
  voice?: string
  /** Was the voice given on the command line (true) or taken from script.md (false)? */
  voiceFromFlag?: boolean
  /** Script language (front matter `language:`), e.g. 'en', 'de'. */
  language: string
  /** --lang / front matter `lang:` (Kokoro language code). */
  lang?: string
}

export interface VoiceChoice {
  engine: TtsEngine
  voice: string
  /** Kokoro language code (kokoro only). */
  lang?: string
  /** Something the user should know (e.g. a script voice that was replaced). */
  note?: string
}

/**
 * Pick engine and voice:
 *  - an explicit --engine wins;
 *  - a Piper voice id (de_DE-thorsten-high) selects Piper, a Kokoro id (af_heart) selects Kokoro;
 *  - otherwise the language decides: Kokoro where it has voices, Piper for everything else (German).
 */
export function chooseVoice(r: VoiceRequest): VoiceChoice {
  const language = (r.language || 'en').toLowerCase()
  // `lang` (Kokoro's language code) can refine Kokoro, but never switches a German script to it
  const kLang = (r.lang && kokoroLang(r.lang) ? r.lang : null) ?? kokoroLang(language)
  let engine: TtsEngine
  if (r.engine && r.engine !== 'auto') {
    if (r.engine !== 'kokoro' && r.engine !== 'piper') throw new CliError(`Unknown TTS engine "${r.engine}".`, 'Use --engine kokoro or --engine piper.')
    engine = r.engine
  } else if (r.voice && isPiperVoice(r.voice)) engine = 'piper'
  else if (r.voice && isKokoroVoice(r.voice) && r.voiceFromFlag) engine = 'kokoro'
  else engine = kLang ? 'kokoro' : 'piper'

  if (engine === 'kokoro') {
    if (!kLang) throw new CliError(`Kokoro has no voice for "${language}".`, 'German and other languages use Piper: drop --engine/--voice, or pass --voice de_DE-thorsten-high.')
    if (r.voice && isPiperVoice(r.voice)) throw new CliError(`"${r.voice}" is a Piper voice.`, 'Drop --engine kokoro, or pick a Kokoro voice (mvs voice --list).')
    if (r.voice && !isKokoroVoice(r.voice)) {
      if (r.voiceFromFlag) throw new CliError(`"${r.voice}" is not a Kokoro voice id.`, 'Kokoro ids look like am_michael, af_heart, bf_emma (mvs voice --list).')
      return { engine, voice: 'am_michael', lang: kLang, note: `script.md voice "${r.voice}" is not a Kokoro voice; using am_michael` }
    }
    return { engine, voice: r.voice ?? 'am_michael', lang: kLang }
  }
  if (r.voice && isPiperVoice(r.voice)) return { engine, voice: r.voice }
  const fallback = piperCatalog().defaults[language.slice(0, 2)]
  if (!fallback) {
    throw new CliError(`No default Piper voice for "${language}".`, 'Pass a voice id from https://huggingface.co/rhasspy/piper-voices, e.g. --voice nl_NL-mls-medium.')
  }
  const note = r.voice ? `"${r.voice}" is not a ${language} Piper voice; using ${fallback}` : undefined
  if (r.voice && r.voiceFromFlag) throw new CliError(`"${r.voice}" is not a Piper voice id.`, `Use e.g. --voice ${fallback} (mvs voice --list).`)
  return { engine, voice: fallback, note }
}

/** Human-readable list of the curated Piper voices. */
export function formatPiperVoices(): string {
  const c = piperCatalog()
  const rows = Object.entries(c.voices).map(([id, v]) => {
    const def = Object.values(c.defaults).includes(id) ? ' (default)' : ''
    const mb = Math.round(v.onnx.size / 1e6)
    return `  ${(id + def).padEnd(42)} ${v.gender.padEnd(7)} ${String(mb).padStart(4)} MB  ${v.notes ?? ''}`
  })
  return [
    `Piper voices (curated, checksum-pinned; any id from https://huggingface.co/${c.repo} also works):`,
    ...rows,
    '  Recordings are CC0, but the models were fine-tuned from English voices with non-commercial data terms:',
    '  commercial use of the audio is not clearly licensed. Use them for drafts, or check before publishing.',
  ].join('\n')
}
