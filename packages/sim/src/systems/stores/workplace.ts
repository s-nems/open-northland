import type { Recipe } from '@open-northland/data';
import { Building, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { canonicalById, NodeBuckets } from '../spatial.js';

// The workplace read model: what a building's type makes, who is allowed to staff it, and how many
// operators are on station right now. Read by the AI planner (recognising workplaces / bound
// operators) and the ProductionSystem (worker-presence gate, per-batch parallelism).

/**
 * The UNION view over a building type's per-product recipes (inputs summed, outputs one line per
 * product — {@link import('../../core/content-index.js').ContentIndex.mergedRecipeByBuilding}), or
 * undefined if it has no Building/type or no recipes.
 *
 * Cross-system: the AI plans against it (recognise a workplace, fetch any input some product needs,
 * haul any product out); the ProductionSystem runs the per-product recipes ({@link recipesByProductOf}).
 */
export function mergedRecipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).mergedRecipeByBuilding.get(b.buildingType);
}

/**
 * A building's per-product recipe table (`product goodType → recipe`), or undefined when it has no
 * Building/type or no recipes. The ProductionSystem's cycle-start/deposit lookup; iteration follows
 * the type's `recipes` content order (fixed data, deterministic).
 */
export function recipesByProductOf(
  world: World,
  ctx: SystemContext,
  building: Entity,
): ReadonlyMap<number, Recipe> | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).recipeByProductByBuilding.get(b.buildingType);
}

/**
 * The goods a building's type produces (`logicproduction` — its `produces` list), or empty when it has no
 * Building/type or produces nothing (a passive store: a warehouse/HQ). The data-driven "is this a producing
 * building" signal — the split behind "a carrier at production hauls the output out, a carrier at a warehouse
 * only brings goods in". A recipe workshop's `produces` mirrors its recipe outputs, so this covers both
 * producer kinds; a warehouse's is empty. It does not distinguish a farm by recipe absence: the sandbox
 * catalog's farm carries no recipe, but the asset pipeline synthesizes a recipe for every producing building
 * (`fillBuildingRecipes`), so "field producer" must be keyed on the good's `farming` block (`farmWorkGood`),
 * never on `mergedRecipeOf`.
 *
 * Cross-system: the AI carrier drive uses it to recognise a bound producing building whose finished output it
 * should haul to a warehouse (see `agents/economy/workshop/supply.ts`).
 */
export function buildingProduces(world: World, ctx: SystemContext, building: Entity): readonly number[] {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_PRODUCES;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.produces ?? EMPTY_PRODUCES;
}

const EMPTY_PRODUCES: readonly number[] = [];

/**
 * Whether building type `buildingType` is an UNSTAFFED shared utility that mints `goodType` from no inputs —
 * a well for water, a hive for honey — that a consumer can crank in place to draw the good. Data-driven via
 * {@link import('../../core/content-index.js').ContentIndex.inputlessProducersByGood} (an unstaffed
 * input-less producer of the good, never a hardcoded id); a staffed input-less producer does not qualify.
 *
 * Cross-system: the self-service input scan ({@link import('../agents/economy/workshop/supply.js').nearestMissingInputSource})
 * lets a consumer draw the good here when this utility is the nearest source, and the utility-carrier
 * delivery rung (routing.ts) uses it to feed the good to nearby consumers before central storage.
 */
export function typeProducesGoodWithoutInputs(
  ctx: SystemContext,
  buildingType: number,
  goodType: number,
): boolean {
  return contentIndex(ctx.content).inputlessProducersByGood.get(goodType)?.has(buildingType) ?? false;
}

/** {@link typeProducesGoodWithoutInputs} for a building entity — resolves its type first (false if it has
 *  no Building/type). The caller gates built/reachable. */
export function producesGoodWithoutInputs(
  world: World,
  ctx: SystemContext,
  building: Entity,
  goodType: number,
): boolean {
  const b = world.tryGet(building, Building);
  return b !== undefined && typeProducesGoodWithoutInputs(ctx, b.buildingType, goodType);
}

/**
 * The set of job types a building type's `workers` slots name (`logicworker <job> <count>`). Empty
 * if the building has no Building/type or declares no workers (an unstaffed-by-design building — a
 * passive store, or any type without worker slots).
 *
 * Cross-system: the production worker-presence gate ({@link presentOperatorCount}) uses it to recognise
 * a settler that may operate the workplace, and the AI planner uses it to recognise a settler standing
 * on a workplace it staffs (so the operator isn't re-planned away).
 */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const typeId = knownBuildingTypeId(world, ctx, building);
  if (typeId === undefined) return EMPTY_JOBS;
  return contentIndex(ctx.content).workerJobsByBuilding.get(typeId) ?? EMPTY_JOBS;
}

/** {@link buildingWorkerJobs} as an ascending list — the canonical slot order a workplace offers its
 *  jobs in, so a multi-slot workplace assigns by lowest job id rather than by `Set` insertion order. */
export function canonicalBuildingWorkerJobs(
  world: World,
  ctx: SystemContext,
  building: Entity,
): readonly number[] {
  const typeId = knownBuildingTypeId(world, ctx, building);
  if (typeId === undefined) return EMPTY_JOB_LIST;
  return contentIndex(ctx.content).canonicalWorkerJobsByBuilding.get(typeId) ?? EMPTY_JOB_LIST;
}

function knownBuildingTypeId(world: World, ctx: SystemContext, building: Entity): number | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.typeId;
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();
/** Frozen so a caller that widens the `readonly` type can't mutate the shared sentinel (see `NO_ENTITIES`). */
const EMPTY_JOB_LIST: readonly number[] = Object.freeze([]);

/**
 * The set of good types a building's `stock` slots store, or undefined when it has no Building/type
 * or declares no stock slots. Cross-system: what a building-employed gatherer may forage for (the
 * flag-less collector rule — `planGatherer`'s roaming filter and the `setGatherGood` employed path).
 */
export function workplaceStoredGoods(
  world: World,
  ctx: SystemContext,
  building: Entity,
): ReadonlySet<number> | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).storedGoodsByBuilding.get(b.buildingType);
}

/**
 * Whether a job is the transport trade — the original's carrier (`logicworker 24`, the "tragarz" who ferries
 * goods but never operates a workshop's craft). Identified by the content job's `id` slug (`'carrier'`), the
 * same id-based inference {@link isFood} uses (approximated — the readable rule files carry no explicit
 * transport flag; both the sandbox content and the extraction pipeline emit the carrier job under this stable
 * slug). Cross-system: the producer drive routes a carrier bound to a workshop into the supply loop instead of
 * the craft loop, and the production operator count excludes carriers.
 */
export function isCarrierJob(ctx: SystemContext, jobType: number): boolean {
  return contentIndex(ctx.content).jobs.get(jobType)?.id === CARRIER_JOB_ID;
}

/** The content `id` slug of the transport (carrier) job — see {@link isCarrierJob}. */
const CARRIER_JOB_ID = 'carrier';

/**
 * The operator jobs of a workplace: its worker-slot jobs minus the transport (carrier) and gatherer slots —
 * the trades that actually run the craft (the mill's millers, not its carrier, nor a collector employed to
 * fetch its raw input). A gatherer bound to a workshop gathers a raw good and delivers it into the building
 * (the building is its flag — see the gatherer drive); it never operates the craft, so it must not satisfy
 * the production worker-presence gate. A building whose slots are all carrier/gatherer keeps them (the well's
 * one carrier is its operator — dropping it would let the well run unstaffed); named approximation, the
 * readable data doesn't say which slot operates.
 */
function operatorJobsOf(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const jobs = buildingWorkerJobs(world, ctx, building);
  if (jobs.size === 0) return jobs;
  const harvest = contentIndex(ctx.content).harvestJobs;
  const operators = new Set<number>();
  for (const job of jobs) if (!isCarrierJob(ctx, job) && !harvest.has(job)) operators.add(job);
  return operators.size > 0 ? operators : jobs;
}

/**
 * Whether `jobType` is one of a workplace's operator jobs — the trades whose presence at the door runs the
 * craft ({@link operatorJobsOf}: worker slots minus carriers/gatherers, or the whole slot set when a
 * building is carrier/gatherer-only, e.g. a well whose lone carrier IS its operator). The planner uses it to
 * keep such an operator standing ON the door (driving production) instead of loitering beside it.
 */
export function isWorkplaceOperator(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobType: number,
): boolean {
  return operatorJobsOf(world, ctx, building).has(jobType);
}

/**
 * A workplace's operator staffing right now — the two cases the production gates must tell apart:
 *  - `unstaffed`: the building type declares no operator slots (a passive store / fixture). There is no worker
 *    requirement to satisfy, so it works at the base rate of {@link UNSTAFFED_OPERATOR_COUNT} anonymous
 *    operator — no entity to attribute the work to.
 *  - `staffed`: the type has operator slots, and `operators` are the settlers filling them at the door right
 *    now — EMPTY when they have all walked away (a deserted workshop stops).
 */
export type WorkplaceOperators =
  | { readonly kind: 'unstaffed' }
  | { readonly kind: 'staffed'; readonly operators: readonly Entity[] };

/** The base-rate headcount an unstaffed-by-design workplace works at — one anonymous operator, so a passive
 *  store / fixture keeps running without anyone to staff it (see {@link WorkplaceOperators}). */
const UNSTAFFED_OPERATOR_COUNT = 1;

/**
 * The operators on station at a workplace right now: settlers whose `jobType` is one of the building's operator
 * jobs ({@link operatorJobsOf}) standing on its interaction tile (its door cell when the type's footprint names
 * one, else its anchor tile — {@link interactionNode}; the walls themselves are walk-blocked, so operators work
 * at the door, where the AI walk-to-station drive delivers them). Listed in ascending id (canonical) and capped
 * at the type's declared operator-slot headcount, so crowding extra settlers onto the door can't overclock past
 * the staffing plan.
 *
 * Cross-system: the ProductionSystem's cycle-START path pairs each spare operator with the product choice it
 * starts ({@link CraftSelection}); the pairing "first `running` operators work the running batches, the rest may
 * start" is a named approximation (batches are anonymous — the original's exact worker↔batch binding isn't
 * decoded), deterministic via the ascending-id order. Its completion path charges forging piety per finished
 * military batch to the same list, and its advance path takes only the {@link operatorCountOf} of this result.
 *
 * The hot caller (ProductionSystem) passes a per-tick `operatorsByNode` index built once and shared across every
 * workplace, so the door-tile lookup is O(settlers on the node) instead of a full-world settler scan; an ad-hoc
 * caller omits it and pays a one-shot index build. Both paths yield the identical list.
 */
export function presentOperators(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operatorsByNode?: NodeBuckets,
): WorkplaceOperators {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return UNSTAFFED; // unstaffed-by-design: no worker requirement to satisfy
  const at = interactionNode(world, ctx, building);
  if (at === null) return DESERTED; // a placed-but-position-less workplace can't be stood on
  const cap = operatorSlotHeadcount(world, ctx, building, jobs);
  if (cap <= 0) return DESERTED;
  const index = operatorsByNode ?? new NodeBuckets(world, canonicalById(world.query(Settler, Position)));
  const present: Entity[] = [];
  for (const e of index.at(at.x, at.y)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType !== null && jobs.has(jobType)) present.push(e);
  }
  present.sort((a, b) => a - b); // canonical: the clamp below keeps the lowest ids, order-independent
  return { kind: 'staffed', operators: present.length > cap ? present.slice(0, cap) : present };
}

const UNSTAFFED: WorkplaceOperators = { kind: 'unstaffed' };
/** Shared "has operator slots, nobody on station" result — the deserted workplace's frozen empty list. */
const DESERTED: WorkplaceOperators = { kind: 'staffed', operators: Object.freeze([]) };

/**
 * How many operators are working a workplace — the number {@link presentOperators}' result is worth to the
 * production rate: one anonymous operator when the type is unstaffed-by-design, else the settlers on station.
 * The ProductionSystem advances this many separate batches by one tick each per tick (oldest first — see the
 * FIFO rule on the Production component): two millers run two independent flours in parallel, doubling
 * throughput, and a single bar never flows faster than 1× (per-batch model; observed original behaviour, the
 * exact staffing rule isn't decoded). Zero means the craft is paused.
 */
export function operatorCountOf(operators: WorkplaceOperators): number {
  switch (operators.kind) {
    case 'unstaffed':
      return UNSTAFFED_OPERATOR_COUNT;
    case 'staffed':
      return operators.operators.length;
  }
}

/** The operator headcount on station at `building` — {@link operatorCountOf} of its {@link presentOperators}. */
export function presentOperatorCount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operatorsByNode?: NodeBuckets,
): number {
  return operatorCountOf(presentOperators(world, ctx, building, operatorsByNode));
}

/** The declared headcount across a building's operator slots (Σ `count` over `workers` whose job is in
 *  `jobs`) — the ceiling {@link presentOperators} clamps to. */
function operatorSlotHeadcount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobs: ReadonlySet<number>,
): number {
  const b = world.tryGet(building, Building);
  if (b === undefined) return 0;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  let headcount = 0;
  for (const slot of type?.workers ?? []) if (jobs.has(slot.jobType)) headcount += slot.count;
  return headcount;
}
