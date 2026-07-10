import { type Component, type Simulation, components, systems } from '@vinland/sim';
import { WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { type GathererSpec, JOB_SOLDIER_SWORD } from '../game/sandbox/index.js';

const { Building, GroundDrop, Health, Owner, Position, Settler, Stockpile } = components;

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

/**
 * Total `good` banked in the goods YARD — summed across every loose ground heap holding it. A flag-bound
 * gatherer no longer stores its harvest ON the flag (a pure marker now); it spreads the load onto separate
 * ground heaps around the flag, capped per tile, so a good's yield lives across several pinned heaps. Each
 * gatherable good is unique to its lane, so summing all heaps of `good` gives that lane's banked total. A
 * heap is a bare loose pile ({@link systems.isYardHeap}) — the ONE shared "settled ground heap" predicate.
 */
export function yardGood(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!systems.isYardHeap(sim.world, e)) continue;
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

/** The number of entities currently carrying `component`. */
export function countComponent<T>(sim: Simulation, component: Component<T>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

/** Loose player-dropped ground piles: a bare {@link Stockpile}+{@link Position} with no building store or
 *  felled-trunk marker — the entity `dropGood` creates, a growing heap that rests in place. */
export function countGroundPiles(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!sim.world.has(e, Building) && !sim.world.has(e, GroundDrop)) n++;
  }
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
