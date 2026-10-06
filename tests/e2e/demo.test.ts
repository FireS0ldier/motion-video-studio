/** The demo project must load, validate and render. */

import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')

function mvs(...args: string[]) {
  const r = spawnSync(process.execPath, [join(ROOT, 'cli', 'bin.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('orbit-launch demo', () => {
  it('has the expected structure', () => {
    const r = mvs('info', 'orbit-launch', '--json')
    expect(r.code, r.out).toBe(0)
    const m = JSON.parse(r.out.slice(r.out.indexOf('{'))) as { scenes: Array<{ id: string }>; width: number; fps: number; timing: { source: string; stale: boolean }; cues: unknown[] }
    expect(m.scenes.map((s) => s.id)).toEqual(['hook', 'intro', 'workspace', 'nomore', 'setup', 'ask', 'results', 'everything', 'cta'])
    expect([m.width, m.fps]).toEqual([1920, 60])
    expect(m.timing).toMatchObject({ source: 'ctc', stale: false })
    expect(m.cues.length).toBeGreaterThan(10)
  })

  it('passes mvs check without errors', () => {
    const r = mvs('check', 'orbit-launch', '--step', '1')
    expect(r.code, r.out).toBe(0)
  })

  it('renders stills of every scene', () => {
    const r = mvs('still', 'orbit-launch', '--t', '2.5,8,13,18,23,30,36,41,47', '--scale', '0.25', '--samples', '1', '--out', 'out/e2e-demo')
    expect(r.code, r.out).toBe(0)
    const files = readdirSync(join(ROOT, 'out', 'e2e-demo'))
    expect(files.length, r.out).toBe(9)
    expect(files.some((f) => f.includes('_setup_'))).toBe(true)
    rmSync(join(ROOT, 'out', 'e2e-demo'), { recursive: true, force: true })
  })
})
