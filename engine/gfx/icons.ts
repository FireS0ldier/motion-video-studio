/**
 * Icons from Lucide (ISC license, 1500+ icons, https://lucide.dev/icons).
 * Use the kebab-case names from the website: g.icon('rocket'), g.icon('bar-chart-3').
 */

import { icons as lucide } from 'lucide'

type IconNode = Array<[string, Record<string, string | number>]>

const cache = new Map<string, Path2D[] | null>()

function pascal(name: string): string {
  return name
    .replace(/(^|[-_\s]+)([a-z0-9])/gi, (_, __, c: string) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '')
}

const num = (v: string | number | undefined, d = 0) => (v === undefined ? d : Number(v))

function toPaths(node: IconNode): Path2D[] {
  const out: Path2D[] = []
  for (const [tag, a] of node) {
    switch (tag) {
      case 'path':
        out.push(new Path2D(String(a.d)))
        break
      case 'circle': {
        const p = new Path2D()
        p.arc(num(a.cx), num(a.cy), num(a.r), 0, Math.PI * 2)
        out.push(p)
        break
      }
      case 'ellipse': {
        const p = new Path2D()
        p.ellipse(num(a.cx), num(a.cy), num(a.rx), num(a.ry), 0, 0, Math.PI * 2)
        out.push(p)
        break
      }
      case 'rect': {
        const p = new Path2D()
        const r = num(a.rx, num(a.ry))
        p.roundRect(num(a.x), num(a.y), num(a.width), num(a.height), r)
        out.push(p)
        break
      }
      case 'line': {
        const p = new Path2D()
        p.moveTo(num(a.x1), num(a.y1))
        p.lineTo(num(a.x2), num(a.y2))
        out.push(p)
        break
      }
      case 'polyline':
      case 'polygon': {
        const pts = String(a.points)
          .trim()
          .split(/[\s,]+/)
          .map(Number)
        const p = new Path2D()
        for (let i = 0; i + 1 < pts.length; i += 2) (i === 0 ? p.moveTo : p.lineTo).call(p, pts[i]!, pts[i + 1]!)
        if (tag === 'polygon') p.closePath()
        out.push(p)
        break
      }
    }
  }
  return out
}

/** Path2D list of a Lucide icon in its 24x24 box, or null if the name is unknown. */
export function iconPaths(name: string): Path2D[] | null {
  if (cache.has(name)) return cache.get(name)!
  const table = lucide as unknown as Record<string, IconNode>
  const node = table[pascal(name)] ?? table[name]
  const paths = node ? toPaths(node) : null
  cache.set(name, paths)
  return paths
}

export function iconNames(): string[] {
  return Object.keys(lucide).map((k) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase())
}
