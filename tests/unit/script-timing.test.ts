import { describe, expect, it } from 'vitest'
import { expandNumberToken, flattenWords, intToWords, parseScript, scriptHash } from '../../engine/core/script.ts'
import { buildTiming, estimateTiming, shiftTiming, Timing } from '../../engine/core/timing.ts'
import { normPhrase, normWord, slugify } from '../../engine/core/text-norm.ts'

const SRC = `---
title: Test
language: en
voice: am_michael
speed: 1.1
---

<!-- comment that is not spoken -->

## Hook {#hook}
> direction note, not spoken
Your product ships every week. But dashboards lag.

## Meet Orbit
Meet Orbit. Teams ship {40%|forty percent} faster, e.g. with fewer rollbacks. [pause 0.4]
Visit {orbit.dev|orbit dot dev} today.
`

describe('script parser', () => {
  const doc = parseScript(SRC)
  it('reads front matter', () => {
    expect(doc.meta).toMatchObject({ title: 'Test', voice: 'am_michael', speed: 1.1 })
    expect(doc.language).toBe('en')
  })
  it('splits sections with explicit and slugged ids', () => {
    expect(doc.sections.map((s) => s.id)).toEqual(['hook', 'meet-orbit'])
    expect(doc.sections[0]!.sentences.map((s) => s.text)).toEqual(['Your product ships every week.', 'But dashboards lag.'])
  })
  it('keeps abbreviations and domains inside sentences', () => {
    const s = doc.sections[1]!.sentences
    expect(s.map((x) => x.text)).toEqual(['Meet Orbit.', 'Teams ship 40% faster, e.g. with fewer rollbacks.', 'Visit orbit.dev today.'])
  })
  it('applies spoken overrides and pauses', () => {
    const teams = doc.sections[1]!.sentences[1]!
    const w = teams.words.find((x) => x.text === '40%')!
    expect(w.spoken).toEqual(['forty', 'percent'])
    expect(teams.tts).toContain('forty percent faster')
    expect(teams.pauseAfter).toBeCloseTo(0.4)
    const visit = doc.sections[1]!.sentences[2]!
    expect(visit.words.find((x) => x.text === 'orbit.dev')!.spoken).toEqual(['orbit', 'dot', 'dev'])
  })
  it('flattens words with sentence and section indices', () => {
    const flat = flattenWords(doc)
    expect(flat[0]).toMatchObject({ text: 'Your', section: 'hook', sentence: 0 })
    expect(flat.at(-1)).toMatchObject({ text: 'today.', section: 'meet-orbit', sentence: 4 })
  })
  it('hash changes only when spoken words change', () => {
    const h = scriptHash(doc)
    expect(scriptHash(parseScript(SRC.replace('every week', 'every month')))).not.toBe(h)
    expect(scriptHash(parseScript(SRC.replace('> direction note', '> another note')))).toBe(h)
  })
  it('rejects duplicate section ids', () => {
    expect(() => parseScript('## A {#x}\nOne.\n## B {#x}\nTwo.')).toThrow(/duplicate/)
  })
})

describe('numbers to words', () => {
  it.each([
    ['40%', 'forty percent'],
    ['3×', 'three times'],
    ['3x', 'three times'],
    ['$29', 'twenty nine dollars'],
    ['1st', 'first'],
    ['22nd', 'twenty second'],
    ['2026', 'twenty twenty six'],
    ['1905', 'nineteen oh five'],
    ['1,250', 'one thousand two hundred fifty'],
    ['3.5', 'three point five'],
    ['10k', 'ten thousand'],
    ['24/7', 'twenty four seven'],
  ])('%s → %s', (tok, words) => {
    expect(expandNumberToken(tok)!.join(' ')).toBe(words)
  })
  it('leaves words alone', () => {
    expect(expandNumberToken('hello')).toBeNull()
    expect(intToWords(0)).toEqual(['zero'])
  })
})

describe('normalization', () => {
  it('normalizes words and phrases', () => {
    expect(normWord('Orbit.')).toBe('orbit')
    expect(normWord('Grüße')).toBe('grusse')
    expect(normPhrase('Meet  Orbit — now')).toEqual(['meet', 'orbit', 'now'])
    expect(slugify('Meet Orbit!')).toBe('meet-orbit')
  })
})

describe('timing', () => {
  const doc = parseScript(SRC)
  const est = estimateTiming(doc)
  it('estimates monotonic word times with pauses between sections', () => {
    for (let i = 1; i < est.words.length; i++) expect(est.words[i]!.start).toBeGreaterThan(est.words[i - 1]!.start)
    const lastHook = est.words.filter((w) => w.section === 'hook').at(-1)!
    const firstMeet = est.words.find((w) => w.section === 'meet-orbit')!
    expect(firstMeet.start - lastHook.end).toBeGreaterThan(0.5)
    expect(est.source).toBe('estimate')
    expect(est.scriptHash).toBe(scriptHash(doc))
  })
  it('buildTiming validates the word count', () => {
    expect(() => buildTiming(doc, [], 'manual')).toThrow(/script words/)
  })
  const t = new Timing(shiftTiming(est, 1))
  it('finds phrases by content, incl. multi-word display tokens', () => {
    const meet = t.find('Meet Orbit')!
    expect(meet.text).toBe('Meet Orbit.')
    expect(meet.start).toBeGreaterThan(1)
    expect(t.find('40%')!.text).toBe('40%')
    expect(t.find('orbit.dev')).not.toBeNull()
    expect(t.find('does not exist')).toBeNull()
  })
  it('prefers matches inside a time window and supports nth', () => {
    const tt = new Timing(estimateTiming(parseScript('## a\nGo now. Wait here. Go later.')))
    const all = tt.matches('go')
    expect(all.length).toBe(2)
    const second = tt.words[all[1]!]!.start
    expect(tt.find('go', { from: second - 0.1 })!.start).toBeCloseTo(second)
    expect(tt.find('go', { nth: 1 })!.start).toBeCloseTo(second)
    expect(tt.find('go')!.start).toBeCloseTo(tt.words[0]!.start)
  })
  it('cuts sit in the pause before a phrase', () => {
    const meet = t.find('Meet Orbit')!
    const cut = t.cutBefore('Meet Orbit')!
    const prev = t.words[t.matches('Meet Orbit')[0]! - 1]!
    expect(cut).toBeLessThan(meet.start)
    expect(cut).toBeGreaterThan(prev.end)
  })
  it('sentence, section and wordAt lookups', () => {
    expect(t.sentence('fewer rollbacks')!.text).toContain('Teams ship')
    expect(t.section('hook')!.first).toBe(0)
    const w = t.words[3]!
    expect(t.wordAt((w.start + w.end) / 2)!.i).toBe(3)
    expect(t.lastWordIndex(-5)).toBe(-1)
  })
})
