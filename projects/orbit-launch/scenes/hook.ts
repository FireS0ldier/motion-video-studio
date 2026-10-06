/**
 * Hook (custom scene). Shows how to write a plate by hand:
 *  - a parallax "release train" on a depth plane that blurs when the story turns
 *  - two headlines synced word-by-word to the voiceover
 *  - a stale dashboard card rising in 3D, its warning badge timed to "behind"
 */

import { defineScene, kit, alpha, clamp01, spring, ease } from '@mvs/engine'

export default defineScene({
  name: 'hook',
  render(f, g) {
    const { stage } = f
    const { s, portrait } = kit.responsive(stage)
    kit.background(g, { kind: 'mesh', intensity: 0.45 })

    // story beats, found by content in the voiceover
    const turn = f.sentence('But your dashboards').start
    const turnP = ease('camera')(clamp01((f.t - turn + 0.1) / 0.9))

    // camera: slow push-in, then drift down toward the dashboard after the turn
    g.camera(kit.combine(f, kit.drift(f, { zoom: 0.05 }), { y: stage.cy + turnP * 40 }))

    // --- release train: pills scrolling left on a plane behind the text
    const pillY = portrait ? stage.h * 0.62 : stage.cy + 150 * s
    g.layer({ z: 260, blur: 9 * turnP, opacity: 1 - 0.55 * turnP, w: stage.w * 1.4, x: stage.cx }, (lg) => {
      const n = 12
      const spacing = 330 * s
      const scroll = f.lt * 150 * s
      for (let i = 0; i < n; i++) {
        const x = ((i * spacing - scroll) % (n * spacing) + n * spacing) % (n * spacing) - spacing
        const center = stage.w * 0.7
        const near = 1 - clamp01(Math.abs(x - center) / (spacing * 1.2))
        lg.group({ x, y: pillY, scale: 0.9 + 0.12 * near }, () => {
          kit.card(lg, { x: 0, y: 0, w: 270 * s, h: 82 * s, radius: 'pill', fill: near > 0.5 ? 'surface2' : 'surface', glow: near > 0.7 ? 'primary' : undefined, shadow: 'sm' })
          lg.circle({ x: -95 * s, y: 0, r: 20 * s, fill: alpha(lg.color('success'), 0.18) })
          lg.icon('check', { x: -95 * s, y: 0, size: 24 * s, color: 'success', stroke: 3 })
          lg.text(`v4.${18 + i}`, { x: -62 * s, y: -12 * s, size: 26 * s, weight: 700, align: 'left', font: 'numeric' })
          lg.text('shipped', { x: -62 * s, y: 16 * s, size: 19 * s, color: 'muted', align: 'left' })
        })
      }
      // the track
      lg.line({ from: [0, pillY + 70 * s], to: [stage.w * 1.4, pillY + 70 * s], stroke: alpha(lg.color('text'), 0.08), lineWidth: 2 })
    })

    // --- headline 1 (until the turn)
    const h1y = portrait ? stage.h * 0.33 : stage.cy - 150 * s
    if (f.t < turn + 0.6) {
      g.text('Your product ships **every week.**', {
        x: stage.cx,
        y: h1y,
        style: 'h1',
        size: 104 * s,
        maxWidth: stage.title.w,
        accent: 'gradient:brand',
        anim: { preset: 'rise', sync: 'voice', exit: { at: { at: turn - 0.15 }, duration: 0.4, preset: 'rise' } },
      })
    }

    // --- the stale dashboard (after the turn)
    const rise = spring(f.t - turn - 0.15, { stiffness: 120, damping: 18 })
    if (rise > 0.001) {
      const cw = (portrait ? 860 : 980) * s
      const ch = 470 * s
      const cardY = portrait ? stage.h * 0.62 : stage.cy + 170 * s
      g.layer({ w: cw, h: ch, y: cardY + (1 - Math.min(1, rise)) * 160, rotateX: 14 * (1 - rise) + 8, z: (1 - rise) * 300, opacity: clamp01(rise * 1.6), pad: 80, light: 0.5 }, (lg) => {
        kit.card(lg, { x: cw / 2, y: ch / 2, w: cw, h: ch, radius: 'lg', shadow: 'lg' })
        lg.text('Weekly product report', { x: 40 * s, y: 52 * s, size: 30 * s, weight: 650, align: 'left' })
        lg.text('Exported Tuesday, 09:12', { x: 40 * s, y: 86 * s, size: 19 * s, color: 'muted', align: 'left' })
        // amber "stale" badge pops when "behind" is spoken
        const badge = f.spring(f.word('behind'), 'bouncy')
        if (badge > 0.001) {
          lg.group({ x: cw - 180 * s, y: 60 * s, scale: Math.min(1.1, badge) }, () => kit.pill(lg, { x: 0, y: 0, label: 'Updated 7 days ago', icon: 'clock', color: 'warning', size: 20 * s }))
        }
        // three stale KPI tiles
        const tiles: Array<[string, string]> = [
          ['Signups', '1,204'],
          ['Activation', '38%'],
          ['Churn', '2.1%'],
        ]
        tiles.forEach(([label, value], i) => {
          const tw = (cw - 80 * s - 2 * 20 * s) / 3
          const tx = 40 * s + tw / 2 + i * (tw + 20 * s)
          const tp = clamp01((f.t - turn - 0.25 - i * 0.08) / 0.5)
          lg.group({ opacity: tp, y: (1 - tp) * 12 }, () => {
            lg.rect({ x: tx, y: 160 * s, w: tw, h: 92 * s, radius: 14 * s, fill: 'surface2' })
            lg.text(label, { x: tx - tw / 2 + 20 * s, y: 138 * s, size: 18 * s, color: 'muted', align: 'left' })
            lg.text(value, { x: tx - tw / 2 + 20 * s, y: 176 * s, size: 34 * s, weight: 700, align: 'left', font: 'numeric', color: alpha(lg.color('text'), 0.55) })
          })
        })
        // chart that stops early: data ends on Tuesday, a dotted gap until "today"
        const values = [32, 38, 35, 44, 41, 49, 47, 52]
        const left = 40 * s
        const w = cw - 80 * s
        const top = 240 * s
        const h = ch - 300 * s
        const known = 0.42
        kit.lineChart(lg, { x: left + (w * known) / 2, y: top + h / 2, w: w * known, h, values: values.slice(0, 4), min: 20, max: 60, progress: clamp01((f.t - turn - 0.3) / 0.9), color: lg.color('muted'), head: false })
        lg.line({ from: [left + w * known, top + h * 0.45], to: [left + w, top + h * 0.45], stroke: alpha(lg.color('muted'), 0.6), lineWidth: 3, dash: [6 * s, 10 * s], progress: clamp01((f.t - turn - 1.0) / 0.8) })
        lg.text('Tue', { x: left + w * known, y: top + h + 30 * s, size: 18 * s, color: 'muted' })
        lg.text('today', { x: left + w, y: top + h + 30 * s, size: 18 * s, color: 'muted', align: 'right' })
        lg.text('no new data', { x: left + w * 0.72, y: top + h * 0.45 - 26 * s, size: 19 * s, color: 'warning', opacity: clamp01((f.t - turn - 1.4) / 0.4) })
      })
      g.text('But your dashboards are **always one step behind.**', {
        x: stage.cx,
        y: portrait ? stage.h * 0.3 : stage.cy - 250 * s,
        style: 'h2',
        size: 72 * s,
        maxWidth: stage.title.w * 0.9,
        accent: 'warning',
        anim: { preset: 'mask', sync: 'voice' },
        marks: [{ text: 'one step behind', style: 'underline', color: 'warning' }],
      })
    }
  },
  cues(c) {
    const turn = c.word('But').start
    return [c.cue('tick', { at: c.word('every').start }, { gain: -10 }), c.cue('swipe', { at: turn }, { gain: -8 }), c.cue('notify', { at: c.word('behind').start }, { gain: -6 })]
  },
})
