import { existsSync } from 'node:fs'
import type { Args } from '../lib/args.ts'
import { color, log } from '../lib/log.ts'
import { loadManifest } from '../lib/manifest.ts'
import { listProjects, projectPaths } from '../lib/paths.ts'
import { startServer } from '../lib/server.ts'
import { prepareAssets } from './assets.ts'
import { ensureMix } from './mix.ts'

export const devHelp = `mvs dev [project] [--port 5173] [--host] [--no-prepare]

Live preview with hot reload. Edit a scene, save, the page reloads at the same time.
Before starting it prepares assets and (re)builds the audio mix when inputs changed,
so the preview plays voice + music + SFX. Keys: space, ←/→, , ., [ ], l, h, g, m, q, s, w, ?`

export async function devCommand(a: Args) {
  const id = a._[0] ?? (listProjects().length === 1 ? listProjects()[0] : undefined)
  if (id && a.bool('prepare', true)) {
    const p = projectPaths(id)
    if (existsSync(p.dir)) {
      await prepareAssets(p, { quiet: true })
      try {
        const m = await loadManifest(p)
        await ensureMix(p, m)
        for (const w of m.warnings) log.warn(w)
      } catch (e) {
        log.warn(`Could not prepare audio: ${(e as Error).message.split('\n')[0]} — the preview will show the error.`)
      }
    }
  }
  const server = await startServer({ hmr: true, port: a.num('port', 5173), host: a.bool('host') ? true : undefined, project: id })
  const url = `${server.url}/${id ? `?project=${encodeURIComponent(id)}` : ''}`
  log.info('')
  log.ok(`Preview: ${color.bold(url)}`)
  log.dim('  space play/pause · ←/→ seek · , . frame step · [ ] scenes · l loop · g safe areas · s still · ? help')
  log.dim('  Ctrl+C to stop')
  const stop = async () => {
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
