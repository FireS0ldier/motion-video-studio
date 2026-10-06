/**
 * Word normalization shared by the script parser, the aligners and the
 * runtime phrase lookup (`f.word('faster')`, `cut('Meet Orbit')`).
 */

/** Lowercase, strip diacritics and everything that is not a letter or digit. */
export function normWord(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Split a phrase into normalized tokens (empty tokens dropped). */
export function normPhrase(s: string): string[] {
  return s
    .split(/[\s—–]+/)
    .map(normWord)
    .filter(Boolean)
}

/** Slug for ids (section ids, project ids). */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Rough English-ish syllable count, used to weight word durations when no aligner is available. */
export function syllables(word: string): number {
  const w = normWord(word)
  if (!w) return 0
  if (/^\d+$/.test(w)) return Math.max(1, w.length)
  const groups = w.match(/[aeiouyäöü]+/g)?.length ?? 1
  const silentE = w.length > 3 && w.endsWith('e') && !w.endsWith('le') ? 1 : 0
  return Math.max(1, groups - silentE)
}

/** 32-bit FNV-1a hash as hex (stable across Node and the browser). */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
