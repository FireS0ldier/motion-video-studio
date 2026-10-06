import type { Brand, FontSpec } from '../core/types.ts'

const loaded = new Map<string, Promise<void>>()

async function loadSpec(spec: FontSpec): Promise<void> {
  const faces = spec.sources.map((src) => {
    const desc: FontFaceDescriptors = { style: src.style ?? 'normal', weight: src.weight ?? '400', display: 'block' }
    if (src.unicodeRange) desc.unicodeRange = src.unicodeRange
    if (spec.features) desc.featureSettings = spec.features
    return new FontFace(spec.family, `url("${src.url}")`, desc)
  })
  for (const f of faces) document.fonts.add(f)
  const results = await Promise.allSettled(faces.map((f) => f.load()))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length === results.length) throw new Error(`Font "${spec.family}" failed to load (${spec.sources.map((s) => s.url).join(', ')})`)
}

/**
 * Load every font of a brand and wait until they are usable by canvas text.
 * Fonts are bundled files, never system fonts, so text renders identically on
 * every machine.
 */
export async function loadBrandFonts(brand: Brand): Promise<string[]> {
  const errors: string[] = []
  const specs = new Map<string, FontSpec>()
  for (const spec of Object.values(brand.fonts)) if (spec) specs.set(spec.family, spec)
  await Promise.all(
    [...specs.values()].map(async (spec) => {
      let p = loaded.get(spec.family)
      if (!p) {
        p = loadSpec(spec)
        loaded.set(spec.family, p)
      }
      try {
        await p
      } catch (e) {
        errors.push((e as Error).message)
      }
    }),
  )
  await document.fonts.ready
  return errors
}
