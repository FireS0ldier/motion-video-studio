import { spawn, spawnSync, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Run a command, capture output. Rejects only if the binary cannot be started. */
export function run(cmd: string, args: string[], opts: SpawnOptions & { input?: string; echo?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (d: Buffer) => {
      stdout += d.toString()
      if (opts.echo) process.stdout.write(d)
    })
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (opts.echo) process.stderr.write(d)
    })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }))
    if (opts.input !== undefined) child.stdin!.end(opts.input)
    else child.stdin!.end()
  })
}

/** Absolute path of an executable on PATH, or null. */
export function which(cmd: string): string | null {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext)
      if (existsSync(p)) return p
    }
  }
  return null
}

export function runSync(cmd: string, args: string[]): RunResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error) : '') }
}
