import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Args } from '../lib/args.ts'
import { log } from '../lib/log.ts'
import { CACHE, rel, requireProject } from '../lib/paths.ts'

export const cleanHelp = `mvs clean <project> [--all]

Delete generated files of a project: build/ (frame caches, mix, temp renders)
and out/<project>/ (renders, stills). Sources and data/ are never touched.
  --all   also clear .cache/ (decoded audio, downloaded models)`

export async function cleanCommand(a: Args) {
  const p = requireProject(a._[0])
  for (const dir of [p.build, p.out]) {
    rmSync(dir, { recursive: true, force: true })
    log.ok(`removed ${rel(dir)}`)
  }
  if (a.bool('all')) {
    rmSync(join(CACHE), { recursive: true, force: true })
    log.ok(`removed ${rel(CACHE)}`)
  }
}
