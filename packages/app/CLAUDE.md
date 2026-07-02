# packages/app — the shell (the only package that touches both sim and render)

`app` wires input → sim **commands**, runs the fixed-timestep loop, and hands each `snapshot()` to
`render`. It is the ONE package allowed to depend on both `sim` and `render`. The root
[`CLAUDE.md`](../../CLAUDE.md) carries the project-wide rules; this file is the app-local contract.

## Boundaries

- **DOM + floats are fine here** (and in `render`), never in `sim`. `performance.now`/RAF/`fetch` live
  at this layer — they are the I/O boundary the pure sim must not have. Load gitignored `content/`
  (maps, atlases, textures) via `fetch` over the dev-server middleware (`vite.config.ts`), and degrade
  gracefully when it's absent (a checkout without `content/` must still boot).
- **One-way flow:** app issues commands into the sim and reads `snapshot()` out; never reach into live
  component stores from render glue. Determinism is the sim's; the app just drives wall-clock → ticks.

## URL-flag entries

The app dispatches on `window.location.search` (see `main.ts`). Each flag is opt-in and degrades to a
reproducible default so the committed build + the `npm run shot` PNG never depend on gitignored bytes:

- `?shot[&seed&ticks&hud]` — headless deterministic screenshot entry (`shot.ts`).
- `?scene=<id>` — run a registered **acceptance scene** with its checklist overlay (`scene-mode.ts`).
- `?anim[&char=<id>&view=anim|heads&dir=full|0..7&cols=N&filter=<substr>&zoom&speed]` — the character
  **animation gallery** (`anim-mode.ts` + `viking-roster.ts`), the extracted `[bobseq]` played from the atlas
  with a direction selector so a human can validate all animations in all 8 facings. **Bare `?anim` (no
  `?char=`) is the DEFAULT: the full-roster montage** — one walking cell per viking look (every roster body ×
  each of its heads) on one screen. `?char=<id>` drills into one body — its full animation set (`?view=anim`)
  or, for a multi-look body, its heads montage (`?view=heads`, the plain walk once per head). The roster
  (civilian / **warrior** with its broadsword/sword/bow/spear/bare-handed set / woman / boy / girl / baby) is
  the mod's viking `[jobbasegraphics]` body/head pairs; the baby is body-only. Character/view changes reload
  the page (different atlases); direction is live. Real graphics required (shows a "run the pipeline" message
  when `content/` is absent). All bodies decode with one palette today — a per-tone **skin/hair variant** axis
  is a deferred pipeline follow-up (docs/FIDELITY.md).
- `?map=<id>` · `?atlas` · `?terrain` · `?zoom=N` · `?speed=N` — real decoded grid / sprite atlas / ground
  textures / camera magnify / playback rate. These compose with `?scene=`. Real graphics are the **default**
  for live + scene (`resolveSpriteSheet` degrades to synthetic markers when `content/` is absent, so a bare
  checkout still boots); `?atlas=synthetic` forces markers, `?atlas=none` placeholder geometry. `?shot` keeps
  its own content-free default so the committed PNG never depends on gitignored bytes.

## Acceptance scenes — let a human sign off a mechanic

An agent **cannot self-judge pixels** (root `CLAUDE.md` "How to verify your work", point 5). An
*acceptance scene* is the seam: ONE deterministic setup with two consumers —

- **headless** (`test/scenes.test.ts`) proves the *mechanic* (the agent self-validates with `npm test`),
- **browser** (`?scene=<id>`) renders the SAME run with a checklist overlay so a *human* judges the pixels.

To add one (full guide in [`docs/SCENES.md`](../../docs/SCENES.md)):

1. Write `src/scenes/<id>.ts` exporting a `SceneDefinition` — synthetic `content` (zod-validated, never
   copyrighted data), a `terrain` grid, a `build(sim)` that places the world, a human `checklist`, and
   machine `checks` (the mechanic the headless test asserts).
2. Register it in `src/scenes/index.ts` (`SCENES`). That auto-adds its headless test AND its `?scene=` link.
3. `npm test` (mechanic green) → then surface `npm run dev` → `http://localhost:5173/?scene=<id>` and the
   checklist, and ask the user whether it looks right. Don't claim the visual is correct yourself.

Scene sims share `sim`'s **module-level component stores** (a known footgun), so `createSceneSim` resets
them on every build — don't bypass it (e.g. the overlay's restart relies on it).
