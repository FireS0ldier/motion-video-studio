# Rendering: preview, stills, drafts, finals, formats

| Mode | Command | Output | Use |
| --- | --- | --- | --- |
| Preview | `npx mvs dev <id>` | browser, live | Building scenes, timing, sound |
| Still | `npx mvs still <id> --t 12.5` | PNG | Checking a moment at final quality (agents: look at it) |
| Review | `npx mvs review <id>` | contact sheet + PNGs | Judging the whole video at a glance |
| Draft | `npx mvs render <id> --draft` | `out/<id>/<id>-draft.mp4` | Watching motion, timing and sound |
| Final | `npx mvs render <id>` | `out/<id>/<id>.mp4` | Delivery |
| 4K | `npx mvs render <id> --uhd` | 3840×2160 | Delivery in 4K (slow; ask first) |

All modes run the same code in the same browser engine: **preview = export**.

## Preview

```bash
npx mvs dev <id> [--port 5173] [--host] [--no-prepare]
```

Prepares assets and the audio mix, then starts Vite with hot reload at `http://localhost:5173/?project=<id>`.

| Key | Action |
| --- | --- |
| `space` | Play / pause (with the mixed audio) |
| `←` `→` (`shift`) | −/+ 1 s (5 s) |
| `,` `.` | −/+ 1 frame |
| `[` `]` | Previous / next scene |
| `l` | Loop the current scene |
| `g` | Safe-area guides |
| `m` | Motion blur on/off (accurate but slower) |
| `q` | Preview resolution |
| `s` | Save a PNG of the current frame |
| `w` | Warnings panel |
| `h` | Hide the UI |
| `?` | Help |

URL parameters: `t=12.5` (time), `scene=features`, `format=vertical` (another format of the same project), `scale=0.5` (preview resolution). The timeline shows scenes, transitions, the voice waveform with words, and SFX cues; click to seek.

## Stills

```bash
npx mvs still <id> --t 3.2,10,24.5          # timeline seconds
npx mvs still <id> --scene features          # 15 %, 50 %, 85 % of the scene
npx mvs still <id> --scene features --t 1.2  # 1.2 s into the scene
npx mvs still <id> --frame 750               # frame index
npx mvs still <id> --t 10 --scale 0.5        # half size (faster) · --scale 2 for 4K
npx mvs still <id> --t 10 --format vertical  # another format
npx mvs still <id> --t 10 --samples 1        # without motion blur
```

PNGs go to `out/<id>/stills/` (or `--out dir`). Stills are final quality, including motion blur and post.

## Video renders

```bash
npx mvs render <id> --draft                  # 960×540 @ 30, 1 sample, CRF 23
npx mvs render <id>                          # 1920×1080 @ 60, adaptive motion blur, CRF 16
npx mvs render <id> --scene setup            # one scene
npx mvs render <id> --from 20 --to 28        # a time range
npx mvs render <id> --format vertical --out out/<id>/<id>-9x16.mp4
npx mvs render <id> --workers 4 --samples 8 --crf 14 --fps 30 --scale 0.75 --no-audio
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--draft` / `--final` | final | Preset (see table) |
| `--uhd`, `--4k` | — | Final at scale 2 |
| `--scale` | 1 (draft 0.5) | Resolution multiplier (rendered natively, not upscaled) |
| `--fps` | project (draft 30) | Output frame rate |
| `--samples` | `auto` (draft 1) | Motion-blur samples per frame (`auto`, or 1–16) |
| `--workers` | half the cores, max 4 (`MVS_WORKERS`) | Parallel browser workers |
| `--crf` | 16 (draft 23) | x264 quality (lower = better/bigger; 14–18 is visually lossless) |
| `--from`, `--to`, `--scene` | whole video | Range |
| `--format` | project | Another format |
| `--no-audio` | — | Skip mix/mux |
| `--out` | `out/<id>/<id>[-draft].mp4` | Output file |

Output:

- **Video:** H.264 High, yuv420p, BT.709 (tagged), `-preset slow`, keyframe every 120 frames, `+faststart` (web playback starts before download completes).
- **Audio:** the mix (`build/mix.wav`, −14 LUFS) as AAC 320 kb/s (192 kb/s for drafts), 48 kHz.
- **Report:** `<output>.render.json` — settings, render time, average samples, slowest frames, ffprobe summary, warnings.

### How a render works

1. The CLI starts a Vite server (no HMR) and N headless Chromium workers (Playwright).
2. Each worker loads the project and renders every N-th frame: `scene.render(f, g)` → Canvas 2D + GPU layers → WebGL2 compositor → transitions → motion-blur accumulation → post.
3. Frames go as raw RGBA over a local HTTP sink to the CLI, which writes them **in order** into one ffmpeg process (back-pressured, so memory stays flat).
4. The audio mix is built (or reused) and muxed.

### Motion blur

Real cameras blur moving things; without it 60 fps motion looks like stop motion. The engine renders several sub-frame samples across the shutter (`look.motionBlur.shutter`, default 0.5 = 180°) and averages them on the GPU.

`samples: 'auto'` (default) renders a ¼-resolution probe of the frame at the shutter's start and end and compares them; if nothing moved it uses one sample, else 3…`maxSamples` (default 10) depending on how much moved. Static holds cost one sample, fast moves get smooth blur. Glitch transitions are rendered without blur (they should be crisp). `--samples 8` forces a fixed count.

## Formats

| Name | Size | fps |
| --- | --- | --- |
| `landscape` (default) | 1920×1080 | 60 |
| `landscape30` | 1920×1080 | 30 |
| `vertical` | 1080×1920 | 60 |
| `vertical30` | 1080×1920 | 30 |
| `square` | 1080×1080 | 60 |
| `portrait45` | 1080×1350 | 60 |
| `uhd` | 3840×2160 | 60 |
| custom | `format: { width: 2560, height: 1080, fps: 24 }` | any |

Set the project format in `project.ts`; render another one with `--format`. Kit components and templates adapt (`f.stage.portrait`, `kit.responsive`). Custom scenes adapt if they position with `f.stage` and `kit.responsive(f.stage).s` — check every format you deliver with stills.

**4K:** `--uhd` renders a 1080p project at scale 2: the same layout, natively rendered at 3840×2160 (text, vectors and layers are sharp; bitmaps should be ≥ 2× for that). Expect about 4× the render time of 1080p. A project with `format: 'uhd'` is laid out for 4K directly.

## Determinism

Same inputs → bit-identical MP4 (verified by the e2e tests: two renders, one with 2 workers and one with 1, produce the same SHA-256). This is guaranteed by:

- scenes as pure functions of time; `Math.random` replaced by a seeded generator during rendering; `f.rand()` streams seeded by project seed + scene + key
- bundled fonts (never system fonts)
- grain and dither from a fixed noise texture, seeded per frame
- the same browser build and GL backend (SwiftShader by default on Linux, which is CPU-exact)
- ffmpeg with `bitexact` flags, no metadata/timestamps in the file
- an audio mix that only depends on its inputs

Different machines with different GPUs (`MVS_GL=gpu`) can differ in the last bit of some pixels; renders on the same setup stay reproducible.

## Performance

The cost of a frame is roughly *(Canvas 2D drawing + layer uploads) × samples + compositing + post*. On a machine without GPU everything WebGL runs in SwiftShader on the CPU.

| Lever | Effect |
| --- | --- |
| `--draft` | ~10× faster than final (demo: 3 min vs. 37 min) |
| `--scene`, `--from/--to` | Render only what you are working on |
| `cache: 'key'` on static layers | Draw once instead of every sample |
| Fewer / smaller blurred layers | Blur is the most expensive GPU operation in SwiftShader |
| `--workers` | Scales with cores (each worker is one browser) |
| `MVS_GL=gpu` (or macOS/Windows Chrome) | GPU stages many times faster |
| `--samples 1` | No motion blur (quick checks) |

`npx mvs check <id>` lists the slowest scenes; `.render.json` lists the slowest frames.

Measured numbers are in the [README](../README.md#performance).

## Environment variables

Set in the shell or in `.env` (see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `MVS_BROWSER` | Path to a Chrome/Chromium binary |
| `MVS_BROWSER_CHANNEL` | Installed channel: `chrome`, `msedge`, `chrome-beta` |
| `MVS_GL` | `auto` (SwiftShader on Linux, native elsewhere), `gpu`, `swiftshader`, `egl`, `vulkan`, `metal` |
| `MVS_WORKERS` | Default worker count |
| `MVS_FFMPEG`, `MVS_FFPROBE` | Binaries if not on `PATH` |
| `MVS_PORT` | Preview port |
