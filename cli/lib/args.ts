export interface Args {
  _: string[]
  flags: Record<string, string | boolean>
  str(name: string, fallback?: string): string | undefined
  num(name: string, fallback?: number): number | undefined
  bool(name: string, fallback?: boolean): boolean
  has(name: string): boolean
}

/** Tiny argv parser: positionals, --flag value, --flag=value, --bool, --no-bool. */
export function parseArgs(argv: string[], booleans: string[] = []): Args {
  const _: string[] = []
  const flags: Record<string, string | boolean> = {}
  const bools = new Set(['help', 'verbose', ...booleans])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') {
      _.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
        continue
      }
      const name = a.slice(2)
      if (name.startsWith('no-')) {
        flags[name.slice(3)] = false
        continue
      }
      const next = argv[i + 1]
      if (!bools.has(name) && next !== undefined && !next.startsWith('--')) {
        flags[name] = next
        i++
      } else flags[name] = true
      continue
    }
    if (a === '-h') {
      flags.help = true
      continue
    }
    _.push(a)
  }
  return {
    _,
    flags,
    str: (n, f) => (typeof flags[n] === 'string' ? (flags[n] as string) : f),
    num: (n, f) => {
      const v = flags[n]
      if (typeof v !== 'string') return f
      const x = Number(v)
      if (!Number.isFinite(x)) throw new Error(`--${n} expects a number, got "${v}"`)
      return x
    },
    bool: (n, f = false) => (typeof flags[n] === 'boolean' ? (flags[n] as boolean) : flags[n] === undefined ? f : flags[n] !== 'false'),
    has: (n) => flags[n] !== undefined,
  }
}
