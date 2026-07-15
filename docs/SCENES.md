# Acceptance scenes

Acceptance scenes are deterministic world setups shared by headless mechanic tests and the browser.
The browser renders only the game and its normal HUD; scene names and short descriptions live on the
main menu, not in an in-scene instructions panel.

## One scene, two consumers

| Consumer | Where | Purpose |
| --- | --- | --- |
| Headless | `packages/app/test/scenes.test.ts` | assert mechanics, invariants, and deterministic replay |
| Browser | `npm run dev` → `?scene=<id>` | let a human inspect pixels, animation, and sound |

The same seed, global rules, and setup drive both consumers. The browser may additionally load local
decoded footprints and presentation assets; tests remain independent of copyrighted, gitignored content.

## Scene definition

A `SceneDefinition` in `packages/app/src/scenes/<id>.ts` contains:

- `id`, `seed`, and cell-resolution `terrain`;
- `build(sim)` for deterministic placement and commands;
- `runTicks` and machine-readable `checks`;
- optional needs, fog, and initial zoom settings.

Player-facing `title` and `summary` values belong in both locale catalogs under `scene.<id>`. Scenes do
not own goods, jobs, buildings, weapons, animation bindings, controls, sound, or menu contents; those
rules live in `packages/app/src/game/sandbox/`.

## Add and verify a scene

1. Add the definition and keep it focused on setup plus machine checks.
2. Register it in `packages/app/src/scenes/index.ts`; this adds its test and main-menu entry.
3. Run `npm test -- scenes`.
4. Open `http://localhost:5173/?scene=<id>`, sanity-check that it runs, and hand the URL plus concise
   verification notes to the human reviewer. Record any reusable acceptance criteria in the ticket or
   test, not in an expandable in-game checklist.

The left tool panel owns pause and its three standard speeds. Initial speed, interface scale, fog, and
the geometry grid can be configured from the main menu. The mouse wheel controls camera zoom. Reloading
restarts the deterministic scene.

## Building a scene sim

Each sim owns its component stores, so the headless test can build many scene sims in one process
independently — no reset ritual. Build scenes through `createSceneSim`: it applies the scene defaults
(needs-off, fog) the headless twin and the browser must share.

See also `packages/app/AGENTS.md`, `docs/TESTING.md`, and `docs/ARCHITECTURE.md`.
