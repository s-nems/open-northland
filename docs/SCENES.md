# Acceptance scenes

An acceptance scene is a deterministic world setup shared by a headless test and the browser. Use a
scene when a mechanic needs both state assertions and a human check of its presentation.

## Two consumers

| Consumer | Location | Purpose |
| --- | --- | --- |
| Headless | `packages/app/test/scenes.test.ts` | mechanics, invariants, and determinism |
| Browser | `?scene=<id>` | pixels, animation, controls, and sound |

Both consumers use the same seed, sandbox content, setup, and run length. The browser may add local
decoded art and footprints, but the headless test must not require copyrighted content.

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
3. Add its title and summary to both locale catalogs.
4. Run `npm test -- scenes`.
5. Open `http://localhost:5173/?scene=<id>` and perform the human checks named by the ticket.

Keep instructions out of the game view. Put durable assertions in tests and short review notes in the
ticket. The normal HUD should remain the thing being tested.

Build the simulation through `createSceneSim` so headless and browser defaults stay aligned. Each
simulation owns its component stores, so tests do not need a global reset between scenes.

See [`TESTING.md`](TESTING.md) for test layers and [`DEVELOPMENT.md`](DEVELOPMENT.md) for browser
entries.
