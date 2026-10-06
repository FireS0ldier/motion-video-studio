/**
 * Finds a Chromium-based browser for headless rendering and launches it with
 * flags that keep WebGL2 available (and deterministic) without a GPU.
 *
 * Resolution order:
 *   1. MVS_BROWSER=/path/to/chrome
 *   2. MVS_BROWSER_CHANNEL=chrome|msedge|chrome-beta (BROWSER_CHANNEL also accepted)
 *   3. the Chromium that matches the installed playwright-core
 *   4. any Playwright-managed Chromium in PLAYWRIGHT_BROWSERS_PATH / the default cache
 *   5. a system Chrome / Chromium
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type LaunchOptions } from 'playwright-core'
import { CliError } from './log.ts'

export interface BrowserChoice {
  executablePath?: string
  channel?: string
  source: string
}

function cacheDirs(): string[] {
  const dirs: string[] = []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') dirs.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  const home = homedir()
  if (platform() === 'darwin') dirs.push(join(home, 'Library', 'Caches', 'ms-playwright'))
  else if (platform() === 'win32') dirs.push(join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright'))
  else dirs.push(join(process.env.XDG_CACHE_HOME ?? join(home, '.cache'), 'ms-playwright'))
  return dirs
}

const EXECUTABLES = [
  ['chrome-linux64', 'chrome'],
  ['chrome-linux', 'chrome'],
  ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-win64', 'chrome.exe'],
  ['chrome-win', 'chrome.exe'],
  ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ['chrome-linux', 'headless_shell'],
]

function scanPlaywrightCache(): string | null {
  const found: Array<{ rev: number; path: string; full: boolean }> = []
  for (const dir of cacheDirs()) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const m = /^(chromium|chromium_headless_shell)-(\d+)$/.exec(name)
      if (!m) continue
      for (const parts of EXECUTABLES) {
        const p = join(dir, name, ...parts)
        if (existsSync(p)) {
          found.push({ rev: Number(m[2]), path: p, full: m[1] === 'chromium' })
          break
        }
      }
    }
  }
  // prefer full Chromium (new headless) over the headless shell, newest first
  found.sort((a, b) => Number(b.full) - Number(a.full) || b.rev - a.rev)
  return found[0]?.path ?? null
}

const SYSTEM_CHROME: Record<string, string[]> = {
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
}

export function findBrowser(): BrowserChoice {
  const envPath = process.env.MVS_BROWSER
  if (envPath) {
    if (!existsSync(envPath)) throw new CliError(`MVS_BROWSER points to a missing file: ${envPath}`)
    return { executablePath: envPath, source: 'MVS_BROWSER' }
  }
  const channel = process.env.MVS_BROWSER_CHANNEL ?? process.env.BROWSER_CHANNEL
  if (channel) return { channel, source: `channel ${channel}` }
  try {
    const p = chromium.executablePath()
    if (p && existsSync(p)) return { executablePath: p, source: 'playwright-core' }
  } catch {
    /* not installed for this version */
  }
  const cached = scanPlaywrightCache()
  if (cached) return { executablePath: cached, source: 'playwright cache' }
  for (const p of SYSTEM_CHROME[platform()] ?? []) if (existsSync(p)) return { executablePath: p, source: 'system' }
  throw new CliError('No Chromium-based browser found for rendering.', 'Install one with `npx playwright-core install chromium`, or set MVS_BROWSER=/path/to/chrome (or MVS_BROWSER_CHANNEL=chrome).')
}

/**
 * GL flags. MVS_GL=auto (default) uses SwiftShader on Linux (works on servers
 * without a GPU, fully deterministic) and the native GPU elsewhere.
 * MVS_GL=gpu | swiftshader | egl | vulkan | metal force a backend.
 */
export function glArgs(): string[] {
  const mode = (process.env.MVS_GL ?? 'auto').toLowerCase()
  const swiftshader = ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']
  switch (mode) {
    case 'swiftshader':
      return swiftshader
    case 'gpu':
      return ['--enable-gpu', '--ignore-gpu-blocklist']
    case 'egl':
      return ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist']
    case 'vulkan':
      return ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
    case 'metal':
      return ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
    default:
      return platform() === 'linux' ? swiftshader : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
  }
}

export async function launchBrowser(choice = findBrowser()): Promise<Browser> {
  const opts: LaunchOptions = {
    headless: true,
    args: [...glArgs(), '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  }
  if (choice.executablePath) opts.executablePath = choice.executablePath
  if (choice.channel) opts.channel = choice.channel
  try {
    return await chromium.launch(opts)
  } catch (e) {
    throw new CliError(`Could not launch the browser (${choice.source}): ${(e as Error).message.split('\n')[0]}`, 'Run `mvs doctor`. Set MVS_BROWSER=/path/to/chrome to use a specific browser.')
  }
}
