import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { Args } from '../lib/args.ts'
import { findBrowser } from '../lib/browser.ts'
import { which } from '../lib/exec.ts'
import { color, log } from '../lib/log.ts'
import { ROOT } from '../lib/paths.ts'
import { doctorCommand } from './doctor.ts'

export const setupHelp = `mvs setup

One-time setup after \`npm install\`:
  - installs a headless Chromium via Playwright if no usable browser is found
  - tells you how to install ffmpeg if it is missing
  - runs \`mvs doctor\``

export async function setupCommand(a: Args) {
  try {
    const b = findBrowser()
    log.ok(`Browser found (${b.source})`)
  } catch {
    log.step('No Chromium found — installing one with Playwright (~170 MB, once)')
    const cli = join(ROOT, 'node_modules', 'playwright-core', 'cli.js')
    const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' })
    if (r.status !== 0) log.warn('Browser install failed. Install Google Chrome, or set MVS_BROWSER=/path/to/chrome.')
  }
  if (!which('ffmpeg')) {
    log.warn('ffmpeg is missing. Install it:')
    log.info(color.gray('  macOS:   brew install ffmpeg'))
    log.info(color.gray('  Ubuntu:  sudo apt-get install -y ffmpeg'))
    log.info(color.gray('  Windows: winget install Gyan.FFmpeg'))
  }
  if (!which('uv')) log.dim('Optional: install uv (https://docs.astral.sh/uv/) for word-level alignment (`mvs align`) and local TTS (`mvs voice`).')
  await doctorCommand(a)
}
