import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { HUMAN_PLAYER } from '../game/rules.js';

const { Building, GroundDrop, Health, Owner, Position, Settler, Stockpile } = components;

/**
 * Read-only world queries the sandbox scene's machine checks assert on. These read a scene-owned sim
 * after its headless run (never live render glue), so the direct `sim.world` reads are the sanctioned
 * check-side counterpart of the command-side placement helpers (`game/sandbox/place/`). They live
 * beside the scenes so `game/` carries content + rules, not test predicates.
 */

/** The one placed building of `typeId`, or null before its placement command ran. */
export function buildingOfType(sim: Simulation, typeId: number): Entity | null {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === typeId) return e;
  }
  return null;
}

/**
 * Total `good` banked in the goods yard — summed across every loose ground heap holding it. A flag-bound
 * gatherer spreads its harvest onto separate ground heaps around the flag, capped per tile, so a good's
 * yield lives across several pinned heaps. Each gatherable good is unique to its lane, so summing all heaps
 * of `good` gives that lane's banked total. A heap is a bare loose pile ({@link systems.isYardHeap}) — the
 * shared "settled ground heap" predicate.
 */
export function yardGood(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!systems.isYardHeap(sim.world, e)) continue;
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
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

/** Living settlers owned by the human (blue) player — the symmetric twin of
 *  {@link enemyLivingSettlers} for both-sides casualty checks. */
export function blueLivingSettlers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER && sim.world.get(e, Health).hitpoints > 0) n++;
  }
  return n;
}

/** Living settlers owned by any other player (the scene's hostiles). */
export function enemyLivingSettlers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    const owner = sim.world.get(e, Owner).player;
    if (owner !== HUMAN_PLAYER && sim.world.get(e, Health).hitpoints > 0) n++;
  }
  return n;
}
