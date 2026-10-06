/**
 * Generates the demo's product assets from the HTML mockups in this folder:
 *   assets/screens/dashboard.png           (2400x1500)
 *   assets/screens/phone-ask|answer|share.png (780x1688)
 *   assets/recordings/dashboard-live.mp4   (1600x1000, 30 fps, 9 s)
 *
 * Run: npx tsx projects/orbit-launch/assets-src/make-assets.ts
 *
 * This is also a pattern for real projects without screenshots: build a quick
 * HTML mock of the UI and capture it deterministically.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from '../../../cli/lib/browser.ts'
import { ffmpeg } from '../../../cli/lib/ffmpeg.ts'
import { startServer } from '../../../cli/lib/server.ts'

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'assets')
// served over http (file:// pages cannot load web fonts)
const server = await startServer({ hmr: false, quiet: true })
const url = (file: string, q = '') => `${server.url}/projects/orbit-launch/assets-src/${file}${q}`

const browser = await launchBrowser()
try {
  mkdirSync(join(assets, 'screens'), { recursive: true })
  mkdirSync(join(assets, 'recordings'), { recursive: true })

  // dashboard still
  const dash = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })
  await dash.goto(url('dashboard.html'))
  await dash.evaluate(() => document.fonts.ready)
  await dash.evaluate(() => (window as unknown as { render(t: number): void }).render(6))
  await dash.screenshot({ path: join(assets, 'screens', 'dashboard.png') })
  console.log('screens/dashboard.png')

  // phone screens
  for (const s of ['ask', 'answer', 'share']) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    await p.goto(url('phone.html', `?s=${s}`))
    await p.evaluate(() => document.fonts.ready)
    await p.screenshot({ path: join(assets, 'screens', `phone-${s}.png`) })
    console.log(`screens/phone-${s}.png`)
  }

  // screen recording: frame-exact capture of the animated dashboard
  const rec = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  await rec.goto(url('dashboard.html'))
  await rec.evaluate(() => document.fonts.ready)
  const tmp = join(here, '.frames')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp)
  const fps = 30
  const seconds = 9
  for (let i = 0; i < fps * seconds; i++) {
    await rec.evaluate((t) => (window as unknown as { render(t: number): void }).render(t), i / fps)
    await rec.screenshot({ path: join(tmp, `${String(i).padStart(5, '0')}.png`) })
  }
  await ffmpeg(['-framerate', String(fps), '-i', join(tmp, '%05d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', join(assets, 'recordings', 'dashboard-live.mp4')])
  rmSync(tmp, { recursive: true, force: true })
  console.log('recordings/dashboard-live.mp4')
} finally {
  await browser.close()
  await server.close()
}
