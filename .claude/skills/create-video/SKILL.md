---
name: create-video
description: Create a new voiceover-driven product, app or marketing video in this repository (script, voiceover, timing, scenes, timeline, checks, draft and final render). Use when the user asks for a new video, launch film, explainer, promo, social clip or ad.
---

# Create a video

Follow CLAUDE.md §3. This is the condensed checklist; run every command from the repo root.

## 1. Brief

Collect (ask once, in one message, for whatever is missing; use sensible defaults otherwise):

- product name, one-line pitch, audience
- 3–5 key features, 1–3 proof points (numbers, quotes)
- call to action + URL
- brand: colors, fonts, logo (SVG), motion personality (smooth / snappy / bouncy / cinematic)
- assets: screenshots, screen recordings
- voiceover: file, or permission to use local TTS (`mvs voice`), or none yet
- length (default 30–60 s) and format(s) (default 16:9 1080p60; 9:16 for social)

## 2. Build

```bash
npx mvs doctor
npx mvs new <id> --title "<Title>" [--format vertical]
```

1. `projects/<id>/script.md` — sections `## Name {#id}`, ~150 words/min, hook first, CTA last, `{display|spoken}` for numbers/URLs. See docs/script-format.md.
2. `projects/<id>/brand.ts` — colors, gradients, logo, `motion: motionPresets.<x>`, fonts.
3. Assets into `projects/<id>/assets/{screens,recordings,brand,audio}`. No screenshots: draw UI with the kit or build an HTML mock and capture it (see `projects/orbit-launch/assets-src/make-assets.ts`).
4. Voice: `assets/audio/voiceover.wav`, or `npx mvs voice <id> --voice am_michael`, or skip (estimated timing).
5. `npx mvs align <id>` then `npx mvs analyze <id>`.
6. Scenes in `projects/<id>/scenes/` (templates first, custom scenes for the hook and hero moment; see docs/kit-and-templates.md, docs/scene-api.md) and `timeline.ts` (`section('id')`, `cut('phrase')`, varied transitions, last entry `end: end(2)`).

## 3. Verify (do not skip)

```bash
npm run typecheck
npx mvs check <id>                 # fix every error; resolve warnings
npx mvs review <id>                # then LOOK at out/<id>/review/*.png
npx mvs still <id> --t <s>         # look at specific moments
npx mvs render <id> --draft        # sample frames: ffmpeg -ss <t> -i out/<id>/<id>-draft.mp4 -frames:v 1 x.png
```

Judge against docs/motion-guide.md#checklist. Iterate until it passes.

## 4. Deliver

```bash
npx mvs render <id>                # out/<id>/<id>.mp4 (+ .render.json)
```

Ask before `--uhd` (4K) — it takes ~4× longer. Report: output path, duration, format, loudness, what was checked, and anything the user still has to provide (e.g. real voiceover, final screenshots).
