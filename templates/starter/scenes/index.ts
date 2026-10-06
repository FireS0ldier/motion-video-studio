/**
 * The scenes of this video. Most are configured templates — change the text,
 * icons and numbers here. `product` is a custom scene (scenes/product.ts).
 * Template catalog: docs/kit-and-templates.md.
 */

import { templates as T } from '@mvs/engine'
export { default as product } from './product.ts'

export const hook = T.title({ name: 'hook', eyebrow: 'Introducing Acme', title: 'See every customer signal **the moment it happens**' })

export const problem = T.kinetic({
  name: 'problem',
  mode: 'stack',
  lines: [{ text: 'Today the data is **scattered.**' }, { text: 'Spreadsheets.' }, { text: 'Dashboards.' }, { text: 'Tickets nobody reads.' }],
  sfx: 'tap',
})

export const features = T.features({
  name: 'features',
  eyebrow: 'How it works',
  title: 'Signals in. **Decisions out.**',
  features: [
    { icon: 'radar', title: 'Capture automatically', text: 'Every review, ticket and chat in one stream.', at: 'Capture' },
    { icon: 'trending-up', title: 'Spot trends', text: 'Topics surface in real time, not next quarter.', at: 'Spot' },
    { icon: 'zap', title: 'Act early', text: 'Alerts reach the right team before it is too late.', at: 'Act' },
  ],
})

export const proof = T.stats({
  name: 'proof',
  eyebrow: 'Results',
  title: 'Less digging, more doing',
  stats: [{ value: 10, label: 'hours saved every week', format: { suffix: 'h' }, at: '10 hours' }],
  chart: [4, 6, 5, 8, 9, 8, 12, 14, 13, 17, 19],
})

export const cta = T.cta({ name: 'cta', title: 'Try Acme free today.', subtitle: 'No credit card. Set up in minutes.', button: 'Get started', url: 'acme.com' })
