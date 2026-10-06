/**
 * Product reveal drawn entirely with the kit (no screenshot needed):
 * a browser window with live UI that builds up in sync with the voiceover.
 * Replace it with templates.screenshot({ image: 'screens/app.png', ... }) once you have real screens.
 */

import { defineScene, kit, clamp01, spring } from '@mvs/engine'

export default defineScene({
  name: 'product',
  render(f, g) {
    const { stage } = f
    const { s, portrait } = kit.responsive(stage)
    kit.background(g, { kind: 'grid' })
    g.camera(kit.drift(f, { zoom: 0.04 }))

    const t0 = f.word('Meet').start
    g.text('Meet **Acme**', { x: stage.cx, y: portrait ? stage.h * 0.18 : stage.cy - 330 * s, style: 'h1', size: 88 * s, accent: 'gradient:brand', anim: { preset: 'mask', at: 'Meet' } })

    const enter = spring(f.t - t0 - 0.3, { stiffness: 110, damping: 18 })
    const w = Math.min(stage.title.w, 1180 * s)
    const h = w * 0.56
    g.layer({ w, h, y: (portrait ? stage.h * 0.55 : stage.cy + 90 * s) + (1 - Math.min(1, enter)) * 140, rotateX: 10 * (1 - enter) + 4, z: (1 - enter) * 500, opacity: clamp01(enter * 1.6), pad: 90, light: 0.4 }, (lg) => {
      kit.browser(lg, { x: w / 2, y: h / 2, w, h, url: 'app.acme.com' }, (screen) => {
        const pad = 28 * s
        const colW = (screen.w - pad * 4) / 3
        // three KPI cards that count up one after another
        const kpis: Array<[string, number, string]> = [
          ['Signals today', 12840, ''],
          ['Trending topics', 37, ''],
          ['Response time', 4, ' min'],
        ]
        kpis.forEach(([label, value, suffix], i) => {
          const x = screen.x + pad + colW / 2 + i * (colW + pad)
          const y = screen.y + pad + 60 * s
          const p = clamp01((f.t - t0 - 0.8 - i * 0.15) / 0.9)
          kit.card(lg, { x, y, w: colW, h: 120 * s, radius: 'md', opacity: clamp01(p * 3) })
          lg.text(label, { x: x - colW / 2 + 22 * s, y: y - 26 * s, size: 18 * s, color: 'muted', align: 'left', opacity: clamp01(p * 3) })
          lg.text(kit.formatNumber(value * p, { suffix }), { x: x - colW / 2 + 22 * s, y: y + 16 * s, size: 40 * s, weight: 700, font: 'numeric', align: 'left', opacity: clamp01(p * 3) })
        })
        // a chart that draws on
        const cy = screen.y + pad * 2 + 120 * s + (screen.h - pad * 3 - 120 * s) / 2
        kit.card(lg, { x: screen.x + screen.w / 2, y: cy, w: screen.w - pad * 2, h: screen.h - pad * 3 - 120 * s, radius: 'md' })
        kit.lineChart(lg, {
          x: screen.x + screen.w / 2,
          y: cy + 10 * s,
          w: screen.w - pad * 4,
          h: screen.h - pad * 3 - 200 * s,
          values: [8, 12, 10, 15, 14, 19, 18, 24, 22, 29, 33, 31, 38],
          progress: clamp01((f.t - t0 - 1.2) / 1.6),
          color: lg.color('primary'),
        })
      })
    })
  },
})
