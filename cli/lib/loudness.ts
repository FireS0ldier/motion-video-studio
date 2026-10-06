/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement (integrated LUFS) and a
 * 4x-oversampled true-peak estimate. Verified against ffmpeg's ebur128 filter
 * in tests/unit/loudness.test.ts.
 */

import { Biquad, gainToDb } from './dsp.ts'

function kWeighting(rate: number): [Biquad, Biquad] {
  // pre-filter (high shelf) and RLB high-pass, bilinear designs from the standard's analog prototypes
  const shelf = new Biquad(rate)
  {
    const f0 = 1681.974450955533
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / rate)
    const Vh = 10 ** (G / 20)
    const Vb = Vh ** 0.4996667741545416
    const a0 = 1 + K / Q + K * K
    shelf.coeffs((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0)
  }
  const hp = new Biquad(rate)
  {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / rate)
    const a0 = 1 + K / Q + K * K
    hp.coeffs(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0)
  }
  return [shelf, hp]
}

/** Integrated loudness (LUFS) of planar audio. Returns -70 for silence. */
export function integratedLoudness(channels: Float32Array[], rate: number): number {
  const n = channels[0]?.length ?? 0
  const block = Math.round(0.4 * rate)
  const hop = Math.round(0.1 * rate)
  if (n < block) return -70
  // K-weighted squared signal summed over channels (L/R weights = 1)
  const pre = new Float64Array(n + 1)
  const sq = new Float64Array(n)
  for (const ch of channels) {
    const [a, b] = kWeighting(rate)
    for (let i = 0; i < n; i++) {
      const y = b.tick(a.tick(ch[i]!))
      sq[i]! += y * y
    }
  }
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + sq[i]!
  const blocks: number[] = []
  for (let s = 0; s + block <= n; s += hop) blocks.push((pre[s + block]! - pre[s]!) / block)
  const lufs = (z: number) => -0.691 + 10 * Math.log10(Math.max(z, 1e-20))
  const abs = blocks.filter((z) => lufs(z) > -70)
  if (!abs.length) return -70
  const relGate = lufs(abs.reduce((s, z) => s + z, 0) / abs.length) - 10
  const gated = abs.filter((z) => lufs(z) > relGate)
  if (!gated.length) return -70
  return lufs(gated.reduce((s, z) => s + z, 0) / gated.length)
}

/** Sample peak in dBFS. */
export function samplePeakDb(channels: Float32Array[]): number {
  let m = 0
  for (const ch of channels) for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]!))
  return gainToDb(m)
}

// 4x polyphase interpolation filter (windowed sinc, 48 taps)
const TP_TAPS = 12
const TP_PHASES = 4
const tpKernel: Float64Array[] = (() => {
  const out: Float64Array[] = []
  for (let ph = 0; ph < TP_PHASES; ph++) {
    const k = new Float64Array(TP_TAPS)
    for (let t = 0; t < TP_TAPS; t++) {
      const x = t - TP_TAPS / 2 + 1 - ph / TP_PHASES
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const w = 0.5 * (1 + Math.cos((Math.PI * x) / (TP_TAPS / 2)))
      k[t] = sinc * w
    }
    out.push(k)
  }
  return out
})()

/** True-peak estimate in dBTP (4x oversampling). */
export function truePeakDb(channels: Float32Array[]): number {
  let m = 0
  for (const ch of channels) {
    for (let i = TP_TAPS; i < ch.length; i++) {
      for (let ph = 0; ph < TP_PHASES; ph++) {
        const k = tpKernel[ph]!
        let s = 0
        for (let t = 0; t < TP_TAPS; t++) s += ch[i - t]! * k[t]!
        const a = Math.abs(s)
        if (a > m) m = a
      }
    }
  }
  return gainToDb(m)
}
