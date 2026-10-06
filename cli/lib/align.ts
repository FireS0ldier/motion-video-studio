/**
 * Word-level alignment engines.
 *
 *   ctc        known script + wav2vec2 CTC forced alignment (ONNX, CPU, English). Default.
 *   whisperx   WhisperX transcription + alignment, mapped onto the script (multilingual, heavier).
 *   heuristic  no ML: voice-activity detection + syllable-weighted distribution. Always available.
 *   estimate   no audio: speaking-rate estimate from the text (for drafting before a voiceover exists).
 *
 * Every engine produces one span per script word; refineTimes() then fixes
 * gaps, order and CTC's early word ends against the audio energy.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expandNumberToken, flattenWords, type ScriptDoc } from '../../engine/core/script.ts'
import { normWord, syllables } from '../../engine/core/text-norm.ts'
import type { WordTime } from '../../engine/core/timing.ts'
import { ENV_RATE, speechSegments, speechStats } from './analysis.ts'
import { CACHE, ensureDir } from './paths.ts'
import { runPythonTool } from './python.ts'

export type MaybeTime = (WordTime | null)[]

function weights(doc: ScriptDoc): number[] {
  return flattenWords(doc).map((w) => Math.max(1, w.spoken.reduce((n, s) => n + syllables(s), 0)) + 0.6)
}

// ------------------------------------------------------------------ heuristic

/** VAD-based alignment: words spread over detected speech, sentence starts snapped to speech onsets. */
export function heuristicAlign(doc: ScriptDoc, db: Float32Array): WordTime[] {
  const segs = speechSegments(db)
  const flat = flattenWords(doc)
  const w = weights(doc)
  if (!segs.length) throw new Error('no speech detected in the voiceover')
  const speechTotal = segs.reduce((s, [a, b]) => s + (b - a), 0)
  const total = w.reduce((a, b) => a + b, 0)
  // map "speech time" (silences removed) to real time
  const toReal = (st: number) => {
    let acc = 0
    for (const [a, b] of segs) {
      if (st <= acc + (b - a)) return a + (st - acc)
      acc += b - a
    }
    return segs[segs.length - 1]![1]
  }
  const times: WordTime[] = []
  let cum = 0
  for (let i = 0; i < flat.length; i++) {
    const s = toReal((cum / total) * speechTotal)
    cum += w[i]!
    const e = toReal((cum / total) * speechTotal)
    times.push({ start: s, end: Math.max(s + 0.05, e - 0.02) })
  }
  // snap each sentence start to the closest speech-segment start, then re-spread inside the sentence
  const sentences = new Map<number, number[]>()
  flat.forEach((x, i) => sentences.set(x.sentence, [...(sentences.get(x.sentence) ?? []), i]))
  const starts = segs.map((s) => s[0])
  const sentenceStarts: number[] = []
  for (const idx of sentences.values()) {
    const t0 = times[idx[0]!]!.start
    const near = starts.reduce((b, s) => (Math.abs(s - t0) < Math.abs(b - t0) ? s : b), starts[0]!)
    sentenceStarts.push(Math.abs(near - t0) < 0.7 ? near : t0)
  }
  const keys = [...sentences.keys()]
  keys.forEach((k, si) => {
    const idx = sentences.get(k)!
    const a = Math.max(sentenceStarts[si]!, si > 0 ? sentenceStarts[si - 1]! + 0.2 : 0)
    const lastEnd = times[idx[idx.length - 1]!]!.end
    const nextStart = si < keys.length - 1 ? sentenceStarts[si + 1]! : Infinity
    const b = Math.min(Math.max(a + 0.2 * idx.length, lastEnd), nextStart - 0.05)
    const ws = idx.map((i) => w[i]!)
    const tw = ws.reduce((x, y) => x + y, 0)
    let c = 0
    idx.forEach((i, j) => {
      const s = a + ((b - a) * c) / tw
      c += ws[j]!
      const e = a + ((b - a) * c) / tw
      times[i] = { start: s, end: Math.max(s + 0.05, e - 0.015) }
    })
  })
  return times
}

// ------------------------------------------------------------------ ASR → script mapping

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[])
  for (let j = 1; j <= n; j++) d[0]![j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return 1 - d[m]![n]! / Math.max(m, n)
}

export interface AsrWord {
  word: string
  start: number | null
  end: number | null
}

/** Needleman-Wunsch alignment of ASR words onto the script's spoken tokens. */
export function mapAsrToScript(doc: ScriptDoc, asr: AsrWord[]): MaybeTime {
  const flat = flattenWords(doc)
  const tokens: Array<{ norm: string; word: number }> = []
  flat.forEach((w, i) => (w.spoken.length ? w.spoken : [w.norm]).forEach((s) => tokens.push({ norm: normWord(s), word: i })))
  const hyp: Array<{ norm: string; start: number | null; end: number | null }> = []
  for (const a of asr) {
    const n = normWord(a.word)
    const expanded = expandNumberToken(a.word.trim()) ?? (n ? [n] : [])
    expanded.forEach((e, k) => {
      const span = a.start !== null && a.end !== null ? (a.end - a.start) / expanded.length : 0
      hyp.push({ norm: normWord(e), start: a.start !== null ? a.start + span * k : null, end: a.start !== null ? a.start + span * (k + 1) : null })
    })
  }
  const N = tokens.length
  const M = hyp.length
  const GAP = -0.6
  const score = new Float64Array((N + 1) * (M + 1))
  const move = new Uint8Array((N + 1) * (M + 1))
  const at = (i: number, j: number) => i * (M + 1) + j
  for (let i = 1; i <= N; i++) {
    score[at(i, 0)] = i * GAP
    move[at(i, 0)] = 1
  }
  for (let j = 1; j <= M; j++) {
    score[at(0, j)] = j * GAP
    move[at(0, j)] = 2
  }
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const sim = similarity(tokens[i - 1]!.norm, hyp[j - 1]!.norm)
      const diag = score[at(i - 1, j - 1)]! + (sim >= 0.75 ? 1 + sim : sim >= 0.5 ? 0.2 : -1)
      const up = score[at(i - 1, j)]! + GAP
      const left = score[at(i, j - 1)]! + GAP
      if (diag >= up && diag >= left) {
        score[at(i, j)] = diag
        move[at(i, j)] = 0
      } else if (up >= left) {
        score[at(i, j)] = up
        move[at(i, j)] = 1
      } else {
        score[at(i, j)] = left
        move[at(i, j)] = 2
      }
    }
  }
  const match: Array<number | null> = new Array(N).fill(null)
  let i = N
  let j = M
  while (i > 0 || j > 0) {
    const mv = move[at(i, j)]
    if (i > 0 && j > 0 && mv === 0) {
      if (similarity(tokens[i - 1]!.norm, hyp[j - 1]!.norm) >= 0.5) match[i - 1] = j - 1
      i--
      j--
    } else if (i > 0 && (j === 0 || mv === 1)) i--
    else j--
  }
  const out: MaybeTime = new Array(flat.length).fill(null)
  tokens.forEach((t, k) => {
    const h = match[k]
    if (h === null || h === undefined) return
    const hw = hyp[h]!
    if (hw.start === null || hw.end === null) return
    const cur = out[t.word]
    out[t.word] = cur ? { start: Math.min(cur.start, hw.start), end: Math.max(cur.end, hw.end) } : { start: hw.start, end: hw.end }
  })
  return out
}

// ------------------------------------------------------------------ refinement

/**
 * Fill missing words, enforce order, extend CTC's early word ends while the
 * voice is still sounding, pull starts back to the energy onset.
 */
export function refineTimes(doc: ScriptDoc, times: MaybeTime, db: Float32Array | null, duration: number): WordTime[] {
  const w = weights(doc)
  const n = times.length
  const out: WordTime[] = new Array(n)
  // 1) interpolate gaps between known words by syllable weight
  let i = 0
  while (i < n) {
    if (times[i]) {
      out[i] = { ...times[i]! }
      i++
      continue
    }
    let j = i
    while (j < n && !times[j]) j++
    const before = i > 0 ? out[i - 1]!.end : Math.max(0, (times[j]?.start ?? 0.3) - w.slice(i, j).reduce((a, b) => a + b, 0) * 0.18)
    const after = j < n ? times[j]!.start : Math.min(duration, before + w.slice(i, j).reduce((a, b) => a + b, 0) * 0.18)
    const span = Math.max(0.05 * (j - i), after - before)
    const tw = w.slice(i, j).reduce((a, b) => a + b, 0)
    let c = 0
    for (let k = i; k < j; k++) {
      const s = before + (span * c) / tw
      c += w[k]!
      out[k] = { start: s, end: before + (span * c) / tw - 0.01, conf: 0 }
    }
    i = j
  }
  // 2) monotonic
  for (let k = 1; k < n; k++) if (out[k]!.start < out[k - 1]!.start + 0.02) out[k]!.start = out[k - 1]!.start + 0.02
  if (db) {
    const { threshold } = speechStats(db)
    const voiced = (t: number) => (db[Math.max(0, Math.min(db.length - 1, Math.round(t * ENV_RATE)))] ?? -100) > threshold - 4
    for (let k = 0; k < n; k++) {
      const cur = out[k]!
      const nextStart = k < n - 1 ? out[k + 1]!.start : duration
      // 3) extend end while voiced (max +0.35 s, never into the next word)
      let e = Math.max(cur.end, cur.start + 0.06)
      const limit = Math.min(nextStart - 0.01, e + 0.35)
      while (e + 0.01 < limit && voiced(e + 0.01)) e += 0.01
      cur.end = e
      // 4) pull start back to the onset (max 80 ms)
      const prevEnd = k > 0 ? out[k - 1]!.end : 0
      let s = cur.start
      let moved = 0
      while (moved < 0.08 && s - 0.01 > prevEnd + 0.005 && voiced(s - 0.01)) {
        s -= 0.01
        moved += 0.01
      }
      cur.start = s
    }
  }
  for (let k = 0; k < n; k++) {
    const cur = out[k]!
    const nextStart = k < n - 1 ? out[k + 1]!.start : Infinity
    cur.end = Math.max(cur.start + 0.04, Math.min(cur.end, nextStart))
  }
  return out
}

// ------------------------------------------------------------------ engines

export async function ctcAlign(doc: ScriptDoc, pcm16k: Float32Array): Promise<MaybeTime> {
  const dir = ensureDir(join(CACHE, 'align'))
  const audioFile = join(dir, 'audio-16k.f32')
  const tokensFile = join(dir, 'tokens.json')
  const outFile = join(dir, 'ctc.json')
  writeFileSync(audioFile, Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength))
  const flat = flattenWords(doc)
  writeFileSync(tokensFile, JSON.stringify({ words: flat.map((w) => w.spoken.map((s) => s.toUpperCase().replace(/[^A-Z']/g, '')).filter(Boolean)) }))
  await runPythonTool('align_ctc.py', ['--audio', audioFile, '--tokens', tokensFile, '--out', outFile, '--models', join(CACHE, 'models', 'wav2vec2-base-960h')], ['onnxruntime', 'numpy'])
  const res = JSON.parse(readFileSync(outFile, 'utf8')) as { words: Array<WordTime | null> }
  return res.words
}

export async function whisperxAlign(doc: ScriptDoc, audioFile: string, language: string, model: string): Promise<MaybeTime> {
  const dir = ensureDir(join(CACHE, 'align'))
  const outFile = join(dir, 'whisperx.json')
  await runPythonTool('align_whisperx.py', ['--audio', audioFile, '--out', outFile, '--language', language, '--model', model], ['whisperx'], { python: '3.12' })
  const res = JSON.parse(readFileSync(outFile, 'utf8')) as { words: AsrWord[] }
  return mapAsrToScript(doc, res.words)
}

