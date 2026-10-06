import { defineTimeline } from '@mvs/engine'
import { cta, features, hook, problem, product, proof } from './scenes/index.ts'

/**
 * Scene order and cuts. section('id') starts a scene just before that script
 * section is spoken, so the video re-times itself to any voiceover read.
 */
export default defineTimeline(({ section, end }) => [
  { scene: hook, start: 0 },
  { scene: problem, start: section('problem'), transition: { type: 'slide', direction: 'up' } },
  { scene: product, start: section('product'), transition: { type: 'zoom' } },
  { scene: features, start: section('features'), transition: { type: 'push', direction: 'left' } },
  { scene: proof, start: section('proof'), transition: { type: 'wipe', direction: 'left' } },
  { scene: cta, start: section('cta'), end: end(2), transition: { type: 'iris' } },
])
