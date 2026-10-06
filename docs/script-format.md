# `script.md` format

`projects/<id>/script.md` contains the voiceover words. It is the **single source of truth for words**: the aligner matches the audio against it, `mvs voice` reads it aloud, scenes look words up in it, captions show it, and `mvs check` uses its hash to detect a stale timing file.

```markdown
---
title: Orbit — launch film
language: en
voice: am_michael
speed: 1.0
sentencePause: 0.3
sectionPause: 0.55
---

<!-- Comments are ignored. -->

## Hook {#hook}
> Calm, confident. Small pause after "week".
Your product ships every week.
But your dashboards are always one step behind.

## Results {#results}
Teams on Orbit ship {40%|forty percent} faster, with {3×|three times} fewer rollbacks.
[pause 0.4]
Try it free at {orbit.dev|orbit dot dev}.
```

## Elements

| Syntax | Meaning |
| --- | --- |
| Front matter (`---` … `---`) | Optional settings (below) |
| `## Title {#id}` | A **section**. `{#id}` sets the id used by `section('id')`; without it the id is the slugified title. Any heading level works. Ids must be unique. |
| Plain text | Spoken words. Lines and paragraphs inside a section are joined; sentences are split at `.`, `!`, `?`, `…` (abbreviations like `e.g.` and tokens like `orbit.dev` or `3.5` stay together). |
| `{display\|spoken}` | Show `display` on screen, but the voice says `spoken`. Use for numbers, symbols, URLs, acronyms, brand names with unusual pronunciation. |
| `[pause]`, `[pause 0.4]`, `[pause 300ms]` | Extra silence after the current sentence when generating a voice (default 0.5 s). Also a natural place for a cut. |
| `> note` | Direction note for the speaker. Not spoken, not shown. |
| `<!-- … -->` | Comment. |
| `**bold**` | Not special in the script. Accent marks belong in the scene text (`g.text('Ship **faster**')`). |

Text before the first heading belongs to a section with id `main`.

## Front matter

| Key | Used by | Default |
| --- | --- | --- |
| `title` | info only | — |
| `language` | alignment + number expansion (`en`, `de`, `fr`, …) | `en` |
| `voice` | `mvs voice` (Kokoro voice id) | `am_michael` |
| `speed` | `mvs voice` speaking rate | `1.0` |
| `lang` | `mvs voice` Kokoro language code (`en-us`, `en-gb`, `es`, `fr-fr`, `it`, `pt-br`, `hi`, `ja`, `zh`) | from `language` |
| `sentencePause` | `mvs voice`: silence between sentences (s) | `0.32` |
| `sectionPause` | `mvs voice`: silence between sections (s) | `0.65` |

## Numbers and symbols

In English scripts, numeric tokens are expanded to the words a speaker says, for alignment and TTS:

| Written | Spoken |
| --- | --- |
| `40%` | forty percent |
| `3x`, `3×` | three times |
| `$5k`, `$1.2M` | five thousand dollars, one point two million dollars |
| `10k` | ten thousand |
| `1,250` | one thousand two hundred fifty |
| `3.5` | three point five |
| `2026`, `1999` | twenty twenty six, nineteen ninety nine |
| `21st` | twenty first |
| `24/7` | twenty four seven |
| `v2`, `M3` | v two, m three |
| `&`, `+`, `@` | and, plus, at |

When the speaker says something else (`3×` as "three x", `orbit.dev` as "orbit dot dev"), write it explicitly: `{3×|three x}`, `{orbit.dev|orbit dot dev}`. For other languages always use `{…|…}` for numbers.

On screen and in lookups the **display** form is used: write `f.in('40%')`, not `f.in('forty percent')`.

## Writing for timing

- Scenes find words **by content**. Text you want to animate exactly on the word must appear verbatim in the script (case and punctuation do not matter).
- Repeated phrases: lookups search the current scene first; use `f.word('every', 2)` (zero-based `nth`) or `cut('every', { nth: 1 })` for later occurrences.
- A section per scene keeps the timeline readable: `section('features')`.
- Leave a breath between sections (a `[pause]` or a sentence end): cuts and transitions are placed in pauses.
- ~150 words per minute is a natural pace for product videos; 160–170 is energetic; 130 is calm.

## Changing the script

After editing the words, the timing no longer matches the audio. `mvs check` reports `data/timing.json is stale`. Then:

1. New voiceover (re-record, or `npx mvs voice <id>`),
2. `npx mvs align <id>` (and `npx mvs analyze <id>`).

Without a new recording yet, `npx mvs align <id> --estimate` gives a usable estimated timing.
