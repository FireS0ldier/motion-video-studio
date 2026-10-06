import { existsSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import type { Args } from '../lib/args.ts'
import { findBrowser, glArgs, launchBrowser } from '../lib/browser.ts'
import { run, which } from '../lib/exec.ts'
import { color, log } from '../lib/log.ts'
import { ROOT, listProjects } from '../lib/paths.ts'
import { findPythonRunner } from '../lib/python.ts'

export const doctorHelp = `mvs doctor [--render]

Checks everything the studio needs and prints how to fix what is missing:
Node.js, dependencies, ffmpeg/ffprobe (libx264), a Chromium browser with WebGL2,
optional uv/Python (alignment + local TTS), disk space.
  --render   also render a test still of the first project`

type Status = 'ok' | 'warn' | 'fail'

export async function doctorCommand(a: Args) {
  const rows: Array<[Status, string, string]> = []
  const add = (s: Status, what: string, detail: string) => rows.push([s, what, detail])

  const [maj, min] = process.versions.node.split('.').map(Number) as [number, number]
  add(maj > 20 || (maj === 20 && min >= 19) ? 'ok' : 'fail', 'Node.js', `v${process.versions.node}${maj < 20 ? ' — need >= 20.19 (22 LTS recommended)' : ''}`)
  add(existsSync(join(ROOT, 'node_modules', 'vite')) ? 'ok' : 'fail', 'npm dependencies', existsSync(join(ROOT, 'node_modules', 'vite')) ? 'installed' : 'run `npm install`')
  add(existsSync(join(ROOT, 'node_modules', '@fontsource-variable', 'inter')) ? 'ok' : 'fail', 'bundled fonts', 'Inter, JetBrains Mono, Instrument Serif (npm)')

  const ff = process.env.MVS_FFMPEG ?? which('ffmpeg')
  if (!ff) add('fail', 'ffmpeg', 'not found — install a full build (brew install ffmpeg | apt install ffmpeg | winget install ffmpeg)')
  else {
    const v = await run(ff, ['-hide_banner', '-version'])
    const enc = await run(ff, ['-hide_banner', '-encoders'])
    const x264 = /libx264/.test(enc.stdout)
    add(x264 ? 'ok' : 'fail', 'ffmpeg', `${v.stdout.split('\n')[0]?.replace('ffmpeg version ', '').split(' ')[0]}${x264 ? ' · libx264' : ' — libx264 encoder missing, install a full ffmpeg build'}`)
    add(/libopus/.test(enc.stdout) ? 'ok' : 'warn', 'ffmpeg libopus', /libopus/.test(enc.stdout) ? 'available' : 'only needed to regenerate the music bed')
  }
  add((process.env.MVS_FFPROBE ?? which('ffprobe')) ? 'ok' : 'fail', 'ffprobe', (process.env.MVS_FFPROBE ?? which('ffprobe')) ?? 'ships with ffmpeg')

  try {
    const choice = findBrowser()
    const browser = await launchBrowser(choice)
    try {
      const page = await browser.newPage()
      const gl = await page.evaluate(() => {
        const c = document.createElement('canvas')
        const g = c.getContext('webgl2')
        if (!g) return null
        const dbg = g.getExtension('WEBGL_debug_renderer_info')
        return {
          renderer: dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(g.getParameter(g.RENDERER)),
          float: !!g.getExtension('EXT_color_buffer_float'),
          maxTex: Number(g.getParameter(g.MAX_TEXTURE_SIZE)),
        }
      })
      add('ok', 'browser', `${choice.source}: ${browser.version()} (${choice.executablePath ?? choice.channel})`)
      if (!gl) add('fail', 'WebGL2', 'not available in headless mode — try MVS_GL=swiftshader')
      else add('ok', 'WebGL2', `${gl.renderer.slice(0, 70)} · float targets ${gl.float ? 'yes' : 'no'} · max texture ${gl.maxTex}`)
      add('ok', 'GL mode', `MVS_GL=${process.env.MVS_GL ?? 'auto'} → ${glArgs().join(' ') || 'native'}`)
    } finally {
      await browser.close()
    }
  } catch (e) {
    add('fail', 'browser', (e as Error).message.split('\n')[0] ?? 'failed')
  }

  const py = findPythonRunner()
  add(py ? 'ok' : 'warn', 'uv / Python (optional)', py ? `${py.describe} — enables \`mvs align\` (CTC) and \`mvs voice\`` : 'not found — alignment falls back to the heuristic engine. Install uv: https://docs.astral.sh/uv/')
  try {
    const st = statfsSync(ROOT)
    const gb = (st.bavail * st.bsize) / 1e9
    add(gb > 5 ? 'ok' : gb > 1.5 ? 'warn' : 'fail', 'disk space', `${gb.toFixed(1)} GB free (renders and frame caches need a few GB)`)
  } catch {
    /* statfs unsupported */
  }
  add(listProjects().length ? 'ok' : 'warn', 'projects', listProjects().join(', ') || 'none yet — `mvs new my-video`')

  const icon = { ok: color.green('✓'), warn: color.yellow('!'), fail: color.red('✗') }
  for (const [s, w, d] of rows) log.info(`${icon[s]} ${w.padEnd(24)} ${color.gray(d)}`)
  const failed = rows.filter((r) => r[0] === 'fail').length

  if (a.bool('render') && !failed && listProjects().length) {
    const { stillCommand } = await import('./still.ts')
    const { parseArgs } = await import('../lib/args.ts')
    log.step(`Test still of "${listProjects()[0]}"`)
    await stillCommand(parseArgs([listProjects()[0]!, '--t', '1', '--scale', '0.5', '--samples', '1', '--out', 'out/doctor']))
  }
  if (failed) {
    log.error(`${failed} problem(s) must be fixed before rendering.`)
    process.exitCode = 1
  } else log.ok('Ready to render.')
}
