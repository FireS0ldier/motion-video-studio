# Workflow: creating a video end to end

This is the long form of the workflow in [CLAUDE.md](../CLAUDE.md#3-create-a-new-video--the-workflow). It works the same for a person at a keyboard and for an AI agent. Every step has a command, an output you can inspect, and a check.

```
 1 setup        npm install && npm run setup          once per machine
 2 scaffold     npx mvs new <id>                      projects/<id>/
 3 inputs       brief, brand, assets, voiceover       projects/<id>/assets/
 4 script       script.md                             the words, in sections
 5 voice        npx mvs voice <id>   (optional)       assets/audio/voiceover.wav
 6 timing       npx mvs align <id> && mvs analyze     data/timing.json, data/audio.json
 7 scenes       scenes/*.ts + timeline.ts             the picture
 8 preview      npx mvs dev <id>                      http://localhost:5173
 9 validate     npx mvs check <id>                    out/<id>/check.json
10 review       npx mvs review <id>                   out/<id>/review/*.png
11 draft        npx mvs render <id> --draft           out/<id>/<id>-draft.mp4
12 final        npx mvs render <id>                   out/<id>/<id>.mp4
```

## 1. Setup

```bash
npm install
npm run setup        # Chromium (if none found), ffmpeg check, `mvs doctor`
```

`mvs doctor` must show no ✗. Optional items (uv for alignment and TTS) are marked as such. `npx mvs doctor --render` also renders a test still.

## 2. Scaffold

```bash
npx mvs new acme-launch --title "Acme launch"                   # 1920×1080 @ 60
npx mvs new acme-reel --title "Acme reel" --format vertical     # 1080×1920 @ 60
```

The project is a copy of `templates/starter/`: a complete, working six-scene video (hook, problem, product UI, features, proof, CTA) with an Acme placeholder script. It renders right away with estimated timing, so you start from a working video and change it, never from an empty page.

## 3. Collect inputs

What a good product video needs (ask the client/user for what is missing):

| Input | Where it goes |
| --- | --- |
| Product name, one-line pitch, audience | `script.md`, CTA scene |
| 3–5 key features, proof points (numbers, logos, quotes) | `script.md`, `features`/`stats`/`quote` scenes |
| Call to action + URL | last section of `script.md`, `cta` template |
| Brand colors, fonts, logo (SVG) | `brand.ts`, `assets/brand/` |
| Screenshots (PNG, ideally 2× the size they appear) | `assets/screens/` |
| Screen recordings (MP4/MOV) | `assets/recordings/` |
| Voiceover (WAV/MP3/M4A) | `assets/audio/voiceover.wav` |
| Music (optional) | `assets/audio/music.mp3`, or the bundled bed |
| Format(s) and length | `project.ts → format`, script length |

**No screenshots yet?** Two options that look better than placeholders:

- Draw the UI with the kit (`kit.browser`, `kit.card`, `kit.lineChart`, `kit.button`, …) — see `templates/starter/scenes/product.ts`.
- Build the UI as a small HTML/CSS mock and capture it with the headless browser — see `projects/orbit-launch/assets-src/make-assets.ts` (captures PNG screens and records an animated MP4 "screen recording").

## 4. Write the script

`script.md` holds the voiceover words and nothing else ([format reference](script-format.md)).

```markdown
## Hook {#hook}
Your product ships every week.
But your dashboards are always one step behind.

## Meet Orbit {#intro}
Meet Orbit. Real-time product analytics that keeps up with your team.

## Proof {#proof}
Teams decide {40%|forty percent} faster.
```

Guidelines:

- **Length:** ~150 spoken words per minute. 30 s ≈ 75 words, 60 s ≈ 150 words.
- **One idea per sentence**, one section per scene (roughly). Section ids (`{#hook}`) are what the timeline anchors to.
- **Write for the ear:** short sentences, active voice, concrete numbers.
- **Hook in the first 3 seconds**, CTA as the last sentence.
- Write words that will appear on screen *exactly* as they are spoken. Scenes find them by content (`f.in('dashboards')`).
- Numbers, URLs and acronyms: `{40%|forty percent}`, `{orbit.dev|orbit dot dev}`, `{API|A P I}`. Plain numbers (`40%`, `10x`, `$5k`, `2026`) are expanded automatically in English.

## 5. Voiceover

Pick one:

1. **A recording or TTS service file** (best quality): save as `assets/audio/voiceover.wav` (or `.mp3/.m4a/.flac/.ogg`). It is picked up automatically.
2. **Local TTS:** `npx mvs voice <id> --voice am_michael` (Kokoro-82M, CPU, free, Apache-2.0). Good for drafts and demos. Voices: `--list`. English, Spanish, French, Italian, Portuguese, Hindi, Japanese, Chinese; no German.
3. **None yet:** skip. `mvs align --estimate` (and the preview, automatically) estimate the timing from the script, so you can build the whole video first and drop the voice in later.

To start the voice after a short visual intro, set it explicitly in `project.ts`:

```ts
audio: { voiceover: { src: 'assets/audio/voiceover.wav', offset: 0.5 } }
```

## 6. Timing and analysis

```bash
npx mvs align <id>          # word timing → data/timing.json
npx mvs analyze <id>        # loudness envelope, pauses, music beats → data/audio.json
```

- English: the default CTC aligner (wav2vec2, CPU) is accurate to ~15–30 ms per word.
- Other languages: `npx mvs align <id> --engine whisperx --language de`.
- Without Python/uv: the heuristic engine (voice activity) is sentence-accurate; word starts are approximated.
- The output tells you how many words matched and the confidence. `mvs info <id>` shows the timing source; `mvs check` flags a stale timing file (script changed after aligning).

Re-run `align` whenever the voiceover or the script changes. Scenes re-time themselves.

## 7. Scenes and timeline

Scenes live in `projects/<id>/scenes/`. Three ways to make one, from fastest to most custom:

1. **Template:** `templates.showcase({...})`, `templates.features({...})`, … — complete scenes from config ([list](kit-and-templates.md#scene-templates)).
2. **Kit composition:** `defineScene` + `kit.background`, `kit.headline`, `kit.browser`, `kit.card`, `kit.lineChart`, `kit.cursor`, …
3. **Custom drawing:** `g.rect/text/image/layer/camera` — anything ([scene API](scene-api.md)).

A good video mixes them: templates for the standard beats, a custom scene for the hook and the hero moment.

The timeline (`timeline.ts`) orders the scenes and anchors each start to the voice:

```ts
export default defineTimeline(({ cut, section, end }) => [
  { scene: hook, start: 0 },
  { scene: intro, start: section('intro'), transition: 'zoom' },
  { scene: workspace, start: section('workspace'), transition: { type: 'slide', direction: 'left' } },
  { scene: punch, start: cut('No more waiting'), transition: 'whip' },
  { scene: cta, start: section('cta'), end: end(2), transition: 'iris' },
])
```

`section('id')` and `cut('phrase')` place the cut inside the pause *before* the words, so a transition never covers speech. The last entry needs an `end` (`end(2)` = 2 s after the voice ends).

Write/iterate scenes in the preview (next step). Rules that keep them correct are in [CLAUDE.md §5](../CLAUDE.md#5-writing-scenes); motion quality in the [motion guide](motion-guide.md).

## 8. Preview

```bash
npx mvs dev <id>        # → http://localhost:5173/?project=<id>
```

Saving any file hot-reloads the frame you are on. Keys: `space` play (with audio), `←/→` ±1 s, `,`/`.` ±1 frame, `[`/`]` scene, `l` loop scene, `g` safe areas, `m` motion blur, `q` resolution, `s` save PNG, `w` warnings. The timeline under the picture shows scenes, the voice waveform with words, and SFX cues. URL parameters: `?t=12.5`, `?scene=features`.

Agents without a browser view use stills instead (`npx mvs still <id> --t 12.5` → PNG to look at).

## 9. Validate

```bash
npx mvs check <id>
```

Fix every error and as many warnings as possible. It checks: stale or missing timing, missing voiceover/assets/SFX, phrases not in the voiceover, scene crashes, blank frames, text leaving the frame or the title-safe area, very short/long scenes, slow scenes, and non-deterministic code (`Math.random`, `Date.now`, timers). Results also go to `out/<id>/check.json`.

## 10. Review

```bash
npx mvs review <id>
```

Look at every image in `out/<id>/review/`:

- `contact.png` — 24 thumbnails across the video: pacing, variety, color rhythm.
- `scene-<id>.png` — each scene at 60 %: layout, hierarchy, typography, contrast.
- `transition-<id>.png` — the middle of each transition: no empty frames, no ugly overlaps.

Judge against the [quality checklist](motion-guide.md#checklist). For a specific moment: `npx mvs still <id> --t 23.4` or `--scene features` (renders 15 %, 50 %, 85 %).

## 11. Draft

```bash
npx mvs render <id> --draft        # 960×540, 30 fps, no motion blur — a few minutes
```

Watch it with sound. Things only visible in motion: timing against the voice, rhythm of cuts, transitions, SFX placement, readability at speed. Agents can sample frames with ffmpeg (`ffmpeg -ss 12.5 -i out/<id>/<id>-draft.mp4 -frames:v 1 frame.png`).

To iterate on one part: `--scene features` or `--from 20 --to 28`.

## 12. Final

```bash
npx mvs render <id>                # 1920×1080 @ 60 fps, motion blur, −14 LUFS audio
npx mvs render <id> --format vertical --out out/<id>/<id>-9x16.mp4    # another format
npx mvs render <id> --uhd          # 3840×2160 — slow, ask first
```

Output: `out/<id>/<id>.mp4` plus `<id>.render.json` (settings, render time, average motion-blur samples, slowest frames, ffprobe summary). Renders are deterministic: the same inputs give a bit-identical file.

## Changing things later

| Change | Do |
| --- | --- |
| New voiceover read | Replace the file → `mvs align` → `mvs analyze` → `mvs check` |
| Script edit | Edit `script.md` → new voiceover (or `--estimate`) → `mvs align` |
| Brand refresh | Edit `brand.ts` (colors, fonts, motion, look) — all scenes follow |
| New format | `--format vertical` on still/render; adjust scenes that need a different layout via `f.stage.portrait` |
| Shorter cut | Remove sections from the script and entries from the timeline |
