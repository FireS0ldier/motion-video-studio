import { describe, expect, it } from 'vitest'
import { defineBrand, deepMerge, defaultBrand } from '../../engine/core/brand.ts'
import { makeStage, resolveFormat } from '../../engine/core/format.ts'
import { defineProject, resolveProject } from '../../engine/core/project.ts'
import { createFrame, defineScene } from '../../engine/core/scene.ts'
import { activeAt, defineTimeline, normalizeTransition, resolveTimeline } from '../../engine/core/timeline.ts'
import { estimateTiming, Timing } from '../../engine/core/timing.ts'
import { parseScript } from '../../engine/core/script.ts'
import { AudioFeatures } from '../../engine/core/audio-features.ts'

const script = `## a {#a}
First part of the story. It has two sentences.
## b {#b}
Second part starts here.
## c {#c}
And the ending.`

const scene = (name: string) =>
  defineScene({
    name,
    render() {},
    cues: (c) => [c.cue('click', 0.5)],
  })

describe('formats', () => {
  it('resolves presets and validates sizes', () => {
    expect(resolveFormat('vertical')).toEqual({ width: 1080, height: 1920, fps: 60 })
    expect(() => resolveFormat({ width: 101, height: 100, fps: 30 })).toThrow(/even/)
    const st = makeStage({ width: 1080, height: 1920, fps: 60 })
    expect(st.portrait).toBe(true)
    expect(st.title.x).toBeGreaterThan(st.safe.x)
  })
})

describe('brand', () => {
  it('merges overrides deeply but replaces arrays and font specs', () => {
    const b = defineBrand({ name: 'X', colors: { primary: '#ff0000' }, gradients: { brand: ['#000', '#fff'] } })
    expect(b.colors.primary).toBe('#ff0000')
    expect(b.colors.bg).toBe(defaultBrand.colors.bg)
    expect(b.gradients.brand).toEqual(['#000', '#fff'])
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 3 } })).toEqual({ a: { b: 3, c: 2 } })
  })
})

describe('timeline', () => {
  const timing = new Timing(estimateTiming(parseScript(script)))
  const def = defineTimeline(({ section, end }) => [
    { scene: scene('a'), start: 0 },
    { scene: scene('b'), start: section('b'), transition: 'fade' },
    { scene: scene('c'), start: section('c'), end: end(1), transition: { type: 'slide', duration: 0.5 } },
  ])
  it('resolves contiguous entries with centered transition windows', () => {
    const warnings: string[] = []
    const e = resolveTimeline(def, timing, (m) => warnings.push(m))
    expect(warnings).toEqual([])
    expect(e.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(e[0]!.end).toBe(e[1]!.start)
    expect(e[2]!.end).toBeCloseTo(timing.end + 1)
    const w = e[2]!.window!
    expect((w[0] + w[1]) / 2).toBeCloseTo(e[2]!.start)
    const mid = activeAt(e, e[2]!.start)
    expect(mid.a.id).toBe('c')
    expect(mid.b!.id).toBe('b')
    expect(mid.p).toBeCloseTo(0.5)
    expect(activeAt(e, 0.01).b).toBeNull()
  })
  it('warns instead of crashing on unknown anchors and out-of-order starts', () => {
    const warnings: string[] = []
    const bad = defineTimeline(({ cut }) => [
      { scene: scene('a'), start: 0 },
      { scene: scene('b'), start: cut('not in the script') },
      { scene: scene('c'), start: 0.1 },
    ])
    const e = resolveTimeline(bad, timing, (m) => warnings.push(m))
    expect(warnings.some((w) => w.includes('not found'))).toBe(true)
    expect(warnings.some((w) => w.includes('check its anchor'))).toBe(true)
    for (let i = 1; i < e.length; i++) expect(e[i]!.start).toBeGreaterThan(e[i - 1]!.start)
  })
  it('normalizes transitions', () => {
    expect(normalizeTransition('cut').duration).toBe(0)
    expect(normalizeTransition('zoom').duration).toBeGreaterThan(0)
    expect(() => normalizeTransition('spin' as never)).toThrow(/Unknown transition/)
  })
})

describe('project', () => {
  const def = defineProject({
    title: 'T',
    timeline: defineTimeline(({ section }) => [
      { scene: scene('a'), start: 0 },
      { scene: scene('b'), start: section('b'), transition: 'whip' },
    ]),
    audio: { voiceover: { src: 'assets/audio/voiceover.wav', offset: 0.5 } },
    cues: (c) => [c.cue('impact', { at: c.section('b').start })],
  })
  it('builds a manifest with scenes, cues and timing info', () => {
    const p = resolveProject({ id: 't', def, script })
    const m = p.manifest()
    expect(m).toMatchObject({ id: 't', width: 1920, height: 1080, fps: 60 })
    expect(m.frames).toBe(Math.round(m.duration * 60))
    expect(m.timing.source).toBe('estimate')
    expect(m.timing.voiceStart).toBeGreaterThan(0.5) // voiceover offset applied
    const sounds = m.cues.map((c) => c.sound)
    expect(sounds).toContain('whoosh-fast') // transition default
    expect(sounds).toContain('impact')
    expect(sounds.filter((s) => s === 'click').length).toBe(2)
    for (let i = 1; i < m.cues.length; i++) expect(m.cues[i]!.at).toBeGreaterThanOrEqual(m.cues[i - 1]!.at)
    expect(m.warnings.some((w) => w.includes('estimated timing'))).toBe(true)
  })
  it('flags stale timing when the script changed', () => {
    const timing = estimateTiming(parseScript(script))
    const p = resolveProject({ id: 't', def, script: script.replace('ending', 'finale'), timing })
    expect(p.timingStale).toBe(true)
  })
  it('renders other formats from the same definition', () => {
    const p = resolveProject({ id: 't', def, script, format: 'square' })
    expect([p.stage.w, p.stage.h]).toEqual([1080, 1080])
  })
})

describe('frame context', () => {
  const timing = new Timing(estimateTiming(parseScript(script)))
  const stage = makeStage({ width: 1920, height: 1080, fps: 60 })
  const make = (t: number) =>
    createFrame({ id: 's', t, start: 1, end: 5, frame: Math.round(t * 60), stage, brand: defaultBrand, quality: 'final', timing, audio: new AudioFeatures(null), transition: { phase: null, p: 1 }, seed: 1, warn: () => {} })
  it('exposes local time, progress and anchors', () => {
    const f = make(3)
    expect(f.lt).toBe(2)
    expect(f.p).toBeCloseTo(0.5)
    expect(f.at(0.5)).toBe(1.5)
    expect(f.at({ at: 9 })).toBe(9)
    expect(f.in(0, 4, 'linear')).toBeCloseTo(0.5)
    expect(f.out(1, 'linear')).toBe(0)
    expect(make(4.5).out(1, 'linear')).toBeCloseTo(0.5)
  })
  it('falls back gracefully for unknown phrases and is deterministic', () => {
    const warnings: string[] = []
    const f = createFrame({ id: 's', t: 2, start: 1, end: 5, frame: 120, stage, brand: defaultBrand, quality: 'final', timing, audio: new AudioFeatures(null), transition: { phase: null, p: 1 }, seed: 1, warn: (m) => warnings.push(m) })
    expect(f.word('zzz').start).toBe(1)
    expect(warnings.length).toBe(1)
    expect(f.rand('k')()).toBe(make(2).rand('k')())
  })
})
