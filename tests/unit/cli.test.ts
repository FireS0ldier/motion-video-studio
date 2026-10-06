import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../cli/lib/args.ts'
import { encodePng } from '../../cli/lib/png.ts'
import { tokenizeLine } from '../../engine/kit/code.ts'
import { formatNumber } from '../../engine/kit/charts.ts'
import { chunkWords } from '../../engine/kit/captions.ts'
import { frameDirName } from '../../engine/assets/store.ts'
import type { TimedWord } from '../../engine/core/types.ts'

describe('args', () => {
  it('parses positionals, values, booleans and negations', () => {
    const a = parseArgs(['proj', '--t', '1,2', '--draft', '--scale=2', '--no-audio', '--samples', 'auto'], ['draft', 'audio'])
    expect(a._).toEqual(['proj'])
    expect(a.str('t')).toBe('1,2')
    expect(a.bool('draft')).toBe(true)
    expect(a.num('scale')).toBe(2)
    expect(a.bool('audio', true)).toBe(false)
    expect(a.str('samples')).toBe('auto')
    expect(() => parseArgs(['--scale', 'x']).num('scale')).toThrow()
  })
})

describe('png', () => {
  it('encodes a valid RGB PNG', () => {
    const w = 3
    const h = 2
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256)
    const png = encodePng(px, w, h)
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(w)
    expect(png.readUInt32BE(20)).toBe(h)
    const idatLen = png.readUInt32BE(33)
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect(raw.length).toBe(h * (w * 3 + 1))
    expect(raw[1]).toBe(px[0])
    expect(raw[3]).toBe(px[2])
  })
})

describe('kit helpers', () => {
  it('tokenizes code', () => {
    const t = tokenizeLine("const x = orbit.init({ key: 'a' }) // hi", 'ts')
    expect(t.find((x) => x.text === 'const')!.type).toBe('keyword')
    expect(t.find((x) => x.text === "'a'")!.type).toBe('string')
    expect(t.find((x) => x.text === 'init')!.type).toBe('function')
    expect(t.at(-1)!.type).toBe('comment')
    expect(t.map((x) => x.text).join('')).toBe("const x = orbit.init({ key: 'a' }) // hi")
  })
  it('formats numbers', () => {
    expect(formatNumber(48213)).toBe('48,213')
    expect(formatNumber(1240000, { compact: true })).toBe('1.2M')
    expect(formatNumber(39.6, { suffix: '%' })).toBe('40%')
    expect(formatNumber(2.5, { decimals: 1, prefix: '$' })).toBe('$2.5')
  })
  it('chunks captions at sentences and pauses', () => {
    const w = (i: number, text: string, start: number, sentence = 0): TimedWord => ({ i, text, norm: text, start, end: start + 0.2, section: 's', sentence })
    const words = [w(0, 'One', 0), w(1, 'two.', 0.25), w(2, 'Three', 0.5, 1), w(3, 'four', 1.5, 1)]
    expect(chunkWords(words, 6).map((c) => c.map((x) => x.text).join(' '))).toEqual(['One two.', 'Three', 'four'])
  })
  it('maps recording paths to frame folders', () => {
    expect(frameDirName('recordings/demo.mp4')).toBe('recordings__demo')
  })
})
