/**
 * End-to-end: scaffold a project, render stills and a draft video, verify
 * dimensions, audio, determinism and the check command. Needs Chromium + ffmpeg.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')
const ID = `e2e-${process.pid}`
const OUT = join(ROOT, 'out', ID)

function mvs(...args: string[]) {
  const r = spawnSync(process.execPath, [join(ROOT, 'cli', 'bin.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', MVS_WORKERS: '2' } })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function probe(file: string) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' })
  return JSON.parse(r.stdout) as { format: { duration: string }; streams: Array<{ codec_type: string; width?: number; height?: number; r_frame_rate?: string }> }
}

/** The single PNG written into an output folder. */
const onlyPng = (dir: string) => {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []
  expect(files.length, `PNGs in ${dir}`).toBe(1)
  return join(dir, files[0]!)
}

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')

/** Decode a PNG to raw RGB with ffmpeg and return the spread between darkest and brightest pixel. */
function pngContrast(file: string): number {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 * 1024 * 1024 })
  const px = r.stdout as Buffer
  let min = 255
  let max = 0
  for (let i = 0; i < px.length; i += 7) {
    min = Math.min(min, px[i]!)
    max = Math.max(max, px[i]!)
  }
  return max - min
}

describe('render pipeline', () => {
  beforeAll(() => {
    const r = mvs('new', ID, '--title', 'E2E Test')
    expect(r.code, r.out).toBe(0)
  })
  afterAll(() => {
    rmSync(join(ROOT, 'projects', ID), { recursive: true, force: true })
    rmSync(OUT, { recursive: true, force: true })
  })

  it('renders a still with the expected size and real content', () => {
    const r = mvs('still', ID, '--t', '13', '--scale', '0.25', '--out', `out/${ID}/a`)
    expect(r.code, r.out).toBe(0)
    const file = onlyPng(join(OUT, 'a'))
    const s = probe(file).streams[0]!
    expect([s.width, s.height]).toEqual([480, 270])
    expect(pngContrast(file)).toBeGreaterThan(60)
  })

  it('is deterministic: the same frame renders to identical bytes', () => {
    const a = mvs('still', ID, '--t', '4.2', '--scale', '0.25', '--out', `out/${ID}/d1`)
    const b = mvs('still', ID, '--t', '4.2', '--scale', '0.25', '--out', `out/${ID}/d2`)
    expect(a.code, a.out).toBe(0)
    expect(b.code, b.out).toBe(0)
    expect(sha(onlyPng(join(OUT, 'd1')))).toBe(sha(onlyPng(join(OUT, 'd2'))))
  })

  it('renders other formats from the same project', () => {
    const r = mvs('still', ID, '--t', '20', '--scale', '0.25', '--format', 'vertical', '--out', `out/${ID}/v`)
    expect(r.code, r.out).toBe(0)
    const file = onlyPng(join(OUT, 'v'))
    expect([probe(file).streams[0]!.width, probe(file).streams[0]!.height]).toEqual([270, 480])
  })

  it('renders a draft video with audio, reproducibly', () => {
    const out1 = `out/${ID}/draft1.mp4`
    const out2 = `out/${ID}/draft2.mp4`
    const a = mvs('render', ID, '--draft', '--from', '11', '--to', '14', '--out', out1)
    expect(a.code, a.out).toBe(0)
    const info = probe(join(ROOT, out1))
    const v = info.streams.find((s) => s.codec_type === 'video')!
    expect([v.width, v.height, v.r_frame_rate]).toEqual([960, 540, '30/1'])
    expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(true)
    expect(Number(info.format.duration)).toBeCloseTo(3, 0)
    const b = mvs('render', ID, '--draft', '--from', '11', '--to', '14', '--out', out2, '--workers', '1')
    expect(b.code, b.out).toBe(0)
    expect(sha(join(ROOT, out1))).toBe(sha(join(ROOT, out2)))
  })

  it('passes mvs check', () => {
    const r = mvs('check', ID, '--step', '1')
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('No errors')
  })
})
