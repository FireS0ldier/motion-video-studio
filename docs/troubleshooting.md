# Troubleshooting

Start with **`npx mvs doctor`** — it checks Node, dependencies, ffmpeg/libx264, the browser and WebGL2, uv/Python and disk space, and prints the fix for anything missing. For a project, **`npx mvs check <id>`** finds most content problems.

## Setup

| Problem | Fix |
| --- | --- |
| `No Chromium/Chrome found` | `npm run setup` (installs Playwright's Chromium), or set `MVS_BROWSER=/path/to/chrome` / `MVS_BROWSER_CHANNEL=chrome` in `.env` |
| Browser fails to launch on Linux (missing libraries) | `npx playwright-core install-deps chromium` (needs sudo), or install Google Chrome |
| `ffmpeg not found` / no libx264 | macOS `brew install ffmpeg`, Ubuntu `sudo apt-get install -y ffmpeg`, Windows `winget install Gyan.FFmpeg`; or `MVS_FFMPEG=/path/to/ffmpeg` |
| `WebGL2 not available` | Default Linux mode uses SwiftShader (CPU) — make sure no `MVS_GL` override is set; on macOS/Windows update Chrome. `npx mvs doctor --render` tests a real frame. |
| Node version error | Node ≥ 20.19 (22 LTS recommended, see `.nvmrc`) |
| `uv not found` (align/voice) | Install [uv](https://docs.astral.sh/uv/getting-started/installation/), or use `mvs align --engine heuristic` / `--estimate` |
| Port 5173 in use | `npx mvs dev <id> --port 5180` or `MVS_PORT` |
| Model download fails behind a proxy | Models come from huggingface.co and github.com. Set `HTTPS_PROXY` and, if the proxy re-signs TLS, `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` to its CA bundle. Downloads are verified by SHA-256 and cached in `.cache/models/`. |

## Timing and voiceover

| Problem | Fix |
| --- | --- |
| `data/timing.json is stale` | The script changed after aligning → `npx mvs align <id>` |
| `phrase "…" not found in the voiceover timing` | The text in the scene is not in `script.md` exactly (check spelling, numbers: lookups use the display form `40%`), or it is not spoken in that scene's time range. Fix the text or the script, then `mvs align`. |
| Animations late / early everywhere | Voiceover `offset` in `project.ts` vs. the file; re-run `mvs align` after replacing the audio |
| Words drift late towards the end (heuristic/estimate) | Use the CTC engine (install uv) for word accuracy |
| CTC alignment poor | The voice deviates from the script (ad-libs, skipped words) → fix the script to what was said; non-English → `--engine whisperx --language xx` |
| WhisperX: slow / large download | Expected on first run (PyTorch + models). Use `--model base` for speed. |
| `mvs voice`: language not supported | German uses Piper automatically (`language: de`). Other languages without a default: pass a Piper id, e.g. `--voice nl_NL-mls-medium` ([list](https://huggingface.co/rhasspy/piper-voices)) |
| `mvs voice`: "Kokoro has no voice for de" | A Kokoro voice (`af_heart`) was passed for a German script: drop `--voice`/`--engine` or use `--voice de_DE-thorsten-high` |
| German voice: "word timings unavailable" | The `onnx` package is missing (it comes with `piper-tts[alignment]` through uv); run `mvs align <id>` instead |
| A Piper voice reads very slowly | Multi-speaker voices (e.g. `de_DE-mls-medium`) vary by speaker: `--speed 1.3` or another `--speaker` |
| WhisperX: `PytorchStreamReader failed reading zip archive` | An interrupted model download (often behind proxies): delete the file named in the error from `~/.cache/torch/hub/checkpoints/` and run again |
| Cut happens mid-word | Use `cut('phrase')` / `section('id')` instead of fixed seconds; add a `[pause]` in the script for more room |

## Picture

| Problem | Fix |
| --- | --- |
| Red "crashed" banner in a scene | An exception in `render()`. The message is in the banner, the preview's warnings (`w`) and `mvs check`. |
| Black / empty frames | The scene paints no background (`kit.background(g)` first), opacity is 0, or everything is off-screen. `mvs check` reports blank frames. |
| Placeholder box instead of an image | Path wrong (relative to `assets/`, extension optional) or the file is missing; `mvs check` lists missing assets |
| Recording frozen or missing | Frames not extracted: `npx mvs assets <id> --force`. Check `start` (anchor) and `from` |
| Text in the wrong font | Font failed to load (warning in `mvs check`); for custom fonts the URL must start at the repo root (`/projects/<id>/assets/fonts/…`) |
| Text cut off at the frame edge | `mvs check` reports it; use `maxWidth`, a smaller `style`, and position inside `f.stage.title` |
| Flicker between frames | Something random per frame: `Math.random()` (flagged by `mvs check`) → `f.rand('key')`, which is stable across frames |
| Shadows or glows clipped on a layer | Increase `pad` on `g.layer()` |
| Blurry layer when zooming the camera in | `res: 1.5` or `2` on the layer; use 2× screenshots |
| Layer drawn flat inside another layer | Nested layers are drawn inline (warning). Use groups inside layers. |
| Gradient banding | Dither is on by default in post; avoid very large, very dark gradients at low contrast; keep `grain.amount` > 0 |
| Preview and render look different | They are the same code; check the preview resolution (`q`), motion blur toggle (`m`), and `f.quality` branches in your scene |

## Audio

| Problem | Fix |
| --- | --- |
| No audio in the MP4 | No voiceover/music/cues configured or files missing → `mvs check`, `mvs mix <id>` |
| SFX missing | Unknown sound name → `npx mvs sfx --list`; project sounds in `projects/<id>/assets/sfx/`. `build/mix.json → missing` lists them. |
| Music too loud / too quiet | `audio.music.gain` (−16…−20 dB), `duck` (8–10 dB) |
| Voice too quiet against SFX | Lower cue `gain`s, `audio.sfx.gain`, raise `sfx.duck` |
| Mix not updated | Rebuilt automatically when inputs change; force with `npx mvs mix <id> --force` |
| Audio and picture out of sync | Check `voiceover.offset`; the preview's waveform shows where words are. Renders mux with sample accuracy. |

## Rendering

| Problem | Fix |
| --- | --- |
| Render slow | `--draft`, `--scene`, `--from/--to` while iterating; `cache: 'key'` on static layers; fewer/smaller blurred layers; more `--workers` if you have cores; `MVS_GL=gpu` on a GPU machine. `mvs check` lists the slowest scenes, `.render.json` the slowest frames. |
| Out of memory | Fewer workers (`--workers 1`), smaller layers, lower `res` |
| Render stops with a page error | The scene error is printed with its stack; reproduce with `mvs still <id> --t <time>` |
| Output differs between machines | Different browser builds or GPU backends can differ in the last bits; renders on the same setup are bit-identical. Use the default SwiftShader mode for reproducible output. |
| ffmpeg error on odd sizes | Width and height must be even (yuv420p) |
| `--uhd` takes very long | Expected: 4× the pixels. Render 1080p first; ask before 4K. |

## Getting more information

- `npx mvs info <id> --json` — exactly what the renderer sees (scenes, times, transitions, cues, timing source, warnings).
- `out/<id>/check.json` — all problems found by `mvs check`.
- `build/mix.json` — loudness, peak, gain, missing sounds.
- `out/<id>/<id>.render.json` — render settings, timings and probe of the output.
- Browser devtools in the preview (`npx mvs dev`) — console errors from scenes.
