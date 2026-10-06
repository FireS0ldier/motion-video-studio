import { defineProject } from '@mvs/engine'
import brand from './brand.ts'
import timeline from './timeline.ts'

/**
 * {{title}}
 *
 * Voiceover: put it at assets/audio/voiceover.wav (or run `npx mvs voice {{id}}`);
 * it is picked up automatically. Set audio.voiceover explicitly to add an offset.
 * Until then the timing is estimated from script.md, so the video is already
 * watchable in the preview.
 */
export default defineProject({
  title: '{{title}}',
  format: 'landscape', // landscape | vertical | square | portrait45 | ... (mvs new --format)
  brand,
  timeline,
  audio: {
    music: { src: '../../assets/music/ambient-pulse.ogg', gain: -18, duck: 9 },
    master: { lufs: -14 },
  },
})
