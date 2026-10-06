import { writeFileSync } from 'node:fs'

/** Planar float audio, samples in -1..1. */
export interface Audio {
  rate: number
  channels: Float32Array[]
}

export function audioLength(a: Audio): number {
  return a.channels[0]?.length ?? 0
}

export function readWav(buf: Buffer): Audio {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let off = 12
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  let data: Buffer | null = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = buf.subarray(off + 8, off + 8 + size)
    if (id === 'fmt ') {
      let format = body.readUInt16LE(0)
      if (format === 0xfffe) format = body.readUInt16LE(24)
      fmt = { format, channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }
    } else if (id === 'data') data = body
    off += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV is missing fmt or data chunk')
  const bytes = fmt.bits / 8
  const frames = Math.floor(data.length / (bytes * fmt.channels))
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = (i * fmt.channels + c) * bytes
      let v: number
      if (fmt.format === 3) v = bytes === 8 ? data.readDoubleLE(p) : data.readFloatLE(p)
      else if (bytes === 2) v = data.readInt16LE(p) / 32768
      else if (bytes === 3) v = data.readIntLE(p, 3) / 8388608
      else if (bytes === 4) v = data.readInt32LE(p) / 2147483648
      else v = (data[p]! - 128) / 128
      channels[c]![i] = v
    }
  }
  return { rate: fmt.rate, channels }
}

/** Encode PCM WAV (16/24-bit integer or 32-bit float). Integer formats use TPDF dither. */
export function encodeWav(a: Audio, bits: 16 | 24 | 32 = 24): Buffer {
  const ch = a.channels.length
  const frames = audioLength(a)
  const bytes = bits / 8
  const float = bits === 32
  const data = Buffer.alloc(frames * ch * bytes)
  // deterministic dither
  let seed = 0x12345678
  const rnd = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  const max = bits === 16 ? 32767 : 8388607
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const p = (i * ch + c) * bytes
      const v = Math.max(-1, Math.min(1, a.channels[c]![i]!))
      if (float) data.writeFloatLE(v, p)
      else {
        const q = Math.max(-max - 1, Math.min(max, Math.round(v * max + (rnd() - rnd()))))
        if (bits === 16) data.writeInt16LE(q, p)
        else data.writeIntLE(q, p, 3)
      }
    }
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(float ? 3 : 1, 20)
  header.writeUInt16LE(ch, 22)
  header.writeUInt32LE(a.rate, 24)
  header.writeUInt32LE(a.rate * ch * bytes, 28)
  header.writeUInt16LE(ch * bytes, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export function writeWav(path: string, a: Audio, bits: 16 | 24 | 32 = 24) {
  writeFileSync(path, encodeWav(a, bits))
}

/** Mono mixdown. */
export function toMono(a: Audio): Float32Array {
  const n = audioLength(a)
  if (a.channels.length === 1) return a.channels[0]!
  const out = new Float32Array(n)
  const k = 1 / a.channels.length
  for (const ch of a.channels) for (let i = 0; i < n; i++) out[i]! += ch[i]! * k
  return out
}
