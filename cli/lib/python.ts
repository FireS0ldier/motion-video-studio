/**
 * Runs the optional Python tools in tools/python through `uv` (ephemeral,
 * cached environments; nothing is installed globally). Falls back to a plain
 * `python3` that already has the packages.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { which, runSync } from './exec.ts'
import { CliError } from './log.ts'
import { TOOLS } from './paths.ts'

export interface PythonRunner {
  kind: 'uv' | 'python-m-uv' | 'python'
  describe: string
}

/** Python modules a pip requirement provides, e.g. "piper-tts[alignment]==1.8.0" → piper, onnx. */
export function importNames(requirement: string): string[] {
  const name = requirement.replace(/\[.*?\]/, '').replace(/[<>=!~;].*$/, '').trim().toLowerCase()
  const known: Record<string, string> = { 'piper-tts': 'piper', 'kokoro-onnx': 'kokoro_onnx', 'onnxruntime-gpu': 'onnxruntime' }
  const mods = [known[name] ?? name.replace(/-/g, '_')]
  if (/\[[^\]]*alignment/.test(requirement) && name === 'piper-tts') mods.push('onnx')
  return mods
}

export function findPythonRunner(): PythonRunner | null {
  if (which('uv')) return { kind: 'uv', describe: 'uv' }
  for (const py of ['python3', 'python']) {
    if (!which(py)) continue
    if (runSync(py, ['-m', 'uv', '--version']).code === 0) return { kind: 'python-m-uv', describe: `${py} -m uv` }
  }
  return null
}

function pythonExe(): string | null {
  return which('python3') ?? which('python')
}

/**
 * Run tools/python/<script> with the given packages available.
 * stderr is streamed (progress), stdout returned.
 */
export async function runPythonTool(script: string, args: string[], packages: string[], opts: { python?: string } = {}): Promise<string> {
  const runner = findPythonRunner()
  const file = join(TOOLS, 'python', script)
  let cmd: string
  let argv: string[]
  const withs = packages.flatMap((p) => ['--with', p])
  const py = opts.python ? ['--python', opts.python] : []
  if (runner?.kind === 'uv') {
    cmd = 'uv'
    argv = ['run', '--no-project', '--quiet', ...py, ...withs, 'python', file, ...args]
  } else if (runner?.kind === 'python-m-uv') {
    cmd = pythonExe()!
    argv = ['-m', 'uv', 'run', '--no-project', '--quiet', ...py, ...withs, 'python', file, ...args]
  } else {
    const exe = pythonExe()
    if (!exe) throw new CliError('Python is not installed.', 'Install uv (https://docs.astral.sh/uv/) — it manages Python and the packages for you.')
    const mods = packages.flatMap(importNames)
    const check = runSync(exe, ['-c', mods.map((m) => `import ${m}`).join(';')])
    if (check.code !== 0) throw new CliError(`Python packages missing: ${packages.join(', ')}`, 'Install uv (https://docs.astral.sh/uv/) and re-run; it provides them automatically.')
    cmd = exe
    argv = [file, ...args]
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', UV_NO_PROGRESS: '1' } })
    let out = ''
    let err = ''
    let lineStart = true
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err += s
      // prefix tool output so it is visually nested under the CLI step
      let pretty = ''
      for (const ch of s) {
        if (lineStart && ch !== '\n') pretty += '  │ '
        pretty += ch
        lineStart = ch === '\n'
      }
      process.stderr.write(pretty)
    })
    child.on('close', () => lineStart || process.stderr.write('\n'))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new CliError(`${script} failed (exit ${code}).`, err.trim().split('\n').slice(-4).join('\n')))
    })
  })
}
