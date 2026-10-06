import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ttsReportFor } from '../../cli/commands/align.ts'
import { ttsAlign, type TtsReport } from '../../cli/lib/align.ts'
import type { ProjectPaths } from '../../cli/lib/paths.ts'
import { importNames } from '../../cli/lib/python.ts'
import { chooseVoice, kokoroLang, piperCatalog } from '../../cli/lib/tts.ts'
import { expandNumberToken, flattenWords, intToWordsDe, parseScript, scriptHash } from '../../engine/core/script.ts'
import { estimateTiming, Timing } from '../../engine/core/timing.ts'

describe('German numbers', () => {
  it.each([
    ['0', 'null'],
    ['1', 'eins'],
    ['16', 'sechzehn'],
    ['21', 'einundzwanzig'],
    ['31', 'einunddreißig'],
    ['100', 'hundert'],
    ['101', 'hunderteins'],
    ['200', 'zweihundert'],
    ['1000', 'tausend'],
    ['1.250', 'tausendzweihundertfünfzig'],
    ['21.000', 'einundzwanzigtausend'],
    ['101.000', 'hunderteintausend'],
    ['2026', 'zweitausendsechsundzwanzig'],
    ['1999', 'neunzehnhundertneunundneunzig'],
    ['2.500.000', 'zwei millionen fünfhunderttausend'],
    ['1.000.000', 'eine million'],
    ['3,5', 'drei komma fünf'],
    ['40%', 'vierzig prozent'],
    ['3x', 'dreimal'],
    ['1×', 'einmal'],
    ['5€', 'fünf euro'],
    ['€5', 'fünf euro'],
    ['$5k', 'fünftausend dollar'],
    ['10k', 'zehntausend'],
    ['1,2Mio.', 'eins komma zwei millionen'],
    ['24/7', 'vierundzwanzig sieben'],
    ['v2', 'v zwei'],
    ['+40%', 'plus vierzig prozent'],
    ['-20', 'minus zwanzig'],
    ['1,5x', 'eins komma fünf mal'],
    ['2.000x', 'zweitausendmal'],
    ['30-tägige', 'dreißigtägige'],
    ['2-wöchiger', 'zweiwöchiger'],
    ['80er', 'achtziger'],
    ['1990er', 'neunzehnhundertneunziger'],
    ['10:30', 'zehn dreißig'],
    ['9:00', 'neun'],
    ['Ü18', 'ü achtzehn'],
  ])('%s → %s', (tok, words) => {
    expect(expandNumberToken(tok, 'de')!.join(' ')).toBe(words)
  })

  it('leaves words alone and keeps English the default', () => {
    expect(expandNumberToken('Hallo', 'de')).toBeNull()
    expect(expandNumberToken('40%')!.join(' ')).toBe('forty percent')
    expect(intToWordsDe(3_000_000_001)).toEqual(['drei', 'milliarden', 'eins'])
  })
})

describe('German scripts', () => {
  const doc = parseScript(
    '---\nlanguage: de\n---\n## A {#a}\nTeams sparen 10 Stunden pro Woche, z.B. 40 % weniger & 3x schneller. Das kostet ca. 5 € bzw. 2 Mio. Euro. Fertig.',
  )
  const sentences = doc.sections[0]!.sentences

  it('keeps abbreviations inside sentences', () => {
    expect(sentences.map((s) => s.text)).toEqual([
      'Teams sparen 10 Stunden pro Woche, z.B. 40 % weniger & 3x schneller.',
      'Das kostet ca. 5 € bzw. 2 Mio. Euro.',
      'Fertig.',
    ])
  })

  it('writes numbers, symbols and abbreviations out for the TTS', () => {
    expect(sentences[0]!.tts).toBe('Teams sparen zehn Stunden pro Woche, zum beispiel vierzig prozent weniger und dreimal schneller.')
    expect(sentences[1]!.tts).toBe('Das kostet circa fünf euro beziehungsweise zwei millionen Euro.')
  })

  it('finds display text in the timing', () => {
    const timing = new Timing(estimateTiming(doc))
    expect(timing.find('10 Stunden')).not.toBeNull()
    expect(timing.find('40 %')).not.toBeNull()
    expect(timing.find('z.B.')).not.toBeNull()
  })

  it('reads domains, versions and more abbreviations', () => {
    const d = parseScript('---\nlanguage: de\n---\n## A {#a}\nMehr auf acme.de, z.B. Version 3.5 und u.U. später.')
    expect(d.sections[0]!.sentences.map((s) => s.tts)).toEqual(['Mehr auf acme punkt de, zum beispiel Version drei punkt fünf und unter umständen später.'])
    const en = parseScript('## A {#a}\nVisit orbit.dev today.')
    expect(en.sections[0]!.sentences[0]!.tts).toBe('Visit orbit dot dev today.')
    expect(flattenWords(en).find((w) => w.text === 'orbit.dev')!.spoken).toEqual(['orbit', 'dot', 'dev'])
  })

  it('reads German dates and keeps the sentence together', () => {
    const d = parseScript('---\nlanguage: de\n---\n## A {#a}\nAm 1. Oktober startet die Beta. Er wurde 3. Danach mehr. Seit dem 01.10.2026 live.')
    expect(d.sections[0]!.sentences.map((s) => s.tts)).toEqual(['Am ersten Oktober startet die Beta.', 'Er wurde drei.', 'Danach mehr.', 'Seit dem 01.10.2026 live.'])
  })

  it('expands abbreviations only with their dot, and keeps real words', () => {
    const d = parseScript('---\nlanguage: de\n---\n## A {#a}\nEin starker Sog. Danach mehr. Unsere eigene CA signiert. Mio ist da. Das ist sog. Technik von Dr. Müller.')
    expect(d.sections[0]!.sentences.map((s) => s.tts)).toEqual([
      'Ein starker Sog.',
      'Danach mehr.',
      'Unsere eigene CA signiert.',
      'Mio ist da.',
      'Das ist sogenannt Technik von doktor Müller.',
    ])
  })

  it('finds phrases across symbols and keeps the sentence period', () => {
    const d = parseScript('---\nlanguage: de\n---\n## A {#a}\nTeams sparen 40 % weniger Zeit. Ab 5 € im Monat auf acme.de.')
    const timing = new Timing(estimateTiming(d))
    expect(timing.find('40 % weniger')?.text).toBe('40 % weniger')
    expect(timing.find('5 € im Monat')?.text).toBe('5 € im Monat')
    expect(timing.find('weniger')?.text).toBe('weniger')
    expect(d.sections[0]!.sentences[1]!.tts).toBe('Ab fünf euro im Monat auf acme punkt de.')
    const words = flattenWords(d)
    expect(words.find((w) => w.text === '%')).toMatchObject({ norm: '', spoken: ['prozent'], tts: 'prozent' })
  })

  it('reads domain labels with digits and hyphens', () => {
    const en = parseScript('## A {#a}\nTry web3.io or 1password.com now.')
    expect(en.sections[0]!.sentences[0]!.tts).toBe('Try web three dot io or one password dot com now.')
    const de = parseScript('---\nlanguage: de\n---\n## A {#a}\nBesuche my-app.de heute.')
    expect(de.sections[0]!.sentences[0]!.tts).toBe('Besuche my app punkt de heute.')
  })

  it('leaves English scripts unchanged except for symbol words', () => {
    const en = parseScript('## A {#a}\nShip 40% faster & safer.')
    expect(en.sections[0]!.sentences[0]!.tts).toBe('Ship forty percent faster and safer.')
  })
})

describe('starter-de template', () => {
  const doc = parseScript(readFileSync(fileURLToPath(new URL('../../templates/starter-de/script.md', import.meta.url)), 'utf8'))
  it('is a German script with every anchor the scenes use', () => {
    expect(doc.language).toBe('de')
    const timing = new Timing(estimateTiming(doc))
    for (const phrase of ['Kundensignal', 'Sofort', 'verstreut', 'Tickets, die niemand liest', 'Das ist', 'Signale', 'Trends', 'Handeln', '10 Stunden']) {
      expect(timing.find(phrase), phrase).not.toBeNull()
    }
    expect(['hook', 'problem', 'product', 'features', 'proof', 'cta'].every((id) => timing.section(id))).toBe(true)
  })
})

describe('TTS engine choice', () => {
  it('uses Kokoro where it has voices and Piper for German', () => {
    expect(chooseVoice({ language: 'en' })).toMatchObject({ engine: 'kokoro', voice: 'am_michael', lang: 'en-us' })
    expect(chooseVoice({ language: 'de' })).toMatchObject({ engine: 'piper', voice: 'de_DE-thorsten-high' })
    expect(chooseVoice({ language: 'fr', voice: 'ff_siwis' })).toMatchObject({ engine: 'kokoro', voice: 'ff_siwis', lang: 'fr-fr' })
  })

  it('follows the voice id', () => {
    expect(chooseVoice({ language: 'de', voice: 'de_DE-kerstin-low' })).toMatchObject({ engine: 'piper', voice: 'de_DE-kerstin-low' })
    expect(chooseVoice({ language: 'en', voice: 'de_DE-thorsten-high' }).engine).toBe('piper')
  })

  it('replaces a Kokoro voice left in a German script, but rejects one passed explicitly', () => {
    const c = chooseVoice({ language: 'de', voice: 'af_heart' })
    expect(c).toMatchObject({ engine: 'piper', voice: 'de_DE-thorsten-high' })
    expect(c.note).toContain('af_heart')
    expect(() => chooseVoice({ language: 'de', voice: 'af_heart', voiceFromFlag: true })).toThrow(/Kokoro has no voice/)
    expect(() => chooseVoice({ language: 'de', engine: 'kokoro' })).toThrow(/Kokoro has no voice/)
    expect(() => chooseVoice({ language: 'nl' })).toThrow(/No default Piper voice/)
    expect(kokoroLang('de')).toBeNull()
  })

  it('never lets --lang switch a German script to Kokoro, and rejects unknown Kokoro voices', () => {
    expect(chooseVoice({ language: 'de', lang: 'de' })).toMatchObject({ engine: 'piper', voice: 'de_DE-thorsten-high' })
    expect(chooseVoice({ language: 'en', lang: 'en-gb' })).toMatchObject({ engine: 'kokoro', lang: 'en-gb' })
    expect(() => chooseVoice({ language: 'en', voice: 'bf-emma', voiceFromFlag: true })).toThrow(/not a Kokoro voice/)
    expect(chooseVoice({ language: 'en', voice: 'Heart' })).toMatchObject({ engine: 'kokoro', voice: 'am_michael' })
    expect(chooseVoice({ language: 'en', voice: 'Heart' }).note).toContain('Heart')
  })

  it('maps pip requirements to import names for the no-uv fallback', () => {
    expect(importNames('piper-tts[alignment]==1.8.0')).toEqual(['piper', 'onnx'])
    expect(importNames('kokoro-onnx')).toEqual(['kokoro_onnx'])
    expect(importNames('whisperx')).toEqual(['whisperx'])
  })

  it('has a consistent, checksum-pinned catalog', () => {
    const c = piperCatalog()
    expect(c.revision).toMatch(/^[0-9a-f]{40}$/)
    for (const [id, v] of Object.entries(c.voices)) {
      expect(v.path.endsWith(id.split('-').slice(1).join('/').replace(/-/g, '/')), id).toBe(true)
      expect(v.onnx.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(v.config.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(v.dataLicense).toBe('CC0-1.0')
      expect(v.base).toMatch(/fine-tuned from/)
    }
    expect(c.voices[c.defaults.de!]).toBeDefined()
  })
})

describe('TTS word timing', () => {
  const doc = parseScript('---\nlanguage: de\n---\n## A {#a}\nDas kostet 40 % weniger. Fertig.')
  const words = flattenWords(doc).map((w) => w.text)

  it('uses per-script-word spans when the report has them', () => {
    const rep: TtsReport = {
      sentences: [
        // the TTS merged "Das kostet" and split nothing else: scriptWords still name every script word
        { start: 0.2, end: 1.6, words: [[0.2, 0.8], [0.85, 1.1], [1.12, 1.3], [1.32, 1.6]], scriptWords: [[0.2, 0.4], [0.45, 0.8], [0.85, 1.1], [1.12, 1.3], [1.32, 1.6]] },
        { start: 2, end: 2.5, words: [[2, 2.5]], scriptWords: [[2, 2.5]] },
      ],
    }
    const t = ttsAlign(doc, rep)
    expect(words).toEqual(['Das', 'kostet', '40', '%', 'weniger.', 'Fertig.'])
    expect(t.map((x) => [x!.start, x!.end])).toEqual([
      [0.2, 0.4],
      [0.45, 0.8],
      [0.85, 1.1],
      [1.12, 1.3],
      [1.32, 1.6],
      [2, 2.5],
    ])
    expect(t.every((x) => x!.conf === 1)).toBe(true)
  })

  it('maps the TTS word split when only the count matches, with lower confidence', () => {
    const t = ttsAlign(doc, { sentences: [{ start: 0.2, end: 1.6, words: [[0.2, 0.4], [0.45, 0.8], [0.85, 1.1], [1.12, 1.3], [1.32, 1.6]] }, { start: 2, end: 2.5, words: [[2, 2.5]] }] })
    expect(t[1]).toMatchObject({ start: 0.45, end: 0.8, conf: 0.8 })
  })

  it('falls back to spoken length when the TTS split words differently', () => {
    const t = ttsAlign(doc, { sentences: [{ start: 0, end: 2, words: [[0, 1], [1, 2]] }, { start: 3, end: 3.5 }] })
    for (let i = 1; i < 5; i++) expect(t[i]!.start).toBeGreaterThanOrEqual(t[i - 1]!.end - 1e-9)
    expect(t[0]!.start).toBe(0)
    expect(t[4]!.end).toBeCloseTo(2)
    expect(t[5]).toMatchObject({ start: 3, end: 3.5, conf: 0.3 })
  })

  it('only reuses a report for the same audio and script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvs-tts-'))
    mkdirSync(join(dir, 'data'))
    mkdirSync(join(dir, 'build'))
    const audio = join(dir, 'voice.wav')
    writeFileSync(audio, 'RIFF-fake-audio')
    const real = createHash('sha256').update(readFileSync(audio)).digest('hex')
    const rep = { audioSha256: '0'.repeat(64), scriptHash: scriptHash(doc), sentences: [{ start: 0, end: 1, words: [[0, 1]] }, { start: 2, end: 3, words: [[2, 3]] }] }
    writeFileSync(join(dir, 'data', 'voice.json'), JSON.stringify(rep))
    const p = { dir, build: join(dir, 'build') } as ProjectPaths
    expect(ttsReportFor(p, audio, doc)).toBeNull() // audio hash differs
    writeFileSync(join(dir, 'data', 'voice.json'), JSON.stringify({ ...rep, audioSha256: real }))
    expect(ttsReportFor(p, audio, doc)).not.toBeNull()
    const other = parseScript('---\nlanguage: de\n---\n## A {#a}\nGanz anderer Text. Fertig.')
    expect(ttsReportFor(p, audio, other)).toBeNull() // script changed
  })

  it('finds the report of another take in build/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvs-tts-'))
    mkdirSync(join(dir, 'build'))
    const audio = join(dir, 'take2.wav')
    writeFileSync(audio, 'RIFF-take-2')
    const sha = createHash('sha256').update(readFileSync(audio)).digest('hex')
    writeFileSync(join(dir, 'build', 'voice-take2.json'), JSON.stringify({ audioSha256: sha, scriptHash: scriptHash(doc), sentences: [{ start: 0, end: 1, words: [[0, 1]] }, { start: 2, end: 3, words: [[2, 3]] }] }))
    expect(ttsReportFor({ dir, build: join(dir, 'build') } as ProjectPaths, audio, doc)).not.toBeNull()
  })
})
