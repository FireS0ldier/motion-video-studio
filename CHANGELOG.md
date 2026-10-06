# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-10-06

First release.

### Engine

- Scenes as pure functions of time (`defineScene`, `render(f, g)`), timelines anchored to voiceover words (`cut`, `section`, `word`, `end`), projects (`defineProject`) with format, brand, audio, cues and look.
- Graphics API on Canvas 2D: shapes, paths with draw-on, gradients, brand paints, shadows, groups with clipping, images, frame-exact screen recordings, Lucide icons, glow.
- Typography: brand type scale, balanced wrapping, kinetic presets (rise, fade, blur, mask, pop, slam, type, scramble, karaoke) by char/word/line, voice-synced reveals, animated marks, exits.
- WebGL2 compositor: 3D layers (perspective, rotation, depth, fake lighting), layer cache, Gaussian blur and depth of field, 2.5D camera with parallax planes, 11 transitions (cut, fade, dip, slide, push, zoom, wipe, iris, blur, glitch, whip), adaptive motion blur, bloom, chromatic aberration, grading, vignette, grain, dithering.
- Motion library: 35 named easings plus cubic-bezier, analytic springs, keyframes, interpolate, stagger, seeded noise/RNG, arced paths.
- Brand system with motion presets (smooth, snappy, bouncy, cinematic) and bundled fonts (Inter, JetBrains Mono, Instrument Serif).
- Formats: landscape, vertical, square, 4:5, 4K, 30/60 fps, custom.

### Kit and templates

- Components: backgrounds (mesh, aurora, grid, dots, spotlight), particles, sheen, browser and phone frames, glass, cards, buttons with press states, pills, toggles, avatars, progress, checkmarks, toasts, cursor paths with clicks, bar/line/donut/ring charts, counters, code editor with highlighting and typing, terminal, captions, logo and logo reveal, headline block, camera moves (drift, punch, shake, move), responsive layout helpers.
- Templates: title, kinetic, quote, montage, showcase/screenshot/recording (3D card with callouts and zoom), phoneShowcase, features, stats, code, cta, logoScene.

### CLI (`mvs`)

- `setup`, `doctor`, `new`, `dev`, `info`, `voice`, `align`, `analyze`, `assets`, `sfx`, `mix`, `still`, `render`, `check`, `review`, `clean`.
- Headless rendering with parallel Chromium workers, binary frame sink, ordered ffmpeg encoding (H.264 BT.709), draft/final/4K presets, bit-identical output.
- Alignment engines: wav2vec2 CTC forced alignment (ONNX, CPU), WhisperX, heuristic, estimate.
- Audio: mixer with voice-driven ducking, peak-aligned SFX cues, BS.1770 loudness normalization (−14 LUFS), look-ahead limiter; analysis (envelope, onsets, silences, BPM, beats); local TTS with Kokoro-82M.
- Procedural, license-free SFX library (17 sounds) and music bed.
- `check`: stale timing, missing phrases/assets/sounds, crashes, blank frames, text outside the frame, slow scenes, non-deterministic code. `review`: contact sheet and per-scene/per-transition stills.

### Content

- Starter template (`mvs new`) with a complete six-scene product video.
- Demo project `orbit-launch`: 50 s 1080p60 launch film with voiceover, music and sound design.

### Docs and tooling

- README, CLAUDE.md / AGENTS.md for AI agents, docs (workflow, scene API, kit and templates, script format, audio, rendering, motion guide, architecture, troubleshooting), Claude Code skills, CI (typecheck, unit tests, e2e render tests).
