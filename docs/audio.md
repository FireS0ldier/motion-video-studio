# Audio: voiceover, timing, music, sound effects, mix

```
script.md ──► (mvs voice) ──► assets/audio/voiceover.wav ──► mvs align ──► data/timing.json ──► scenes, cuts, captions
                                         │                  mvs analyze ─► data/audio.json  ──► f.audio (reactive motion)
                                         ▼
               music + SFX cues ──► mvs mix ──► build/mix.wav (−14 LUFS) ──► muxed into the MP4 by mvs render
```

All of it runs locally on the CPU. Nothing needs a GPU or a paid service.

## Voiceover

**Sources**, in order of quality:

1. A human recording or a TTS service export (ElevenLabs, …). 48 kHz WAV is ideal; MP3/M4A/FLAC/OGG work.
2. `npx mvs voice <id>` — local TTS on the CPU, free, no account. It reads `script.md` sentence by sentence with natural pauses (`sentencePause`, `sectionPause`, `[pause]`). The engine follows the script language:
   - **Kokoro** ([Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via `kokoro-onnx`, Apache-2.0, ~120 MB once): English, Spanish, French, Italian, Portuguese, Hindi, Japanese, Chinese. `--voice am_michael`, `--lang en-us`.
   - **Piper** ([piper-tts](https://github.com/OHF-Voice/piper1-gpl), GPL-3.0, run through uv and not bundled): **German** and many other languages. `--voice de_DE-thorsten-high` (default for `language: de`). It also writes the word timing (see below).
   Common options: `--speed 1.0`, `--list` (all voices), `--engine kokoro|piper` to force one.
3. Nothing: timing is estimated from the script until a voice exists.

### German voices (Piper)

```bash
npx mvs new mein-video --language de     # German starter: script, scene texts, voice
npx mvs voice mein-video                 # voiceover.wav + data/timing.json in one step
npx mvs voice mein-video --voice de_DE-kerstin-low
npx mvs voice mein-video --voice de_DE-thorsten_emotional-medium --speaker surprised
npx mvs voice mein-video --seed 2        # another take of the same script
```

| Voice | | License (voice data) | Notes |
| --- | --- | --- | --- |
| `de_DE-thorsten-high` | male | CC0 | Default. Clearest; 114 MB |
| `de_DE-thorsten-medium` | male | CC0 | Same speaker, ~2× faster to generate; 63 MB |
| `de_DE-thorsten_emotional-medium` | male | CC0 | `--speaker neutral, amused, angry, disgusted, drunk, sleepy, surprised, whisper` |
| `de_DE-kerstin-low` | female | CC0 | 16 kHz; 63 MB |

These voices are checksum-pinned and their training data allows commercial use. Any other id from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) works too (downloaded from the same pinned revision without a checksum; check its `MODEL_CARD` license, e.g. `de_DE-pavoque-low` is non-commercial). Measured on the German starter script: word error rate of a German Whisper transcription 7–14 % (errors mostly on one-word sentences and brand names), generation faster than real time on a 4-core CPU.

- **Same script + same `--seed` → the same WAV** (the model's sampling noise is seeded). Change the seed (`--seed`, or `seed:` in the script front matter) for another take.
- Numbers, symbols, domains and common abbreviations are written out before synthesis (`40 %` → „vierzig Prozent“, `z.B.` → „zum Beispiel“, `acme.de` → „acme punkt de“), see [script-format.md](script-format.md#numbers-and-symbols).
- Voice settings can live in the script front matter: `voice:`, `speaker:`, `speed:`, `seed:`.

**Placement:** `assets/audio/voiceover.*` is used automatically. To delay the voice (a visual intro before the first word), declare it:

```ts
audio: { voiceover: { src: 'assets/audio/voiceover.wav', offset: 0.5, gain: 0 } }
```

`offset` shifts the whole timing, so every anchor follows.

**Recording tips** (for whoever records): quiet room, consistent distance, no music under it, leave ~0.5 s of silence at both ends, read exactly the script (or update the script to what was said).

## Word timing (`mvs align`)

```bash
npx mvs align <id>                                   # auto engine
npx mvs align <id> --engine whisperx --language de   # other languages
npx mvs align <id> --estimate --wpm 155              # no audio yet
```

| Engine | How | Accuracy | Needs |
| --- | --- | --- | --- |
| `tts` | Word times reported by the TTS itself (Piper phoneme durations), written by `mvs voice` | Exact for the generated audio: sentence starts within ~30 ms of the acoustic onset on the German starter | A voiceover from `mvs voice` with a Piper voice |
| `ctc` (default for English) | Forced alignment of the known script with wav2vec2-base-960h (ONNX, int8) and a CTC Viterbi path | ~15 ms median vs. ground truth on the demo | uv (or Python ≥ 3.10); ~95 MB model, downloaded once, pinned by checksum |
| `whisperx` | WhisperX ASR + phoneme alignment, words mapped onto the script with sequence alignment | ~20 ms median vs. CTC on the English demo; on German speech ~0.1 s late at sentence starts; multilingual | uv; a large first download (PyTorch, WhisperX, the Whisper model, a wav2vec2 model per language; `--model small` default) |
| `heuristic` | Voice-activity detection: sentences mapped to speech regions, words spread by length inside | Sentence-accurate, words approximate | Nothing |
| `estimate` | Speaking rate from the text (no audio) | Rough | Nothing |
| `auto` | `tts` when the voiceover is still the one `mvs voice` made with Piper for this script; else `ctc` for English if uv/Python is available, else `heuristic`; `estimate` without audio | — | — |

For recorded German voiceovers use `--engine whisperx --language de`.

Python tools run through [uv](https://docs.astral.sh/uv/) in cached, isolated environments (`uv run --with …`): nothing is installed globally and the Node install stays lean. Models are cached in `.cache/models/` (git-ignored) and verified by SHA-256.

Output `data/timing.json` (commit it, it is small):

```jsonc
{
  "version": 1, "source": "ctc", "scriptHash": "4a5ac62a", "audio": "assets/audio/voiceover.wav", "audioDuration": 48.2,
  "words":     [{ "i": 0, "text": "Your", "norm": "your", "start": 0.15, "end": 0.34, "section": "hook", "sentence": 0, "conf": 1 }, …],
  "sentences": [{ "i": 0, "text": "Your product ships every week.", "start": 0.15, "end": 1.9, "section": "hook", "first": 0, "last": 4 }, …],
  "sections":  [{ "id": "hook", "title": "Hook", "start": 0.15, "end": 5.2, "first": 0, "last": 12 }, …]
}
```

Times are seconds in the voiceover file; the engine adds the voiceover `offset`. `scriptHash` lets `mvs check` detect a timing file that no longer matches the script.

**Fixing a single word by hand** is fine (edit `start`/`end` in `timing.json`); re-running `align` overwrites it.

## Audio analysis (`mvs analyze`)

Writes `data/audio.json`:

- **voice:** RMS envelope (100 Hz, 0..1), speech onsets, silences, integrated loudness (LUFS), peak
- **music:** envelope, tempo (BPM, comb-filter search 70–180) and beat grid, onsets

Scenes read it through `f.audio`:

```ts
const glow = 0.4 + 0.6 * f.audio.level          // voice loudness
const kick = f.audio.beat                        // 1 on every music beat, decaying
g.camera({ ...kit.drift(f), zoom: 1 + 0.01 * f.audio.beat })
```

Use it subtly: a logo that breathes with the voice, a background that pulses on the beat.

## Music

```ts
audio: { music: { src: '../../assets/music/ambient-pulse.ogg', offset: 0, gain: -18, duck: 9, fadeIn: 1, fadeOut: 2.5 } }
```

- `src` is relative to the project folder. `assets/audio/music.*` in the project is used automatically if `music` is not set.
- `gain`: dB before ducking. −16…−20 under a voiceover.
- `duck`: dB the music drops while the voice speaks (sidechain from the voice envelope, smooth attack/release).
- The bundled bed `assets/music/ambient-pulse.ogg` (100 BPM, 75 s, generated by `mvs sfx --music`) is license-free. For a real production, license a track (Artlist, Epidemic, …) and check the terms for your use.
- Cut on the beat: `data/audio.json → music.beats` lists the beat times in music-file seconds (add `music.offset` for timeline time). `f.audio.beat/beatPhase/beatIndex` already apply the offset.

## Sound effects

Shared library in `assets/sfx/` (generated from code by `cli/lib/sfx-synth.ts`, deterministic, MIT):

| Sound | Use |
| --- | --- |
| `whoosh`, `whoosh-fast`, `whoosh-deep` | Slides/pushes, whip pans, zoom-throughs |
| `swipe` | Wipes, iris, UI panels |
| `reverse` | Lead-in to a slam or a hard cut |
| `riser` | Tension build into a reveal (peaks at the end) |
| `impact`, `hit` | Big reveals, logo hits · text slams, counters landing |
| `click`, `tap`, `pop`, `tick` | Buttons and cursor clicks · cards · badges · counters |
| `ding`, `notify` | Success, notifications |
| `type` | Typing |
| `glitch` | Glitch transitions, errors |
| `shimmer` | AI / magic moments |

`npx mvs sfx --list` shows durations and peak offsets. Put your own files in `projects/<id>/assets/sfx/<name>.wav` — a project file with a library name overrides the library sound.

**Where cues come from** (all merged into one cue list, shown in the preview timeline and `mvs info`):

1. **Transitions:** each type has a default sound (`slide/push` whoosh, `whip` whoosh-fast, `zoom` whoosh-deep, `wipe/iris` swipe, `glitch` glitch), peak-aligned to the cut. Override with `transition: { type: 'zoom', sfx: 'impact' }` or silence with `sfx: false`.
2. **Templates:** kinetic lines, montage words, stats, CTA clicks, logo reveals bring their own.
3. **Scenes:** `cues: (c) => [...]` in `defineScene`.
4. **Project:** `cues: (c) => [...]` in `project.ts` (e.g. a riser into the product reveal).

```ts
c.cue('whoosh', c.word('Meet'), { align: 'peak', gain: -6, pan: -0.2, rate: 1.05, label: 'intro' })
```

- `align: 'peak'` puts the sound's loudest moment on the anchor (use for whooshes, risers, reverses). Default `'start'`.
- `gain` in dB (−6…−12 typical), `pan` −1..1, `rate` speed/pitch.

Sound design rules of thumb: one sound per visual beat, not per element; whooshes peak on the cut, hits on the landing, clicks on the press; the voice always wins (SFX duck under it automatically, `sfx.duck` dB); silence is a tool.

## Mix and master (`mvs mix`)

Runs automatically before `dev` and `render` when an input changed (voice, music, cue list, settings); `--force` rebuilds.

1. Decode everything to 48 kHz stereo float (ffmpeg, cached in `.cache/`).
2. Voice at `voiceover.gain`, offset by `voiceover.offset`.
3. Music: gain, fades, ducking by voice presence.
4. SFX bus: each cue placed (start or peak aligned), gain/pan/rate, bus gain `sfx.gain`, ducking `sfx.duck`.
5. Master: integrated loudness (ITU-R BS.1770 / EBU R128 gating) normalized to `master.lufs` (default **−14 LUFS**, the web/social standard; −16 podcasts, −23 broadcast), then an O(n) look-ahead limiter to `master.ceiling` (default −1.5 dBFS, which lands around −1 dBTP after AAC encoding), with a corrective second pass.
6. Write `build/mix.wav` and `build/mix.json` (LUFS, true peak, gain applied, missing sounds).

```ts
audio: {
  voiceover: { src: 'assets/audio/voiceover.wav', offset: 0.5 },
  music: { src: '../../assets/music/ambient-pulse.ogg', gain: -18, duck: 9, fadeOut: 2.5 },
  sfx: { gain: -2, duck: 4 },
  master: { lufs: -14, ceiling: -1.5 },
}
```

`mvs render` encodes the mix as AAC 320 kb/s and muxes it with the video. The demo measures −14.4 LUFS integrated in the final MP4 (ffmpeg `ebur128`).
