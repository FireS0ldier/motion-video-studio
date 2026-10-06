# Scene API reference

Everything a scene needs is imported from `@mvs/engine`:

```ts
import { defineScene, kit, templates as T, ease, keyframes, interpolate, lerp, clamp01 } from '@mvs/engine'
```

- [Scenes](#scenes)
- [`f` — the frame](#f--the-frame)
- [Anchors and timing](#anchors-and-timing)
- [`g` — graphics](#g--graphics)
- [Text](#text)
- [Layers (GPU, 3D)](#layers-gpu-3d)
- [Camera, planes, depth of field](#camera-planes-depth-of-field)
- [Images, recordings, icons](#images-recordings-icons)
- [Post-processing per frame](#post-processing-per-frame)
- [Motion helpers](#motion-helpers)
- [Cues (sound effects)](#cues-sound-effects)
- [Brand tokens](#brand-tokens)
- [Fonts](#fonts)
- [Projects and timelines](#projects-and-timelines)

## Scenes

```ts
export default defineScene({
  name: 'features',                      // id in the timeline (unless the entry sets `id`)
  render(f, g) { /* draw one frame */ },
  cues: (c) => [c.cue('pop', c.word('live'))],   // optional SFX
  assets: ['screens/app.png'],            // optional: preload/validate up front
})
```

`render(f, g)` must be a **pure function of `f`**: it is called for any frame, in any order, several times per frame for motion blur, by several browsers in parallel. No `Math.random()` (use `f.rand()`), no `Date.now()`, no timers, no state between calls, no async work. `mvs check` flags violations.

Coordinates are composition pixels (1920×1080 for landscape) with the origin top-left. **Positions are centers** unless an option says otherwise.

## `f` — the frame

| Property | Meaning |
| --- | --- |
| `f.t` | Timeline time (s) |
| `f.lt` | Local time since the scene started (s); negative/over `dur` during transitions |
| `f.dur`, `f.start`, `f.end` | Scene duration and timeline span |
| `f.p` | Progress through the scene 0..1 |
| `f.frame`, `f.fps` | Output frame index and rate |
| `f.stage` | Layout: `w, h, cx, cy, aspect, portrait, landscape, square, unit, safe, title` (rects `{x,y,w,h}`) |
| `f.brand` | The resolved brand (colors, type, motion, look) |
| `f.quality` | `'preview' \| 'draft' \| 'final'` — e.g. fewer particles in preview |
| `f.audio` | `level` (voice 0..1), `pulse` (speech onset spike), `music`, `beat` (beat spike), `beatPhase`, `beatIndex` — needs `mvs analyze` |
| `f.transition` | `{ phase: 'in' \| 'out' \| null, p }` while a transition is running |
| `f.timing` | Low-level timing object (prefer the helpers below) |

| Method | Returns |
| --- | --- |
| `f.in(anchor, dur?, ease?)` | Eased 0..1 for an animation starting at `anchor` (default duration/ease from `brand.motion`) |
| `f.out(dur?, ease?, before?)` | 0 → 1 over the last `dur` seconds of the scene (ending `before` s early) |
| `f.enter(anchor?, dur?)` | Like `in` with the brand's enter ease |
| `f.exit(dur?, before?)` | Like `out` with the brand's exit ease |
| `f.show(anchor?, enterDur?, exitDur?)` | `enter × (1 − exit)` — a typical opacity |
| `f.spring(anchor, cfg?)` | Analytic spring 0..1 (overshoots); cfg: `'gentle' \| 'snappy' \| 'bouncy' \| 'heavy'` or `{stiffness, damping, mass}` |
| `f.at(anchor)` / `f.local(anchor)` / `f.since(anchor)` | Timeline s / local s / seconds since |
| `f.word(text, nth?)`, `f.phrase(text, nth?)` | `{start, end}` of a word/phrase spoken in this scene |
| `f.sentence(text)` | Span of the sentence containing `text` |
| `f.section(id)` | Span of a script section |
| `f.has(text)` | Is the phrase in the voiceover? |
| `f.speaking()` | The word being spoken now (or `null`) |
| `f.spoken()` | All words spoken during this scene |
| `f.rand(key?)` | Seeded RNG: `r()`, `r.range(a,b)`, `r.int(a,b)`, `r.pick(arr)`, `r.sign()`, `r.gaussian()` |
| `f.wiggle(freq, amp, seed?)` | Smooth deterministic drift around 0 |
| `f.warn(msg)` | Report a problem (preview + `mvs check`) |

## Anchors and timing

Anywhere a time is expected you can pass an **Anchor**:

| Anchor | Means |
| --- | --- |
| `1.2` (number) | 1.2 s after the scene start |
| `'faster'` (string) | When that word/phrase starts in the voiceover (searched inside the scene first) |
| `f.word('faster')` (span) | Its start — use `.end` for "after the word" |
| `{ at: 12.5 }` | Absolute timeline seconds |

Phrase lookup is by content, case- and punctuation-insensitive, and handles numbers written as `{10 hours|ten hours}`. If a phrase is not found, the scene start is used and a warning is reported (`mvs check` lists them).

```ts
const p = f.in('dashboard', 0.7, 'expoOut')          // starts when "dashboard" is said
const q = f.in(f.word('dashboard').end + 0.1)        // starts just after it (span.end is timeline time)
const r = f.in({ at: f.word('dashboard').end })       // the same, explicitly absolute
```

> `f.word(x).start/end` are **timeline** seconds. Passing a span or `{at}` is always absolute; plain numbers are local.

## `g` — graphics

### Shapes

All shape calls accept the style options `fill`, `stroke`, `lineWidth`, `dash`, `shadow`, `opacity`, `blur`, `blend`.

```ts
g.fill('bg')                                                     // whole frame
g.rect({ x, y, w, h, radius: 'lg', fill: 'surface', shadow: 'md', stroke: 'border', lineWidth: 1 })
g.rect({ x: 100, y: 100, w: 300, h: 80, anchor: 'top-left', fill: 'gradient:brand' })
g.circle({ x, y, r: 40, fill: 'primary' })
g.ellipse({ x, y, rx: 300, ry: 120, rotate: -8, fill: 'accent', opacity: 0.3, blur: 60 })
g.arc({ x, y, r: 80, start: 0, end: 360, progress: p, stroke: 'primary', lineWidth: 10 })   // degrees, 0 = 12 o'clock
g.line({ from: [x0, y0], to: [x1, y1], progress: p, stroke: 'muted', lineWidth: 2, dash: [6, 8] })
g.poly([[0, 0], [100, 40], [200, 10]], { stroke: 'accent', lineWidth: 4, smooth: true, progress: p })
g.path('M0 0 L100 100', { x, y, scale: 2, stroke: 'text', progress: p })            // SVG path data
g.glow({ x, y, r: 300, color: 'primary', intensity: 0.5 })                         // soft additive light
```

**Paint** is a brand color name (`'primary'`, `'muted'`, …), any CSS color, `'gradient:<name>'` (brand gradient across the shape's box), or a gradient object:

```ts
fill: { type: 'linear', from: [0, 0], to: [400, 0], stops: ['#7c5cff', '#2ee6d6'] }
fill: { type: 'radial', at: [x, y], r: 300, stops: [[0, 'rgba(124,92,255,0.6)'], [1, 'transparent']] }
fill: { type: 'conic', at: [x, y], angle: 0, stops: ['red', 'blue', 'red'] }
```

**Shadow**: `'sm' | 'md' | 'lg' | 'glow'` (brand tokens) or `{ x, y, blur, color }` (or an array).
**Radius**: `'sm' | 'md' | 'lg' | 'xl' | 'pill'`, a number, or `[tl, tr, br, bl]`.
**Blend**: `'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'soft-light' | 'color-dodge' | 'lighten' | 'darken' | 'destination-in' | 'destination-out'`.

### Groups

```ts
g.group({ x: 200, y: 100, scale: 1.1, rotate: -4, origin: [150, 50], opacity: 0.8, blend: 'screen',
          clip: { rect: [0, 0, 300, 100], radius: 'md' }, blur: 2 }, () => {
  // draw in the group's local coordinates
})
```

`clip` accepts `{ rect: [x, y, w, h], radius }`, `{ circle: [cx, cy, r] }`, a `Path2D`, or `(path) => { … }`. `g.with()` is an alias.

### Utilities

| Call | Use |
| --- | --- |
| `g.color('primary')` | Brand color → CSS string |
| `g.gradient('brand', from, to)` | Brand gradient as a paint object between two points |
| `g.measure(text, { style, size, maxWidth })` | `{ w, h, lines }` without drawing |
| `g.stage`, `g.brand`, `g.f` | Same as `f.stage`, `f.brand`, the frame |
| `g.inLayer` | True inside `g.layer()` |
| `g.clear()` | Clear what was drawn so far on the current canvas |

## Text

```ts
g.text('Ship **faster** with Orbit', {
  x: f.stage.cx, y: f.stage.cy,
  style: 'h1',                   // brand type token: hero | h1 | h2 | h3 | body | label | caption | eyebrow | code | serif | number
  size: 96, weight: 700, tracking: -0.03, leading: 1, italic: false, uppercase: false, font: 'display',   // overrides
  color: 'text', accent: 'gradient:brand',   // **marked** words use `accent` (default: primary)
  align: 'center', valign: 'middle',          // left | center | right · top | middle | bottom | baseline
  maxWidth: 1200, balance: true,              // wrapping with balanced lines
  shadow: 'md', stroke: { color: '#000', width: 2 }, opacity: 1,
  anim: { preset: 'mask', by: 'word', at: 'ship', stagger: 0.06, duration: 0.6, sync: 'voice', exit: { at: 'end' } },
  marks: [{ text: 'faster', style: 'marker', color: 'accent', at: 'faster' }],
  caret: false,
})
```

- `**word**` marks a word as accent.
- **Presets:** `rise`, `fade`, `blur`, `mask` (slides up behind a line mask), `pop` (spring scale), `slam` (scales down from big), `type` (typewriter), `scramble` (decoding characters), `karaoke` (dim → bright as spoken), `none`. Default from `brand.motion.text`.
- **by:** `'char' | 'word' | 'line'`.
- **`sync: 'voice'`** reveals each word exactly when it is spoken (words must be in the voiceover; falls back to staggering when they are not).
- **`exit`:** `{ at: 'end' }` animates out so it finishes at the scene end; `{ at: 'phrase', preset: 'blur' }` for an explicit exit.
- **`progress`:** drive the reveal manually 0..1.
- **marks:** `marker` (highlighter), `underline`, `pill`, `color`, `box`, animated in when the phrase is spoken.

`g.text` returns a `TextResult` with the bounding box, per-line and per-word boxes (local coordinates) and `revealed` 0..1 — use it to place things relative to text:

```ts
const r = g.text('Live', { x, y, style: 'h2' })
g.circle({ x: r.x + r.w + 24, y: r.y + r.h / 2, r: 8, fill: 'danger' })
```

## Layers (GPU, 3D)

A layer is drawn into its own texture and placed by the WebGL compositor: real perspective, rotation in 3D, depth, blur, depth of field, cache, blend modes, lighting.

```ts
g.layer({
  w: 1200, h: 750,              // layer canvas size (default: full stage)
  x: f.stage.cx, y: 560,        // where its anchor sits on the stage
  z: 0,                         // depth: positive = farther away
  anchor: [0.5, 0.5],
  rotateX: 8, rotateY: -18, rotateZ: 0,   // degrees
  scale: 1, opacity: 1,
  blur: 0,                      // px, on top of the camera's depth of field
  blend: 'normal',              // normal | add | screen | multiply
  pad: 80,                      // transparent margin so shadows/glows are not cut
  light: 0.5,                   // fake light from the top-left on rotated layers
  res: 1,                       // texture resolution (use 1.5–2 when the camera zooms in)
  cache: 'dashboard',           // static content: drawn once, reused while the key is unchanged
  screen: false,                // true = ignore the camera (HUD, captions)
}, (lg) => {
  // local coordinates (0,0)..(w,h), full g API
  kit.browser(lg, { x: 600, y: 375, w: 1200, h: 750 }, (sc) => lg.image('screens/app.png', { x: sc.x + sc.w / 2, y: sc.y + sc.h / 2, w: sc.w, h: sc.h }))
})
```

- Drawing order is kept: things drawn before the layer are behind it, things after are in front.
- Layers inside layers are drawn inline (no 3D) with a warning.
- **Cache static layers** (`cache: 'key'`): drawing a big UI each frame (×motion-blur samples) is the main cost. Change the key when content changes (`cache: \`list-${step}\``). Animated content must not be cached.
- Group transforms (`g.group({ x, y, scale })`) apply to a layer's position and scale.

## Camera, planes, depth of field

One 2.5D camera per scene, shared by 2D drawing and GPU layers so they stay aligned.

```ts
g.camera({ x, y, zoom: 1.2, rotate: 2, z: 0, perspective: 2700, focus: 0, aperture: 6 })   // call before drawing
g.camera(kit.drift(f))                                       // slow push-in + handheld float
g.camera(kit.combine(f, kit.drift(f), kit.punch(f, 'now'), kit.shake(f, 'boom')))
g.camera(kit.move(f, { zoom: 1 }, { zoom: 1.6, x: 1300, y: 400 }, 'zoom in', 1.2))
```

- `x, y`: the stage point the camera looks at (default: center). `zoom` scales, `rotate` rolls (degrees), `z` dollies in.
- `perspective`: eye distance in px (default 1.4 × the long side). Smaller = stronger perspective.
- `focus`, `aperture`: depth of field — layers at depth ≠ `focus` blur by `aperture` px per 1000 units of defocus.
- `g.plane(z, () => …)`: draw 2D content at depth `z` (parallax: farther planes move less with the camera, and are scaled by perspective).
- `g.screen(() => …)`: draw ignoring the camera (captions, logo bug, HUD).

## Images, recordings, icons

```ts
g.image('screens/dashboard.png', { x, y, w: 1200, h: 750, fit: 'cover', focus: [0.5, 0], radius: 'lg', shadow: 'lg', border: { color: 'border', width: 1 } })
g.image('brand/logo.svg', { x, y, h: 80 })                  // give w or h to keep aspect ratio
g.video('recordings/demo.mp4', { x, y, w, h, start: 'Watch', rate: 1.5, from: 2, loop: false })
g.icon('sparkles', { x, y, size: 48, color: 'accent', stroke: 2, progress: p })   // https://lucide.dev/icons
```

- Paths are relative to the project's `assets/` folder; the extension may be omitted.
- Missing files show a labeled placeholder in the preview (nothing in renders) and are reported by `mvs check`.
- Recordings are pre-extracted to frames by `mvs assets` (automatic before `dev/still/render`), so every frame is exact. `start` is an Anchor; `from` is the offset into the clip.
- Icons: any [Lucide](https://lucide.dev/icons) name in kebab-case; `progress` draws the strokes on.

## Post-processing per frame

The look (bloom, vignette, grain, aberration, grade, motion blur) comes from `brand.look`, optionally overridden in `project.ts → look`. A scene can change it for the current frame:

```ts
const flash = 1 - f.in('Now', 0.25)
g.fx({ grade: { exposure: 0.4 * flash }, bloom: { strength: 0.6 } })
```

## Motion helpers

```ts
import { ease, eases, cubicBezier, spring, springs, keyframes, interpolate, progress, stagger, lerp, clamp01, remap, smoothstep, pingpong, loop, steps, mixColor, alpha, shade, noise1, noise2, fbm1, wiggle, followPath, arc } from '@mvs/engine'
```

| Helper | Example |
| --- | --- |
| Eases | `'expoOut'`, `'quintIn'`, `'smooth'`, `'emphasized'`, `'standard'`, `'accelerate'`, `'snappy'`, `'camera'`, `'backOut'`, `'backOutSoft'`, `'elasticOut'`, `'linear'`, `quad/cubic/quart/quint/expo/circ/sine` × `In/Out/InOut`, `[x1, y1, x2, y2]` cubic-bezier, or a function |
| `ease(name)(t)` | Resolve an ease to a function |
| `keyframes(t, keys)` | `keyframes(f.lt, [[0, 0], [0.6, 1, 'expoOut'], [2.4, 1], [2.8, 0, 'in']])` — numbers, colors or arrays; the ease on a key shapes the segment arriving at it |
| `interpolate(t, inRange, outRange, { ease, clamp })` | Remotion-style piecewise mapping |
| `progress(t, start, dur, ease)` | Eased 0..1 on any time base |
| `stagger(i, n, each, from)` | Offsets for lists (`'start' \| 'center' \| 'end'`) |
| `spring(t, cfg)` | Analytic spring; `springs.gentle/snappy/bouncy/heavy` |
| `mixColor(a, b, t)` | OKLab color mix · `alpha(c, a)` · `shade(c, ±amount)` |
| `noise1/noise2/fbm1/wiggle` | Seeded smooth noise |
| `followPath(t, waypoints)` | Arced motion through timed points (used by `kit.cursorPath`) |

## Cues (sound effects)

```ts
cues: (c) => [
  c.cue('whoosh', c.word('Meet Orbit'), { align: 'peak', gain: -6 }),   // whoosh peaks on the word
  c.cue('pop', 1.2, { gain: -10, pan: 0.3, rate: 1.1 }),                 // 1.2 s after the scene start
  c.cue('click', { at: 31.4 }, { label: 'cta click' }),
]
```

`c.word/phrase/section/scene(id)` return spans; numbers are relative to the scene start (or the video start in `project.ts → cues`). Sound names come from `assets/sfx/` (`npx mvs sfx --list`) or `projects/<id>/assets/sfx/`; a path like `'audio/boom.wav'` also works. See [audio.md](audio.md).

## Brand tokens

`brand.ts` (via `defineBrand`) defines what scenes reference by name:

| Token | Used as |
| --- | --- |
| `colors.*` | `fill: 'primary'`, `color: 'muted'`, `stroke: 'border'` (add your own keys) |
| `gradients.*` | `fill: 'gradient:brand'` |
| `type.*` | `style: 'h2'` (font role, size, weight, tracking, leading, case) |
| `fonts.*` | `font: 'display' \| 'body' \| 'mono' \| 'serif' \| 'numeric'` |
| `radius.*` | `radius: 'lg'` |
| `space.*` | `f.brand.space.lg` |
| `shadows.*` | `shadow: 'md'` |
| `motion` | default eases, durations, stagger, spring, text preset (`motionPresets.smooth \| snappy \| bouncy \| cinematic`) |
| `look` | bloom, vignette, grain, aberration, grade, motion blur |
| `logo` | `{ mark: 'assets/brand/mark.svg', full: 'assets/brand/logo.svg' }` for `kit.logo` |

Sizes in the type scale are at 1080p. For other formats multiply with `kit.responsive(f.stage).s`.

## Fonts

Bundled (SIL OFL, loaded from `node_modules`, never from the system so renders are identical everywhere): `bundledFonts.inter`, `interTabular` (tabular figures for counters), `jetbrainsMono`, `instrumentSerif`.

To use a brand font, put the files in the project and reference them by URL from the repository root:

```ts
// projects/acme/brand.ts
export default defineBrand({
  name: 'Acme',
  fonts: {
    display: {
      family: 'Acme Display',              // use a unique family name
      sources: [
        { url: '/projects/acme/assets/fonts/AcmeDisplay-Bold.woff2', weight: '700' },
        { url: '/projects/acme/assets/fonts/AcmeDisplay-Regular.woff2', weight: '400' },
      ],
      fallback: 'system-ui, sans-serif',
      features: '"ss01"',                   // optional OpenType features
    },
  },
})
```

Variable fonts: one source with `weight: '100 900'`. Fonts must be loadable (`mvs check` reports font errors). Check the font license allows embedding in video.

## Projects and timelines

```ts
// project.ts
export default defineProject({
  title: 'Acme launch',
  format: 'landscape',          // landscape (1920×1080@60) | landscape30 | vertical | vertical30 | square | portrait45 | uhd | { width, height, fps }
  brand,
  timeline,
  audio: { voiceover: { src: 'assets/audio/voiceover.wav', offset: 0.5 }, music: { src: '...', gain: -18, duck: 9 }, sfx: { gain: 0, duck: 4 }, master: { lufs: -14 } },
  cues: (c) => [...],           // project-level SFX
  look: { grain: { amount: 0.02 } },
  tail: 1.2,                    // seconds after the voice when the last entry has no end
  seed: 1,                      // changes every f.rand() stream
})
```

```ts
// timeline.ts
export default defineTimeline(({ cut, section, word, at, end, voiceStart, voiceEnd }) => [
  { scene: hook, start: 0 },
  { scene: intro, start: section('intro'), transition: 'zoom' },
  { scene: ui, id: 'ui-2', start: cut('Every event', { lead: 0.1 }), transition: { type: 'slide', direction: 'left', duration: 0.5 } },
  { scene: cta, start: section('cta'), end: end(2), transition: { type: 'iris', sfx: false } },
])
```

- `cut(phrase, { lead, nth, after })`: just before the phrase, inside the pause (`after` = search after this time).
- `section(id)`: just before the section's first word.
- `word(phrase)`: span · `at(s)`: absolute seconds · `end(tail)`: voice end + tail.
- **Transitions:** `cut`, `fade`, `dip` (through `color`), `slide`, `push`, `zoom`, `wipe`, `iris` (`center`), `blur`, `glitch`, `whip` — options `duration`, `ease`, `direction`, `color`, `center`, `align` (`'center' \| 'start' \| 'end'` relative to the cut), `sfx` (sound name or `false`). Each type has a default whoosh-like sound.
- The same scene definition can appear several times with different `id`s.
