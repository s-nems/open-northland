# Acceptance scenes — watch a mechanic, sign off

The sim is deterministic and headless, so an agent can prove *mechanics* by running `npm test`. But an
agent **cannot self-judge pixels** — whether the worker actually *looks* like it walks to the clay pit,
plays a believable dig animation, and carries the load home is a human call (see `CLAUDE.md`, "How to
verify your work"). **Acceptance scenes** close that gap.

> The workflow this enables: you ask for a mechanic ("zrób zbieranie gliny"); the agent writes the code,
> sprites, and animation, **and an acceptance scene**; it runs the headless test (mechanic proven), then
> hands you a link — `http://localhost:5173/?scene=clay-gathering` — that plays a worker gathering clay
> with a checklist, and asks "czy jest OK?". You watch and sign off in chat.

## One scene, two consumers

A scene is a single deterministic world setup (`SceneDefinition`) consumed two ways:

| Consumer | Where | Judges | Who |
| --- | --- | --- | --- |
| **Headless** | `packages/app/test/scenes.test.ts` | the **mechanic** (asserts `checks` + core invariants, and re-runs for byte-identical determinism) | the **agent** (`npm test`) |
| **Browser** | `npm run dev` → `?scene=<id>` | the **pixels/animation** | a **human** (the checklist overlay) |

Because the sim is deterministic (same seed + content + setup → byte-identical run), the two observe the
**same** run: what the test proves is exactly what you watch. The mechanic can never silently differ from
the demo.

## Anatomy of a `SceneDefinition`

Defined in `packages/app/src/scenes/<id>.ts` (the type is `scenes/types.ts`):

- `id` — URL-safe; the `?scene=<id>` value and the test's `describe()` name.
- `title` / `summary` — shown in the overlay.
- `seed` — fixes the RNG.
- `content` — a **synthetic** `ContentSet` (goods/jobs/buildings/...), zod-validated by `parseContentSet`.
  Never copyrighted game data — scenes ship in the repo, the real decoded `content/` is gitignored.
- `terrain` — the `TerrainMap` the sim navigates and the renderer projects.
- `build(sim)` — populate the fresh sim: `sim.enqueue(...)` commands (place buildings, spawn settlers)
  and/or `sim.world.create()` resource entities (there is no `spawnResource` command — place them like
  the vertical slice does).
- `runTicks` — how far the headless test advances before asserting.
- `checklist` — the human-readable "what to look for", rendered as the overlay's acceptance list.
- `checks` — `{ label, predicate(sim) }[]`; the mechanic the headless test enforces.

## Add a scene (the loop)

1. **Write** `packages/app/src/scenes/<id>.ts` exporting a `SceneDefinition`. Model it on
   `all-buildings.ts`. Keep `content` minimal — just the goods/jobs/buildings the mechanic needs. Terrain
   size is no longer a constraint: the retained `WorldRenderer` meshes terrain once and pools + culls
   sprites, so a big grass field is cheap (the `stress-crowd` scene is a 256×256 map with thousands of
   bobs). The browser view shows a live FPS / entity / drawn / pooled readout (bottom-left) so you can
   judge render performance and see culling bite (`drawn` ≪ `entities` when zoomed in).
2. **Register** it in `packages/app/src/scenes/index.ts` (`SCENES`). This automatically adds both its
   headless test case and its `?scene=` link — no other wiring.
3. **Prove the mechanic:** `npm test -- scenes`. The check labels point at exactly what failed. This is
   your self-validation — green here means the mechanic works deterministically.
4. **Hand it to the human:** end your turn with `npm run dev` → `http://localhost:5173/?scene=<id>` and
   the checklist, and ask whether it looks right. Add `&atlas=real&zoom=2` if decoded sprites are wanted
   (needs a populated `content/`); the default synthetic atlas animates as flat markers and needs nothing.
   **Do not certify the visual yourself.**

## Watching a scene (controls)

The overlay (top-right) shows the scene's title, summary, the acceptance checklist, and a live tick — it is
the sign-off panel only. **Playback is the in-game GUI now:** the **LEFT tool panel** owns speed + pause (its
game-speed button cycles ×1 → ×2 → ×3 → pause). For a slower-than-×1 pace to judge a walk/animation, pass
`?speed=` (e.g. `?scene=<id>&speed=0.5`) — the discrete button can't reach sub-1×. Reload the page to replay
from tick 0 (deterministic — identical every time). The left HUD shows the tribe's live stocks, so you can
watch a counter rise as goods are gathered.

## Determinism footgun (why `createSceneSim` resets stores)

Sim component stores are **module-level singletons** shared by every `Simulation` (see
`packages/sim/src/ecs/world.ts`). A single page load starts clean, but the **headless test harness builds
many scene sims in one process** — so `createSceneSim` wipes the stores first (`scenes/runtime.ts`), exactly
as the app's vertical-slice test does, or an earlier build's entities leak onto a later one's reused ids.
Always build scene sims through `createSceneSim`; never `new Simulation` directly for a scene.

## See also

- `packages/app/CLAUDE.md` — the app shell contract (URL flags, layering).
- `docs/TESTING.md` — the full test pyramid the headless half plugs into.
- `docs/ARCHITECTURE.md` — the sim → snapshot → render one-way flow scenes ride on.
