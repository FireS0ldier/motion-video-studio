/**
 * Voiceover timing: build timing data from per-word times, estimate timing
 * from a script when no audio exists yet, and look words/phrases up by
 * content at runtime.
 *
 * Content lookups are what make re-timing painless: scenes say "animate when
 * 'faster' is spoken", so a new voiceover read only needs `mvs align`.
 */

import { flattenWords, scriptHash, type ScriptDoc } from './script.ts'
import { normPhrase, syllables } from './text-norm.ts'
import type { Span, TimedSection, TimedSentence, TimedWord, TimingData, TimingSource } from './types.ts'

export interface WordTime {
  start: number
  end: number
  conf?: number
}

/** Assemble TimingData from a parsed script and one time span per script word (same order). */
export function buildTiming(
  doc: ScriptDoc,
  times: WordTime[],
  source: TimingSource,
  extra: { audio?: string; audioDuration?: number } = {},
): TimingData {
  const flat = flattenWords(doc)
  if (flat.length !== times.length) throw new Error(`buildTiming: ${flat.length} script words but ${times.length} times`)
  const round = (v: number) => Math.round(v * 1000) / 1000
  const words: TimedWord[] = flat.map((w, i) => {
    const t = times[i]!
    const tw: TimedWord = {
      i,
      text: w.text,
      norm: w.norm,
      start: round(t.start),
      end: round(Math.max(t.end, t.start + 0.02)),
      section: w.section,
      sentence: w.sentence,
    }
    if (t.conf !== undefined) tw.conf = Math.round(t.conf * 100) / 100
    return tw
  })
  const sentences: TimedSentence[] = []
  const sections: TimedSection[] = []
  let si = 0
  let wi = 0
  for (const sec of doc.sections) {
    const secFirst = wi
    for (const s of sec.sentences) {
      const first = wi
      const last = wi + s.words.length - 1
      sentences.push({ i: si++, text: s.text, start: words[first]!.start, end: words[last]!.end, section: sec.id, first, last })
      wi += s.words.length
    }
    sections.push({ id: sec.id, title: sec.title, start: words[secFirst]!.start, end: words[wi - 1]!.end, first: secFirst, last: wi - 1 })
  }
  const data: TimingData = { version: 1, source, scriptHash: scriptHash(doc), words, sentences, sections }
  if (extra.audio) data.audio = extra.audio
  if (extra.audioDuration !== undefined) data.audioDuration = round(extra.audioDuration)
  return data
}

export interface EstimateOptions {
  /** Speaking rate in words per minute. */
  wpm?: number
  /** Leading silence (s). */
  start?: number
  sentencePause?: number
  sectionPause?: number
  commaPause?: number
}

/**
 * Timing estimate from text alone (no audio). Lets you build and preview the
 * whole video before a voiceover exists; `mvs align` replaces it later.
 */
export function estimateTiming(doc: ScriptDoc, opts: EstimateOptions = {}): TimingData {
  const wpm = opts.wpm ?? Number(doc.meta.wpm ?? 155)
  const sentencePause = opts.sentencePause ?? Number(doc.meta.sentencePause ?? 0.32)
  const sectionPause = opts.sectionPause ?? Number(doc.meta.sectionPause ?? 0.6)
  const commaPause = opts.commaPause ?? 0.16
  // average English word ~1.45 syllables
  const secPerSyllable = 60 / wpm / 1.45
  const times: WordTime[] = []
  let t = opts.start ?? 0.25
  doc.sections.forEach((sec, si) => {
    if (si > 0) t += sectionPause
    sec.sentences.forEach((s, k) => {
      if (k > 0) t += sentencePause
      for (const w of s.words) {
        const syl = w.spoken.reduce((n, x) => n + syllables(x), 0) || 1
        const dur = Math.max(0.12, syl * secPerSyllable)
        times.push({ start: t, end: t + dur * 0.92 })
        t += dur
        if (/[,;:—–]$/.test(w.text)) t += commaPause
      }
      t += s.pauseAfter
    })
  })
  return buildTiming(doc, times, 'estimate', { audioDuration: t + 0.5 })
}

/** Shift all times of a timing data object (e.g. by the voiceover offset). */
export function shiftTiming(data: TimingData, offset: number): TimingData {
  if (!offset) return data
  const s = <T extends { start: number; end: number }>(x: T): T => ({ ...x, start: x.start + offset, end: x.end + offset })
  return { ...data, words: data.words.map(s), sentences: data.sentences.map(s), sections: data.sections.map(s) }
}

export interface FindOptions {
  /** Prefer matches starting at or after this time (timeline seconds). */
  from?: number
  /** Prefer matches starting before this time. */
  to?: number
  /** Pick the n-th match (0-based) within the preferred window. */
  nth?: number
}

/**
 * Runtime index over timing data (already shifted to timeline time).
 * All lookups are cached, so calling them every frame is cheap.
 */
export class Timing {
  readonly words: TimedWord[]
  readonly sentences: TimedSentence[]
  readonly sections: TimedSection[]
  readonly source: TimingSource
  private readonly norms: string[]
  private readonly cache = new Map<string, Span | null>()

  constructor(readonly data: TimingData) {
    this.words = data.words
    this.sentences = data.sentences
    this.sections = data.sections
    this.source = data.source
    this.norms = data.words.map((w) => w.norm)
  }

  get start(): number {
    return this.words[0]?.start ?? 0
  }

  get end(): number {
    return this.words[this.words.length - 1]?.end ?? 0
  }

  /** All start indices where the phrase occurs. */
  matches(phrase: string): number[] {
    const tokens = normPhrase(phrase)
    if (tokens.length === 0) return []
    const out: number[] = []
    outer: for (let i = 0; i + tokens.length <= this.norms.length; i++) {
      for (let k = 0; k < tokens.length; k++) if (this.norms[i + k] !== tokens[k]) continue outer
      out.push(i)
    }
    return out
  }

  /** Time span of a phrase ("Meet Orbit"), or null when not found. */
  find(phrase: string, opts: FindOptions = {}): Span | null {
    const key = `${phrase}\u0000${opts.from ?? ''}\u0000${opts.to ?? ''}\u0000${opts.nth ?? 0}`
    if (this.cache.has(key)) return this.cache.get(key)!
    const n = normPhrase(phrase).length
    const all = this.matches(phrase)
    let pick: number | undefined
    if (all.length) {
      const nth = opts.nth ?? 0
      const from = opts.from ?? -Infinity
      const to = opts.to ?? Infinity
      const inWindow = all.filter((i) => this.words[i]!.start >= from - 0.5 && this.words[i]!.start < to + 0.25)
      pick = inWindow.length ? inWindow[Math.min(nth, inWindow.length - 1)] : all[Math.min(nth, all.length - 1)]
    }
    const span: Span | null =
      pick === undefined
        ? null
        : {
            start: this.words[pick]!.start,
            end: this.words[pick + n - 1]!.end,
            text: this.words
              .slice(pick, pick + n)
              .map((w) => w.text)
              .join(' '),
          }
    this.cache.set(key, span)
    return span
  }

  /** The sentence containing the phrase. */
  sentence(phrase: string, opts: FindOptions = {}): TimedSentence | null {
    const span = this.find(phrase, opts)
    if (!span) return null
    return this.sentences.find((s) => s.start <= span.start + 1e-6 && s.end >= span.start - 1e-6) ?? null
  }

  section(id: string): TimedSection | null {
    return this.sections.find((s) => s.id === id) ?? null
  }

  /** Words overlapping [from, to). */
  wordsBetween(from: number, to: number): TimedWord[] {
    return this.words.filter((w) => w.end > from && w.start < to)
  }

  /** The word being spoken at time t (or null in pauses). */
  wordAt(t: number): TimedWord | null {
    let lo = 0
    let hi = this.words.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const w = this.words[mid]!
      if (t < w.start) hi = mid - 1
      else if (t >= w.end) lo = mid + 1
      else return w
    }
    return null
  }

  /** Index of the last word that started at or before t (-1 before the first word). */
  lastWordIndex(t: number): number {
    let lo = 0
    let hi = this.words.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.words[mid]!.start <= t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  /**
   * A good cut point before the phrase: `lead` seconds before its first word,
   * but never before the end of the previous word (cuts live in the pause).
   */
  cutBefore(phrase: string, lead = 0.15, opts: FindOptions = {}): number | null {
    const span = this.find(phrase, opts)
    if (!span) return null
    return this.cutAt(span.start, lead)
  }

  cutAt(wordStart: number, lead = 0.15): number {
    const idx = this.words.findIndex((w) => Math.abs(w.start - wordStart) < 1e-6)
    const prevEnd = idx > 0 ? this.words[idx - 1]!.end : -Infinity
    const gap = wordStart - prevEnd
    const t = gap > 2 * lead ? wordStart - lead : Math.max(prevEnd + gap * 0.5, wordStart - lead)
    return Math.max(0, t)
  }
}
