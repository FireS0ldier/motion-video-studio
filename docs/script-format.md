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
| `language` | alignment, number expansion (`en`, `de`) and the TTS engine (`de` → Piper) | `en` |
| `voice` | `mvs voice`: Kokoro id (`am_michael`) or Piper id (`de_DE-thorsten-high`) | by language |
| `speaker` | `mvs voice`: speaker of a multi-speaker Piper voice (`surprised`, …) | — |
| `speed` | `mvs voice` speaking rate | `1.0` |
| `seed` | `mvs voice` (Piper): take number; same seed, same read | `1` |
| `lang` | `mvs voice` Kokoro language code (`en-us`, `en-gb`, `es`, `fr-fr`, `it`, `pt-br`, `hi`, `ja`, `zh`) | from `language` |
| `sentencePause` | `mvs voice`: silence between sentences (s) | `0.32` |
| `sectionPause` | `mvs voice`: silence between sections (s) | `0.65` |

## Numbers and symbols

In English and German scripts, numeric tokens, symbols and domains are expanded to the words a speaker says, for alignment and TTS.

**English** (`language: en`):

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
| `&`, `+`, `@`, `%` | and, plus, at, percent |
| `orbit.dev`, `www.acme.com` | orbit dot dev, w w w dot acme dot com |

**German** (`language: de`): numbers below a million are one word, as written in German; `.` groups thousands and `,` is the decimal separator.

| Written | Spoken |
| --- | --- |
| `21`, `101`, `1.250` | einundzwanzig, hunderteins, tausendzweihundertfünfzig |
| `2026`, `1999` | zweitausendsechsundzwanzig, neunzehnhundertneunundneunzig |
| `2.500.000` | zwei Millionen fünfhunderttausend |
| `3,5`, `3.5` | drei Komma fünf, drei Punkt fünf (versions) |
| `40 %`, `40%` | vierzig Prozent |
| `3x`, `3×` | dreimal |
| `5 €`, `5€`, `€5`, `$5k` | fünf Euro, fünftausend Dollar |
| `10k`, `1,2 Mio.`, `2 Mrd.` | zehntausend, eins Komma zwei Millionen, zwei Milliarden |
| `24/7`, `v2` | vierundzwanzig sieben, v zwei |
| `&`, `+`, `@` | und, plus, at |
| `acme.de` | acme punkt de |
| `z.B.`, `d.h.`, `u.a.`, `u.U.`, `z.T.`, `bzw.`, `bspw.`, `ca.`, `usw.`, `inkl.`, `zzgl.`, `ggf.`, `evtl.`, `vgl.`, `sog.`, `Nr.` | zum Beispiel, das heißt, unter anderem, … |
| `+40%`, `-20 %` | plus vierzig Prozent, minus zwanzig Prozent |
| `30-tägige`, `80er`, `1990er` | dreißigtägige, achtziger, neunzehnhundertneunziger |
| `1. Oktober`, `3. März` | ersten Oktober, dritten März (day before a month name; the sentence is not split there) |
| `10:30`, `9:00` | zehn dreißig, neun |
| `01.10.2026` | left to the TTS (read as a date) |
| `Dr.`, `Prof.` | Doktor, Professor |


`1` is read „eins“; where German needs „ein/eine“ write it: `{1 Woche|eine Woche}`. Other ordinals (`der 1. Platz`) are read as cardinals and the `.` may end the sentence — write them out (`{1.|erste}`). For the formal time, write `{10:30 Uhr|zehn Uhr dreißig}`. Abbreviations are expanded only with their dot (`Sog` and `Sog.` stay words; `sog.` → sogenannt).

When the speaker says something else (`3×` as "three x", `orbit.dev` as "orbit dev"), write it explicitly: `{3×|three x}`, `{orbit.dev|orbit dev}`. For other languages always use `{…|…}` for numbers.

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
