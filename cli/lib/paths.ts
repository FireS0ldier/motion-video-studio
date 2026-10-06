import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from './log.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PROJECTS = join(ROOT, 'projects')
export const TEMPLATES = join(ROOT, 'templates')
export const OUT = join(ROOT, 'out')
export const SHARED_SFX = join(ROOT, 'assets', 'sfx')
export const CACHE = join(ROOT, '.cache')
export const TOOLS = join(ROOT, 'tools')

export function listProjects(): string[] {
  if (!existsSync(PROJECTS)) return []
  return readdirSync(PROJECTS)
    .filter((d) => existsSync(join(PROJECTS, d, 'project.ts')))
    .sort()
}

export interface ProjectPaths {
  id: string
  dir: string
  script: string
  timing: string
  analysis: string
  assets: string
  build: string
  frames: string
  mix: string
  out: string
}

export function projectPaths(id: string): ProjectPaths {
  const dir = join(PROJECTS, id)
  return {
    id,
    dir,
    script: join(dir, 'script.md'),
    timing: join(dir, 'data', 'timing.json'),
    analysis: join(dir, 'data', 'audio.json'),
    assets: join(dir, 'assets'),
    build: join(dir, 'build'),
    frames: join(dir, 'build', 'frames'),
    mix: join(dir, 'build', 'mix.wav'),
    out: join(OUT, id),
  }
}

/** Resolve the project argument (or the only project when there is exactly one). */
export function requireProject(id: string | undefined): ProjectPaths {
  const all = listProjects()
  if (!id) {
    if (all.length === 1) return projectPaths(all[0]!)
    throw new CliError('Which project? Pass its folder name.', `Projects: ${all.join(', ') || '(none — create one with `mvs new <name>`)'}`)
  }
  if (!all.includes(id)) throw new CliError(`Project "${id}" not found in projects/.`, `Projects: ${all.join(', ') || '(none)'}. Create one with \`mvs new ${id}\`.`)
  return projectPaths(id)
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true })
  return p
}

export function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as T
}

/** Write JSON with stable formatting (small arrays of numbers stay on one line). */
export function writeJson(p: string, data: unknown) {
  ensureDir(dirname(p))
  const text = JSON.stringify(data, null, 2).replace(/\[\n\s+((?:-?[\d.e+-]+,\n\s+)*-?[\d.e+-]+)\n\s+\]/g, (_, nums: string) => `[${nums.replace(/,\n\s+/g, ', ')}]`)
  writeFileSync(p, text + '\n')
}

export function mtime(p: string): number {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

export function rel(p: string): string {
  return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p
}
