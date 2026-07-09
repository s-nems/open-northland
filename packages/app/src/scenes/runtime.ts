import { type Component, Simulation, components, halfCellMapFromCells } from '@vinland/sim';
import { sandboxContent } from '../game/sandbox/index.js';
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
 * byte-identical run, so the test's proof and the human's view are the same world.
 */
export function createSceneSim(scene: SceneDefinition): Simulation {
  resetComponentStores();
  const sim = new Simulation({
    seed: scene.seed,
    content: sandboxContent(scene.terrain),
    // Scenes author cell grids; the sim navigates their half-cell lattice.
    map: halfCellMapFromCells(scene.terrain),
  });
  scene.build(sim);
  return sim;
}
