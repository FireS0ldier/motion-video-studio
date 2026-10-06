/**
 * Code editor and terminal panels with syntax highlighting and typing
 * animation. The tokenizer is a small regex lexer: good enough for video,
 * no heavy dependency.
 */

import type { Anchor } from '../core/scene.ts'
import type { Graphics } from '../gfx/graphics.ts'
import { alpha } from '../gfx/color.ts'
import { clamp01 } from '../motion/tween.ts'

export type TokenType = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'punct' | 'prop' | 'tag'

export interface Token {
  text: string
  type: TokenType
}

export const codeTheme: Record<TokenType, string> = {
  plain: '#d7dae0',
  keyword: '#c792ea',
  string: '#a5e075',
  number: '#f78c6c',
  comment: '#6b7280',
  function: '#82aaff',
  type: '#ffcb6b',
  punct: '#89ddff',
  prop: '#f07178',
  tag: '#f07178',
}

const KEYWORDS: Record<string, string[]> = {
  ts: 'import export from const let var function return if else for while await async new class extends implements interface type enum public private readonly static of in as default try catch throw yield true false null undefined this'.split(' '),
  py: 'import from def return if elif else for while in as with class try except raise yield lambda async await True False None self pass not and or is'.split(' '),
  sh: 'npm npx pnpm yarn bun git cd ls echo export curl sudo mvs node python uv pip brew'.split(' '),
  json: ['true', 'false', 'null'],
}

/** Tokenize one line. `lang`: ts | js | tsx | py | sh | bash | json | plain. */
export function tokenizeLine(line: string, lang = 'ts'): Token[] {
  const l = lang === 'js' || lang === 'tsx' || lang === 'jsx' ? 'ts' : lang === 'bash' || lang === 'shell' ? 'sh' : lang
  const kw = new Set(KEYWORDS[l] ?? [])
  const out: Token[] = []
  const commentRe = l === 'py' || l === 'sh' ? /^#.*/ : /^\/\/.*/
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d"'`]+)/y
  let i = 0
  while (i < line.length) {
    const rest = line.slice(i)
    const cm = commentRe.exec(rest)
    if (cm && l !== 'json') {
      out.push({ text: cm[0], type: 'comment' })
      break
    }
    re.lastIndex = i
    const m = re.exec(line)
    if (!m) {
      out.push({ text: line[i]!, type: 'plain' })
      i++
      continue
    }
    const [text, str, num, ident, ws] = m
    let type: TokenType = 'plain'
    if (str) type = l === 'json' && /^\s*:/.test(line.slice(i + text.length)) ? 'prop' : 'string'
    else if (num) type = 'number'
    else if (ident) {
      const next = line.slice(i + text.length)
      if (kw.has(ident)) type = 'keyword'
      else if (/^\s*\(/.test(next)) type = 'function'
      else if (/^[A-Z]/.test(ident)) type = 'type'
      else if (/^\s*:/.test(next) && l === 'ts') type = 'prop'
      else if (l === 'sh' && out.length === 0) type = 'function'
    } else if (!ws) type = 'punct'
    out.push({ text, type })
    i += text.length
  }
  return out
}

export interface CodeOptions {
  x: number
  y: number
  w: number
  h?: number
  code: string
  lang?: string
  title?: string
  /** Typing animation start (anchor). Omit for static code. */
  typeAt?: Anchor
  /** Characters per second while typing. */
  cps?: number
  /** Line numbers (1-based) to highlight, with optional start anchor. */
  highlight?: number[]
  highlightAt?: Anchor
  fontSize?: number
  lineNumbers?: boolean
  opacity?: number
}

/** Editor window centered on (x, y). Returns the number of typed characters. */
export function codeBlock(g: Graphics, o: CodeOptions): number {
  const f = g.f
  const size = o.fontSize ?? 26
  const lh = size * 1.55
  const lines = o.code.replace(/\t/g, '  ').split('\n')
  const header = 50
  const pad = size * 1.1
  const h = o.h ?? header + pad * 1.6 + lines.length * lh
  const left = o.x - o.w / 2
  const top = o.y - h / 2
  const total = o.code.length
  const typed = o.typeAt === undefined ? total : Math.floor(clamp01(f.since(o.typeAt) * (o.cps ?? 38) / Math.max(1, total)) * total)
  const gutter = o.lineNumbers === false ? 0 : size * 2.4
  g.group({ opacity: o.opacity }, () => {
    g.rect({ x: o.x, y: o.y, w: o.w, h, radius: 18, fill: '#0d0f14', shadow: 'lg' })
    g.rect({ x: o.x, y: top + header / 2, w: o.w, h: header, radius: [18, 18, 0, 0], fill: '#161922' })
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => g.circle({ x: left + 24 + i * 22, y: top + header / 2, r: 6.5, fill: c }))
    if (o.title) {
      g.rect({ x: left + 96, y: top + header / 2 + 4, w: g.measure(o.title, { size: 17 }).w + 36, h: header - 8, radius: [10, 10, 0, 0], fill: '#0d0f14', anchor: 'left' })
      g.text(o.title, { x: left + 114, y: top + header / 2 + 5, size: 17, weight: 500, color: '#c9ccd4', align: 'left' })
    }
    g.rect({ x: o.x, y: o.y, w: o.w - 1, h: h - 1, radius: 18, stroke: 'rgba(255,255,255,0.08)', lineWidth: 1.5 })
    const hp = o.highlight ? clamp01(f.since(o.highlightAt ?? o.typeAt ?? 0) / 0.4) : 0
    const ctx = g.ctx
    const mono = g.brand.fonts.mono
    ctx.font = `450 ${size}px "${mono.family}", ${mono.fallback ?? 'monospace'}`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    const charW = ctx.measureText('M').width
    let remaining = typed
    const state: { caret: [number, number] | null } = { caret: null }
    lines.forEach((line, li) => {
      const y = top + header + pad + li * lh + size * 0.78
      if (o.highlight?.includes(li + 1) && hp > 0) {
        g.rect({ x: left + 4, y: y - size * 0.33, w: (o.w - 8) * hp, h: lh, anchor: 'left', fill: alpha(g.color('primary'), 0.16) })
        g.rect({ x: left + 4, y: y - size * 0.33, w: 4, h: lh, anchor: 'left', fill: g.color('primary'), opacity: hp })
      }
      if (gutter) {
        ctx.fillStyle = '#4b5263'
        ctx.textAlign = 'right'
        ctx.fillText(String(li + 1), left + gutter - size * 0.4 + pad * 0.3, y)
        ctx.textAlign = 'left'
      }
      if (remaining < 0) return
      let x = left + gutter + pad * 0.6
      for (const tk of tokenizeLine(line, o.lang)) {
        if (remaining <= 0) break
        const visible = tk.text.slice(0, remaining)
        ctx.fillStyle = codeTheme[tk.type]
        ctx.fillText(visible, x, y)
        x += visible.length * charW
        remaining -= visible.length
      }
      if (remaining >= 0) state.caret = [x, y]
      remaining -= 1 // newline
    })
    if (o.typeAt !== undefined) {
      const done = typed >= total
      const blink = done ? Math.floor(f.t * 2.2) % 2 === 0 : true
      const pos = state.caret
      if (pos && blink) g.rect({ x: pos[0] + 2, y: pos[1] - size * 0.32, w: size * 0.08, h: size * 1.1, fill: g.color('accent') })
    }
  })
  return typed
}

export interface TerminalLine {
  /** Command typed after the prompt; omit for output lines. */
  cmd?: string
  /** Output text shown after the command finishes. */
  out?: string
  /** When typing starts (anchor). */
  at: Anchor
  color?: string
}

/** Terminal panel with typed commands and appearing output. */
export function terminal(g: Graphics, o: { x: number; y: number; w: number; h: number; lines: TerminalLine[]; title?: string; fontSize?: number; prompt?: string; opacity?: number }) {
  const f = g.f
  const size = o.fontSize ?? 24
  const lh = size * 1.6
  const left = o.x - o.w / 2
  const top = o.y - o.h / 2
  g.group({ opacity: o.opacity }, () => {
    g.rect({ x: o.x, y: o.y, w: o.w, h: o.h, radius: 16, fill: '#0b0d12', shadow: 'lg', stroke: 'rgba(255,255,255,0.08)', lineWidth: 1.5 })
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => g.circle({ x: left + 22 + i * 20, y: top + 22, r: 6, fill: c }))
    if (o.title) g.text(o.title, { x: o.x, y: top + 23, size: 16, color: '#8b91a3' })
    const ctx = g.ctx
    const mono = g.brand.fonts.mono
    ctx.font = `450 ${size}px "${mono.family}", monospace`
    ctx.textAlign = 'left'
    let y = top + 64 + size * 0.5
    for (const line of o.lines) {
      const since = f.since(line.at)
      if (since < 0) break
      if (line.cmd !== undefined) {
        const prompt = o.prompt ?? '❯'
        const n = Math.floor(since * 32)
        ctx.fillStyle = g.color('accent')
        ctx.fillText(prompt, left + 24, y)
        ctx.fillStyle = '#e6e8ee'
        const shown = line.cmd.slice(0, n)
        ctx.fillText(shown, left + 24 + size * 1.3, y)
        if (n < line.cmd.length || Math.floor(f.t * 2.2) % 2 === 0) {
          const cx = left + 24 + size * 1.3 + ctx.measureText(shown).width + 3
          if (n <= line.cmd.length) {
            ctx.fillStyle = alpha('#e6e8ee', 0.9)
            ctx.fillRect(cx, y - size * 0.8, size * 0.55, size * 1.0)
          }
        }
        y += lh
        if (line.out && n > line.cmd.length + 6) {
          for (const outLine of line.out.split('\n')) {
            ctx.fillStyle = line.color ? g.color(line.color) : '#9aa0ad'
            ctx.fillText(outLine, left + 24, y)
            y += lh
          }
        }
      } else if (line.out) {
        for (const outLine of line.out.split('\n')) {
          ctx.fillStyle = line.color ? g.color(line.color) : '#9aa0ad'
          ctx.fillText(outLine, left + 24, y)
          y += lh
        }
      }
    }
  })
}
