/**
 * Discovers projects by convention (projects/<id>/project.ts) and loads
 * everything one needs: definition, script, timing, audio analysis, assets,
 * fonts. Used by both the interactive preview and the headless renderer.
 */

import { AssetStore } from '../assets/store.ts'
import { loadBrandFonts } from '../assets/fonts.ts'
import type { FormatName } from '../core/format.ts'
import { resolveProject, type ProjectDefinition, type ResolvedProject } from '../core/project.ts'
import type { AudioAnalysisData, Format, TimingData } from '../core/types.ts'

const projectModules = import.meta.glob<{ default: ProjectDefinition }>('/projects/*/project.ts')
const timingFiles = import.meta.glob<TimingData>('/projects/*/data/timing.json', { import: 'default' })
const analysisFiles = import.meta.glob<AudioAnalysisData>('/projects/*/data/audio.json', { import: 'default' })
const scriptFiles = import.meta.glob<string>('/projects/*/script.md', { query: '?raw', import: 'default' })
const assetFiles = import.meta.glob('/projects/*/assets/**/*.*', { query: '?url', import: 'default' })

const IMAGE = /\.(png|jpe?g|webp|avif|gif|svg)$/i

export function listProjects(): string[] {
  return Object.keys(projectModules)
    .map((k) => k.split('/')[2]!)
    .sort()
}

export interface LoadedProject {
  project: ResolvedProject
  assets: AssetStore
  /** Audio to try for the preview, best first (full mix, then raw voiceover). `offset` = timeline time of audio t=0. */
  audio: Array<{ url: string; offset: number }>
  fontErrors: string[]
}

export async function loadProject(id: string, opts: { format?: Format | FormatName; preloadImages?: boolean } = {}): Promise<LoadedProject> {
  const base = `/projects/${id}/`
  const load = projectModules[`${base}project.ts`]
  if (!load) throw new Error(`Project "${id}" not found. Known: ${listProjects().join(', ') || '(none)'} — create one with \`mvs new ${id}\``)
  const mod = await load()
  if (!mod.default) throw new Error(`${base}project.ts must \`export default defineProject({...})\``)
  const [timing, analysis, script] = await Promise.all([
    timingFiles[`${base}data/timing.json`]?.() ?? null,
    analysisFiles[`${base}data/audio.json`]?.() ?? null,
    scriptFiles[`${base}script.md`]?.() ?? null,
  ])
  const project = resolveProject({ id, def: mod.default, timing, analysis, script, format: opts.format })
  const prefix = `${base}assets/`
  const known = Object.keys(assetFiles)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
  const assets = new AssetStore({ projectBase: base, known })
  const fontErrors = await loadBrandFonts(project.brand)
  for (const e of fontErrors) project.warnings.push(e)
  if (opts.preloadImages !== false) {
    const scenesAssets = project.entries.flatMap((e) => e.scene.assets ?? [])
    const images = [...new Set([...known.filter((k) => IMAGE.test(k) && !k.includes('/src/')), ...scenesAssets.filter((k) => IMAGE.test(k))])]
    await assets.preloadImages(images)
    for (const [k, msg] of assets.errors) project.warnings.push(`asset ${k}: ${msg}`)
  }
  const audio = [{ url: `${base}build/mix.wav`, offset: 0 }]
  const vo = project.audio.voiceover
  if (vo?.src) audio.push({ url: `${base}${vo.src}`, offset: vo.offset ?? 0 })
  return { project, assets, audio, fontErrors }
}
