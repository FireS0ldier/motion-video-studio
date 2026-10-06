import { defineProject } from '@mvs/engine'
import brand from './brand.ts'
import timeline from './timeline.ts'

/**
 * Orbit — launch film (demo project).
 * 1920x1080 @ 60 fps, voiceover-driven, ~50 s.
 */
export default defineProject({
  title: 'Orbit — launch film',
  format: 'landscape',
  brand,
  timeline,
  audio: {
    voiceover: { src: 'assets/audio/voiceover.wav', offset: 0.5 },
    music: { src: '../../assets/music/ambient-pulse.ogg', gain: -18, duck: 9, fadeOut: 2.5 },
    sfx: { gain: -2, duck: 4 },
    master: { lufs: -14 },
  },
  // extra sound design on top of the scene and transition cues
  cues: (c) => [c.cue('riser', { at: c.section('intro').start - 0.1 }, { align: 'peak', gain: -12 })],
})
