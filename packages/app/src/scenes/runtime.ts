import { type Component, components, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { FOG_MODE_BY_NAME } from '../game/fog.js';
import { type SandboxContentExtras, sandboxContent } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Clear every sim component's backing store. Component stores are module-level singletons shared by every
 * {@link Simulation} (`packages/sim/src/ecs/world.ts`), so a sim rebuilt in the same JS context (the
 * overlay's restart) would see the prior run's entities and break determinism unless they are wiped first.
 */
function resetComponentStores(): void {
  // The `components` namespace also re-exports helpers, so clear only the exports carrying a `.store` Map.
  for (const v of Object.values(components)) {
    const store = (v as Partial<Component<unknown>>).store;
    if (store instanceof Map) store.clear();
  }
}

/**
 * Build a fresh, deterministic {@link Simulation} for a scene at tick 0: reset the singleton stores,
 * construct the sim over the global sandbox content + scene terrain, then run `scene.build`. The headless
 * test advances it and asserts; the app renders it live — same inputs, byte-identical run, so the test's
 * proof and the human's view are the same world, with one named exception. `extras` is mostly display-only
 * (e.g. localized `goodNames`), except `buildingFootprints`: the browser feeds the real extracted
 * (door-shifted) footprints, which are sim-affecting (collision, placement legality, walk-to-door), while
 * the headless twin keeps the clean-room approximations (copyrighted `content/` never enters tests). So a
 * placement-sensitive scene must keep its placements legal under both geometries.
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
  // Scenes run with needs off by default (user decision 2026-07-11) so an inspection unit can't starve
  // mid-inspection and fail the sign-off. Enqueued after build so it applies on tick 1 before that tick's
  // needsSystem; a needs-exercising scene opts back in via `SceneDefinition.needs` (FIFO, later write
  // wins). Live maps keep the sim default (enabled); the admin "Potrzeby" button flips it at runtime.
  if (scene.needs !== true) sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
  // The scene's fog-of-war mode (omitted = no fog, the sim default), enqueued here so the headless twin
  // and browser run share it; the browser `?fog=` flag enqueues its override after this one (FIFO).
  if (scene.fog !== undefined && scene.fog !== 'off') {
    sim.enqueue({ kind: 'setFogMode', mode: FOG_MODE_BY_NAME[scene.fog] });
  }
  return sim;
}
