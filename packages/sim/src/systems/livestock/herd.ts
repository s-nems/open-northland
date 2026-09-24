import {
  Building,
  FarmAnimal,
  Health,
  Owner,
  ownerOf,
  Position,
  Production,
  Settler,
  StayPoint,
  Stockpile,
  setStockAmount,
  YoungAnimal,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import {
  animalBabyHitpoints,
  isLivestockWorkplaceType,
  livestockGoodOfTribe,
  livestockSpeciesGoods,
  livestockTribeOfGood,
} from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import { stampAnimalBody } from '../spawn/animals.js';
import { stockCapacity } from '../stores/index.js';
import { ANIMAL_ADULT_AGE_TICKS } from './growth.js';
import { herdOf } from './herd-index.js';

// A farm's herd is the set of animals carrying {@link FarmAnimal} for it - the original's house
// attachment - and its species stock rows are that set counted per species, recomputed rather than
// banked (the original zeroes the rows and re-adds one per attached animal every breeder cycle).
//
// Approximation: the original's animals also carry hunger and graze it back into hitpoints, which is
// where a neglected herd starves. Here an animal's pool stays as it was created until a hunter or a
// fight takes it down, so a herd needs no pasture of its own.

/** How far from the farm the newborn's parent may stand (hex map points), the original's search radius
 *  for the adult a produced animal is placed beside. */
const BIRTH_PARENT_RANGE = 40;

/** One species' share of a farm's herd. */
export interface SpeciesHerd {
  /** Every attached animal of the species, the number its stock row carries. */
  readonly all: number;
  /** Those grown up - the only ones the breeder slaughters or breeds from. */
  readonly adults: number;
}

/** Whether `farm` is a standing, finished livestock workplace: what a herd can stay attached to. */
export function farmStands(world: World, ctx: SystemContext, farm: Entity): boolean {
  const b = world.tryGet(farm, Building);
  return b !== undefined && b.built >= ONE && isLivestockWorkplaceType(ctx.content, b.buildingType);
}

/** Whether `animal` has grown up (the original's `adult_animal` job). */
export function isAdultAnimal(world: World, animal: Entity): boolean {
  return !world.has(animal, YoungAnimal);
}

/** The species good of `animal`, or null when it is not livestock. */
export function speciesGoodOf(world: World, ctx: SystemContext, animal: Entity): number | null {
  const settler = world.tryGet(animal, Settler);
  return settler === undefined ? null : livestockGoodOfTribe(ctx.content, settler.tribe);
}

/** `farm`'s herd of `speciesGood`, counted over the attachment store. */
export function speciesHerdOf(
  world: World,
  ctx: SystemContext,
  farm: Entity,
  speciesGood: number,
): SpeciesHerd {
  let all = 0;
  let adults = 0;
  for (const e of herdOf(world, farm)) {
    if (speciesGoodOf(world, ctx, e) !== speciesGood) continue;
    all += 1;
    if (isAdultAnimal(world, e)) adults += 1;
  }
  return { all, adults };
}

/**
 * How many more animals `farm` may take in while breeding or adopting `speciesGood`: its row cap less the
 * whole herd, every species together, and less the calves its running cycles will bear.
 *
 * The caps are per row (`housetypes.ini` gives the animal farm 20 sheep and 20 cattle), but the house is
 * described as holding "20 oxen and sheep" (manual p. 53), and a breeder set to tend both species would
 * otherwise keep twice the herd one tending a single species keeps. The room a species has therefore
 * shrinks as the other one grows.
 */
export function herdRoom(world: World, ctx: SystemContext, farm: Entity, speciesGood: number): number {
  let held = herdOf(world, farm).length;
  for (const cycle of world.tryGet(farm, Production)?.cycles ?? []) {
    if (livestockTribeOfGood(ctx.content, cycle.goodType) !== null) held += 1; // a calf on its way
  }
  return stockCapacity(world, ctx, farm, speciesGood) - held;
}

/** Attach `animal` to `farm`'s herd, dropping whatever summon its previous farm held it under. */
export function attachToFarm(world: World, animal: Entity, farm: Entity): void {
  const held = world.tryGet(animal, FarmAnimal);
  if (held === undefined) {
    world.add(animal, FarmAnimal, { farm, summoner: null });
    return;
  }
  const mut = world.mut(animal, FarmAnimal);
  mut.farm = farm;
  mut.summoner = null;
}

/** Rewrite `farm`'s species rows to the herd it actually holds, the row cap standing in for a herd no
 *  branch of the breeder cycle can grow past. A row that already reads right is left untouched. */
export function recountHerdRows(world: World, ctx: SystemContext, farm: Entity): void {
  if (!world.has(farm, Stockpile)) return;
  const counts = new Map<number, number>();
  for (const e of herdOf(world, farm)) {
    const good = speciesGoodOf(world, ctx, e);
    if (good !== null) counts.set(good, (counts.get(good) ?? 0) + 1);
  }
  const stock = world.get(farm, Stockpile).amounts;
  for (const good of herdRowGoodsOf(world, ctx, farm)) {
    const capacity = stockCapacity(world, ctx, farm, good);
    const count = Math.min(counts.get(good) ?? 0, capacity);
    if ((stock.get(good) ?? 0) !== count) setStockAmount(world, farm, good, count);
  }
}

/** The species goods `farm` keeps a herd row for: the species its stock has a slot for. */
function* herdRowGoodsOf(world: World, ctx: SystemContext, farm: Entity): IterableIterator<number> {
  for (const good of livestockSpeciesGoods(ctx.content)) {
    if (stockCapacity(world, ctx, farm, good) > 0) yield good;
  }
}

/**
 * The young animal a finished breeding cycle yields: it appears beside an adult of its species already
 * attached to `farm` and joins the herd there, as the original places a produced animal at the second
 * attached adult of the species within {@link BIRTH_PARENT_RANGE} map points.
 * A pair that wandered out of range yields nothing, the inputs already spent (approximation: the
 * original's failure path is not read).
 */
export function birthHerdAnimal(
  world: World,
  ctx: SystemContext,
  farm: Entity,
  speciesGood: number,
): Entity | null {
  const parent = birthParentOf(world, ctx, farm, speciesGood);
  if (parent === null) return null;
  const tribe = world.get(parent, Settler).tribe;
  const hitpoints = animalBabyHitpoints(ctx.content, tribe) ?? 0;
  if (hitpoints <= 0) return null; // a species with no juvenile pool bears nothing alive
  const at = world.get(parent, Position);
  const calf = world.create();
  world.add(calf, Position, { x: at.x, y: at.y });
  stampAnimalBody(world, ctx, calf, tribe, hitpoints);
  const owner = ownerOf(world, farm);
  if (owner !== undefined) world.add(calf, Owner, { player: owner });
  const anchor = world.tryGet(parent, StayPoint);
  if (anchor !== undefined) world.add(calf, StayPoint, { cell: anchor.cell });
  world.add(calf, YoungAnimal, { adultAt: ctx.tick + ANIMAL_ADULT_AGE_TICKS });
  attachToFarm(world, calf, farm);
  // No `settlerBorn`: that event rings the settlement's birth jingle
  // (`DM_MUSIC_TYPE_JINGLE_BIRTH`), which the original keeps for its people. A calf arrives with the
  // sounds its breeder's clip names and nothing else.
  recountHerdRows(world, ctx, farm);
  return calf;
}

/** The adult the newborn appears beside: the second of its species attached to `farm` and standing
 *  within range of its door, else the first. */
function birthParentOf(world: World, ctx: SystemContext, farm: Entity, speciesGood: number): Entity | null {
  const terrain = ctx.terrain;
  const door = terrain === undefined ? null : interactionNodeId(world, ctx, terrain, farm);
  const inRange = (animal: Entity): boolean => {
    if (terrain === undefined || door === null) return true; // mapless sim: no door to measure from
    const at = terrain.coordsOf(entityNode(world, terrain, animal));
    const from = terrain.coordsOf(door);
    return hexDistanceBetween(from.x, from.y, at.x, at.y) <= BIRTH_PARENT_RANGE;
  };
  const adults: Entity[] = [];
  for (const e of herdOf(world, farm)) {
    if (!isAdultAnimal(world, e) || speciesGoodOf(world, ctx, e) !== speciesGood) continue;
    if (!world.has(e, Health) || !inRange(e)) continue;
    adults.push(e);
    if (adults.length > 1) break;
  }
  return adults[1] ?? adults[0] ?? null;
}
