/**
 * script.md parser. The script is the single source of truth for the words
 * of the voiceover: alignment, TTS, timing lookups and captions all derive
 * from it.
 *
 * Syntax (see docs/script-format.md):
 *
 *   ---
 *   title: Orbit launch film
 *   language: en
 *   voice: am_michael
 *   ---
 *
 *   ## Hook {#hook}
 *   Your product ships every week.
 *   Teams ship {40%|forty percent} faster. [pause 0.4]
 *   > Direction notes start with ">" and are ignored.
 *
 * `{display|spoken}` shows `display` on screen but tells the aligner/TTS what
 * is actually said. `[pause 0.4]` inserts silence when generating a voice.
 */

import { hashText, normWord, slugify } from './text-norm.ts'

export interface ScriptWord {
  /** Display text including punctuation, e.g. "decisions," or "40%". */
  text: string
  norm: string
  /** Spoken tokens (normalized) used for forced alignment. */
  spoken: string[]
}

export interface ScriptSentence {
  /** Display text. */
  text: string
  /** Text sent to a TTS engine (spoken overrides applied). */
  tts: string
  words: ScriptWord[]
  /** Extra pause after this sentence (s), from [pause] markers. */
  pauseAfter: number
}

export interface ScriptSection {
  id: string
  title: string
  sentences: ScriptSentence[]
}

export interface ScriptDoc {
  meta: Record<string, string | number | boolean>
  language: string
  sections: ScriptSection[]
}

export interface FlatScriptWord extends ScriptWord {
  i: number
  section: string
  sentence: number
}

const ABBREVIATIONS = /\b(e\.g|i\.e|vs|etc|mr|mrs|ms|dr|prof|inc|ltd|z\.b|d\.h|u\.a|u\.u|z\.t|bzw|bspw|ca|usw|inkl|zzgl|ggf|evtl|vgl|sog|nr|mio|mrd|tsd)\.$/i

function parseFrontMatter(src: string): { meta: Record<string, string | number | boolean>; body: string } {
  const meta: Record<string, string | number | boolean> = {}
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { meta, body: src }
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line)
    if (!kv) continue
    let v: string | number | boolean = kv[2]!.replace(/^["']|["']$/g, '')
    if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v)
    else if (v === 'true' || v === 'false') v = v === 'true'
    meta[kv[1]!] = v
  }
  return { meta, body: src.slice(m[0].length) }
}

function splitSentences(text: string): string[] {
  const out: string[] = []
  const re = /[^.!?…]*(?:[.!?…]+["'”’)\]]*|$)/g
  let buf = ''
  for (const m of text.matchAll(re)) {
    const piece = m[0]
    if (!piece) continue
    buf += piece
    const trimmed = buf.trim()
    // keep abbreviations and things like "orbit.dev" or "3.5" together
    const next = text[(m.index ?? 0) + piece.length]
    if (next !== undefined && !/\s/.test(next)) continue
    if (ABBREVIATIONS.test(trimmed)) continue
    if (trimmed) out.push(trimmed)
    buf = ''
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

// ---------------------------------------------------------------- numbers -> words (English)

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ORDINAL: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' }

export function intToWords(n: number): string[] {
  if (!Number.isFinite(n)) return []
  if (n < 0) return ['minus', ...intToWords(-n)]
  n = Math.floor(n)
  if (n < 20) return [ONES[n]!]
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)]!, ONES[n % 10]!] : [TENS[n / 10]!]
  if (n < 1000) return [ONES[Math.floor(n / 100)]!, 'hundred', ...(n % 100 ? intToWords(n % 100) : [])]
  const scales: Array<[number, string]> = [
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ]
  for (const [v, name] of scales) {
    if (n >= v) return [...intToWords(Math.floor(n / v)), name, ...(n % v ? intToWords(n % v) : [])]
  }
  return []
}

function yearToWords(n: number): string[] {
  if (n >= 2000 && n < 2010) return intToWords(n)
  const hi = Math.floor(n / 100)
  const lo = n % 100
  if (lo === 0) return [...intToWords(hi), 'hundred']
  return [...intToWords(hi), ...(lo < 10 ? ['oh', ONES[lo]!] : intToWords(lo))]
}

/** Languages whose numbers are expanded to words automatically (others need `{display|spoken}`). */
export function numberLanguage(language: string): 'en' | 'de' | null {
  const l = language.toLowerCase()
  if (l.startsWith('en')) return 'en'
  if (l.startsWith('de')) return 'de'
  return null
}

/**
 * Expand a token containing digits to spoken words; null if not a numeric token.
 * `language` selects English (default) or German rules.
 */
export function expandNumberToken(token: string, language = 'en'): string[] | null {
  if (numberLanguage(language) === 'de') return expandNumberTokenDe(token)
  const t = token.replace(/[’]/g, "'")
  if (!/\d/.test(t)) return null
  let m: RegExpExecArray | null
  if ((m = /^\$(\d[\d,]*(?:\.\d+)?)([kmb])?$/i.exec(t))) return [...numberWords(m[1]!, m[2]), 'dollars']
  if ((m = /^(\d[\d,]*(?:\.\d+)?)%$/.exec(t))) return [...numberWords(m[1]!), 'percent']
  if ((m = /^(\d[\d,]*(?:\.\d+)?)[x×]$/i.exec(t))) return [...numberWords(m[1]!), 'times']
  if ((m = /^(\d+)(st|nd|rd|th)$/i.exec(t))) {
    const w = intToWords(Number(m[1]))
    const last = w[w.length - 1]!
    w[w.length - 1] = ORDINAL[last] ?? (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th')
    return w
  }
  if ((m = /^(\d[\d,]*(?:\.\d+)?)([kmb])$/i.exec(t))) return numberWords(m[1]!, m[2])
  if ((m = /^(\d+)\/(\d+)$/.exec(t))) return [...intToWords(Number(m[1])), ...intToWords(Number(m[2]))]
  if (/^(1[1-9]|20)\d\d$/.test(t)) return yearToWords(Number(t))
  if ((m = /^\d[\d,]*(?:\.\d+)?$/.exec(t))) return numberWords(t)
  // mixed letters/digits: "v2", "M3" -> letters + spoken digits
  const parts = t.match(/\d+|[^\d\W]+/gu)
  if (!parts) return null
  return parts.flatMap((p) => (/^\d+$/.test(p) ? intToWords(Number(p)) : [normWord(p)])).filter(Boolean)
}

function numberWords(num: string, suffix?: string): string[] {
  const clean = num.replace(/,/g, '')
  const [int, frac] = clean.split('.')
  const words = intToWords(Number(int))
  if (frac) words.push('point', ...frac.split('').map((d) => ONES[Number(d)]!))
  const scale = suffix?.toLowerCase()
  if (scale === 'k') words.push('thousand')
  if (scale === 'm') words.push('million')
  if (scale === 'b') words.push('billion')
  return words
}

// ---------------------------------------------------------------- numbers -> words (German)

const DE_ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn']
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig']

/** German cardinal below one million as one compound word ("einundzwanzig", "zweitausendsechsundzwanzig"). */
function deCompound(n: number): string {
  if (n < 20) return DE_ONES[n]!
  if (n < 100) {
    const ones = n % 10
    const tens = DE_TENS[Math.floor(n / 10)]!
    return ones ? (ones === 1 ? 'ein' : DE_ONES[ones]!) + 'und' + tens : tens
  }
  if (n < 1000) {
    const h = Math.floor(n / 100)
    const rest = n % 100
    return (h === 1 ? '' : deCompound(h)) + 'hundert' + (rest ? deCompound(rest) : '')
  }
  const th = Math.floor(n / 1000)
  const rest = n % 1000
  // "eins" becomes "ein" in front of "tausend": einundzwanzigtausend, hunderteintausend
  return (th === 1 ? '' : deCompound(th).replace(/eins$/, 'ein')) + 'tausend' + (rest ? deCompound(rest) : '')
}

/** German cardinal as spoken words: compounds below a million, "zwei Millionen" style above. */
export function intToWordsDe(n: number): string[] {
  if (!Number.isFinite(n)) return []
  if (n < 0) return ['minus', ...intToWordsDe(-n)]
  n = Math.floor(n)
  const scales: Array<[number, string, string]> = [
    [1e9, 'milliarde', 'milliarden'],
    [1e6, 'million', 'millionen'],
  ]
  for (const [v, one, many] of scales) {
    if (n >= v) {
      const k = Math.floor(n / v)
      const rest = n % v
      return [...(k === 1 ? ['eine', one] : [...intToWordsDe(k), many]), ...(rest ? intToWordsDe(rest) : [])]
    }
  }
  return [deCompound(n)]
}

function numberWordsDe(num: string, suffix?: string): string[] {
  // German: "." groups thousands, "," is the decimal separator
  const [int, frac] = num.replace(/\./g, '').split(',')
  const n = Number(int)
  const scale = suffix?.toLowerCase().replace(/\.$/, '')
  if (!frac && scale === 'k' && n * 1000 < 1e6) return [deCompound(n * 1000)]
  const words = intToWordsDe(n)
  if (frac) words.push('komma', ...frac.split('').map((d) => DE_ONES[Number(d)]!))
  if (scale === 'k') words.push('tausend')
  if (scale === 'mio') words.push(n === 1 && !frac ? 'million' : 'millionen')
  if (scale === 'mrd') words.push(n === 1 && !frac ? 'milliarde' : 'milliarden')
  if (n === 1 && !frac && (scale === 'mio' || scale === 'mrd')) words[0] = 'eine'
  return words
}

const DE_NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)`

/** Expand a token containing digits to spoken German words; null if not a numeric token. */
export function expandNumberTokenDe(token: string): string[] | null {
  const t = token.replace(/[’]/g, "'")
  if (!/\d/.test(t)) return null
  let m: RegExpExecArray | null
  if ((m = new RegExp(`^[€$]${DE_NUM}(k|mio\\.?|mrd\\.?)?$`, 'i').exec(t))) return [...numberWordsDe(m[1]!, m[2]), t.startsWith('$') ? 'dollar' : 'euro']
  if ((m = new RegExp(`^${DE_NUM}(k|mio\\.?|mrd\\.?)?[€$]$`, 'i').exec(t))) return [...numberWordsDe(m[1]!, m[2]), t.endsWith('$') ? 'dollar' : 'euro']
  if ((m = new RegExp(`^${DE_NUM}%$`).exec(t))) return [...numberWordsDe(m[1]!), 'prozent']
  if ((m = /^(\d+)[x×]$/i.exec(t))) {
    const n = Number(m[1])
    return n < 1e6 ? [deCompound(n).replace(/eins$/, 'ein') + 'mal'] : [...intToWordsDe(n), 'mal']
  }
  if ((m = new RegExp(`^${DE_NUM}(k|mio\\.?|mrd\\.?)$`, 'i').exec(t))) return numberWordsDe(m[1]!, m[2])
  if ((m = /^(\d+)\/(\d+)$/.exec(t))) return [...intToWordsDe(Number(m[1])), ...intToWordsDe(Number(m[2]))]
  // 1100–1999 without separator reads as a year: neunzehnhundertneunundneunzig
  if (/^1[1-9]\d\d$/.test(t)) {
    const n = Number(t)
    return [deCompound(Math.floor(n / 100)) + 'hundert' + (n % 100 ? deCompound(n % 100) : '')]
  }
  if (new RegExp(`^${DE_NUM}$`).test(t)) return numberWordsDe(t)
  // versions and other dotted numbers that are not thousands: 3.5 → drei punkt fünf
  if (/^\d+(\.\d+)+$/.test(t)) return t.split('.').flatMap((p, i) => [...(i ? ['punkt'] : []), ...intToWordsDe(Number(p))])
  // mixed letters/digits: "v2", "M3" -> letters + spoken digits
  const parts = t.match(/\d+|[^\d\W]+/gu)
  if (!parts) return null
  return parts.flatMap((p) => (/^\d+$/.test(p) ? intToWordsDe(Number(p)) : [normWord(p)])).filter(Boolean)
}

const SYMBOL_WORDS: Record<string, Record<string, string[]>> = {
  en: { '&': ['and'], '+': ['plus'], '@': ['at'], '%': ['percent'] },
  de: { '&': ['und'], '+': ['plus'], '@': ['at'], '%': ['prozent'], '€': ['euro'] },
}

/** Common German abbreviations, spoken in full (keys: lowercase, without the final dot). */
const DE_ABBREVIATIONS: Record<string, string[]> = {
  'z.b': ['zum', 'beispiel'],
  'd.h': ['das', 'heißt'],
  'u.a': ['unter', 'anderem'],
  'u.u': ['unter', 'umständen'],
  'z.t': ['zum', 'teil'],
  bspw: ['beispielsweise'],
  zzgl: ['zuzüglich'],
  evtl: ['eventuell'],
  vgl: ['vergleiche'],
  sog: ['sogenannt'],
  bzw: ['beziehungsweise'],
  ca: ['circa'],
  usw: ['und', 'so', 'weiter'],
  inkl: ['inklusive'],
  ggf: ['gegebenenfalls'],
  nr: ['nummer'],
  mio: ['millionen'],
  mrd: ['milliarden'],
  tsd: ['tausend'],
}

const TLDS = new Set('com net org io dev app ai co de at ch eu uk us fr es it nl info shop tech cloud so xyz me tv gg'.split(' '))

/** "acme.de" → acme punkt de, "orbit.dev" → orbit dot dev (domains are read out, not guessed by the TTS). */
function domainWords(core: string, language: string): string[] | null {
  const lang = numberLanguage(language)
  if (!lang) return null
  const labels = core.toLowerCase().split('.')
  if (labels.length < 2 || !TLDS.has(labels[labels.length - 1]!)) return null
  if (!labels.every((l) => /^[a-z0-9][a-z0-9-]*$/.test(l)) || !/[a-z]/.test(labels[0]!)) return null
  const dot = lang === 'de' ? 'punkt' : 'dot'
  return labels.flatMap((l, i) => [...(i ? [dot] : []), ...(l === 'www' ? ['w', 'w', 'w'] : [l])])
}

/** Spoken words for a symbol or abbreviation token, or null. */
function symbolWords(core: string, language: string): string[] | null {
  const lang = language.slice(0, 2).toLowerCase()
  const symbol = SYMBOL_WORDS[lang]?.[core]
  if (symbol) return symbol
  const abbreviation = lang === 'de' ? DE_ABBREVIATIONS[core.toLowerCase()] : undefined
  if (abbreviation) return abbreviation
  return domainWords(core, language)
}

// ---------------------------------------------------------------- tokens

const TOKEN_RE = /\{([^|}]*)\|([^}]*)\}(\S*)|\[pause(?:\s+([\d.]+)\s*(ms|s)?)?\]|(\S+)/g

function splitPunct(token: string): [core: string, trail: string] {
  const m = /^(.*?)([.,!?;:…"'”’)\]]*)$/.exec(token)
  return m ? [m[1]!, m[2]!] : [token, '']
}

function parseSentence(raw: string, language: string): { sentence: ScriptSentence; pause: number; lead: number } {
  const words: ScriptWord[] = []
  const display: string[] = []
  const tts: string[] = []
  let pause = 0
  let lead = 0
  const numbers = numberLanguage(language)
  for (const m of raw.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) {
      const text = (m[1] + (m[3] ?? '')).trim()
      const spoken = m[2]!.split(/\s+/).map(normWord).filter(Boolean)
      words.push({ text, norm: normWord(m[1]), spoken })
      display.push(text)
      tts.push(m[2]!.trim() + (m[3] ?? ''))
      continue
    }
    if (m[0].startsWith('[pause')) {
      const v = m[4] ? Number(m[4]) : 0.5
      const sec = m[5] === 'ms' ? v / 1000 : v
      // a pause before the first word belongs to the gap after the previous sentence
      if (words.length === 0) lead += sec
      else pause += sec
      continue
    }
    const token = m[6]!
    display.push(token)
    const [core, trail] = splitPunct(token)
    const symbol = symbolWords(core, language)
    if (symbol) {
      words.push({ text: token, norm: normWord(core) || core, spoken: symbol })
      // the TTS reads the words, so every engine says the same thing the aligner expects
      tts.push(symbol.join(' ') + trail.replace(/^\./, ''))
      continue
    }
    const norm = normWord(core)
    if (!norm) {
      tts.push(token)
      continue
    }
    const expanded = numbers ? expandNumberToken(core, numbers) : null
    if (expanded && expanded.length) {
      words.push({ text: token, norm, spoken: expanded })
      tts.push(expanded.join(' ') + trail)
    } else {
      words.push({ text: token, norm, spoken: [norm] })
      tts.push(token)
    }
  }
  return {
    sentence: { text: display.join(' '), tts: tts.join(' '), words, pauseAfter: 0 },
    pause,
    lead,
  }
}

export function parseScript(src: string): ScriptDoc {
  const { meta, body } = parseFrontMatter(src.replace(/\r\n/g, '\n'))
  const language = String(meta.language ?? 'en')
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, '')
  const sections: ScriptSection[] = []
  let current: { id: string; title: string; text: string[] } | null = null
  const flush = () => {
    if (!current) return
    const sentences: ScriptSentence[] = []
    // paragraphs are joined; [pause] markers survive as tokens
    const text = current.text.join(' ').replace(/\s+/g, ' ').trim()
    for (const raw of splitSentences(text)) {
      const { sentence, pause, lead } = parseSentence(raw, language)
      if (lead && sentences.length) sentences[sentences.length - 1]!.pauseAfter += lead
      if (sentence.words.length === 0) {
        // a bare [pause] line extends the pause after the previous sentence
        if (sentences.length) sentences[sentences.length - 1]!.pauseAfter += pause
        continue
      }
      sentence.pauseAfter += pause
      sentences.push(sentence)
    }
    if (sentences.length) {
      if (sections.some((s) => s.id === current!.id)) throw new Error(`script.md: duplicate section id "${current.id}"`)
      sections.push({ id: current.id, title: current.title, sentences })
    }
  }
  for (const line of cleaned.split('\n')) {
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*$/.exec(line)
    if (h) {
      flush()
      const idm = /\{#([A-Za-z0-9_-]+)\}\s*$/.exec(h[1]!)
      const title = h[1]!.replace(/\{#[^}]+\}\s*$/, '').trim()
      current = { id: idm ? idm[1]! : slugify(title) || `section-${sections.length + 1}`, title, text: [] }
      continue
    }
    if (/^\s*>/.test(line)) continue
    if (!current) current = { id: 'main', title: 'Main', text: [] }
    if (line.trim()) current.text.push(line.trim())
  }
  flush()
  return { meta, language, sections }
}

export function flattenWords(doc: ScriptDoc): FlatScriptWord[] {
  const out: FlatScriptWord[] = []
  let sentence = 0
  for (const sec of doc.sections) {
    for (const s of sec.sentences) {
      for (const w of s.words) out.push({ ...w, i: out.length, section: sec.id, sentence })
      sentence++
    }
  }
  return out
}

/** Hash of everything that affects alignment. Changes when the spoken words change. */
export function scriptHash(doc: ScriptDoc): string {
  return hashText(
    doc.sections.map((s) => s.id + ':' + s.sentences.map((x) => x.words.map((w) => w.spoken.join('_')).join(' ')).join('|')).join('\n'),
  )
}

export function scriptWordCount(doc: ScriptDoc): number {
  return doc.sections.reduce((n, s) => n + s.sentences.reduce((m, x) => m + x.words.length, 0), 0)
}
