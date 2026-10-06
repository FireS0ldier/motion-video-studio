import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { slugify } from '../../engine/core/text-norm.ts'
import { formats } from '../../engine/core/format.ts'
import type { Args } from '../lib/args.ts'
import { CliError, color, log } from '../lib/log.ts'
import { PROJECTS, rel, TEMPLATES } from '../lib/paths.ts'

export const newHelp = `mvs new <name> [--template starter] [--title "Product launch"] [--format landscape] [--force]

Create projects/<name>/ from a template. Templates live in templates/:
  starter   generic product video (hook, problem, product intro, features,
            screenshot showcase, stats, call to action) — works in every format
Formats: ${Object.keys(formats).join(', ')}
Next steps are printed after creation (script → voice → align → preview → render).`

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export async function newCommand(a: Args) {
  const raw = a._[0]
  if (!raw) throw new CliError('Give the project a name: mvs new <name>')
  const id = slugify(raw)
  if (!id) throw new CliError(`"${raw}" is not a usable folder name.`)
  const template = a.str('template', 'starter')!
  const src = join(TEMPLATES, template)
  if (!existsSync(src)) throw new CliError(`Template "${template}" not found.`, `Templates: ${readdirSync(TEMPLATES).join(', ')}`)
  const dest = join(PROJECTS, id)
  if (existsSync(dest) && !a.bool('force')) throw new CliError(`projects/${id} already exists.`, 'Pick another name or pass --force to overwrite.')
  const format = a.str('format', 'landscape')!
  if (!(format in formats)) throw new CliError(`Unknown format "${format}".`, `Formats: ${Object.keys(formats).join(', ')}`)
  const title = a.str('title') ?? raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  cpSync(src, dest, { recursive: true, filter: (f) => !/[\\/](build|out)([\\/]|$)/.test(f) })
  for (const file of walk(dest)) {
    if (!/\.(ts|md|json|txt)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    const next = text.replaceAll('{{id}}', id).replaceAll('{{title}}', title).replaceAll("'{{format}}'", `'${format}'`).replaceAll('{{format}}', format)
    if (next !== text) writeFileSync(file, next)
  }
  log.ok(`Created ${rel(dest)} from template "${template}" (${format})`)
  log.info(`
${color.bold('Next steps')}
  1. Edit ${rel(join(dest, 'script.md'))}   (the voiceover text; ## headings = sections)
     and ${rel(join(dest, 'brand.ts'))}      (colors, fonts, logo)
  2. Put screenshots/recordings/logo into ${rel(join(dest, 'assets'))}/
  3. Voiceover: drop a file at assets/audio/voiceover.wav, or generate one:
       npx mvs voice ${id}
  4. npx mvs align ${id}        word timing (or --estimate without a voiceover)
     npx mvs analyze ${id}      audio envelope for audio-reactive motion
  5. npx mvs dev ${id}          live preview
  6. npx mvs check ${id} && npx mvs render ${id} --draft && npx mvs render ${id}
`)
}
