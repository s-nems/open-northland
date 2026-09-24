import {
  Building,
  CARRY_CAPACITY,
  FarmAnimal,
  JobAssignment,
  MoveGoal,
  ownerOf,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { BREEDING_PAIR, craftablePool } from '../../../economy/production.js';
import { removeSettlerSilently } from '../../../lifecycle/cleanup.js';
import {
  attachToFarm,
  farmStands,
  freeStockOf,
  herdedFarms,
  herdOf,
  herdRoom,
  isAdultAnimal,
  recountHerdRows,
  slayDepositGoods,
  speciesGoodOf,
  speciesHerdOf,
} from '../../../livestock/index.js';
import { workplaceStaffable } from '../../../progression/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import {
  isLivestockWorkplaceType,
  livestockTribeOfGood,
  slayAtomicOfSpecies,
} from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { buildingWorkerJobs, recipesByProductOf, stockCapacity } from '../../../stores/index.js';
import { atOrWalk, startAtomic, startPickup } from '../../atomics/start.js';
import { enterBuilding } from '../../indoors.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { interactionCell, jobAtomics } from '../../targets/index.js';
import { deliverableGoodProbe } from '../economy/delivery-targets.js';
import { planProducer, type WorkSeatClaims } from '../economy/index.js';

/** How close the breeder gets before it takes an animal in hand: the original puts one into
 *  house-interaction mode from within 2 map points. */
const SUMMON_RANGE = 2;

/** How many other farms the breeder will raid for a species it is short of, the original's limit. */
const TAKE_SOURCE_FARMS = 5;

/**
 * The breeder's cycle at the farm it is employed at, one branch per planner pass, in the original's own
 * order: adopt a stray, take one from a neighbouring farm while this herd is
 * below a pair, carry a full ware out, slaughter a grown animal past the pair, else breed the pair.
 * Returns false only for a settler that is not a breeder here, so a carrier falls through to its own rung.
 *
 * The species rows are rewritten from the herd at the top of every cycle, as the original recomputes them,
 * and the branches run per species in the breeder's own production order, so a player's craft choice picks
 * which herd it tends.
 */
export function planBreeder(
  plan: PlannerContext,
  seatClaims: WorkSeatClaims,
  spacing: PlannerSpacing,
): boolean {
  const { world, ctx, entity: e } = plan;
  const farm = boundBreederFarm(world, ctx, e, plan.jobType, plan.tribe);
  if (farm === null) return false;
  recountHerdRows(world, ctx, farm);

  const species = tendedSpecies(plan, farm);
  if (adoptStray(plan, farm)) return true;
  for (const good of species) {
    if (takeFromNeighbour(plan, farm, good)) return true;
    if (flushFullWare(plan, farm, good)) return true;
    if (planSlay(plan, farm, good)) return true;
    if (breedableNow(world, ctx, farm, good)) {
      planProducer(plan, farm, seatClaims, spacing);
      return true;
    }
  }
  // Nothing to tend this cycle: wait inside the farm.
  const { terrain, here } = plan;
  enterBuilding(world, e, farm, here, interactionCell(world, ctx, terrain, farm, here));
  return true;
}

/** The farm this settler breeds at, or null when it is not the breeding trade there (a farm's carrier
 *  falls through to the porter rung). The gate is the produce atomic of a species the house breeds, the
 *  original's job-enabled production list. */
function boundBreederFarm(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): Entity | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const farm = binding.workplace;
  const building = world.tryGet(farm, Building);
  if (building === undefined || building.tribe !== tribe || building.built < ONE) return null;
  if (world.has(farm, UnderConstruction) || !world.has(farm, Position)) return null;
  if (!isLivestockWorkplaceType(ctx.content, building.buildingType)) return null;
  if (!buildingWorkerJobs(world, ctx, farm).has(jobType)) return null;
  if (!workplaceStaffable(world, ctx, ownerOf(world, farm), tribe, building.buildingType)) return null;
  const atomics = jobAtomics(ctx, jobType);
  const breeds = [...breedableSpeciesOf(world, ctx, farm)].some((good) => {
    const produce = contentProduceAtomic(ctx, good);
    return produce !== null && atomics.has(produce);
  });
  return breeds ? farm : null;
}

/** The species goods `farm` has a breeding recipe for. */
function* breedableSpeciesOf(world: World, ctx: SystemContext, farm: Entity): IterableIterator<number> {
  for (const good of recipesByProductOf(world, ctx, farm)?.keys() ?? []) {
    if (livestockTribeOfGood(ctx.content, good) !== null) yield good;
  }
}

/** The atomic a breeder plays to produce one animal of `good` (`goodtypes.ini` `atomics.produce`). */
function contentProduceAtomic(ctx: SystemContext, good: number): number | null {
  return contentIndex(ctx.content).goods.get(good)?.atomics.produce ?? null;
}

/** The species this breeder tends, in its own craft rotation's order: its production choice narrowed to
 *  the herds the farm breeds. */
function tendedSpecies(plan: PlannerContext, farm: Entity): readonly number[] {
  const { world, ctx, entity: e } = plan;
  const recipes = recipesByProductOf(world, ctx, farm);
  if (recipes === undefined) return [];
  return craftablePool(world, ctx, e, recipes).filter(
    (good) => livestockTribeOfGood(ctx.content, good) !== null,
  );
}

/**
 * Adopt the player's nearest unheld animal of either species into this herd, while the herd has room.
 * Instant, as the original's attachment is: the animal then walks itself to the farm on the herding sweep.
 *
 * Approximation: the original gates the adoption on the row of the breeder's own production species; with
 * a rotation over both species there is no single one, so each candidate answers to its own row.
 */
function adoptStray(plan: PlannerContext, farm: Entity): boolean {
  const { world, ctx, terrain } = plan;
  const owner = ownerOf(world, farm);
  if (owner === undefined) return false;
  // One herd count per species up front: the rows are a fact about the farm, not about each candidate.
  const room = new Map<number, boolean>();
  for (const good of breedableSpeciesOf(world, ctx, farm)) {
    room.set(good, hasRoomForAnother(world, ctx, farm, good));
  }
  if (![...room.values()].some(Boolean)) return false;
  const door = interactionCell(world, ctx, terrain, farm);
  const side = terrain.componentOf(door);
  let best: Entity | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const animal of freeStockOf(world, owner)) {
    const good = speciesGoodOf(world, ctx, animal);
    if (good === null || room.get(good) !== true) continue;
    const node = entityNode(world, terrain, animal);
    // Across water it could never walk in, and the herding sweep would march it at the farm forever.
    if (terrain.componentOf(node) !== side) continue;
    const range = hexRange(plan, door, node);
    if (range < bestRange || (range === bestRange && best !== null && animal < best)) {
      best = animal;
      bestRange = range;
    }
  }
  if (best === null) return false;
  attachToFarm(world, best, farm);
  recountHerdRows(world, ctx, farm);
  return true;
}

/**
 * Take the nearest animal of `good` from a neighbouring farm of the same player that holds more than a
 * pair of them, but only while this herd is short of a pair itself (the original
 * scans up to {@link TAKE_SOURCE_FARMS} such farms).
 */
function takeFromNeighbour(plan: PlannerContext, farm: Entity, good: number): boolean {
  const { world, ctx, terrain } = plan;
  if (speciesHerdOf(world, ctx, farm, good).all >= BREEDING_PAIR) return false;
  const owner = ownerOf(world, farm);
  if (owner === undefined) return false;
  const door = interactionCell(world, ctx, terrain, farm);
  let sources = 0;
  let best: Entity | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  // Only a farm with animals can hold more than a pair, so the herded farms stand in for every building.
  for (const other of herdedFarms(world)) {
    if (sources >= TAKE_SOURCE_FARMS) break;
    if (other === farm || !world.has(other, Stockpile) || ownerOf(world, other) !== owner) continue;
    if (!farmStands(world, ctx, other)) continue;
    if (speciesHerdOf(world, ctx, other, good).all <= BREEDING_PAIR) continue;
    sources += 1;
    for (const animal of herdOf(world, other)) {
      if (speciesGoodOf(world, ctx, animal) !== good) continue;
      const range = hexRange(plan, door, entityNode(world, terrain, animal));
      if (range < bestRange || (range === bestRange && best !== null && animal < best)) {
        best = animal;
        bestRange = range;
      }
    }
  }
  if (best === null) return false;
  const from = world.get(best, FarmAnimal).farm;
  attachToFarm(world, best, farm);
  recountHerdRows(world, ctx, farm);
  recountHerdRows(world, ctx, from);
  return true;
}

/**
 * Carry out a ware the slaughter fills, so the next one has shelf room: the goods this species' slay clip
 * deposits, the full one first. A ware no store would take is left where it is rather than parking the
 * breeder (departure: the original flushes and ends the cycle either way).
 */
function flushFullWare(plan: PlannerContext, farm: Entity, good: number): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const stock = world.get(farm, Stockpile).amounts;
  const deliverable = deliverableGoodProbe(plan);
  for (const ware of slayDepositGoods(ctx, world.get(e, Settler), good)) {
    if ((stock.get(ware) ?? 0) < stockCapacity(world, ctx, farm, ware)) continue;
    if (!deliverable(ware)) continue;
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, farm, here), () =>
      startPickup(world, ctx, e, plan, farm, ware, CARRY_CAPACITY),
    );
    return true;
  }
  return false;
}

/**
 * Slaughter one grown animal past the breeding pair: the breeder walks up to the nearest one at the door,
 * takes it in hand from {@link SUMMON_RANGE} away and waits while it walks itself to the door, then steps
 * onto the door tile with it and plays the slay clip, whose own frame events put the wares in the house.
 * An animal another breeder already leads away is left to it, and neither counts toward the pair.
 */
function planSlay(plan: PlannerContext, farm: Entity, good: number): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const slayAtomic = slayAtomicOfSpecies(ctx.content, good);
  if (slayAtomic === null || !jobAtomics(ctx, plan.jobType).has(slayAtomic)) return false;
  const door = interactionCell(world, ctx, terrain, farm);
  const target = slayTarget(plan, farm, good, door);
  if (target === null) return false;

  const held = world.get(target, FarmAnimal);
  const at = entityNode(world, terrain, target);
  if (held.summoner !== e) {
    if (hexRange(plan, here, at) > SUMMON_RANGE) {
      world.add(e, MoveGoal, { cell: at });
      return true;
    }
    world.mut(target, FarmAnimal).summoner = e;
    return true; // in hand: it walks itself to the door from here
  }
  if (at !== door) {
    // Stay with it on its way in; it is the summon system that walks it.
    if (hexRange(plan, here, at) > SUMMON_RANGE) world.add(e, MoveGoal, { cell: at });
    return true;
  }
  if (here !== door) {
    world.add(e, MoveGoal, { cell: door });
    return true;
  }
  removeSettlerSilently(world, target);
  recountHerdRows(world, ctx, farm);
  startAtomic(
    world,
    e,
    slayAtomic,
    { kind: 'slay', farm, species: good },
    atomicDuration(ctx.content, world.get(e, Settler), slayAtomic),
    farm,
  );
  return true;
}

/** The animal this cycle slaughters: the one this breeder already leads, else - while the herd keeps more
 *  than a breeding pair of grown animals nobody else is leading away - the nearest of those to the door. */
function slayTarget(plan: PlannerContext, farm: Entity, good: number, door: NodeId): Entity | null {
  const { world, ctx, terrain, entity: e } = plan;
  let spare = 0;
  let best: Entity | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const animal of herdOf(world, farm)) {
    if (!isAdultAnimal(world, animal) || speciesGoodOf(world, ctx, animal) !== good) continue;
    const summoner = world.get(animal, FarmAnimal).summoner;
    if (summoner === e) return animal; // already in hand - it keeps priority
    // Departure: the original prefers the animal already in house-interaction mode, so a farm's second
    // breeder converges on the one its colleague leads and finds it gone. Passing it over puts that
    // breeder on the next animal instead, and keeps it out of the count that decides the pair.
    if (summoner !== null) continue;
    spare += 1;
    const range = hexRange(plan, door, entityNode(world, terrain, animal));
    if (range < bestRange || (range === bestRange && best !== null && animal < best)) {
      best = animal;
      bestRange = range;
    }
  }
  return spare > BREEDING_PAIR ? best : null;
}

/** Whether the pair stands and the herd has room for what it would bear. */
function breedableNow(world: World, ctx: SystemContext, farm: Entity, good: number): boolean {
  const herd = speciesHerdOf(world, ctx, farm, good);
  return herd.adults === BREEDING_PAIR && hasRoomForAnother(world, ctx, farm, good);
}

function hasRoomForAnother(world: World, ctx: SystemContext, farm: Entity, good: number): boolean {
  return herdRoom(world, ctx, farm, good) > 0;
}

/** Map-point distance between two nodes, the metric the original's ranges are measured in. */
function hexRange(plan: PlannerContext, from: NodeId, to: NodeId): number {
  const a = plan.terrain.coordsOf(from);
  const b = plan.terrain.coordsOf(to);
  return hexDistanceBetween(a.x, a.y, b.x, b.y);
}
