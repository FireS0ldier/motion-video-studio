---
name: review-video
description: Review a video project for technical and motion-design quality (check report, contact sheet, scene and transition stills, draft frames) and fix or report what falls short. Use when asked to review, polish, QA or "make it look more professional".
---

# Review a video

1. **Technical:** `npx mvs check <id>` — every error must be fixed; read every warning (stale timing, missing phrases/assets, crashes, blank frames, text outside the frame, slow scenes, non-determinism).
2. **Visual pack:** `npx mvs review <id>`, then open and look at:
   - `out/<id>/review/contact.png` — pacing, variety of layouts, color rhythm, no two neighbours looking the same;
   - `out/<id>/review/scene-*.png` — one focal point, hierarchy, type sizes (≤ 2–3 per scene), alignment, contrast, safe areas, nothing clipped;
   - `out/<id>/review/transition-*.png` — no empty or muddy frames mid-transition.
3. **Motion:** `npx mvs render <id> --draft`; sample frames around every cut and every key word (`ffmpeg -ss <t> -i out/<id>/<id>-draft.mp4 -frames:v 1 f.png`), or watch it if you can. Check that visuals land with (slightly before) the words, holds are long enough to read, exits are quicker than entrances, nothing moves linearly by accident.
4. **Sound:** `build/mix.json` (≈ −14 LUFS, no missing sounds); every major hit has a sound; voice always on top.
5. **Score against** docs/motion-guide.md#checklist. For each failed item: fix it in `projects/<id>/` (never in `engine/` for a single video), re-run the relevant still, and note what changed.
6. **Report** the findings that remain (with times / scene ids) and what was fixed.
