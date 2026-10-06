/**
 * Audio mixer: voiceover + music + sound effects → build/mix.wav
 *
 *  - every source is decoded to 48 kHz stereo float
 *  - music and SFX duck under the voice (sidechain from the voice envelope)
 *  - SFX cues come from the manifest (scene cues, transition defaults, project cue sheet)
 *  - the master is normalized to the target loudness (default -14 LUFS) and peak-limited
 *
 * Deterministic: the same inputs always produce the same file.
 */

import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Cue, Manifest } from '../../engine/core/types.ts'
import type { Args } from '../lib/args.ts'
import { decodeAudio } from '../lib/audio-io.ts'
import { dbToGain, gainToDb, resampleRate, rmsEnvelope, smoothEnvelope } from '../lib/dsp.ts'
import { integratedLoudness, truePeakDb } from '../lib/loudness.ts'
import { log } from '../lib/log.ts'
import { ensureDir, readJson, rel, requireProject, SHARED_SFX, writeJson, type ProjectPaths } from '../lib/paths.ts'
import { openSession } from '../lib/session.ts'
import { writeWav, type Audio } from '../lib/wav.ts'

export const mixHelp = `mvs mix <project> [--force]

Build build/mix.wav from the voiceover, music and SFX cues (ducking + loudness
normalization). Runs automatically before rendering when inputs changed.
Settings live in project.ts → audio: { voiceover, music, sfx, master }.`

const RATE = 48000
const SFX_EXT = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aiff']

interface SfxLibraryEntry {
  peak?: number
  duration?: number
  tags?: string[]
}

export interface MixReport {
  key: string
  duration: number
  lufs: number
  truePeak: number
  gainApplied: number
  voice: string | null
  music: string | null
  cues: number
  missing: string[]
}

export function resolveSound(p: ProjectPaths, sound: string): string | null {
  const candidates: string[] = []
  if (/\.[a-z0-9]+$/i.test(sound)) candidates.push(join(p.dir, sound), join(p.assets, sound), join(p.assets, 'sfx', sound), join(SHARED_SFX, sound))
  for (const ext of SFX_EXT) candidates.push(join(p.assets, 'sfx', sound + ext), join(SHARED_SFX, sound + ext))
  return candidates.find((c) => existsSync(c)) ?? null
}

function fileStamp(f: string | null): string {
  if (!f || !existsSync(f)) return 'none'
  const st = statSync(f)
  return `${f}:${st.size}:${Math.round(st.mtimeMs)}`
}

function mixKey(p: ProjectPaths, m: Manifest): string {
  const files = new Set<string>()
  if (m.audio.voiceover) files.add(join(p.dir, m.audio.voiceover.src))
  if (m.audio.music) files.add(join(p.dir, m.audio.music.src))
  for (const c of m.cues) {
    const f = resolveSound(p, c.sound)
    if (f) files.add(f)
  }
  return createHash('sha1')
    .update(JSON.stringify({ audio: m.audio, cues: m.cues, duration: m.duration, files: [...files].sort().map(fileStamp), v: 2 }))
    .digest('hex')
    .slice(0, 16)
}

function hasAudio(m: Manifest): boolean {
  return !!(m.audio.voiceover || m.audio.music || m.cues.length)
}

/** Add `src` (stereo or mono) into `dst` starting at sample `at`, with gain and equal-power pan. */
function addInto(dst: Float32Array[], src: Float32Array[], at: number, gain: number, pan = 0, envelope?: (i: number) => number) {
  const n = src[0]!.length
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
  const gl = Math.cos(angle) * Math.SQRT2
  const gr = Math.sin(angle) * Math.SQRT2
  const L = src[0]!
  const R = src[1] ?? src[0]!
  for (let i = 0; i < n; i++) {
    const j = at + i
    if (j < 0) continue
    if (j >= dst[0]!.length) break
    const e = envelope ? envelope(j) : 1
    dst[0]![j]! += L[i]! * gain * gl * e
    dst[1]![j]! += R[i]! * gain * gr * e
  }
}

/** Lookahead peak limiter (sample peak): sliding-window minimum → release → moving average. O(n). */
function limit(ch: Float32Array[], ceilingDb: number) {
  const ceiling = dbToGain(ceilingDb)
  const n = ch[0]!.length
  const look = Math.round(0.005 * RATE)
  const release = Math.exp(-1 / (0.12 * RATE))
  const need = new Float32Array(n)
  let any = false
  for (let i = 0; i < n; i++) {
    let p = 0
    for (const c of ch) p = Math.max(p, Math.abs(c[i]!))
    need[i] = p > ceiling ? ceiling / p : 1
    if (need[i]! < 1) any = true
  }
  if (!any) return
  // 1) minimum over [i, i + look] with a monotonic deque
  const winMin = new Float32Array(n)
  const dq = new Int32Array(n + look + 1)
  let head = 0
  let tail = 0
  for (let j = 0; j < n + look; j++) {
    if (j < n) {
      while (tail > head && need[dq[tail - 1]!]! >= need[j]!) tail--
      dq[tail++] = j
    }
    const i = j - look
    if (i >= 0) {
      while (dq[head]! < i) head++
      winMin[i] = need[dq[head]!]!
    }
  }
  // 2) instant attack, exponential release
  let g = 1
  for (let i = 0; i < n; i++) {
    const t = winMin[i]!
    g = t < g ? t : t - (t - g) * release
    winMin[i] = g
  }
  // 3) moving average over the lookahead window: smooth, and still below the need at each peak
  let acc = 0
  const gain = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    acc += winMin[i]!
    if (i > look) acc -= winMin[i - look - 1]!
    gain[i] = acc / Math.min(i + 1, look + 1)
  }
  for (const c of ch) for (let i = 0; i < n; i++) c[i]! *= gain[i]!
}

export async function buildMix(p: ProjectPaths, m: Manifest): Promise<MixReport> {
  const N = Math.ceil(m.duration * RATE)
  const voice = [new Float32Array(N), new Float32Array(N)]
  const music = [new Float32Array(N), new Float32Array(N)]
  const sfx = [new Float32Array(N), new Float32Array(N)]
  const missing: string[] = []
  const a = m.audio

  if (a.voiceover) {
    const file = join(p.dir, a.voiceover.src)
    if (!existsSync(file)) missing.push(a.voiceover.src)
    else {
      const vo = await decodeAudio(file, RATE, 2)
      addInto(voice, vo.channels, Math.round((a.voiceover.offset ?? 0) * RATE), dbToGain(a.voiceover.gain ?? 0))
    }
  }

  // voice presence 0..1 drives ducking
  const hop = 0.01
  const vEnv = smoothEnvelope(rmsEnvelope(voice[0]!, RATE, hop, 0.04), hop, 0.03, 0.35)
  const presence = new Float32Array(vEnv.length)
  for (let i = 0; i < vEnv.length; i++) presence[i] = Math.max(0, Math.min(1, (gainToDb(vEnv[i]!) + 52) / 22))
  const presenceAt = (j: number) => presence[Math.min(presence.length - 1, Math.floor(j / RATE / hop))] ?? 0
  const duckEnv = (db: number) => (j: number) => dbToGain(-db * presenceAt(j))

  if (a.music) {
    const file = join(p.dir, a.music.src)
    if (!existsSync(file)) missing.push(a.music.src)
    else {
      const mu = await decodeAudio(file, RATE, 2)
      const start = Math.round((a.music.offset ?? 0) * RATE)
      const fadeIn = Math.round((a.music.fadeIn ?? 1) * RATE)
      const fadeOut = Math.round((a.music.fadeOut ?? 2) * RATE)
      const len = Math.min(mu.channels[0]!.length, N - start)
      const duck = duckEnv(a.music.duck ?? 10)
      const g = dbToGain(a.music.gain ?? -16)
      addInto(music, mu.channels, start, g, 0, (j) => {
        const i = j - start
        const fin = fadeIn ? Math.min(1, i / fadeIn) : 1
        const fout = fadeOut ? Math.min(1, (Math.min(len, N - start) - i) / fadeOut) : 1
        return Math.max(0, Math.min(fin, fout)) * duck(j)
      })
    }
  }

  const library = readJson<Record<string, SfxLibraryEntry>>(join(SHARED_SFX, 'library.json')) ?? {}
  const sfxGain = dbToGain(a.sfx?.gain ?? -2)
  const sfxDuck = duckEnv(a.sfx?.duck ?? 5)
  const cache = new Map<string, Audio>()
  for (const c of m.cues as Cue[]) {
    const file = resolveSound(p, c.sound)
    if (!file) {
      if (!missing.includes(c.sound)) missing.push(c.sound)
      continue
    }
    let snd = cache.get(file)
    if (!snd) {
      snd = await decodeAudio(file, RATE, 2)
      cache.set(file, snd)
    }
    const rate = c.rate ?? 1
    const chans = rate === 1 ? snd.channels : snd.channels.map((x) => resampleRate(x, rate))
    const name = c.sound.replace(/\.[a-z0-9]+$/i, '')
    const peak = c.align === 'peak' ? (library[name]?.peak ?? 0) / rate : 0
    addInto(sfx, chans, Math.round((c.at - peak) * RATE), sfxGain * dbToGain(c.gain ?? 0), c.pan ?? 0, sfxDuck)
  }

  const master = [new Float32Array(N), new Float32Array(N)]
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) master[c]![i] = voice[c]![i]! + music[c]![i]! + sfx[c]![i]!

  const target = a.master?.lufs ?? -14
  const measured = integratedLoudness(master, RATE)
  const gainDb = measured <= -69 ? 0 : Math.max(-30, Math.min(24, target - measured))
  const g = dbToGain(gainDb)
  for (const c of master) for (let i = 0; i < N; i++) c[i]! *= g
  const ceiling = a.master?.ceiling ?? -1
  limit(master, ceiling - 0.7)
  // limiting lowers loudness a little: one corrective pass toward the target
  if (measured > -69) {
    const after = integratedLoudness(master, RATE)
    const fix = Math.max(-3, Math.min(3, target - after))
    if (Math.abs(fix) > 0.15) {
      const k = dbToGain(fix)
      for (const c of master) for (let i = 0; i < N; i++) c[i]! *= k
      limit(master, ceiling - 0.7)
    }
  }
  // fade the very edges to avoid clicks
  const edge = Math.round(0.004 * RATE)
  for (const c of master) for (let i = 0; i < edge && i < N; i++) {
    c[i]! *= i / edge
    c[N - 1 - i]! *= i / edge
  }
  ensureDir(p.build)
  writeWav(p.mix, { rate: RATE, channels: master }, 24)
  const report: MixReport = {
    key: mixKey(p, m),
    duration: m.duration,
    lufs: Number(integratedLoudness(master, RATE).toFixed(2)),
    truePeak: Number(truePeakDb(master).toFixed(2)),
    gainApplied: Number(gainDb.toFixed(2)),
    voice: a.voiceover?.src ?? null,
    music: a.music?.src ?? null,
    cues: m.cues.length,
    missing,
  }
  writeJson(join(p.build, 'mix.json'), report)
  return report
}

/** Rebuild the mix when its inputs changed. Returns the mix path, or null for silent projects. */
export async function ensureMix(p: ProjectPaths, m: Manifest, force = false): Promise<string | null> {
  if (!hasAudio(m)) return null
  const prev = readJson<MixReport>(join(p.build, 'mix.json'))
  if (!force && prev && existsSync(p.mix) && prev.key === mixKey(p, m)) return p.mix
  log.step('Mixing audio (voice + music + sfx)')
  const r = await buildMix(p, m)
  log.ok(`${rel(p.mix)} · ${r.lufs} LUFS · ${r.truePeak} dBTP · ${r.cues} cues${r.missing.length ? ` · missing: ${r.missing.join(', ')}` : ''}`)
  if (r.missing.length) log.warn(`Missing audio files: ${r.missing.join(', ')} (see docs/audio.md)`)
  return p.mix
}

export async function mixCommand(a: Args) {
  const p = requireProject(a._[0])
  const session = await openSession({ project: p.id, scale: 0.25, quality: 'draft', workers: 1 })
  let manifest: Manifest
  try {
    manifest = session.manifest
  } finally {
    await session.close()
  }
  const out = await ensureMix(p, manifest, a.bool('force', true))
  if (!out) log.warn('This project has no voiceover, music or SFX cues — nothing to mix.')
}
