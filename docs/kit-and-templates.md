# Kit and templates

Two levels of reuse on top of the [scene API](scene-api.md):

- **Kit** (`kit.*`) — components you call inside `render(f, g)`: backgrounds, devices, UI, charts, code, captions, logo, camera moves, layout helpers.
- **Templates** (`templates.*`) — complete, parameterized scenes. A typical product video is 70 % templates and 30 % custom scenes.

```ts
import { defineScene, kit, templates as T } from '@mvs/engine'
```

Kit components are positioned by their **center**, read time from `g.f`, use brand tokens, and scale with the `size`/`w`/`h` you give them. Templates are responsive (16:9, 9:16, 1:1) and anchor their beats to the voiceover where the text matches.

---

## Kit

### Layout

| Function | Returns |
| --- | --- |
| `kit.responsive(f.stage)` | `{ s, portrait, square, landscape, area }` — `s` is the size multiplier vs. 1080p (0.72–2), `area` the title-safe rect |
| `kit.row(n, { x, w, gap?, item? })` | x centers of `n` items in a row |
| `kit.grid(n, cols, rect, gap?)` | `n` cell rects |
| `kit.split(rect, ratio, gap, vertical)` | Two rects (e.g. text | media; stacked on portrait) |
| `kit.center(rect)` | `[cx, cy]` |
| `kit.fitBox(w, h, into, 'contain' \| 'cover')` | A rect with the aspect ratio of `w×h` fitted into `into` |
| `kit.inset(rect, d)` | Shrunk rect |

```ts
const { s, portrait } = kit.responsive(f.stage)
const [text, media] = kit.split(f.stage.title, portrait ? 0.35 : 0.42, 60 * s, portrait)
```

### Backgrounds

```ts
kit.background(g, { kind: 'mesh' })     // mesh | aurora | grid | dots | spotlight | gradient | solid
kit.background(g, { kind: 'grid', colors: ['#7c5cff'], intensity: 0.6, speed: 0.5, cell: 80, depth: 400 })
kit.particles(g, { count: 40, color: 'accent', size: [1, 3], speed: 1, opacity: 0.5 })
kit.sheen(g, { x, y, w, h, progress: f.in(0.4, 1), radius: 28 })            // light sweep over a card
kit.meshGradient(g, o) / kit.gridLines(g, o) / kit.dots(g, o) / kit.aurora(g, o)   // individual layers
```

Always paint a background first. `depth` puts it on a parallax plane (moves with the camera); default is screen-locked.

### Devices

```ts
const screen = kit.browser(g, { x, y, w: 1400, h: 860, url: 'app.acme.com', title: 'Acme', theme: 'dark', radius: 18, shadow: 'lg', minimal: false },
  (sc) => g.image('screens/app.png', { x: sc.x + sc.w / 2, y: sc.y + sc.h / 2, w: sc.w, h: sc.h, fit: 'cover', focus: [0.5, 0] }))

kit.phone(g, { x, y, h: 820, color: '#1b1d24', theme: 'dark', statusBar: true, shadow: 'lg' },
  (sc) => g.image('screens/phone.png', { x: sc.x + sc.w / 2, y: sc.y + sc.h / 2, w: sc.w, h: sc.h, fit: 'cover' }))

kit.glass(g, { x, y, w: 600, h: 300, radius: 28, tint: 'rgba(255,255,255,0.06)' })   // frosted panel
```

The callback receives the screen rect; draw the content in it (it is clipped to the screen). Put devices in a `g.layer()` to tilt them in 3D.

### UI

```ts
kit.card(g, { x, y, w: 520, h: 300, radius: 'lg', fill: 'surface', border: true, shadow: 'md', glow: 'primary' })
kit.button(g, { x, y, label: 'Get started', variant: 'primary', icon: 'arrow-right', size: 1, press: c.press, hover: 0 })   // primary | secondary | ghost | gradient
kit.pill(g, { x, y, label: 'New', icon: 'sparkles', color: 'accent', filled: false })
kit.toggle(g, { x, y, on: f.in('enable', 0.3), color: 'success' })
kit.avatar(g, { x, y, r: 28, initials: 'JL', color: 'primary', ring: 'accent' })
kit.progressBar(g, { x, y, w: 400, value: f.in(0.5, 2), color: 'gradient:brand' })
kit.check(g, { x, y, size: 40, progress: f.in('done', 0.4), color: 'success' })
kit.toast(g, { x, y, title: 'Deploy finished', body: 'v2.4 is live', icon: 'check-circle', at: 'live', until: 'later', from: 'top' })
```

**Cursor with clicks:**

```ts
const c = kit.cursorPath(f, [
  { t: 0.5, at: [700, 700] },
  { t: 1.4, at: [1180, 540], click: true },     // local seconds; clicks drive press + ripple
])
kit.button(g, { x: 1180, y: 540, label: 'Start free', press: c.press })
kit.cursor(g, { ...c, kind: 'arrow' })          // arrow | hand
```

To click on a spoken word: `{ t: f.local('Start free'), at: [...], click: true }`.

### Charts and numbers

```ts
kit.barChart(g, { x, y, w: 800, h: 400, values: [3, 5, 8, 6, 11], labels: ['M', 'T', 'W', 'T', 'F'], progress: f.in(0.3, 1.2), highlight: 4, showValues: true, format: { suffix: 'k' } })
kit.lineChart(g, { x, y, w: 800, h: 300, values, progress: f.in('growth', 1.4), color: 'accent', fill: true, dots: false, head: true })
kit.donut(g, { x, y, r: 120, thickness: 26, segments: [{ value: 60, color: 'primary' }, { value: 40, color: 'accent' }], progress: p })
kit.ring(g, { x, y, r: 90, value: 0.82, label: '82%' })
kit.counter(g, { x, y, value: 40, progress: f.in('40%', 1.2), size: 140, label: 'faster releases', format: { suffix: '%' } })
kit.formatNumber(12500, { compact: true, prefix: '$' })   // "$12.5k"
```

Counters use tabular figures (`fonts.numeric`) so digits do not jitter while counting.

### Code

```ts
kit.codeBlock(g, { x, y, w: 900, code: 'const a = 1', lang: 'ts', title: 'app.ts', typeAt: 'setup', cps: 40, highlight: [3], highlightAt: 'one line', fontSize: 28, lineNumbers: true })
kit.terminal(g, { x, y, w: 900, h: 260, title: 'zsh', prompt: '$', lines: [
  { cmd: 'npm i @acme/sdk', at: 'install', out: 'added 1 package in 0.9s' },
  { out: '● ready', at: 'ready', color: 'success' },
] })
```

Languages for highlighting: `ts`/`js`, `py`, `sh`, `json` (others render as plain text with strings/numbers/comments). The editor height fits the code when `h` is omitted. `typeAt` types the code character by character at `cps` characters per second with a caret.

### Captions

```ts
g.screen(() => kit.captions(g, { style: 'karaoke', maxWords: 6, box: true }))   // karaoke | word | line
```

Captions show the words being spoken right now, from the voiceover timing, chunked at sentence ends, pauses and `maxWords` (default 6, 3 on portrait). Essential for social formats watched without sound.

### Logo

```ts
kit.logo(g, { x, y, h: 120, variant: 'full' })                // brand.logo.full, else mark + brand name, else the name as wordmark
kit.logoReveal(g, { x, y, h: 140, at: 'Orbit', wordmark: 'Orbit', glow: true })   // mark springs in, wordmark slides out
```

### Headline block

```ts
const h = kit.headline(g, { x, y, eyebrow: 'Live workspace', title: 'Every event. **Live.**', subtitle: 'One place for every signal.',
  align: 'left', size: 'h1', at: 0.2, sync: true, maxWidth: 800, exit: true, marks: [{ text: 'Live', style: 'underline' }] })
```

Eyebrow → title → subtitle with motion hierarchy (the subtitle follows the title). Returns the block height.

### Camera moves

All return camera settings for `g.camera(...)`:

| Function | Effect |
| --- | --- |
| `kit.drift(f, { zoom: 0.045, float: 8, rotate: 0 })` | Slow push-in over the scene + handheld float. Default for most scenes. |
| `kit.punch(f, anchor, strength = 0.06, duration = 0.45)` | Zoom punch on a beat/word |
| `kit.shake(f, anchor, amount = 14, duration = 0.5)` | Decaying shake (impact) |
| `kit.move(f, from, to, anchor, duration, ease = 'camera')` | Camera move between two settings |
| `kit.combine(f, ...parts)` | Combine drift, punches, shakes, moves (zooms multiply, offsets add) |

---

## Scene templates

Each template returns a scene definition. Use it directly in the timeline or export it from `scenes/index.ts`. Every option except the content is optional; `name` defaults to the template's name (set it when you use a template twice).

| Template | Best for |
| --- | --- |
| `T.title` | Hook, chapter title, statement |
| `T.kinetic` | Punchy lines one after another ("No more X. No more Y.") |
| `T.quote` | Testimonial |
| `T.montage` | Fast word-per-beat montage with icons |
| `T.showcase` / `T.screenshot` / `T.recording` | Product UI in a 3D browser card with callouts and zoom |
| `T.phoneShowcase` | Mobile app screens in a phone with bullets |
| `T.features` | 3–6 feature cards with icons |
| `T.stats` | Animated numbers (+ optional chart) |
| `T.code` | Code editor typing + terminal (developer products) |
| `T.cta` | Call to action with button click and URL |
| `T.logoScene` | Logo reveal with tagline |

### `title`

```ts
T.title({ name: 'hook', eyebrow: 'Introducing Acme', title: 'See every signal **the moment it happens**', subtitle: '…',
  sync: true, at: 0, size: 'hero', align: 'center', particles: true, background: { kind: 'aurora' } })
```

Title words appear as they are spoken (`sync`, default true).

### `kinetic`

```ts
T.kinetic({ name: 'nomore', mode: 'replace', punch: true, sfx: 'hit', lines: [
  { text: 'No more waiting.' }, { text: 'No more guessing.' }, { text: 'No more **stale reports.**', preset: 'slam', style: 'hero', color: 'accent' },
] })
```

Each line starts when it is spoken (`at` to override). `mode: 'replace'` shows one line at a time, `'stack'` accumulates them. A camera punch and a sound mark every line.

### `quote`

```ts
T.quote({ quote: 'We found the bug before our users did.', author: 'Jamie Lee', role: 'CTO, Northwind', avatar: 'images/jamie.jpg' })
```

### `montage`

```ts
T.montage({ name: 'everything', words: [{ text: 'Funnels.', icon: 'filter' }, { text: 'Retention.', icon: 'repeat' }, { text: 'Alerts.', icon: 'bell-ring', color: '#ff5d73' }], colors: ['#7c5cff', '#2ee6d6'], sfx: 'hit' })
```

Each word flashes in when spoken, on a changing color field, with a hit sound.

### `showcase`, `screenshot`, `recording`

```ts
T.recording({
  name: 'workspace',
  video: 'recordings/dashboard-live.mp4',          // or T.screenshot({ image: 'screens/app.png', ... })
  url: 'app.orbit.dev/overview', device: 'browser', // 'none' = bare media card
  eyebrow: 'Live workspace', title: 'Every event. **Every journey.**', subtitle: '…', side: 'left',
  tilt: 16,                                         // resting perspective tilt (deg, mirrored by `side`)
  callouts: [{ x: 0.32, y: 0.52, label: 'Events', icon: 'activity', at: 'event' }],   // x/y = 0..1 on the media
  zoom: { x: 0.45, y: 0.55, scale: 1.28, at: 'live', duration: 1.4 },                 // camera into a detail
  at: 0, background: { kind: 'mesh' },
})
```

The card swings in in 3D with light and shadow, straightens, callouts pop in as their labels are spoken, and an optional zoom pushes into a detail (the headline fades away during the zoom). `T.showcase({ media: { image } | { video, rate, from, loop }, ... })` is the general form.

### `phoneShowcase`

```ts
T.phoneShowcase({ name: 'ask', screens: [{ image: 'screens/a.png' }, { image: 'screens/b.png' }], eyebrow: 'Mobile', title: 'Questions in. **Answers out.**',
  bullets: [{ text: 'Ask in plain English', at: 'plain English' }, { text: 'Share it', at: 'share' }], side: 'right', tilt: 12 })
```

Screens advance with the bullets.

### `features`

```ts
T.features({ eyebrow: 'Features', title: 'Everything in one place', columns: 3, features: [
  { icon: 'zap', title: 'Capture signals', text: 'Automatically, from every channel.' },
  { icon: 'trending-up', title: 'Spot trends', text: 'In real time.', at: 'trends' },
] })
```

Cards appear when their title is spoken (else staggered).

### `stats`

```ts
T.stats({ eyebrow: 'Results', title: 'Teams ship faster', stats: [
  { value: 40, label: 'faster releases', format: { suffix: '%' }, at: '40%' },
  { value: 10, label: 'hours saved weekly', say: '10 hours' },
], chart: [12, 14, 13, 17, 19, 23, 26, 31, 38, 44] })
```

Numbers count up when spoken (`say` = phrase to sync to when it differs from the label).

### `code`

```ts
T.code({ eyebrow: 'Setup', title: 'One line of code.', subtitle: '…', file: 'app.ts', lang: 'ts', code: '…',
  typeAt: 'Setup', cps: 46, highlight: [3], highlightAt: 'one line', side: 'right',
  terminal: [{ cmd: 'npm i @orbit/sdk', at: 'Drop in', out: '+ @orbit/sdk 3.2.0' }] })
```

### `cta`

```ts
T.cta({ title: 'Try Acme free today.', subtitle: 'No credit card.', button: 'Get started', url: 'acme.com', logo: true, click: true, clickAt: 'today' })
```

Logo, title, button with a cursor click (on the button label when spoken, else 2.2 s in), URL.

### `logoScene`

```ts
T.logoScene({ name: 'intro', at: 'Orbit', tagline: 'Real-time product analytics.' })
```

### Helpers for writing your own templates

`when(f, anchor, phrase, fallback)` resolves "explicit anchor → phrase if spoken → fallback seconds"; `cueWhen` does the same for cues; `plain(text)` strips `**` marks. Template sources in `engine/templates/` are good starting points: copy one into `projects/<id>/scenes/` and edit it when a template is close but not quite right.

## Adding a reusable component or template

Only for things more than one video needs (otherwise keep it in the project):

1. Add it to `engine/kit/*.ts` or `engine/templates/*.ts` and export it from the folder's `index.ts`.
2. Follow the conventions: center positioning, brand tokens, time from `g.f`, anchors for timing, `kit.responsive` for sizing, no state.
3. Document it here, use it in a project, run `npm run typecheck && npm test`, and check stills in all formats (`mvs still <id> --format vertical`).
