import type { Recipe } from '@open-northland/data';
import { Building, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';

// The workplace read model: what a building's type makes, who is allowed to staff it, and how many
// operators are on station right now. Read by the AI planner (recognising workplaces / bound
// operators) and the ProductionSystem (worker-presence gate, per-batch parallelism).

/**
 * The recipe a building's type declares, or undefined if it has no Building/type or no recipe.
 *
 * Cross-system: the AI uses it to recognise a workplace (haul source / never-deliver-back-to-producer),
 * and ProductionSystem uses it to run the cycle.
 */
export function recipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.recipe;
}

/**
 * The goods a building's type PRODUCES (`logicproduction` — its `produces` list), or empty when it has
 * no Building/type or produces nothing (a passive store: a warehouse/HQ). This is the data-driven
 * "is this a producing building" signal — the split behind "a carrier at production hauls the output
 * out, a carrier at a warehouse only brings goods in". A recipe workshop's `produces` mirrors its
 * recipe outputs, so this covers both producer kinds; a warehouse's is empty. NOTE it does NOT
 * distinguish a farm by recipe absence: the sandbox catalog's farm carries no recipe, but the asset
 * pipeline synthesizes a recipe for every producing building (`fillBuildingRecipes`), so "field
 * producer" must be keyed on the good's `farming` block (`farmWorkGood`), never on `recipeOf`.
 *
 * Cross-system: the AI carrier drive uses it to recognise a bound producing building whose finished
 * output it should haul to a warehouse (see `agents/economy/workshop/supply.ts`).
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
 * Whether a job is the TRANSPORT trade — the original's carrier (`logicworker 24`, the "tragarz" who
 * ferries goods but never operates a workshop's craft). Identified by the content job's `id` slug
 * (`'carrier'`), the same id-based inference {@link isFood} uses (approximated — the readable rule
 * files carry no explicit transport flag; both the sandbox content and the extraction pipeline emit
 * the carrier job under this stable slug). Cross-system: the producer drive routes a carrier bound to
 * a workshop into the supply loop instead of the craft loop, and the production operator count
 * excludes carriers (a carrier at the door neither runs nor speeds the mill).
 */
export function isCarrierJob(ctx: SystemContext, jobType: number): boolean {
  return contentIndex(ctx.content).jobs.get(jobType)?.id === CARRIER_JOB_ID;
}

/** The content `id` slug of the transport (carrier) job — see {@link isCarrierJob}. */
const CARRIER_JOB_ID = 'carrier';

/**
 * The OPERATOR jobs of a workplace: its worker-slot jobs minus the carrier transport slots — the
 * trades that actually run the craft (the mill's millers, not its carrier). A building whose slots
 * are carrier-ONLY keeps them (the well's one carrier IS its operator — dropping it would let the
 * well run unstaffed); named approximation, the readable data doesn't say which slot operates.
 */
function operatorJobsOf(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const jobs = buildingWorkerJobs(world, ctx, building);
  if (jobs.size === 0) return jobs;
  const operators = new Set<number>();
  for (const job of jobs) if (!isCarrierJob(ctx, job)) operators.add(job);
  return operators.size > 0 ? operators : jobs;
}

/**
 * How many OPERATORS a workplace has on station *right now*: settlers whose `jobType` is one of the
 * building's operator jobs ({@link operatorJobsOf}) standing on its **interaction tile** (its door
 * cell when the type's footprint names one, else its anchor tile — {@link interactionNode}; the walls
 * themselves are walk-blocked, so operators work AT the door, exactly where the AI walk-to-station
 * drive delivers them). Capped at the building type's declared operator-slot headcount, so crowding
 * extra settlers onto the door can never overclock past the staffing plan.
 *
 * A building type that declares **no** worker slots is unstaffed-by-design and counts as ONE operator
 * (passive stores / fixtures without workers keep working at the base rate). The count is a pure
 * tally (order-independent), so no determinism concern.
 *
 * Cross-system: ProductionSystem gates starting a cycle on `> 0` and each tick advances up to this
 * many SEPARATE batches by one tick each (oldest first — see the FIFO rule on the Production
 * component): two millers run two independent flours in parallel, doubling throughput, and a single
 * bar never flows faster than 1× (per-batch model; observed original behaviour, the exact staffing
 * rule isn't decoded).
 */
export function presentOperatorCount(world: World, ctx: SystemContext, building: Entity): number {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return 1; // unstaffed-by-design: no worker requirement to satisfy
  const at = interactionNode(world, ctx, building);
  if (at === null) return 0; // a placed-but-position-less workplace can't be stood on
  const cap = operatorSlotHeadcount(world, ctx, building, jobs);
  if (cap <= 0) return 0;
  const bx = at.x;
  const by = at.y;
  let present = 0;
  for (const e of world.query(Settler, Position)) {
    const settler = world.get(e, Settler);
    if (settler.jobType === null || !jobs.has(settler.jobType)) continue;
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    if (n.hx === bx && n.hy === by) {
      present++;
      if (present >= cap) return cap; // the clamp is reached — counting further can't change it
    }
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
 * Whether a workplace is staffed *right now* — at least one operator on station. This is the
 * production worker-presence model: a workplace only produces while its worker is present, like the
 * original (a sawmill with no operator makes no planks). The boolean face of
 * {@link presentOperatorCount}; see it for the operator/carrier split and the door-tile rule.
 */
export function workerPresentAt(world: World, ctx: SystemContext, building: Entity): boolean {
  return presentOperatorCount(world, ctx, building) > 0;
}

/**
 * Whether a building is a **temple** — the satisfier site for the piety need (where a settler runs
 * the `pray` atomic). The original's "work temple" (`logichousetype` `logictype 37`, the
 * `HOUSE_TYPE_WORK_TEMPLE` constant) is a `logicmaintype 3` workplace that, unlike a real production
 * workplace, declares **no `logicworker`, no `logicstock`, no `logicproduction`** — so it surfaces in
 * the IR as `kind === 'workplace'` with an empty `workers`, empty `stock`, and **no `recipe`**. That
 * "workplace with nothing to make and no one to staff it" shape is how a temple is told apart from a
 * sawmill/mill (which always carry a recipe + workers).
 *
 * source-basis (approximated — see source basis): the temple→pray need→satisfier link lives below the
 * readable rule files (the original binds the religious building to the pray slot at the engine level,
 * not in `houses.ini`), so the satisfier is *inferred* from this structural signature — exactly like
 * the food→eat-slot binding ({@link isFood}) is inferred from the `food_` id prefix. Refine to a
 * content flag if the building→need binding is later decoded. Cross-system: the AI pray-drive planner
 * uses it to find the nearest temple to walk to.
 */
export function isTemple(world: World, ctx: SystemContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  if (type === undefined) return false;
  return type.kind === 'workplace' && type.recipe === undefined && type.workers.length === 0;
}
