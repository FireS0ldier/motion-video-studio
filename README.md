# Motion Video Studio

**Motion graphics as code, driven by a voiceover.** Write scenes in TypeScript, anchor them to the words of a voiceover, preview them live in the browser and render frame-exact, reproducible MP4s — product launches, app walkthroughs, explainers and social cuts — without After Effects.

The repository is built to be used by **AI coding agents** (Claude Code, Codex, Cursor, …) as much as by people: one CLI (`mvs`) covers the whole workflow, every step is scriptable and checkable, and [`CLAUDE.md`](CLAUDE.md) explains how to work in it.

```
script.md ──► voiceover ──► word timing ──► scenes (TS) ──► preview ──► stills ──► draft ──► final MP4
             (mvs voice)    (mvs align)     timeline.ts     mvs dev     mvs still   --draft    mvs render
                            (mvs analyze)                                                     + audio mix
```

> Demo: [`projects/orbit-launch`](projects/orbit-launch) — a 50 s, 1080p60 launch film for a fictional analytics app ("Orbit"): kinetic type, a 3D screen-recording showcase with callouts and camera zoom, a typing code editor and terminal, a phone UI showcase, animated stats, a fast word-synced montage and a CTA with a cursor click — all synced to a voiceover, with music, ducking and 30+ sound effects.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Create a new video](#create-a-new-video)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Architecture decisions](#architecture-decisions)
- [Project layout](#project-layout)
- [Requirements](#requirements)
- [Performance](#performance)
- [Documentation](#documentation)
- [Licenses and credits](#licenses-and-credits)

## Features

- **Voiceover-driven timeline.** Scenes and animations are anchored to words (`f.in('faster')`, `cut('Meet Orbit')`, `section('intro')`). Record a new read, run `mvs align`, and the whole video re-times itself.
- **Word-level timing on a CPU.** wav2vec2 CTC forced alignment of the known script (~15 ms accuracy on the demo), WhisperX for other languages, a no-ML heuristic fallback, and a text-based estimate so you can build the video *before* a voiceover exists.
- **Professional look out of the box.** WebGL2 compositor with true 3D layers (perspective, rotation, depth, lighting), Gaussian blur and depth of field, adaptive **motion blur**, bloom, chromatic aberration, grading, vignette, film grain and dithering. 11 scene transitions (zoom-through, whip pan, glitch, iris, …).
- **Typography engine.** Brand type scale, balanced line wrapping, optical centering, kinetic presets (rise, mask, blur, pop, slam, type, scramble, karaoke) by line / word / character, voice-synced reveals, animated highlights (marker, underline, pill).
- **Component kit + templates.** Device frames (browser, phone), UI (cards, buttons with press states, toggles, toasts, cursor paths with click ripples), charts, counters, code editor with syntax highlighting and typing, terminal, captions, logo reveals, backgrounds, camera moves — and 13 ready-made, parameterized scene templates.
- **Assets.** Screenshots, SVG logos, icons (1,500+ Lucide icons by name), and **screen recordings** (converted to frame sequences for frame-exact playback).
- **Audio pipeline.** Voiceover + music + SFX cues → sidechain ducking → EBU R128 loudness normalization (−14 LUFS) → true-peak-safe limiter. A procedural, license-free SFX library (whooshes, impacts, UI clicks, risers, chimes, typing, glitch) and a generated music bed. Optional local TTS for placeholder or demo voiceovers: Kokoro (English and 7 more languages) and Piper for **German**, which also delivers exact word timing.
- **Preview / still / draft / final / 4K.** Live preview with hot reload and keyboard transport; PNG stills; fast drafts (½ resolution, 30 fps); final renders with motion blur; 4K via `--uhd`. **Deterministic**: identical inputs produce bit-identical MP4s (verified in CI).
- **Any format.** 16:9, 9:16, 1:1, 4:5, 4K from the same project (`--format vertical`). Kit and templates are responsive.
- **Agent tooling.** `mvs doctor`, `mvs check` (stale timing, missing assets/phrases, crashes, blank frames, text leaving the frame, slow scenes, non-deterministic code), `mvs review` (contact sheet + per-scene stills an agent can look at), JSON manifests.

## Quick start

```bash
git clone https://github.com/FireS0ldier/motion-video-studio.git
cd motion-video-studio
npm install
npm run setup                 # installs a headless Chromium if needed, checks ffmpeg, runs `mvs doctor`

npx mvs dev orbit-launch      # live preview → http://localhost:5173/?project=orbit-launch
npx mvs still orbit-launch --t 12.5,24     # PNG stills → out/orbit-launch/stills/
npx mvs render orbit-launch --draft        # fast draft MP4 (~3 min on a 4-core VM)
npx mvs render orbit-launch                # final 1080p60 with motion blur (~40 min without GPU)
```

Preview keys: `space` play/pause (with audio) · `←/→` ±1 s (`shift` ±5 s) · `,` `.` one frame · `[` `]` previous/next scene · `l` loop scene · `g` safe areas · `m` motion blur · `q` resolution · `s` save still · `w` warnings · `h` hide UI · `?` help. URL: `?t=35`, `?scene=setup`.

## Create a new video

```bash
npx mvs new my-launch --title "Acme Launch"        # from templates/starter (add --format vertical for 9:16)
# 1. write projects/my-launch/script.md            the voiceover text, ## headings = sections
# 2. edit   projects/my-launch/brand.ts            colors, fonts, logo, motion style
# 3. add    projects/my-launch/assets/             screens/, recordings/, brand/, audio/voiceover.wav
npx mvs voice my-launch                            # (optional) local TTS voiceover if you have none
npx mvs align my-launch                            # word timing → data/timing.json
npx mvs analyze my-launch                          # loudness envelope / beats → data/audio.json
npx mvs dev my-launch                              # build scenes in projects/my-launch/scenes/, timeline.ts
npx mvs check my-launch                            # fix every error it reports
npx mvs review my-launch                           # contact sheet + stills to look at
npx mvs render my-launch --draft                   # watch it
npx mvs render my-launch                           # deliver out/my-launch/my-launch.mp4
```

The full, step-by-step version (with what to write where, quality checklists and pitfalls) is in [docs/workflow.md](docs/workflow.md).

A scene is a pure function of time:

```ts
import { defineScene, kit } from '@mvs/engine'

export default defineScene({
  name: 'hero',
  render(f, g) {
    kit.background(g, { kind: 'mesh' })
    g.camera(kit.drift(f))                                     // slow push-in + float
    g.text('Ship **faster**', { x: f.stage.cx, y: f.stage.cy, style: 'hero',
      anim: { preset: 'mask', sync: 'voice' } })               // words appear as they are spoken
    g.layer({ w: 1200, h: 750, y: f.stage.cy + 120, rotateY: -14, pad: 80, light: 0.5 }, (lg) =>
      kit.browser(lg, { x: 600, y: 375, w: 1200, h: 750, url: 'app.acme.com' }, (screen) =>
        lg.image('screens/dashboard.png', { x: screen.x + screen.w / 2, y: screen.y + screen.h / 2, w: screen.w, h: screen.h })))
  },
  cues: (c) => [c.cue('whoosh', c.word('faster'), { align: 'peak' })],
})
```

## Commands

| Command | What it does |
| --- | --- |
| `mvs setup` | One-time: install Chromium if needed, check ffmpeg, run doctor |
| `mvs doctor [--render]` | Check Node, ffmpeg/libx264, browser + WebGL2, uv/Python, disk |
| `mvs new <name> [--format vertical] [--language de]` | Scaffold a project from `templates/starter` (German: `starter-de`) |
| `mvs dev [project]` | Live preview with hot reload (prepares assets and audio first) |
| `mvs voice <project>` | Local TTS voiceover from `script.md` (Kokoro; Piper for German, incl. word timing) |
| `mvs align <project> [--engine ctc\|whisperx\|heuristic\|estimate]` | Word-level timing → `data/timing.json` |
| `mvs analyze <project>` | Voice envelope, onsets, pauses, music BPM/beats → `data/audio.json` |
| `mvs assets <project>` | Recordings → frame sequences; image size checks (automatic) |
| `mvs mix <project>` | Voice + music + SFX → `build/mix.wav`, −14 LUFS (automatic) |
| `mvs sfx [--list]` | List / regenerate the procedural SFX library |
| `mvs still <project> --t 1.5,8` | PNG stills (final quality) |
| `mvs render <project> [--draft\|--uhd]` | MP4 with audio; `--from/--to/--scene/--format/--workers/--samples` |
| `mvs check <project>` | Find problems (exit code 1 on errors) |
| `mvs review <project>` | Contact sheet + per-scene and per-transition stills |
| `mvs info <project> [--json]` | Scenes, timing, audio, cues as the renderer sees them |
| `mvs clean <project> [--all]` | Delete build caches and renders |

Every command has `--help`. Run them with `npx mvs …` (or `npm run mvs -- …`).

## How it works

```
                 ┌──────────────── browser (headless Chromium, or your preview tab) ───────────────┐
 project.ts ──►  │ resolveProject: timeline + timing + cues ──► Renderer (per frame, per sample)    │
 scenes/*.ts     │   scene.render(f, g)  ──► 2D canvases + 3D layers (display list)                 │
 script.md       │   WebGL2 compositor  ──► transitions ──► motion-blur accumulation ──► post FX   │
 data/*.json     │   readPixels ──► POST raw RGBA to the CLI                                        │
                 └──────────────────────────────────────────────────────────────────────────────────┘
                          │ frames (binary, in order, back-pressured)            ▲ manifest (scenes, cues, audio)
                          ▼                                                      │
                 ffmpeg libx264 (BT.709, yuv420p) ──► + build/mix.wav (AAC) ──► out/<project>/<project>.mp4
```

- **Scenes are pure functions of time.** `render(f, g)` receives the frame context `f` (time, scene-local time, progress, voiceover lookups, audio features, deterministic RNG) and the graphics API `g`. No state between frames → any frame can be rendered alone, in any order, by any worker, and preview equals export.
- **Drawing** happens on Canvas 2D (excellent text and vector quality). `g.layer()` turns a drawing into a texture the GPU compositor can place in 3D, blur, cache and blend. Plain drawing and layers keep their order.
- **The compositor** (raw WebGL2, ~1k lines, no three.js) composites scenes, runs transition shaders, accumulates sub-frame samples for motion blur (adaptive: a ¼-resolution probe decides how many samples a frame needs; static frames cost one), and applies the post pipeline once per frame.
- **The CLI** drives N headless browsers through Playwright. Each renders every N-th frame; frames stream over local HTTP into one ffmpeg process in order. Audio is mixed in Node and muxed at the end.
- **Timing**: `script.md` is the single source of truth for the words. `data/timing.json` maps each script word to its time in the voiceover. Scenes, cuts, captions and SFX look words up *by content*, so they follow any re-recording.

Details: [docs/architecture.md](docs/architecture.md).

## Architecture decisions

The design started from the *Motion as Code* workflow guide (custom TypeScript engine, plates as functions of time, word-timed voiceover, headless Chrome → ffmpeg). These are the decisions taken for a reusable, agent-operated system, and why:

| Decision | Why |
| --- | --- |
| **Own engine (Canvas 2D + WebGL2) instead of Remotion** | Remotion is excellent, but it renders React/DOM via screenshots (slow, especially with motion blur which multiplies DOM renders), and its license requires a paid company license for organizations above three people — a problem for a template meant to be copied into any company. A pure-function-of-time engine gives frame-exact preview = export, GPU motion blur and post effects at the cost of one pass, and an MIT-clean stack. |
| **No three.js** | The needs are 2.5D: textured layers in perspective, depth of field, light, transitions and post. A focused WebGL2 compositor covers that with no scene-graph dependency or second motion system. Real 3D meshes can be added later as another layer type. |
| **Canvas 2D for content** | Best-in-class text rendering, gradients, shadows and paths in every browser; easy for agents to read and write. The GPU handles what 2D canvas cannot (3D, blur, accumulation, grading). |
| **Vite + headless Chromium + ffmpeg** | One code path for preview and render (same Vite server, same page). Chromium is the most predictable WebGL/Canvas implementation; on Linux it renders through SwiftShader, so renders work on GPU-less servers and CI. ffmpeg is the universal encoder. |
| **Binary frame sink over HTTP** | Frames go from the page to Node as raw RGBA via `fetch` (Blob body) instead of screenshots or base64 through DevTools — several times faster, no PNG round trips. |
| **Determinism as a contract** | Seeded RNG, `Math.random` replaced during render, bundled fonts (never system fonts), bit-exact ffmpeg flags, deterministic dither and grain. CI renders twice and compares hashes. |
| **CTC forced alignment of the known script (default)** | When the script is known, forced alignment beats transcription: exact words, numbers spoken as written via `{40%|forty percent}`, ~95 MB ONNX model, CPU only. WhisperX is integrated for other languages or missing scripts; a heuristic and an estimate keep everything working without Python or ML. |
| **Python only for optional ML, through `uv`** | `onnxruntime-node` ships ~300 MB of binaries and downloads CUDA libs at install. `uv run --with …` creates cached, isolated environments on demand (~25 MB for alignment) and keeps the core install lean. |
| **Audio mixed in TypeScript** | Ducking, cue placement, BS.1770 loudness and limiting are a few hundred lines, testable and deterministic; no SoX/Python dependency. ffmpeg only decodes and encodes. |
| **Procedural SFX and music** | A sound library generated from code is license-free, reproducible and tweakable. Swap in your own files by name any time. |
| **Content / engine separation** | `engine/` and `cli/` are stable infrastructure; everything video-specific lives in `projects/<id>/` (scenes, script, brand, assets). Templates are configurable scenes, the kit is building blocks, custom scenes are plain TypeScript. |

**Remotion "superpowers" / agent skills** were evaluated: they help agents write Remotion code, which this engine does not use. The equivalent here is the agent documentation ([CLAUDE.md](CLAUDE.md)), project skills in [`.claude/skills`](.claude/skills) and the checkable CLI.

## Project layout

```
engine/                 CORE — stable, do not edit for a single video
  core/                 project/scene/timeline/timing/script/brand/renderer
  gfx/                  Graphics API (g), typography, colors, icons
  gl/                   WebGL2 compositor, shaders, camera
  motion/               easing, springs, tweens/keyframes, seeded noise, paths
  kit/                  components (devices, UI, charts, code, captions, logo, camera moves)
  templates/            parameterized scene templates
  assets/               asset store (images, SVG, recordings), font loading
  player/               preview UI + headless render bridge
cli/                    the `mvs` command line (commands/ + lib/)
tools/python/           optional ML tools run through uv (CTC alignment, WhisperX, Kokoro + Piper TTS)
assets/sfx, music       shared, generated sound library + music bed
templates/starter/      project template used by `mvs new` (starter-de: German)
projects/<id>/          CONTENT — one folder per video
  project.ts            format, brand, timeline, audio, cue sheet
  brand.ts              colors, fonts, type, radii, shadows, motion style, look, logo
  script.md             voiceover text (source of truth for words)
  timeline.ts           scene order and cut anchors
  scenes/               scenes (templates configured or custom code)
  assets/               screens/, recordings/, brand/, audio/, sfx/, images/
  data/                 timing.json, audio.json (generated, committed)
  build/                caches (generated, git-ignored)
out/                    renders, stills, review packs (git-ignored)
docs/                   documentation
tests/                  unit (vitest) and end-to-end render tests
```

## Requirements

- **Node.js ≥ 20.19** (22 LTS recommended) and npm
- **ffmpeg + ffprobe** with libx264 (`brew install ffmpeg`, `apt install ffmpeg`, `winget install Gyan.FFmpeg`)
- **Chromium/Chrome** — installed by `npm run setup` if none is found (or set `MVS_BROWSER`)
- Optional: **[uv](https://docs.astral.sh/uv/)** (or Python with uv) for `mvs align` (CTC/WhisperX) and `mvs voice`. Without it alignment falls back to the heuristic engine.
- A GPU is optional. Linux renders through SwiftShader by default; set `MVS_GL=gpu` to use a GPU.

## Performance

Measured on a 4-core cloud VM **without GPU** (SwiftShader, 2 render workers), demo project `orbit-launch` (50.5 s):

| Mode | Output | Measured |
| --- | --- | --- |
| Preview | ~40–70 % of 1080p in the browser | 10–60 ms per frame |
| Still (`mvs still`) | 1920×1080 PNG, motion blur | 0.05–0.9 s per frame (+ a few seconds browser start) |
| Draft (`--draft`) | 960×540 @ 30 fps, 1 sample, 2.7 MB | 1,516 frames in 3 min 16 s (≈ 8 frames/s) |
| Final | 1920×1080 @ 60 fps, adaptive motion blur (avg 2.4 samples), 19.6 Mb/s | 3,031 frames in 37 min (≈ 1.4 frames/s) |
| 4K still (`--scale 2`) | 3840×2160 PNG | ~7 s per frame |

The final MP4 measures −14.3 LUFS integrated and −1.1 dBTP true peak (ffmpeg `ebur128`). On GitHub's hosted runners the whole end-to-end test suite (stills, determinism, a draft video rendered twice, checks) takes under a minute.

Static layers can be cached (`g.layer({ cache: 'key' })`), motion blur only adds samples where things move, glitch transitions skip motion blur. With a real GPU (`MVS_GL=gpu`, or Chrome on macOS/Windows) the GPU stages are many times faster. See [docs/rendering.md](docs/rendering.md).

## Documentation

| Doc | For |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | AI agents: rules, workflow, commands, quality bar |
| [docs/workflow.md](docs/workflow.md) | Creating a video end to end |
| [docs/scene-api.md](docs/scene-api.md) | `f` (frame) and `g` (graphics) reference, layers, camera, text |
| [docs/kit-and-templates.md](docs/kit-and-templates.md) | Components and scene templates |
| [docs/script-format.md](docs/script-format.md) | `script.md` syntax |
| [docs/audio.md](docs/audio.md) | Voiceover, alignment, analysis, mixing, SFX, music |
| [docs/rendering.md](docs/rendering.md) | Preview, stills, drafts, finals, 4K, formats, performance |
| [docs/motion-guide.md](docs/motion-guide.md) | What makes motion look professional (and the defaults that encode it) |
| [docs/architecture.md](docs/architecture.md) | Engine internals |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Problems and fixes |

## Licenses and credits

Code: [MIT](LICENSE).

- Fonts: Inter, JetBrains Mono, Instrument Serif — SIL Open Font License (via Fontsource)
- Icons: [Lucide](https://lucide.dev) — ISC
- Alignment model: wav2vec2-base-960h (Meta, Apache-2.0), ONNX export by Xenova
- WhisperX (BSD-2-Clause), Kokoro-82M (Apache-2.0) and Piper (piper-tts, GPL-3.0) are downloaded on demand and run as separate tools, not bundled
- German Piper voices: Thorsten-Voice and Kerstin recordings (CC0), fine-tuned from English Piper voices with non-commercial data terms (see [docs/audio.md](docs/audio.md#german-voices-piper))
- Sound effects and music in `assets/` are generated by this repository (`cli/lib/sfx-synth.ts`) and covered by the MIT license
- The workflow is inspired by the *Motion as Code* starter kit and its visual engine *pdoom-video* by mexicat (MIT). No code from it is included; the engine here is an independent implementation.
- The demo product "Orbit" and its UI are fictional.

If you publish videos with voices from a commercial TTS service (e.g. ElevenLabs), check that service's license terms.
