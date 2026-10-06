/**
 * Vite server for preview and rendering, plus a "frame sink": an HTTP
 * endpoint the headless page POSTs raw frames / PNGs to. Binary over local
 * HTTP is much faster than shuttling base64 through the DevTools protocol.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { ROOT } from './paths.ts'

export type SinkHandler = (body: Buffer, path: string) => Promise<void> | void

export interface StudioServer {
  vite: ViteDevServer
  url: string
  /** Register a sink; returns its URL prefix. */
  sink(id: string, handler: SinkHandler): string
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] ?? 0)
    if (len > 0) {
      const buf = Buffer.allocUnsafe(len)
      let off = 0
      req.on('data', (d: Buffer) => {
        d.copy(buf, off)
        off += d.length
      })
      req.on('end', () => resolve(off === len ? buf : buf.subarray(0, off)))
    } else {
      const parts: Buffer[] = []
      req.on('data', (d: Buffer) => parts.push(d))
      req.on('end', () => resolve(Buffer.concat(parts)))
    }
    req.on('error', reject)
  })
}

export async function startServer(opts: { hmr: boolean; port?: number; host?: boolean | string; project?: string; quiet?: boolean }): Promise<StudioServer> {
  const sinks = new Map<string, SinkHandler>()
  const plugin: Plugin = {
    name: 'mvs-frame-sink',
    configureServer(server) {
      server.middlewares.use('/__mvs/sink/', (req: IncomingMessage, res: ServerResponse) => {
        const path = (req.url ?? '').replace(/^\//, '')
        const id = path.split('/')[0]!
        const handler = sinks.get(id)
        if (req.method !== 'POST' || !handler) {
          res.statusCode = 404
          res.end('no sink')
          return
        }
        readBody(req)
          .then((body) => handler(body, path))
          .then(() => {
            res.statusCode = 200
            res.end('ok')
          })
          .catch((e: Error) => {
            res.statusCode = 500
            res.end(String(e?.message ?? e))
          })
      })
    },
  }
  if (opts.project) process.env.MVS_PROJECT = opts.project
  const vite = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: opts.quiet ? 'error' : 'info',
    server: {
      port: opts.port ?? (opts.hmr ? 5173 : 0),
      strictPort: false,
      host: opts.host,
      hmr: opts.hmr,
      watch: opts.hmr ? undefined : null,
    },
    plugins: [plugin],
  })
  await vite.listen()
  const address = vite.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 5173)
  return {
    vite,
    url: `http://localhost:${port}`,
    sink(id, handler) {
      sinks.set(id, handler)
      return `/__mvs/sink/${id}`
    },
    close: () => vite.close(),
  }
}
