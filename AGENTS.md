# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Copilot, Gemini, …) working in this repository.

**The full guide is [CLAUDE.md](CLAUDE.md)** — it applies to every agent, not only Claude. Read it before changing anything.

Essentials:

- This is a motion-as-code video studio. Content lives in `projects/<id>/`; the engine (`engine/`) and CLI (`cli/`) are stable infrastructure.
- Create videos with the CLI: `npx mvs new <id>` → write `script.md` → `npx mvs align <id>` → write scenes/timeline → `npx mvs check <id>` → `npx mvs review <id>` → `npx mvs render <id> --draft` → `npx mvs render <id>`.
- Scenes are pure functions of time (`render(f, g)`): no `Math.random`, `Date.now`, timers or state.
- Anchor animations to voiceover words (`f.in('phrase')`, `section('id')`, `cut('phrase')`), position with `f.stage` and brand tokens.
- Verify with `npm run typecheck`, `npm test`, `npx mvs check <id>`. Ask before running 4K renders.
- Never commit secrets; local settings go in `.env` (see `.env.example`).
