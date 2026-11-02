import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { HUMAN_PLAYER } from '../game/rules.js';
import { VEHICLE_SHIP_SMALL } from '../game/sandbox/index.js';

const { Building, GroundDrop, Health, Owner, Position, Settler, Stockpile } = components;

/** Read-only queries for scene checks: they read a scene-owned sim after its headless run, never live
 *  render glue. */

/** The settlers a scene labels by name, per sim: the sim itself keeps no name of a scene's choosing. */
const sceneLabels = new WeakMap<Simulation, Map<string, Entity>>();

/** Label `entity` as `name` for this sim's scene checks. */
export function labelSceneSettler(sim: Simulation, name: string, entity: Entity): void {
  const labels = sceneLabels.get(sim) ?? new Map<string, Entity>();
  labels.set(name, entity);
  sceneLabels.set(sim, labels);
}

/** The settler this sim's scene labelled `name`, or undefined before the label. */
export function labelledSceneSettler(sim: Simulation, name: string): Entity | undefined {
  return sceneLabels.get(sim)?.get(name);
}

/** The one placed building of `typeId`, or null before its placement command ran. */
export function buildingOfType(sim: Simulation, typeId: number): Entity | null {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === typeId) return e;
  }
  return null;
}

/** Resolved against the running content: the sandbox fallback carries the equippables at +100 while
 *  real content keeps the `goodtypes.ini` ids. */
export function goodBySlug(sim: Simulation, slug: string): number {
  const good = sim.content.goods.find((g) => g.id === slug);
  if (good === undefined) throw new Error(`scene content has no '${slug}' good`);
  return good.typeId;
}

/** Total `good` across every settled ground heap: a flag-bound gatherer spreads its harvest onto
 *  separate per-tile-capped heaps around the flag. */
export function yardGood(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!systems.isYardHeap(sim.world, e)) continue;
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

/** The loose piles `dropGood` creates: a bare stockpile with no building store or felled-trunk marker. */
export function countGroundPiles(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!sim.world.has(e, Building) && !sim.world.has(e, GroundDrop)) n++;
  }
  return n;
}

/** Living settlers owned by the human (blue) player. */
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

/** Enemy (non-human) buildings still standing, with a Health pool above 0. */
export function enemyBuildings(sim: Simulation): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Building, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER && sim.world.get(e, Health).hitpoints > 0)
      out.push(e);
  }
  return out;
}

/** Every settler of `tribe`, a species for animals. */
export function settlersOfTribe(sim: Simulation, tribe: number): Entity[] {
  const members: Entity[] = [];
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).tribe === tribe) members.push(e);
  }
  return members;
}

/** Total `good` stored in every building. */
export function storedInBuildings(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile, Building)) {
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

/** The good `slug` in the store of the placed building of `buildingType`, 0 before its placement. */
export function buildingStock(sim: Simulation, buildingType: number, slug: string): number {
  const building = buildingOfType(sim, buildingType);
  if (building === null) return 0;
  return sim.world.get(building, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
}

/** The small ship's door distance, the ring the mooring lies on. */
export function smallShipDoorDistance(sim: Simulation): number | undefined {
  return sim.content.vehicles.find((t) => t.typeId === VEHICLE_SHIP_SMALL)?.passengerVector?.distance;
}
