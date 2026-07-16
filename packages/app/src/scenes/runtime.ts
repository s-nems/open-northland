import type { ContentSet } from '@open-northland/data';
import { halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { FOG_MODE_BY_NAME } from '../game/fog.js';
import { type SandboxContentExtras, sandboxContent } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Build a fresh, deterministic {@link Simulation} for a scene at tick 0 over the scene content + scene
 * terrain, then run `scene.build`. Each sim owns its component stores, so the headless test that builds
 * many scene sims in one process needs no reset ritual. The headless test advances it and asserts; the app
 * renders it live — same inputs, byte-identical run, so the test's proof and the human's view are the same
 * world, with two named exceptions.
 *
 * `content` (the browser real-content path) overrides the default clean-room sandbox content — the headless
 * twin never passes it, so copyrighted `content/` never enters tests. `extras` (used only when building the
 * default sandbox content) is mostly display-only (e.g. localized `goodNames`), except `buildingFootprints`:
 * the browser feeds the real extracted (door-shifted) footprints, which are sim-affecting (collision,
 * placement legality, walk-to-door), while the headless twin keeps the clean-room approximations. So a
 * placement-sensitive scene must keep its placements legal under both geometries (and under real content).
 */
export function createSceneSim(
  scene: SceneDefinition,
  extras?: SandboxContentExtras,
  content?: ContentSet,
): Simulation {
  const sim = new Simulation({
    seed: scene.seed,
    content: content ?? sandboxContent(scene.terrain, extras),
    // Scenes author cell grids; the sim navigates their half-cell lattice.
    map: halfCellMapFromCells(scene.terrain),
  });
  scene.build(sim);
  // Scenes run with needs off by default (user decision 2026-07-11) so an inspection unit can't starve
  // mid-inspection and fail the sign-off. Enqueued after build so it applies on tick 1 before that tick's
  // needsSystem; a needs-exercising scene opts back in via `SceneDefinition.needs` (FIFO, later write
  // wins). Live maps keep the sim default (enabled); the admin "Potrzeby" button flips it at runtime.
  if (scene.needs !== true) sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
  // Signpost navigation confinement is a game fundament (user decision 2026-07-16): every playable world
  // runs with it ON — a settler acts only within its local circle + its player's reachable signpost
  // network. Enqueued for scenes here and for map worlds in the slice builders, keeping the sim-level
  // default off so pre-signpost goldens stay byte-identical.
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  // The scene's fog-of-war mode (omitted = no fog, the sim default), enqueued here so the headless twin
  // and browser run share it; the browser `?fog=` flag enqueues its override after this one (FIFO).
  if (scene.fog !== undefined && scene.fog !== 'off') {
    sim.enqueue({ kind: 'setFogMode', mode: FOG_MODE_BY_NAME[scene.fog] });
  }
  return sim;
}
