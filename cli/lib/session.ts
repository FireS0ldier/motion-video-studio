/**
 * A headless render session: one Vite server + N browser pages in render
 * mode. Each page owns its own WebGL context and renders frames on demand.
 */

import type { Browser, Page } from 'playwright-core'
import type { BridgeRenderOptions, CheckReport } from '../../engine/player/bridge.ts'
import type { FrameStats } from '../../engine/core/renderer.ts'
import type { Manifest } from '../../engine/core/types.ts'
import { findBrowser, launchBrowser } from './browser.ts'
import { CliError, log } from './log.ts'
import { startServer, type SinkHandler, type StudioServer } from './server.ts'

export interface SessionOptions {
  project: string
  scale: number
  quality: 'draft' | 'final' | 'preview'
  workers?: number
  format?: string
  /** Print browser console output. */
  verbose?: boolean
}

export interface Worker {
  page: Page
  browser: Browser
  send(frame: number, sinkUrl: string, o?: BridgeRenderOptions): Promise<FrameStats>
  render(frame: number, o?: BridgeRenderOptions): Promise<FrameStats>
}

export interface Session {
  server: StudioServer
  manifest: Manifest
  workers: Worker[]
  sink(id: string, handler: SinkHandler): string
  check(step: number): Promise<CheckReport>
  contact(times: number[], cols: number, url: string): Promise<{ width: number; height: number }>
  close(): Promise<void>
}

async function openPage(browser: Browser, url: string, verbose: boolean): Promise<{ page: Page; manifest: Manifest }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors: string[] = []
  page.on('console', (m) => {
    const type = m.type()
    if (verbose || type === 'error') {
      const text = m.text()
      if (type === 'error') errors.push(text)
      if (verbose) log.dim(`[browser:${type}] ${text}`)
    }
  })
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForFunction(() => window.__MVS_READY__ !== undefined || window.__MVS_ERROR__ !== undefined, null, { timeout: 120_000 })
  const result = await page.evaluate(async () => {
    try {
      return { manifest: await window.__MVS_READY__!, error: null as string | null }
    } catch (e) {
      return { manifest: null, error: window.__MVS_ERROR__ ?? String(e) }
    }
  })
  if (!result.manifest) {
    throw new CliError(`The project failed to load in the renderer:\n${result.error ?? 'unknown error'}${errors.length ? '\n' + errors.join('\n') : ''}`, 'Open the preview (`mvs dev`) to see the error in context.')
  }
  return { page, manifest: result.manifest }
}

export async function openSession(o: SessionOptions): Promise<Session> {
  const server = await startServer({ hmr: false, quiet: !o.verbose })
  const choice = findBrowser()
  const n = Math.max(1, o.workers ?? 1)
  const params = new URLSearchParams({ mode: 'render', project: o.project, scale: String(o.scale), quality: o.quality })
  if (o.format) params.set('format', o.format)
  const url = `${server.url}/?${params}`
  const browsers: Browser[] = []
  try {
    const workers: Worker[] = []
    let manifest: Manifest | null = null
    // one browser per worker: each gets its own GPU process (true parallelism with SwiftShader)
    const opened = await Promise.all(
      Array.from({ length: n }, async () => {
        const browser = await launchBrowser(choice)
        browsers.push(browser)
        const { page, manifest: m } = await openPage(browser, url, !!o.verbose)
        return { browser, page, manifest: m }
      }),
    )
    for (const { browser, page, manifest: m } of opened) {
      manifest ??= m
      workers.push({
        page,
        browser,
        send: (frame, sinkUrl, opts) => page.evaluate(([f, u, op]) => window.__MVS__!.send(f, u, op), [frame, sinkUrl, opts ?? {}] as const),
        render: (frame, opts) => page.evaluate(([f, op]) => window.__MVS__!.render(f, op), [frame, opts ?? {}] as const),
      })
    }
    const first = workers[0]!
    return {
      server,
      manifest: manifest!,
      workers,
      sink: (id, h) => server.sink(id, h),
      check: (step) => first.page.evaluate((s) => window.__MVS__!.check(s), step),
      contact: (times, cols, u) => first.page.evaluate(([t, c, uu]) => window.__MVS__!.contact(t, c, uu), [times, cols, u] as const),
      async close() {
        await Promise.allSettled(browsers.map((b) => b.close()))
        await server.close()
      },
    }
  } catch (e) {
    await Promise.allSettled(browsers.map((b) => b.close()))
    await server.close()
    throw e
  }
}
