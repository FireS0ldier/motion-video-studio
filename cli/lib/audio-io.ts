import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegPath } from './ffmpeg.ts'
import { CliError } from './log.ts'
import { CACHE, ensureDir } from './paths.ts'
import type { Audio } from './wav.ts'

/**
 * Decode any audio/video file to planar float PCM at `rate` Hz via ffmpeg.
 * Results are cached in .cache/audio (keyed by path, size, mtime, rate, channels).
 */
export async function decodeAudio(file: string, rate = 48000, channels = 2): Promise<Audio> {
  if (!existsSync(file)) throw new CliError(`Audio file not found: ${file}`)
  const st = statSync(file)
  const key = createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${rate}|${channels}|v1`).digest('hex').slice(0, 20)
  const cacheFile = join(ensureDir(join(CACHE, 'audio')), `${key}.f32`)
  let raw: Buffer
  if (existsSync(cacheFile)) raw = readFileSync(cacheFile)
  else {
    raw = await new Promise<Buffer>((resolve, reject) => {
      const p = spawn(ffmpegPath(), ['-v', 'error', '-i', file, '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(rate), '-'])
      const parts: Buffer[] = []
      let err = ''
      p.stdout.on('data', (d: Buffer) => parts.push(d))
      p.stderr.on('data', (d: Buffer) => (err += d.toString()))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(parts)) : reject(new CliError(`ffmpeg could not decode ${file}: ${err.trim()}`))))
    })
    writeFileSync(cacheFile, raw)
  }
  const frames = Math.floor(raw.length / 4 / channels)
  const inter = new Float32Array(raw.buffer, raw.byteOffset, frames * channels)
  const out = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c]![i] = inter[i * channels + c]!
  return { rate, channels: out }
}
