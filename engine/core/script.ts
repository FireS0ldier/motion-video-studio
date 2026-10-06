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

const ABBREVIATIONS = /\b(e\.g|i\.e|vs|etc|mr|mrs|ms|dr|prof|inc|ltd|z\.b|bzw|ca|usw|d\.h)\.$/i

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

/** Expand a token containing digits to spoken English words; null if not a numeric token. */
export function expandNumberToken(token: string): string[] | null {
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

const SYMBOL_WORDS: Record<string, Record<string, string[]>> = {
  en: { '&': ['and'], '+': ['plus'], '@': ['at'] },
  de: { '&': ['und'], '+': ['plus'], '@': ['at'] },
}

// ---------------------------------------------------------------- tokens

const TOKEN_RE = /\{([^|}]*)\|([^}]*)\}(\S*)|\[pause(?:\s+([\d.]+)\s*(ms|s)?)?\]|(\S+)/g

function splitPunct(token: string): [core: string, trail: string] {
  const m = /^(.*?)([.,!?;:…"'”’)\]]*)$/.exec(token)
  return m ? [m[1]!, m[2]!] : [token, '']
}

function parseSentence(raw: string, language: string): { sentence: ScriptSentence; pause: number } {
  const words: ScriptWord[] = []
  const display: string[] = []
  const tts: string[] = []
  let pause = 0
  const en = language.toLowerCase().startsWith('en')
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
      pause += m[5] === 'ms' ? v / 1000 : v
      continue
    }
    const token = m[6]!
    display.push(token)
    const [core, trail] = splitPunct(token)
    const symbol = SYMBOL_WORDS[language.slice(0, 2)]?.[core]
    if (symbol) {
      words.push({ text: token, norm: normWord(core) || core, spoken: symbol })
      tts.push(token)
      continue
    }
    const norm = normWord(core)
    if (!norm) {
      tts.push(token)
      continue
    }
    const expanded = en ? expandNumberToken(core) : null
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
      const { sentence, pause } = parseSentence(raw, language)
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
