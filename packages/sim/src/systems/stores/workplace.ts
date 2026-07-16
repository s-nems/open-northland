import type { Recipe } from '@open-northland/data';
import { Building, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { NodeBuckets } from '../spatial.js';

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
 * The set of job types a building type's `workers` slots name (`logicworker <job> <count>`). Empty
 * if the building has no Building/type or declares no workers (an unstaffed-by-design building — a
 * passive store, or any type without worker slots).
 *
 * Cross-system: the production worker-presence gate ({@link workerPresentAt}) uses it to recognise a
 * settler that may operate the workplace, and the AI planner uses it to recognise a settler standing
 * on a workplace it staffs (so the operator isn't re-planned away).
 */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_JOBS;
  const index = contentIndex(ctx.content);
  const type = index.buildings.get(b.buildingType);
  if (type === undefined) return EMPTY_JOBS;
  return index.workerJobsByBuilding.get(type.typeId) ?? EMPTY_JOBS;
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();

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
 * How many operators a workplace has on station right now: settlers whose `jobType` is one of the building's
 * operator jobs ({@link operatorJobsOf}) standing on its interaction tile (its door cell when the type's
 * footprint names one, else its anchor tile — {@link interactionNode}; the walls themselves are walk-blocked,
 * so operators work at the door, where the AI walk-to-station drive delivers them). Capped at the building
 * type's declared operator-slot headcount, so crowding extra settlers onto the door can't overclock past the
 * staffing plan.
 *
 * A building type that declares no worker slots is unstaffed-by-design and counts as one operator (passive
 * stores / fixtures keep working at the base rate). The count is an order-independent tally.
 *
 * Cross-system: ProductionSystem gates starting a cycle on `> 0` and each tick advances up to this many
 * separate batches by one tick each (oldest first — see the FIFO rule on the Production component): two
 * millers run two independent flours in parallel, doubling throughput, and a single bar never flows faster
 * than 1× (per-batch model; observed original behaviour, the exact staffing rule isn't decoded).
 *
 * The hot caller (ProductionSystem) passes a per-tick `operatorsByNode` index built once and shared across
 * every workplace, so the door-tile lookup is O(settlers on the node) instead of a full-world settler scan;
 * an ad-hoc caller omits it and pays a one-shot index build. The count is clamped to `cap` and
 * order-independent, so both paths yield the identical number.
 */
export function presentOperatorCount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operatorsByNode?: NodeBuckets,
): number {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return 1; // unstaffed-by-design: no worker requirement to satisfy
  const at = interactionNode(world, ctx, building);
  if (at === null) return 0; // a placed-but-position-less workplace can't be stood on
  const cap = operatorSlotHeadcount(world, ctx, building, jobs);
  if (cap <= 0) return 0;
  const index = operatorsByNode ?? new NodeBuckets(world, world.query(Settler, Position));
  let present = 0;
  for (const e of index.at(at.x, at.y)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null || !jobs.has(jobType)) continue;
    present++;
    if (present >= cap) return cap; // the clamp is reached — counting further can't change it
  }
  return present;
}

/** The declared headcount across a building's operator slots (Σ `count` over `workers` whose job is in
 *  `jobs`) — the ceiling {@link presentOperatorCount} clamps to. */
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

/**
 * The operators on station right now as ENTITIES, ascending id (canonical) and capped at the declared
 * operator-slot headcount like {@link presentOperatorCount} — the same tally, listed. The
 * ProductionSystem's cycle-START path uses it to pair each spare operator with the product choice it
 * starts ({@link CraftSelection}); the pairing "first `running` operators work the running batches,
 * the rest may start" is a named approximation (batches are anonymous — the original's exact
 * worker↔batch binding isn't decoded), deterministic via the ascending-id order. Its completion path
 * uses the same list to charge forging piety per finished military batch. Empty when the workplace is
 * unstaffed-by-design (no worker slots) — the caller treats that as one anonymous operator with no
 * selection.
 */
export function presentOperators(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operatorsByNode?: NodeBuckets,
): Entity[] {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return [];
  const at = interactionNode(world, ctx, building);
  if (at === null) return [];
  const cap = operatorSlotHeadcount(world, ctx, building, jobs);
  if (cap <= 0) return [];
  const index = operatorsByNode ?? new NodeBuckets(world, world.query(Settler, Position));
  const present: Entity[] = [];
  for (const e of index.at(at.x, at.y)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType !== null && jobs.has(jobType)) present.push(e);
  }
  present.sort((a, b) => a - b); // canonical: the clamp keeps the lowest ids, order-independent
  return present.length > cap ? present.slice(0, cap) : present;
}

/**
 * Whether a workplace is staffed *right now* — at least one operator on station. This is the
 * production worker-presence model: a workplace only produces while its worker is present, like the
 * original (a sawmill with no operator makes no planks). The boolean face of
 * {@link presentOperatorCount}; see it for the operator/carrier split and the door-tile rule.
 */
export function workerPresentAt(world: World, ctx: SystemContext, building: Entity): boolean {
  return presentOperatorCount(world, ctx, building) > 0;
}

/**
 * Whether a building is a temple — the satisfier site for the piety need (where a settler runs the `pray`
 * atomic). The original's "work temple" (`logichousetype` `logictype 37`, the `HOUSE_TYPE_WORK_TEMPLE`
 * constant) is a `logicmaintype 3` workplace that, unlike a real production workplace, declares no
 * `logicworker`, no `logicstock`, no `logicproduction` — so it surfaces in the IR as `kind === 'workplace'`
 * with an empty `workers`, empty `stock`, and no `recipes`. That "workplace with nothing to make and no one to
 * staff it" shape is how a temple is told apart from a sawmill/mill.
 *
 * Approximated: the temple→pray need→satisfier link lives below the readable rule files (the original binds
 * the religious building to the pray slot at the engine level, not in `houses.ini`), so the satisfier is
 * inferred from this structural signature — like the food→eat-slot binding ({@link isFood}) is inferred from
 * the `food_` id prefix. Refine to a content flag if the building→need binding is later decoded. Cross-system:
 * the AI pray-drive planner uses it to find the nearest temple to walk to.
 */
export function isTemple(world: World, ctx: SystemContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  if (type === undefined) return false;
  return type.kind === 'workplace' && type.recipes.length === 0 && type.workers.length === 0;
}
