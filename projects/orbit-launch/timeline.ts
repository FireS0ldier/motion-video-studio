import { defineTimeline } from '@mvs/engine'
import { ask, cta, everything, hook, intro, nomore, results, setup, workspace } from './scenes/index.ts'

/**
 * When each plate plays. Starts are anchored to script sections, so a new
 * voiceover read re-times everything after `mvs align`.
 * Transitions are centered on the cut and bring their own whoosh.
 */
export default defineTimeline(({ section, end }) => [
  { scene: hook, start: 0 },
  { scene: intro, start: section('intro'), transition: { type: 'zoom' } },
  { scene: workspace, start: section('workspace'), transition: { type: 'slide', direction: 'left' } },
  { scene: nomore, start: section('nomore'), transition: { type: 'whip', direction: 'up' } },
  { scene: setup, start: section('setup'), transition: { type: 'glitch' } },
  { scene: ask, start: section('ask'), transition: { type: 'push', direction: 'left' } },
  { scene: results, start: section('results'), transition: { type: 'blur' } },
  { scene: everything, start: section('everything') },
  { scene: cta, start: section('cta'), end: end(2.2), transition: { type: 'iris' } },
])
