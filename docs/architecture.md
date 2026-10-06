# Architecture

How the engine and the CLI work inside. You need this only to change the engine; for making videos see [workflow.md](workflow.md).

## Overview

```
                         Node (CLI: cli/)                                   Browser (engine/, via Vite)
 ┌──────────────────────────────────────────────────────┐      ┌──────────────────────────────────────────────────────┐
 │ mvs align   script.md + voice ─► data/timing.json     │      │ player/loader   import.meta.glob(projects/*)          │
 │ mvs analyze voice/music ─► data/audio.json            │      │   project.ts, script.md, data/*.json, fonts, assets   │
 │ mvs assets  recordings ─► build/frames/<rec>/*.jpg    │      │ core/project    resolveProject → timeline, timing,    │
 │ mvs mix     manifest cues + audio ─► build/mix.wav    │◄────►│                 cues, manifest                        │
 │ mvs render  session(N browsers) ─► ffmpeg ─► MP4      │ HTTP │ core/renderer   frame → scenes → display lists        │
 │ mvs still / check / review / info                    │  +   │ gfx/graphics    g API → Canvas 2D + layer items        │
 │                                                      │ CDP  │ gl/compositor   WebGL2: layers, transitions,          │
 │ lib/server  Vite + frame sink (/__mvs/sink)          │      │                 motion blur, post                     │
 │ lib/session Playwright workers                       │      │ player/bridge   window.__MVS__ (headless API)         │
 └──────────────────────────────────────────────────────┘      │ player/preview  interactive UI                        │
                                                               └──────────────────────────────────────────────────────┘
```

The engine is plain TypeScript that runs in the browser (Canvas 2D + WebGL2). The CLI runs in Node, drives headless Chromium through Playwright, and does everything that needs the file system: alignment, audio, asset preparation, encoding.

## Engine modules

| Module | Responsibility |
| --- | --- |
| `core/types.ts` | Plain data types shared by engine, CLI and tests (`Manifest`, `TimingData`, `Brand`, `Look`, `Cue`, …) |
| `core/format.ts` | Formats and the `Stage` (size, safe areas, unit) |
| `core/script.ts`, `text-norm.ts` | `script.md` parser, number expansion, normalization, script hash |
| `core/timing.ts` | `Timing`: word/phrase/sentence/section lookup by content, cut placement in pauses, estimate, shift |
| `core/scene.ts` | `defineScene`, the frame context `f`, anchors, cue context |
| `core/timeline.ts` | `defineTimeline`, helpers (`cut/section/word/at/end`), resolution into timed entries with transition windows |
| `core/project.ts` | `defineProject`, `resolveProject` (format, brand, look, timing, timeline, cues, warnings, manifest) |
| `core/brand.ts` | Default brand, motion presets, bundled fonts, `defineBrand` (deep merge) |
| `core/audio-features.ts` | `f.audio` values from `data/audio.json` |
| `core/renderer.ts` | Frame → samples → scenes → compositor; seeded `Math.random`; error banners; text reports for checks |
| `gfx/graphics.ts` | The `g` API: state stack, transforms, clipping, paints, shapes, text, images, video, icons, groups, layers, camera, planes |
| `gfx/text.ts` | Type styles, layout (wrapping, balancing, cached), animated drawing (presets, voice sync, marks, caret) |
| `gfx/color.ts`, `icons.ts`, `canvas-pool.ts` | OKLab color mixing, Lucide → Path2D, reusable OffscreenCanvases |
| `gl/compositor.ts`, `shaders.ts`, `camera.ts`, `mat4.ts` | WebGL2 compositor and the 2.5D camera model |
| `motion/*` | Easing, analytic springs, tweens/keyframes, seeded noise and RNG, paths |
| `assets/store.ts`, `fonts.ts` | Image/SVG/recording-frame loading with LRU caches; FontFace loading |
| `kit/*`, `templates/*` | Components and scene templates (content API) |
| `player/*` | Project discovery and loading, preview UI, headless bridge |
| `index.ts` | The public API (`@mvs/engine`) — everything else is internal |

## Data model

- **Project** = `project.ts` (format, brand, timeline, audio, cues, look) + conventions (`script.md`, `data/timing.json`, `data/audio.json`, `assets/`).
- **Timeline** = function of the timing helpers → entries `{ scene, start, end?, transition? }`. Resolution sorts them, derives ends from the next start, and centers transition windows on the cuts (clamped to 80 % of the shorter neighbour).
- **Scene** = `{ name, render(f, g), cues?, assets? }`.
- **Timing** = words with start/end in voiceover seconds, shifted by the voiceover offset to timeline time. Lookups are by normalized content over the concatenated word stream, so multi-word display tokens ("10 hours") and phrases spanning words both match. Within a scene, matches inside the scene's time window win; otherwise the first match in the whole voiceover is used.
- **Manifest** = what the CLI needs from the browser: size, fps, duration, frames, scenes, audio config, resolved cues, timing summary, look, warnings. The CLI never evaluates project code itself; it asks the page (`window.__MVS__.manifest()`), so the browser is the single interpreter of a project.

## Frame pipeline

For output frame `n` at `t = n / fps`:

1. **Samples.** With motion blur, `k` sample times spread over the shutter (`t ± shutter / fps / 2`). `samples: 'auto'` first renders both shutter ends into ¼-resolution probe targets, measures the difference on the GPU, and picks 1 (static) or 3…`maxSamples`. Transitions of type glitch force one sample.
2. **Active scenes.** At each sample time the timeline yields one scene, or two during a transition (outgoing + incoming, with transition progress).
3. **Scene render.** For each active scene: create `f` (`f.rand(key)` streams are seeded by project seed, scene id and key, so they are identical in every frame), replace `Math.random` with a generator seeded by project seed, scene, frame and sample, call `render(f, g)`. Exceptions are caught and drawn as a red banner plus a warning — one broken scene never kills a render.
4. **Display list.** `g` records an ordered list of items:
   - **flat** items: Canvas 2D drawing between layers is merged into one full-frame canvas (implicit splitting: draw → layer → draw produces flat, layer, flat), drawn through the 2D projection of the camera so 2D planes and 3D layers line up;
   - **layer** items: an OffscreenCanvas (or a cache key) plus a model matrix, opacity, blur (explicit + depth of field), blend, shade (fake light), mip flag.
5. **Compositing.** Each scene's list is drawn into a scene target (RGBA8): flat canvases as full-screen quads, layers as perspective-projected quads (view-projection from the camera), with Gaussian blur (separable, on a mip of the texture for large radii) and blend modes. Textures are uploaded from canvases through a pooled set; cached layers are kept in an LRU texture cache with a memory budget.
6. **Transition.** Two scene targets are combined by the transition shader (fade, dip, slide, push, zoom, wipe, iris, blur, glitch, whip) — or, outside transitions, the single target is used directly.
7. **Accumulation.** Samples are added into an RGBA16F accumulation target and averaged.
8. **Post.** One pass: chromatic aberration, bloom (bright-pass + 5-level quarter-resolution down/up chain), exposure, temperature/tint, contrast, saturation, lift, vignette, grain, and ordered dither (noise texture offset per frame, deterministic) to avoid banding in 8-bit output.
9. **Output.** Preview: draw to the canvas. Render: draw into an RGBA8 readback target, `readPixels`, POST to the CLI.

## Rendering from the CLI

- `lib/server.ts` starts Vite programmatically (same config as `mvs dev`, HMR off) with a middleware sink: `POST /__mvs/sink/<session>/<frame>` receives raw RGBA bytes (a `Blob` body — much faster than base64 or screenshots).
- `lib/session.ts` launches N Chromium workers (`lib/browser.ts` finds the browser and GL flags), opens `/?mode=render&project=…&scale=…&quality=…` in each, waits for `window.__MVS_READY__`, and reads the manifest.
- `commands/render.ts` assigns frames round-robin (worker *i* renders frames *i, i+N, …*). An ordered writer holds out-of-order frames and writes them to ffmpeg's stdin in sequence; workers wait when the queue is full (back-pressure), so memory is bounded.
- ffmpeg encodes raw RGBA → BT.709 yuv420p H.264 with bit-exact flags. The audio mix is built (or reused when its input key matches) and muxed in a second, copy-only ffmpeg pass.
- Asset readiness: a frame is rendered again until all images/recording frames it references are loaded (`renderFrameComplete`), so no frame ever contains a half-loaded asset.

## Audio (Node)

`cli/lib`: `audio-io` (ffmpeg decode to 48 kHz float with a disk cache), `dsp` (RMS envelopes, smoothing, resampling), `loudness` (BS.1770 K-weighting, gating, integrated LUFS, true peak by 4× oversampling), `analysis` (onsets, silences, tempo by comb-filter search, beat grid), `align` (engine dispatch, script ↔ ASR word mapping by Needleman–Wunsch, refinement), `python` (uv runner), `tts` (TTS engine and voice choice; Piper voice catalog in `tools/python/piper-voices.json`), `sfx-synth` (procedural sound library and music bed), `wav` (writer/reader). `commands/mix.ts` is the mixer described in [audio.md](audio.md).

## Determinism

A render is a pure function of the repository contents (+ browser build and GL backend):

- Scenes are pure functions of `f`; `Math.random` is replaced during `render`; all randomness flows from `hash32(seed, scene, key)`.
- Time comes only from the frame index; there is no wall clock anywhere in the frame path.
- Fonts are bundled and prefixed `MVS …` so an installed system font can never substitute; rendering waits for `document.fonts`.
- Grain/dither use a fixed noise texture with a per-frame offset derived from the frame index.
- Recording playback uses pre-extracted frames (no `<video>` decoding races).
- ffmpeg runs with `-fflags +bitexact -flags:v +bitexact -flags:a +bitexact -map_metadata -1`.
- The e2e test renders the same range with 2 workers and with 1 worker and compares SHA-256 hashes; stills are compared the same way.

## Why these choices

See the architecture decision table in the [README](../README.md#architecture-decisions). In short: an own engine (instead of Remotion) for licensing freedom, GPU motion blur and post, and exact preview = export; no three.js because 2.5D layers cover the need; Canvas 2D for text quality; SwiftShader so renders work on GPU-less servers and CI; Python only for optional ML through uv.

## Extending the engine

- **New kit component / template:** see [kit-and-templates.md](kit-and-templates.md#adding-a-reusable-component-or-template).
- **New transition:** add the type to `TransitionType` (`core/types.ts`), defaults in `core/timeline.ts` (duration, ease) and `core/project.ts` (`transitionSfx`), and a branch in `TRANSITION_FS` (`gl/shaders.ts`) with its index in `compositor.ts`.
- **New post effect:** add it to `Look` (`core/types.ts`) and `defaultLook` (`core/brand.ts`), a uniform and code in `POST_FS`, and set it in `Compositor.post`.
- **New layer type** (e.g. real 3D meshes): add a display-list item kind in `gfx/graphics.ts` and draw it in `Compositor.renderScene` into the scene target.
- **New CLI command:** add `cli/commands/<name>.ts` exporting `<name>Command(args)` and `<name>Help`, register it in `cli/index.ts`, add a test in `tests/unit/cli.test.ts`.
- Keep `engine/index.ts` backwards compatible, add tests (`tests/unit` for pure logic, `tests/e2e` for rendering), document options in `docs/`.
