import { type Component, components, halfCellMapFromCells, Simulation } from '@vinland/sim';
import { FOG_MODE_BY_NAME } from '../game/fog.js';
import { type SandboxContentExtras, sandboxContent } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Clear every sim component's backing store. Component stores are MODULE-LEVEL SINGLETONS shared by
 * every {@link Simulation} (`packages/sim/src/ecs/world.ts` — `defineComponent` owns the Map, and
 * `World.create` mints ids from 1 per instance), so a freshly-built sim still sees the entities a
 * prior one left behind. A page load starts clean, but the overlay's **restart** rebuilds the sim in
 * the same JS context — without this wipe the old worker/trees would leak into the new run and break
 * determinism. Mirrors the app's vertical-slice test (`clearStores`).
 */
export function resetComponentStores(): void {
  // The `components` namespace re-exports helpers (e.g. `stockpileEntries`) alongside the actual
  // components, so clear only the exports that carry a `.store` Map.
  for (const v of Object.values(components)) {
    const store = (v as Partial<Component<unknown>>).store;
    if (store instanceof Map) store.clear();
  }
}

/**
 * Build a fresh, deterministic {@link Simulation} for a scene at tick 0: reset the singleton stores,
 * construct the sim over the global sandbox content + scene terrain, then run the scene's setup. The
 * headless test advances it and asserts; the app keeps it live and renders each frame. Same inputs →
 * byte-identical run, so the test's proof and the human's view are the same world — with ONE named
 * exception below.
 *
 * `extras` is mostly display-only content the headless tests omit (e.g. the browser entry's localized
 * `goodNames` — the run stays byte-identical). The exception is `buildingFootprints`: the browser
 * entry feeds the REAL extracted (door-shifted) footprints, which ARE sim-affecting (collision,
 * placement legality, walk-to-door targets), while the headless twin keeps the clean-room
 * approximations — copyrighted `content/` can never enter the tests. So a scene's mechanic proof
 * holds on approximated geometry and the human additionally judges the real-geometry run; a scene
 * whose setup is placement-sensitive must keep its placements comfortably legal under BOTH (the
 * gallery's grid-pitch comment shows the pattern).
 */
export function createSceneSim(scene: SceneDefinition, extras?: SandboxContentExtras): Simulation {
  resetComponentStores();
  const sim = new Simulation({
    seed: scene.seed,
    content: sandboxContent(scene.terrain, extras),
    // Scenes author cell grids; the sim navigates their half-cell lattice.
    map: halfCellMapFromCells(scene.terrain),
  });
  scene.build(sim);
  // Scenes run with the needs mechanic OFF by default (user decision 2026-07-11): a checklist unit
  // starving mid-inspection would fail the sign-off for the wrong reason. Enqueued AFTER build, so it
  // applies on tick 1's commandSystem BEFORE that tick's needsSystem — identically in the headless twin
  // and the browser run — and a build-time enqueue can't override it (FIFO, later write wins), which is
  // why a needs-exercising scene opts back in via `SceneDefinition.needs` instead. Live maps keep the
  // sim default (enabled); the admin panel's "Potrzeby" button flips it at runtime either way.
  if (scene.needs !== true) sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
  // The scene's fog-of-war mode (omitted = no fog, the sim default). Enqueued here so the headless
  // twin and the browser run share it; the browser `?fog=` flag enqueues its override AFTER this one
  // (FIFO, later write wins) — the same layering as the needs toggle above.
  if (scene.fog !== undefined && scene.fog !== 'off') {
    sim.enqueue({ kind: 'setFogMode', mode: FOG_MODE_BY_NAME[scene.fog] });
  }
  return sim;
}
