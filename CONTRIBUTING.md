# Contributing

Thanks for improving Motion Video Studio. This file is about changing the **studio itself** (engine, CLI, kit, templates, docs). To make a video, see [docs/workflow.md](docs/workflow.md).

## Setup

```bash
git clone https://github.com/FireS0ldier/motion-video-studio.git
cd motion-video-studio
npm install
npm run setup          # Chromium if needed, ffmpeg check, doctor
npm run check          # typecheck + unit tests
npm run test:e2e       # render tests (a few minutes)
```

Requirements: Node ≥ 20.19 (22 recommended), ffmpeg with libx264, a Chromium/Chrome. Optional: [uv](https://docs.astral.sh/uv/) for the Python tools.

## Where things go

| Change | Location | Also |
| --- | --- | --- |
| A component several videos need | `engine/kit/` + export in `engine/kit/index.ts` | Document in `docs/kit-and-templates.md` |
| A reusable scene | `engine/templates/` + export in `engine/templates/index.ts` | Document; try it in landscape, vertical and square |
| Graphics/text/compositor | `engine/gfx/`, `engine/gl/` | Determinism, e2e test |
| Timing, timeline, project | `engine/core/` | Unit tests in `tests/unit/` |
| A CLI command | `cli/commands/<name>.ts`, registered in `cli/index.ts` | `--help` text, test in `tests/unit/cli.test.ts`, row in the README table |
| Python tool | `tools/python/` (run through `uv run --with …`) | Pin model revisions and SHA-256 checksums |
| Content for one video | `projects/<id>/` | — |

## Rules

- **Public API stability.** `engine/index.ts` is the content API. Additions are fine; breaking changes need a reason, a CHANGELOG entry and updated projects/templates/docs.
- **Determinism is a contract.** No wall clock, no unseeded randomness, no system fonts, nothing order-dependent between frames. A render must not depend on worker count. `tests/e2e/pipeline.test.ts` checks this.
- **Pure scenes.** Kit components and templates read time only from `g.f` / `f`.
- **Brand tokens, responsive layout.** Components use brand colors/type/radii/shadows and size with `kit.responsive(f.stage).s`; positions are centers.
- **Small dependency surface.** Prefer a focused implementation over a new package. New runtime dependencies need a clear benefit and a compatible license (MIT/Apache/BSD/ISC/OFL).
- **Helpful errors.** CLI errors are `CliError(message, hint)`: say what is wrong and how to fix it.
- **No secrets** in code, tests, fixtures or docs. Local settings go in `.env` (git-ignored).

## Tests

| Command | What |
| --- | --- |
| `npm run typecheck` | TypeScript (strict) over engine, CLI, projects, templates, tests |
| `npm test` | Unit tests (vitest): motion, script/timing, project/timeline, audio DSP/loudness/mixer, CLI |
| `npm run test:e2e` | Renders in headless Chromium: a temporary project from the starter template (stills, determinism, vertical format, draft video with 1 and 2 workers → identical hashes, `mvs check`) and the demo project (`info`, `check`, stills of every scene) |

Visual changes: compare stills before and after (`npx mvs still orbit-launch --scene <id>`) and look at the review pack (`npx mvs review orbit-launch`).

## Commits and pull requests

- Conventional commits: `feat(kit): …`, `fix(cli): …`, `docs: …`, `perf(gl): …`, `test: …`, `chore: …`.
- One topic per pull request; describe what changed, why, and how it was tested (commands + results).
- Update `CHANGELOG.md` (Unreleased section) for user-visible changes.
- CI runs typecheck, unit tests and e2e render tests; it must be green.
