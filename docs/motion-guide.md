# Motion guide: what makes it look professional

The difference between "animated slides" and a video that feels designed is mostly a set of small, consistent decisions. The engine encodes many of them as defaults (brand motion presets, eases, templates). This guide explains them so you can keep them when writing custom scenes.

## 1. Timing

- **Lead the voice slightly.** Visuals that start 0.1–0.2 s *before* the word feel synced; exactly on the word feels late. `f.in('word')` starts on the word — the brand's long ease-out makes most of the motion happen in the first 150 ms, which reads as "on time". For hard hits, anchor to `f.word('x').start - 0.08`.
- **Cut in pauses.** `cut()`/`section()` place cuts in the silence before the phrase. A cut in the middle of a word feels like an error.
- **Hold long enough to read.** Rule of thumb: 0.3 s per word on screen + 0.5 s. A 6-word headline needs ~2.3 s of stillness. Fast montages are the exception (one word per beat).
- **Rhythm, not uniformity.** Alternate long holds with quick beats. A 50 s video with nine scenes of 5.5 s each is monotonous; 8 s, 3 s, 6 s, 2 s, … is alive.
- **First 3 seconds:** something moves in the first frame, the first statement lands before 1.5 s.

## 2. Easing

- **Nothing moves linearly** except progress bars, scrolling text, and continuous rotation.
- **Entrances decelerate** (`expoOut`, `quintOut`, `emphasized`): fast start, long soft landing. Objects arrive and settle.
- **Exits accelerate** (`quintIn`, `accelerate`) and are **shorter** than entrances (~60 %). Objects leave with intent.
- **Moves between two positions:** `smooth` / `standard` (ease in and out).
- **Camera:** `camera` (slow in, slow out), longer durations (0.8–1.6 s).
- **Springs** for UI elements and icons (`f.spring(anchor, 'snappy')`), with little overshoot for premium brands (`gentle`), more for playful ones (`bouncy`).
- One motion personality per video: pick `motionPresets.smooth | snappy | bouncy | cinematic` in `brand.ts` and let `f.enter()`, `f.exit()`, text presets and templates use it.

## 3. Hierarchy and choreography

- **One hero per beat.** The eye can follow one thing at a time. Decide what the viewer looks at in each second.
- **Stagger related elements** by 40–90 ms (`brand.motion.stagger`), in reading order. Lists: from top; grids: from the center or the top-left.
- **Secondary follows primary** by 0.15–0.3 s: eyebrow → headline → subtitle → supporting UI (`kit.headline` does this).
- **Group, then move the group.** Animate a card as one object, then reveal its contents — not every element independently at once.
- **Direction carries meaning:** forward/next = right-to-left or bottom-to-top; back = the reverse. Keep it consistent across transitions.

## 4. Typography

- Use the brand type scale (`hero/h1/h2/h3/body/label/caption/eyebrow`). Two sizes per scene, maybe three.
- Big and short: ≤ 8 words per line, ≤ 2 lines for headlines. If the voice says more, show the key phrase.
- Tight tracking for big display text (`-0.03…-0.045 em`), slightly open for small caps eyebrows (`+0.12…0.16 em`).
- Balanced line breaks (default) — no single word on the last line.
- **Accent one word** per headline (`**word**`), with color or gradient, not both bold and color and underline.
- Kinetic presets with intent: `mask` and `rise` for clean statements, `blur` for cinematic, `pop`/`slam` for punches, `type` for code/AI, `karaoke` for spoken emphasis. `sync: 'voice'` for statements the voice reads verbatim.
- Numbers: tabular figures (`style: 'number'`, `kit.counter`) so they don't jitter while counting.
- Contrast: body text ≥ 4.5:1 against its background; put text on a panel or darker plane when the background is busy.

## 5. Space, depth and light

- **Depth sells quality.** Combine: 3D layers with a small Y rotation (10–18°) and `light`, soft large shadows (`shadow: 'lg'`), parallax planes (`g.plane(z)`), depth of field on background planes (`camera.aperture`).
- **Keep the frame alive:** a slow camera drift (`kit.drift`), a living background (mesh/aurora at low intensity), ambient particles. Never fully static, never busy.
- **Light leads the eye:** a glow (`g.glow`) or a sheen sweep (`kit.sheen`) on the hero element, bloom on bright accents (from `brand.look`).
- **Grain and vignette** (subtle, defaults) make flat digital frames feel filmic and hide banding.
- **Safe areas:** text inside `f.stage.title`, important motion inside `f.stage.safe` (`g` in the preview shows them).

## 6. Camera

- Motivated moves: push in to focus (a detail, a number), pull out to reveal context, track to follow a cursor or a flow.
- Zooms into UI need resolution: `g.layer({ res: 1.5–2 })` or a 2× screenshot.
- Punches (`kit.punch`) on strong words or beats; shakes (`kit.shake`) only for impacts.
- Don't fight the content: when the UI itself animates heavily, keep the camera calm.

## 7. Transitions

| Transition | Use for |
| --- | --- |
| `cut` | Punchy beats, rhythm, montage — the most professional transition is often none |
| `zoom` | Diving into a product/detail; from a statement into the reveal |
| `slide` / `push` | Next step in a sequence (direction = forward) |
| `whip` | Energy, change of topic, fast cuts |
| `blur` | Soft change of context, time passing |
| `wipe` | Before/after, replacing old with new |
| `glitch` | Tech/AI moments, errors — once per video at most |
| `iris` | Ending, focusing on the CTA |
| `fade` / `dip` | Calm openings and endings, emotional pauses |

Vary them, but keep a family (e.g. pushes for steps, one zoom for the reveal, an iris for the end). Every transition gets a sound (default) — whooshes peak on the cut.

## 8. UI and product shots

- Show real UI (or a convincing mock) early. The product is the hero.
- **Simplify screens:** crop to the relevant part, zoom in on the thing the voice talks about, callouts for 2–3 key elements — not ten.
- **Microinteractions sell interactivity:** cursor paths with eased arcs (`kit.cursorPath`), button press states, toggles, toasts, numbers ticking, charts drawing in.
- Cursor clicks get a sound (`click`) and a visual response within 100 ms.
- Recordings: trim to the action; speed up boring parts (`rate: 1.5–2`).

## 9. Sound

- Every major visual hit has a sound; small UI moves get soft taps/ticks or nothing.
- Whooshes `align: 'peak'` on the cut, risers peak on the reveal, hits on landings.
- Music under a voice at −16…−20 dB, ducking 8–10 dB; louder in sections without voice.
- The final mix at −14 LUFS (automatic). Listen on laptop speakers *and* headphones.

## 10. Color

- Dark backgrounds with one or two saturated accents look premium and make bloom work; keep the palette to the brand.
- Use gradients for accents and fills, not for text bodies.
- Grade consistently (brand `look.grade`); a slight warm or cool bias unifies screenshots from different sources.

## Checklist

Before calling a video done:

- [ ] `npx mvs check <id>` passes without errors (warnings understood)
- [ ] Hook lands in the first 3 s; CTA is on screen ≥ 3 s with the URL readable
- [ ] Every scene has one clear focal point; nothing important outside title-safe
- [ ] Every headline is readable at its hold time; no orphan words; ≤ 2 lines
- [ ] Animations anchored to the words they illustrate; nothing visibly late
- [ ] No linear motion (except intentional), exits faster than entrances
- [ ] Transitions varied and motivated; every cut in a pause
- [ ] Frame never fully static, never chaotic
- [ ] Contact sheet shows variety in layout and color rhythm
- [ ] Every transition still (`out/<id>/review/transition-*.png`) looks intentional
- [ ] Sound: voice always intelligible, SFX on hits, music ducked, no clipping
- [ ] Draft watched start to finish with sound; final rendered and spot-checked
