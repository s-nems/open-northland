import { halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { FOG_MODE_BY_NAME } from '../game/fog.js';
import { resolveWorldContent, type WorldContentOptions } from '../game/sandbox/index.js';
import type { SceneWorld } from './types.js';

/**
 * Build a fresh, deterministic {@link Simulation} for a {@link SceneWorld} at tick 0 over the scene
 * content + scene terrain, then run `scene.build`. Each sim owns its component stores, so the headless
 * test that builds many scene sims in one process needs no reset ritual. The headless test advances it and
 * asserts; the app renders it live — same inputs, byte-identical run, so the test's proof and the human's
 * view are the same world, with two named exceptions.
 *
 * `options.content` (the browser real-content path) overrides the default clean-room sandbox content;
 * the headless twin never passes it, so copyrighted `content/` never enters tests. The browser also feeds
 * the real extracted (door-shifted, sim-affecting) footprints while the headless twin keeps the clean-room
 * approximations, so a placement-sensitive scene must keep its placements legal under both geometries
 * (and under real content).
 */
export function createSceneSim(scene: SceneWorld, options: WorldContentOptions = {}): Simulation {
  const sim = new Simulation({
    seed: scene.seed,
    content: resolveWorldContent(scene.terrain, options),
    // Scenes author cell grids; the sim navigates their half-cell lattice.
    map: halfCellMapFromCells(scene.terrain),
  });
  scene.build(sim);
  // Scenes run with needs off by default (user decision 2026-07-11) so an inspection unit can't starve
  // mid-inspection and fail the sign-off. Enqueued after build so it applies on tick 1 before that tick's
  // needsSystem; a needs-exercising scene opts back in via `SceneDefinition.needs` (FIFO, later write
  // wins). Live maps keep the sim default (enabled); the admin "Potrzeby" button flips it at runtime.
  if (scene.needs !== true) sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
  // Signpost confinement is on in every playable world (rationale on the slice's
  // `enableSignpostNavigation`); scenes enqueue it here, map worlds in the slice builders.
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  // The scene's fog-of-war mode (omitted = no fog, the sim default), enqueued here so the headless twin
  // and browser run share it; the browser `?fog=` flag enqueues its override after this one (FIFO).
  if (scene.fog !== undefined && scene.fog !== 'off') {
    sim.enqueue({ kind: 'setFogMode', mode: FOG_MODE_BY_NAME[scene.fog] });
  }
  return sim;
}

/**
 * Whether `predicate` holds at SOME tick of a fresh deterministic run of `scene`, sampled after every
 * step up to `ticks`. The end-of-run world can legitimately miss a transient truth (a harvest trough
 * between crop generations, an arrived civilian wandering off its goal node to gossip), so a check whose
 * claim is "this state was reached" re-runs the same seed and watches for the moment instead of the
 * final frame. Deterministic — the fresh run repeats the scene's own — but a full re-simulation: only
 * the fallback path of a check should pay it, after the cheap end-tick sample fails.
 */
export function holdsSometimeDuring(
  scene: SceneWorld,
  ticks: number,
  predicate: (sim: Simulation) => boolean,
): boolean {
  const fresh = createSceneSim(scene);
  for (let i = 0; i < ticks; i++) {
    fresh.step();
    if (predicate(fresh)) return true;
  }
  return false;
}
