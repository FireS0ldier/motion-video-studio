---
name: add-scene
description: Add or change a scene in an existing video project (template or custom code), anchor it to the voiceover and verify it. Use when the user wants a new shot, a different layout, an animation tweak or a new transition in a project under projects/.
---

# Add or change a scene

1. **Find the moment.** `npx mvs info <id>` lists scenes with start/end and transitions. Read `projects/<id>/script.md` for the words spoken there.
2. **Pick the approach:**
   - a template fits → configure it in `projects/<id>/scenes/index.ts` (`templates.showcase`, `features`, `stats`, `code`, `kinetic`, `phoneShowcase`, `cta`, … — docs/kit-and-templates.md);
   - otherwise → a new file `projects/<id>/scenes/<name>.ts` with `defineScene({ name, render(f, g) {…}, cues })` built from kit components (docs/scene-api.md).
3. **Write it correctly** (CLAUDE.md §5):
   - pure function of `f`: no `Math.random`/`Date.now`/state — use `f.rand('key')`, `f.wiggle()`;
   - paint a background first (`kit.background(g, …)`), keep the shot alive (`g.camera(kit.drift(f))`);
   - position with `f.stage` and `kit.responsive(f.stage).s`, centers, text inside `f.stage.title`;
   - anchor to words: `f.in('phrase')`, `anim: { sync: 'voice' }`, `at: 'phrase'`;
   - brand tokens (`'primary'`, `style: 'h2'`, `radius: 'lg'`, `shadow: 'md'`);
   - entrances ease out, exits are faster and ease in; one focal point per beat; stagger secondary elements;
   - cache static layers (`g.layer({ cache: 'key' })`).
4. **Place it** in `projects/<id>/timeline.ts`: `{ scene, start: section('id') | cut('phrase'), transition: … }`. Add a sound for every visual hit (`cues`).
5. **Verify:**
   ```bash
   npm run typecheck
   npx mvs check <id>
   npx mvs still <id> --scene <scene-id>              # look at the 15/50/85 % stills
   npx mvs still <id> --scene <scene-id> --format vertical   # if the project ships other formats
   npx mvs render <id> --draft --scene <scene-id>
   ```
   Look at every PNG; fix layout, timing and contrast issues before reporting back.
