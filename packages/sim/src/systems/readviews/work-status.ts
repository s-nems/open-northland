import type { Recipe } from '@open-northland/data';
import {
  Building,
  IdleStand,
  JobAssignment,
  ownerOf,
  ownersCompatible,
  Person,
  Production,
  ProductionCounters,
  productionCountOf,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import {
  type GatheringTrade,
  gatherGoodOpen,
  gatheringTradeOf,
  jobGatherGoods,
  jobGathersGood,
} from '../economy/gather-goods.js';
import { canStartCycle, outputRoomForCycles, waitingForRecipeInput } from '../economy/production/cycles.js';
import { craftablePool } from '../economy/production/rotation.js';
import { liveHaulFlag, liveWorkFlag } from '../economy/work-flag.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { operatorRecipeEnabled } from '../progression/index.js';
import { jobCanBuild } from '../settlers/atomics/start.js';
import { strandedWorkplaceDoor } from '../settlers/drives/cut-off.js';
import { carriedGoodForm } from '../settlers/drives/economy/delivery-targets.js';
import { isBoundToStorageSink } from '../settlers/drives/economy/store-policy.js';
import { FetchableStock } from '../settlers/targets/stores/fetchable-stock.js';
import { StoreSinks } from '../settlers/targets/stores/sinks.js';
import { navigationLimitFor } from '../signposts/index.js';
import {
  isCarrierJob,
  isWorkplaceOperator,
  isWorkplaceOutput,
  mayFetchGoodFrom,
  recipesByProductOf,
  stockCapacity,
  workplaceStocksGood,
  workplaceStoredGoods,
} from '../stores/index.js';
import { constructionSupply } from './construction-supply.js';
import { gatherWorkStatus } from './gather-work-status.js';
import { GoodSources } from './good-sources.js';
import { type HerdHold, herdHoldOf } from './herd-hold.js';
import { type StoreReach, storeReach } from './store-reach.js';

export interface MissingWorkInput {
  readonly goodType: number;
  readonly required: number;
  readonly available: number;
  readonly missing: number;
  /** Where the worker's side keeps or brings in the input: a store holding a unit, a workplace turning
   *  it out or a gatherer of it, as {@link inputSources} lists them. */
  readonly source: StoreReach;
  /** The kind of trade that gathers the input off the map when no building type makes it, so only a
   *  gatherer of that trade supplies it; null otherwise. */
  readonly gatheredBy: GatheringTrade | null;
}

export interface BlockedWorkOutput {
  readonly goodType: number;
  readonly required: number;
  readonly available: number;
  readonly capacity: number;
  /** Where the worker's side has stores that take the product in the form it is carried. */
  readonly destination: StoreReach;
}

/** Selected-worker diagnostics are derived on demand, never persisted or used by the planner. */
export type WorkStatus =
  | { readonly kind: 'crafting'; readonly goodType: number }
  | {
      readonly kind: 'waitingInput';
      readonly goodType: number;
      readonly missingInputs: readonly MissingWorkInput[];
    }
  | { readonly kind: 'outputFull'; readonly outputs: readonly BlockedWorkOutput[] }
  /** A breeder whose herd keeps it from breeding, and no other product of its waits for inputs. */
  | ({ readonly kind: 'herdNotReady' } & HerdHold)
  | { readonly kind: 'nothingSelected' }
  | { readonly kind: 'productsLocked'; readonly goodTypes: readonly number[] }
  | {
      readonly kind: 'noEligibleResource';
      readonly goodTypes: readonly number[];
      readonly scope: 'workArea' | 'map';
    }
  | { readonly kind: 'resourceRouteBlocked'; readonly goodTypes: readonly number[] }
  | {
      readonly kind: 'noOutputDestination';
      readonly goodType: number;
      /** `outOfReach`: stores would take it, but all of them lie outside the worker's signpost area. */
      readonly reason: 'noStorage' | 'outOfReach' | 'unknown';
    }
  | { readonly kind: 'noWorkplace' }
  | {
      readonly kind: 'unknown';
      readonly reason: 'unsupportedWorkplace' | 'productionGate' | 'gatherSearch' | 'constructionSearch';
    }
  /** A builder with no unfinished site on its side to work. */
  | { readonly kind: 'noConstructionSite' }
  /** A builder whose side's building sites wait for goods no store of the side holds. */
  | { readonly kind: 'constructionShort'; readonly goodTypes: readonly number[] }
  | { readonly kind: 'noTool' }
  | { readonly kind: 'noJob' }
  | { readonly kind: 'workplaceUnderConstruction' }
  /** The worker's own workplace lies beyond its signpost reach, so it stands lost until the network
   *  reaches the building. */
  | { readonly kind: 'workplaceOutOfReach' }
  /** A carrier holding a pickup flag finds nothing to lift around it. */
  | { readonly kind: 'nothingAtFlag' }
  /** A store's carrier left idle by its ladder: nothing in reach for it to take to a store. */
  | { readonly kind: 'nothingToCarry' }
  /** A hunter's prey search finds no free game in its hunting ground. */
  | { readonly kind: 'noGame' }
  /** The only game in a hunter's ground stands across a terrain seam or was given up as unreachable. */
  | { readonly kind: 'gameOutOfReach' }
  /** No swarm with fish left lies within a fisher's shore search. */
  | { readonly kind: 'noFish' };

/** Read current workplace blockers and a bounded resource search for one selected person. */
export function workStatus(world: World, ctx: SystemContext, entity: Entity): WorkStatus | undefined {
  if (!world.isAlive(entity) || !world.has(entity, Person)) return undefined;
  const jobType = world.get(entity, Settler).jobType;
  if (jobType === null || jobType === CIVILIST_JOB) return { kind: 'noJob' };
  const assigned = world.tryGet(entity, JobAssignment)?.workplace;
  const workplace =
    assigned !== undefined && world.isAlive(assigned) && world.has(assigned, Building) ? assigned : undefined;
  const terrain = ctx.terrain;
  if (
    workplace !== undefined &&
    terrain !== undefined &&
    strandedWorkplaceDoor(
      world,
      ctx,
      terrain,
      entity,
      navigationLimitFor(world, ctx.content, terrain, entity),
    ) !== null
  ) {
    return { kind: 'workplaceOutOfReach' };
  }
  if (workplace !== undefined && world.has(workplace, UnderConstruction)) {
    return { kind: 'workplaceUnderConstruction' };
  }
  const gathered = jobGatherGoods(ctx, jobType);
  if (gathered.length > 0) return gatherWorkStatus(world, ctx, entity, workplace, gathered);
  if (jobCanBuild(ctx.content, jobType)) {
    // The walk over the side's sites is for a builder standing idle; a busy one has a site.
    return world.tryGet(entity, IdleStand)?.standing === true
      ? builderWorkStatus(world, ctx, entity)
      : { kind: 'unknown', reason: 'constructionSearch' };
  }
  if (liveHaulFlag(world, entity) !== undefined) return { kind: 'nothingAtFlag' };
  // A store's carrier reaches the idle tail of its ladder only after the porter and haul rungs found
  // nothing in reach a store would take.
  if (
    isCarrierJob(ctx, jobType) &&
    isBoundToStorageSink(world, ctx, entity) &&
    world.tryGet(entity, IdleStand)?.standing === true
  )
    return { kind: 'nothingToCarry' };
  if (workplace === undefined) {
    const index = contentIndex(ctx.content);
    const requiresWorkshop = [...index.operatorJobsByBuilding].some(
      ([type, jobs]) => jobs.has(jobType) && (index.recipeByProductByBuilding.get(type)?.size ?? 0) > 0,
    );
    return requiresWorkshop ? { kind: 'noWorkplace' } : { kind: 'unknown', reason: 'unsupportedWorkplace' };
  }
  if (!world.has(workplace, Stockpile) || !isWorkplaceOperator(world, ctx, workplace, jobType))
    return { kind: 'unknown', reason: 'unsupportedWorkplace' };
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return { kind: 'unknown', reason: 'unsupportedWorkplace' };

  const newest = world.tryGet(workplace, Production)?.cycles.at(-1);
  if (newest !== undefined) return { kind: 'crafting', goodType: newest.goodType };

  const pool = craftablePool(world, ctx, entity, recipes);
  if (pool.length === 0) {
    const selection = world.tryGet(entity, ProductionCounters);
    const allStopped = [...recipes.keys()].every((good) => productionCountOf(selection, good) === 0);
    return allStopped
      ? { kind: 'nothingSelected' }
      : {
          kind: 'productsLocked',
          goodTypes: [...recipes.keys()].filter((good) => productionCountOf(selection, good) > 0),
        };
  }
  const inRotation = rotationOrder(world, entity, pool, recipes);
  let held: PoolEntry | undefined;
  // A breeding recipe the herd holds back waits for animals, not inputs: its breeder fetches none.
  const herdHeld = new Set<PoolEntry>();
  let firstHold: HerdHold | undefined;
  for (const entry of inRotation) {
    if (!operatorRecipeEnabled(world, ctx, workplace, entity, entry.recipe)) continue;
    if (canStartCycle(world, ctx, workplace, entry.recipe)) return undefined;
    const herd = herdHoldOf(world, ctx, workplace, entry.recipe);
    if (herd === 'slaughter') return undefined;
    if (herd !== null) {
      herdHeld.add(entry);
      firstHold ??= herd;
      continue;
    }
    if (waitingForRecipeInput(world, ctx, workplace, entry.recipe)) {
      held = entry;
      break;
    }
  }
  // The rotation holds its turn on a partly stocked product, so that one is next; otherwise the first
  // product with shelf room is the one waiting for its inputs.
  const waiting =
    held ??
    inRotation.find(
      (entry) => !herdHeld.has(entry) && hasShelfRoom(world, ctx, workplace, entity, entry.recipe),
    );
  if (waiting !== undefined) {
    const stock = world.get(workplace, Stockpile).amounts;
    const missingInputs = waiting.recipe.inputs.flatMap((input) => {
      const available = stock.get(input.goodType) ?? 0;
      return available < input.amount
        ? [
            {
              goodType: input.goodType,
              required: input.amount,
              available,
              missing: input.amount - available,
              source: storeReach(
                world,
                ctx,
                entity,
                inputSources(world, ctx, entity, workplace, input.goodType),
              ),
              gatheredBy: gatheringTradeOf(ctx, input.goodType),
            },
          ]
        : [];
    });
    return missingInputs.length > 0
      ? { kind: 'waitingInput', goodType: waiting.good, missingInputs }
      : { kind: 'unknown', reason: 'productionGate' };
  }
  if (firstHold !== undefined) return { kind: 'herdNotReady', ...firstHold };
  const enabled = inRotation.filter((entry) =>
    operatorRecipeEnabled(world, ctx, workplace, entity, entry.recipe),
  );
  if (enabled.length === 0) return { kind: 'productsLocked', goodTypes: pool.slice() };
  const stock = world.get(workplace, Stockpile).amounts;
  const sinks = StoreSinks.of(world, ctx);
  const outputs = enabled
    .flatMap((entry) =>
      entry.recipe.outputs.map((output) => ({
        goodType: output.goodType,
        required: output.amount,
        available: stock.get(output.goodType) ?? 0,
        capacity: stockCapacity(world, ctx, workplace, output.goodType),
      })),
    )
    .filter((output) => output.capacity - output.available < output.required)
    .map((output) => ({
      ...output,
      destination: storeReach(
        world,
        ctx,
        entity,
        sinks.sinks(carriedGoodForm(world, ctx, entity, output.goodType), false),
      ),
    }));
  if (outputs.length === 0) return { kind: 'unknown', reason: 'productionGate' };
  const stranded = outputs.find((output) => output.destination === 'outOfReach');
  return stranded !== undefined
    ? { kind: 'noOutputDestination', goodType: stranded.goodType, reason: 'outOfReach' }
    : { kind: 'outputFull', outputs };
}

/**
 * An idle builder's blockers, from its side's unfinished sites, walls and roads included: none at all,
 * or sites short of goods no own store in their reach holds and nobody brings, named ascending. A side
 * whose sites are short only of held goods leaves the cause to the builder's planner, which the
 * diagnosis does not re-run.
 */
function builderWorkStatus(world: World, ctx: SystemContext, builder: Entity): WorkStatus {
  const owner = ownerOf(world, builder);
  const short = new Set<number>();
  let sites = 0;
  for (const site of world.query(UnderConstruction)) {
    if (!ownersCompatible(owner, ownerOf(world, site))) continue;
    sites++;
    const supply = constructionSupply(world, ctx, site);
    if (supply?.kind !== 'short') continue;
    for (const line of supply.shortfalls) {
      if (line.inbound === 0 && !line.held) short.add(line.goodType);
    }
  }
  if (sites === 0) return { kind: 'noConstructionSite' };
  if (short.size > 0) return { kind: 'constructionShort', goodTypes: [...short].sort((a, b) => a - b) };
  return { kind: 'unknown', reason: 'constructionSearch' };
}

/**
 * Where an operator may get `goodType` for `workplace`: the stores lending a unit, as its fetch searches
 * them, then its side's sources of the good ({@link GoodSources}). A producer's next unit lands on its own
 * shelf, where the fetch finds it, so an empty farm next door still supplies the mill.
 */
function* inputSources(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  workplace: Entity,
  goodType: number,
): Generator<Entity> {
  yield* FetchableStock.of(world, ctx).holders(goodType);
  for (const source of GoodSources.of(world, ctx).sources(goodType, ownerOf(world, operator))) {
    const found = world.has(source, Settler)
      ? landingOf(world, ctx, source, workplace, goodType)
      : finishedWorkplace(world, source);
    if (found !== undefined) yield found;
  }
}

/**
 * Where `settler`'s work lands `goodType` for `workplace`, or undefined when it brings none there. A
 * gatherer of the good posted at a finished workplace forages it only when that workplace stocks it, as
 * its planner does, and banks it there, which counts when that is `workplace` or lends the good rather
 * than consuming it; one posted at a site still going up brings nothing. An unposted gatherer banks at its
 * flag, or stands for itself when it has none. A settler held off the good by its counters gathers none.
 * An operator's unit lands on its finished workplace's shelf when that type turns the good out.
 */
function landingOf(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  workplace: Entity,
  goodType: number,
): Entity | undefined {
  const jobType = world.get(settler, Settler).jobType;
  if (jobType === null) return undefined;
  const own = world.tryGet(settler, JobAssignment)?.workplace;
  const finished = own === undefined ? undefined : finishedWorkplace(world, own);
  if (jobGathersGood(ctx, jobType, goodType)) {
    if (!gatherGoodOpen(world, ctx, settler, jobType, goodType)) return undefined;
    if (own === undefined) return liveWorkFlag(world, settler)?.flag ?? settler;
    if (finished === undefined || !foragesFor(world, ctx, finished, goodType)) return undefined;
    return finished === workplace || mayFetchGoodFrom(world, ctx, finished, goodType) ? finished : undefined;
  }
  return finished !== undefined &&
    isWorkplaceOperator(world, ctx, finished, jobType) &&
    isWorkplaceOutput(world, ctx, finished, goodType)
    ? finished
    : undefined;
}

/** Whether a gatherer posted at `workplace` forages `goodType`: a workplace declaring no stock slots
 *  leaves its gatherers unfiltered. */
function foragesFor(world: World, ctx: SystemContext, workplace: Entity, goodType: number): boolean {
  const stored = workplaceStoredGoods(world, ctx, workplace);
  return stored === undefined || workplaceStocksGood(ctx, stored, goodType);
}

function finishedWorkplace(world: World, e: Entity): Entity | undefined {
  return world.isAlive(e) && world.has(e, Building) && !world.has(e, UnderConstruction) ? e : undefined;
}

interface PoolEntry {
  readonly good: number;
  readonly recipe: Recipe;
}

/** The operator's pool in the order its rotation walks it, starting at the cursor. */
function rotationOrder(
  world: World,
  operator: Entity,
  pool: readonly number[],
  recipes: ReadonlyMap<number, Recipe>,
): PoolEntry[] {
  const cursor = world.tryGet(operator, ProductionCounters)?.cursor ?? 0;
  const ordered: PoolEntry[] = [];
  for (let i = 0; i < pool.length; i++) {
    const good = pool[(cursor + i) % pool.length];
    const recipe = good === undefined ? undefined : recipes.get(good);
    if (good !== undefined && recipe !== undefined) ordered.push({ good, recipe });
  }
  return ordered;
}

function hasShelfRoom(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  worker: Entity,
  recipe: Recipe,
): boolean {
  return (
    operatorRecipeEnabled(world, ctx, workplace, worker, recipe) &&
    outputRoomForCycles(world, ctx, workplace, recipe) > 0
  );
}
