/**
 * The scenes of this video (German starter). Most are configured templates —
 * change the text, icons and numbers here. `product` is a custom scene
 * (scenes/product.ts). Template catalog: docs/kit-and-templates.md.
 *
 * Text anchored to the voice (titles, `at:`) must use words from script.md.
 */

import { templates as T } from '@mvs/engine'
export { default as product } from './product.ts'

export const hook = T.title({ name: 'hook', eyebrow: 'Neu: Acme', title: 'Jedes Kundensignal. **Sofort.**' })

export const problem = T.kinetic({
  name: 'problem',
  mode: 'stack',
  lines: [{ text: 'Heute sind die Daten **verstreut.**' }, { text: 'Tabellen.' }, { text: 'Dashboards.' }, { text: 'Tickets, die niemand liest.' }],
  sfx: 'tap',
})

export const features = T.features({
  name: 'features',
  eyebrow: 'So funktioniert es',
  title: 'Signale rein. **Entscheidungen raus.**',
  features: [
    { icon: 'radar', title: 'Automatisch erfassen', text: 'Jede Bewertung, jedes Ticket, jeder Chat in einem Strom.', at: 'Signale' },
    { icon: 'trending-up', title: 'Trends erkennen', text: 'Themen tauchen in Echtzeit auf, nicht erst im nächsten Quartal.', at: 'Trends' },
    { icon: 'zap', title: 'Früh handeln', text: 'Hinweise erreichen das richtige Team, bevor es zu spät ist.', at: 'Handeln' },
  ],
})

export const proof = T.stats({
  name: 'proof',
  eyebrow: 'Ergebnis',
  title: 'Weniger suchen, mehr machen',
  stats: [{ value: 10, label: 'Stunden pro Woche gespart', format: { suffix: ' h' }, at: '10 Stunden' }],
  chart: [4, 6, 5, 8, 9, 8, 12, 14, 13, 17, 19],
})

export const cta = T.cta({ name: 'cta', title: 'Teste Acme heute kostenlos.', subtitle: 'Keine Kreditkarte. In Minuten eingerichtet.', button: 'Jetzt starten', url: 'acme.de' })
