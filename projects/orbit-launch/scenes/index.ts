/**
 * The plates of the Orbit launch film. Most are configured templates
 * (engine/templates); `hook` is a hand-written custom scene.
 */

import { templates as T } from '@mvs/engine'
export { default as hook } from './hook.ts'

export const intro = T.logoScene({ name: 'intro', at: 'Orbit', tagline: 'Real-time product analytics that keeps up with your team.' })

export const workspace = T.recording({
  name: 'workspace',
  video: 'recordings/dashboard-live.mp4',
  url: 'app.orbit.dev/overview',
  eyebrow: 'Live workspace',
  title: 'Every event. Every funnel. **Every journey.**',
  side: 'left',
  callouts: [
    { x: 0.32, y: 0.52, label: 'Events', icon: 'activity', at: 'event' },
    { x: 0.83, y: 0.3, label: 'Funnels', icon: 'filter', at: 'funnel' },
    { x: 0.83, y: 0.72, label: 'Journeys', icon: 'route', at: 'journey' },
  ],
  zoom: { x: 0.45, y: 0.55, scale: 1.28, at: 'live', duration: 1.4 },
})

export const nomore = T.kinetic({
  name: 'nomore',
  lines: [{ text: 'No more waiting.' }, { text: 'No more guessing.' }, { text: 'No more **stale reports.**' }],
})

export const setup = T.code({
  name: 'setup',
  eyebrow: 'Setup',
  title: 'One line of code.',
  subtitle: 'Drop in the SDK. Events stream in milliseconds.',
  file: 'app.ts',
  lang: 'ts',
  code: [
    "import { orbit } from '@orbit/sdk'",
    '',
    'orbit.init({ key: process.env.ORBIT_KEY })',
    '',
    '// every event is now live',
    "orbit.track('signup_completed', { plan: 'pro' })",
  ].join('\n'),
  typeAt: 'Setup',
  cps: 46,
  highlight: [3],
  highlightAt: 'one line',
  terminal: [
    { cmd: 'npm i @orbit/sdk', at: 'Drop in', out: '+ @orbit/sdk 3.2.0 · added 1 package in 0.9s' },
    { out: '● streaming events · p95 12 ms', at: 'milliseconds', color: 'success' },
  ],
})

export const ask = T.phoneShowcase({
  name: 'ask',
  screens: [{ image: 'screens/phone-ask.png' }, { image: 'screens/phone-answer.png' }, { image: 'screens/phone-share.png' }],
  eyebrow: 'Ask Orbit',
  title: 'Questions in. **Answers out.**',
  bullets: [
    { text: 'Ask in plain English', at: 'plain English' },
    { text: 'Get the answer as a chart', at: 'answers' },
    { text: 'Share it with your team', at: 'share' },
  ],
})

export const results = T.stats({
  name: 'results',
  eyebrow: 'Results',
  title: 'Teams on Orbit ship faster',
  stats: [
    { value: 40, label: 'faster releases', format: { suffix: '%' }, at: '40%' },
    { value: 3, label: 'fewer rollbacks', format: { suffix: '×' }, at: '3×' },
  ],
  chart: [12, 14, 13, 17, 19, 18, 23, 26, 25, 31, 34, 38, 37, 44, 49],
})

export const everything = T.montage({
  name: 'everything',
  words: [
    { text: 'Funnels.', icon: 'filter' },
    { text: 'Retention.', icon: 'repeat' },
    { text: 'Cohorts.', icon: 'users' },
    { text: 'Alerts.', icon: 'bell-ring' },
  ],
})

export const cta = T.cta({
  name: 'cta',
  title: 'See your product clearly.',
  subtitle: 'Real-time analytics for teams that ship.',
  button: 'Start free',
  url: 'orbit.dev',
})
