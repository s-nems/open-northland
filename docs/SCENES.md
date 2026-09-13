# Acceptance scenes

An acceptance scene is a deterministic world setup shared by a headless test and the browser. Use a
scene when a mechanic needs both state assertions and a human check of its presentation.

## Two consumers

| Consumer | Location | Purpose |
| --- | --- | --- |
| Headless | `packages/app/test/scenes/<id>.test.ts` | mechanics and invariants |
| Browser | `?scene=<id>` | pixels, animation, controls, and sound |

A scene does not re-prove same-seed determinism: every mechanic's own suite under `packages/sim/test/`
compares two runs of its scenario, with `core/fuzz-determinism.test.ts` and `core/golden-trace.test.ts`
as the engine-wide tripwires. Nothing checks a scene's own `build()`, so keep pre-tick-zero setup free
of wall clock, unseeded randomness, and payloads shared between runs.

Both consumers use the same seed, sandbox content, setup, and run length. The browser adds local
decoded terrain (required: without generated `content/` the entry halts on the missing-content
notice) and decoded sprites and footprints when served, but the headless test must not require
copyrighted content.

## Scene definition

A `SceneDefinition` in `packages/app/src/scenes/<id>.ts` contains:

- a stable `id`, `seed`, and terrain setup;
- `build(sim)` for pre-tick entities and commands;
- `runTicks` and machine-readable checks;
- optional settings such as needs, fog, or initial zoom.

Player-facing title and summary text belongs in both locale catalogs under `scene.<id>`. Shared goods,
jobs, buildings, controls, and sound bindings belong in the sandbox catalog, not in the scene.

## Add a scene

1. Add a focused scene definition.
2. Register it in `packages/app/src/scenes/index.ts`.
3. Add `packages/app/test/scenes/<id>.test.ts` calling `sceneAcceptance` - one file per scene, so
   Vitest spreads the runs over workers. `registry.test.ts` fails until it exists.
4. Add its title and summary to both locale catalogs.
5. Run `npm test -- scenes`.
6. Open `http://localhost:5173/?scene=<id>` and perform the human checks named by the ticket.

Keep instructions out of the game view. Put durable assertions in tests and short review notes in the
ticket. The normal HUD should remain the thing being tested.

Build the simulation through `createSceneSim` so headless and browser defaults stay aligned. Each
simulation owns its component stores, so tests do not need a global reset between scenes.

See [`TESTING.md`](TESTING.md) for test layers and [`DEVELOPMENT.md`](DEVELOPMENT.md) for browser
entries.

Scenes accept `assets=own` for the same own sprite and terrain loaders as map play. The
`farm-construction` scene starts at ×2 and places a working construction crew beside a finished farm.
The `terrain-edits` scene exercises saved terrain palette edits and a scripted build ban. Its western
patch uses a brown vertex palette entry and its eastern patch a green entry from the owned content.

## Real map acceptance

`?scene=mission-map` opens the decoded `wielkie_sprzatanie` map through the normal map entry with
automatic script execution and `debug=missions`. The menu lists it under test scenes. The URL becomes a map URL,
so save/load uses the real map identity. Explicit mission and fog overrides remain effective.

Real-map scenes live in `scenes/map-scenes.ts`, separately from synthetic `SceneDefinition` worlds.
Their headless checks require owned content and run under `npm run test:content`:
`packages/app/test/content/map-mission-acceptance.test.ts` exercises the untouched script's opening,
the hero's ordinary move order to reinforcements, and identical continuation after save/load.
`packages/app/test/map-mission-scene.test.ts` checks routing and the execution-log projection without
owned content.

This is a scripted single-player free map, not a base campaign. Its opening and reinforcements do not
prove its ending or campaign completion. The inspector shows saved execution ticks and counts;
unsupported and refused results remain in the diagnostic log.

`?scene=school` shows a collector walking to school and acquiring an individual carpentry qualification.
Another collector is available for choosing a course through the school dialog.

`?scene=technology` shows map permission followed by a player-owned profession unlocking housing.
