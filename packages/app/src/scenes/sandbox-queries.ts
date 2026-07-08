import { type Component, type Simulation, components, fx } from '@vinland/sim';
import { WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { type GathererSpec, JOB_SOLDIER_SWORD } from '../game/sandbox/ids.js';

const { Health, Owner, Position, Settler, Stockpile } = components;

/**
 * Read-only world queries the sandbox scene's machine checks assert on. These read a SCENE-OWNED sim
 * after its headless run (never live render glue), so the direct `sim.world` reads are the sanctioned
 * check-side counterpart of the command-side placement helpers (`game/sandbox/place.ts`). They live
 * beside the scenes so `game/` carries content + rules, not test predicates.
 */

/** How many units a gatherer's full scene setup should bank: nodes × per-node yield. */
export function expectedGatherYield(g: GathererSpec): number {
  if (g.mode === 'fell') return g.nodes * WOOD_YIELD_PER_NODE;
  if (g.mode === 'mine') return g.depositUnits ?? 0;
  return g.nodes;
}

/** The amount of `good` banked at the flag (stockpile) standing on tile `at`, or 0. */
export function flagGood(sim: Simulation, at: { x: number; y: number }, good: number): number {
  for (const e of sim.world.query(Stockpile)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === at.x && fx.toInt(p.y) === at.y) {
      return sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
    }
  }
  return 0;
}

/** The number of entities currently carrying `component`. */
export function countComponent<T>(sim: Simulation, component: Component<T>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

/** Settlers owned by the human (blue) player. */
export function blueOwnedSettlers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER) n++;
  }
  return n;
}

/** Living settlers owned by any OTHER player (the scene's hostiles). */
export function enemyLivingSettlers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    const owner = sim.world.get(e, Owner).player;
    if (owner !== HUMAN_PLAYER && sim.world.get(e, Health).hitpoints > 0) n++;
  }
  return n;
}

/** Living human-owned swordsmen. */
export function blueLivingSoldiers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    const settler = sim.world.get(e, Settler);
    if (
      sim.world.get(e, Owner).player === HUMAN_PLAYER &&
      settler.jobType === JOB_SOLDIER_SWORD &&
      sim.world.get(e, Health).hitpoints > 0
    ) {
      n++;
    }
  }
  return n;
}
