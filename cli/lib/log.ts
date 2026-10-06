const tty = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)

export const color = {
  bold: c('1'),
  dim: c('2'),
  red: c('31'),
  green: c('32'),
  yellow: c('33'),
  blue: c('34'),
  magenta: c('35'),
  cyan: c('36'),
  gray: c('90'),
}

export const log = {
  info: (...a: unknown[]) => console.log(...a),
  step: (msg: string) => console.log(`${color.cyan('›')} ${msg}`),
  ok: (msg: string) => console.log(`${color.green('✓')} ${msg}`),
  warn: (msg: string) => console.log(`${color.yellow('!')} ${msg}`),
  error: (msg: string) => console.error(`${color.red('✗')} ${msg}`),
  dim: (msg: string) => console.log(color.gray(msg)),
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

/** Single-line progress (falls back to periodic lines when not a TTY). */
export function progress(label: string, total: number) {
  const start = Date.now()
  let last = 0
  return {
    update(done: number, extra = '') {
      const now = Date.now()
      if (done < total && now - last < (tty ? 120 : 5000)) return
      last = now
      const secs = (now - start) / 1000
      const rate = done / Math.max(1e-3, secs)
      const eta = rate > 0 ? (total - done) / rate : 0
      const pct = ((done / Math.max(1, total)) * 100).toFixed(1)
      const line = `${label} ${done}/${total} (${pct}%) · ${rate.toFixed(1)}/s · ETA ${fmtDuration(eta)}${extra ? ' · ' + extra : ''}`
      if (tty) process.stdout.write(`\r\x1b[2K${line}`)
      else console.log(line)
    },
    done(msg?: string) {
      if (tty) process.stdout.write('\r\x1b[2K')
      const secs = (Date.now() - start) / 1000
      log.ok(`${msg ?? label} in ${fmtDuration(secs)}`)
      return secs
    },
  }
}

export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return '?'
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, '0')}s`
}
