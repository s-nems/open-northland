import {
  halfCellMapFromCells,
  type RestoredSimulation,
  restoreSimulation,
  type SaveGame,
  Simulation,
} from '@open-northland/sim';
import { FOG_MODE_BY_NAME } from '../game/fog.js';
import { setupPlacementTribes } from '../game/placement-tribes.js';
import { resolveWorldContent, type WorldContentOptions } from '../game/sandbox/index.js';
import type { SceneWorld } from './types.js';

/**
 * Builds a fresh deterministic sim for a scene world at tick 0, then runs `scene.build`. The headless
 * twin never passes `options.content`, so copyrighted `content/` never enters tests, and it keeps the
 * clean-room footprints where the browser feeds the real door-shifted ones: a placement-sensitive scene
 * must keep its placements legal under both geometries.
 */
export function createSceneSim(scene: SceneWorld, options: WorldContentOptions = {}): Simulation {
  const sim = new Simulation({
    seed: scene.seed,
    content: resolveWorldContent(scene.terrain, options),
    // Scenes author cell grids; the sim navigates their half-cell lattice.
    map: halfCellMapFromCells(scene.terrain),
  });
  scene.build(sim);
  // Scenes run with needs off so an inspection unit cannot starve mid-run. Enqueued after build so it
  // lands before tick 1's needsSystem; `SceneDefinition.needs` opts back in (FIFO, later write wins).
  if (scene.needs !== true) sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  // Signpost confinement is on in every playable world; scenes enqueue it here, map worlds in their
  // builders.
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  // Enqueued here so the headless twin and the browser run share it; the browser `?progression=` flag
  // enqueues its override after this one (FIFO).
  if (scene.progression === false) sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  // The browser `?fog=` flag enqueues its override after this one (FIFO).
  if (scene.fog !== undefined && scene.fog !== 'off') {
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE_BY_NAME[scene.fog] });
  }
  if (scene.participants !== undefined) {
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: scene.participants });
  }
  setupPlacementTribes(sim);
  return sim;
}

/** Restore a save onto the exact content and terrain {@link createSceneSim} resolves, running none of
 *  the scene's build or rule setup: the saved state already carries them. */
export function restoreSceneSim(
  scene: SceneWorld,
  save: SaveGame,
  options: WorldContentOptions = {},
): RestoredSimulation {
  return restoreSimulation(save, {
    content: resolveWorldContent(scene.terrain, options),
    map: halfCellMapFromCells(scene.terrain),
  });
}

/**
 * Whether `predicate` holds at any tick of a fresh run of `scene`, sampled after every step. The
 * end-of-run world can miss a transient truth, so a check claiming "this state was reached" re-runs the
 * same seed. It is a full re-simulation: only a check's fallback path should pay it, after the cheap
 * end-tick sample fails.
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
