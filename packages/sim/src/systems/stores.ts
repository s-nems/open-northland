import type { BuildingType, Recipe } from '@vinland/data';
import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Position,
  Settler,
  Stockpile,
  stockpileEntries,
  Vehicle,
} from '../components/index.js';
import { contentIndex } from '../core/content-index.js';
import { type Fixed, fx, ONE } from '../core/fixed.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import type { SystemContext } from './context.js';
import { interactionNode } from './footprint/index.js';
import { vehicleMayCarry } from './readviews/vehicles.js';

// The cross-system STORE/ECONOMY read-model: what a store can hold, what a workplace makes, who
// staffs it, and the housing/population counts. A leaf module beside ./spatial.ts (the split of the
// old shared.ts grab-bag) so every per-system file imports these without creating cycles.

/** The capacity a bare POSITION-LESS test-fixture store (no Building/Vehicle type, not on the map)
 *  advertises — uncapped, so a mapless fixture still accepts deposits. */
const UNCAPPED_CAPACITY = Number.MAX_SAFE_INTEGER;

/**
 * The most units of ONE good a loose ground heap can hold on one tile — the engine's GLOBAL per-tile
 * limit for goods resting on the ground (a gatherer's yard heap, a hand-dropped pile, and a delivered
 * load alike). Source basis: observed original behaviour (at most 5 of any single good ever lies on
 * one field) and the `ls_goods.bmd` heap art carrying exactly 5 fill states per good (the pipeline's
 * goods stage) — a pile can't grow past what its graphic can show.
 */
export const MAX_GROUND_STACK = 5;

/** The good-`id` prefix identifying the eat-slot food goods (`food_simple`/`food_extra`) — see
 *  {@link isFood} for the source basis of this inference. */
const FOOD_GOOD_ID_PREFIX = 'food_';

/**
 * The per-good capacity of a store's stockpile.
 *
 * - An **under-construction building** (a {@link Building} still at `built < ONE` — a construction
 *   site): its per-good ceiling is the material-DELIVERY demand from its building type's `construction`
 *   cost. A good named by the cost gets that cost line's full `amount` (the TOTAL ceiling, like every
 *   other store — callers subtract what's on hand: `nearestStoreFor`'s `have >= capacity` full-check,
 *   `pileup`'s `capacity - have` space); any other good gets 0 (refused). So a site advertises room for
 *   *exactly* its outstanding materials and nothing else — `nearestStoreFor` only delivers a good to a
 *   store with room, so the existing carrier path hauls the `construction` goods to the site (the
 *   `pileup` deposit capped at the outstanding need), and the ConstructionSystem then consumes them and
 *   flips `built`. (An unbuilt building never produces — `productionSystem` gates its start loop on
 *   `built >= ONE` — so this branch's only consumer is the carrier-delivery of build materials; its
 *   stockpile can't be raided to feed a recipe.)
 * - A built **building** store: from its building type's stock slots — a good with no declared slot
 *   has no room (capacity 0). **Plus** an upgradable **built `home`** ({@link homeNextTier} — a `home`
 *   with a next tier in the level chain) also advertises room for its NEXT tier's `construction`
 *   materials: the per-good ceiling is the **larger** of the normal stock-slot capacity and the next
 *   tier's cost-line `amount`, so the same carrier path that delivers a build-site's materials now also
 *   accumulates the upgrade materials at a still-upgradable home (closing the births→housing→upgrade→
 *   more-housing loop with no upgrade-specific transport code). The `constructionSystem` then consumes
 *   them and levels the home up. The top-tier home (no next tier) reverts to its plain stock-slot
 *   capacity, so a maxed home stops attracting materials — exactly like a finished build site.
 * - A **boat hull** ({@link Vehicle}, the "boats as mobile stores" entity — a `Stockpile` on a hull,
 *   not a building): gated by the ship's `cargoGoods` **load allow-list** — a good the hold may carry
 *   ({@link vehicleMayCarry}) gets the whole `stockSlots` hold capacity, a good it may **not** carry
 *   gets 0 (refused, so a carrier never deposits a forbidden good into a boat). This is the *load
 *   half* of "boats as mobile stores": the hull was placed empty (the `placeBoat` command); here a
 *   haul INTO it is filtered by what the vehicle type may hold and bounded by how much. The `stockSlots`
 *   total is applied as a per-good upper bound (a faithful upper bound — the whole-hold-shared-across-
 *   goods cap is a deferred refinement; see source basis).
 * - A **loose ground heap** (a positioned Stockpile with neither Building nor Vehicle — a gatherer's
 *   yard heap or a hand-dropped pile): the engine's global per-tile limit, {@link MAX_GROUND_STACK}
 *   units of the ONE good it holds; a heap already holding a DIFFERENT good refuses ours outright
 *   (capacity 0 — piles never mix goods, matching `stackOntoTile`/`dropOrStackGood`). This is what
 *   keeps a delivery (`nearestStoreFor` + `pileup`) from banking an unbounded heap of flour on a
 *   field tile — a full heap stops advertising room and the load routes to a real store instead.
 * - A store with **none** of the above and no Position (a mapless test fixture) stays uncapped.
 *
 * Cross-system: used by the AI store scan (`nearestStoreFor`), the atomic `pileup` deposit,
 * and production's `canStartCycle`/`depositOutputs`.
 */
export function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building !== undefined) {
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    if (type === undefined) return 0;
    return buildingStockCapacity(ctx, type, building.built, goodType);
  }
  const hull = world.tryGet(store, Vehicle);
  if (hull !== undefined) {
    const type = contentIndex(ctx.content).vehicles.get(hull.vehicleType);
    if (type === undefined) return 0;
    return vehicleMayCarry(type, goodType) ? type.stockSlots : 0;
  }
  const stock = world.tryGet(store, Stockpile);
  if (stock !== undefined && world.has(store, Position)) {
    const held = lowestStockedGood(stock);
    if (held !== null && held !== goodType) return 0; // a ground heap never mixes goods
    return MAX_GROUND_STACK;
  }
  return UNCAPPED_CAPACITY;
}

/** The building branch of {@link stockCapacity}, pure over content + the `built` progress — the
 *  construction-site / stock-slot / home-upgrade capacity math, unit-testable without a world. */
function buildingStockCapacity(
  ctx: SystemContext,
  type: BuildingType,
  built: number,
  goodType: number,
): number {
  if (built < ONE) {
    // Construction site: the per-good ceiling is the building's full `construction` cost for that
    // material (a non-material good gets 0 — refused). Like every store, this is the TOTAL capacity;
    // callers (`nearestStoreFor`'s `have >= capacity` full-check, `pileup`'s `capacity - have` space)
    // subtract what's on hand, so a site advertises room until it holds the whole cost line.
    const line = type.construction.find((c) => c.goodType === goodType);
    return line?.amount ?? 0;
  }
  // Built building: its normal per-good stock-slot ceiling…
  const slot = type.stock.find((s) => s.goodType === goodType);
  const slotCapacity = slot?.capacity ?? 0;
  // …plus, for a built `home` that can still level up, room for the NEXT tier's outstanding
  // construction materials, so the existing carrier path accumulates the upgrade materials at the
  // home. Take the larger of the two ceilings (a good can be both a stocked good and an upgrade
  // material); a maxed-out (top-tier) home has no next tier and keeps only its stock-slot capacity.
  const next = homeNextTier(type, ctx);
  if (next === undefined) return slotCapacity;
  const upgradeLine = next.construction.find((c) => c.goodType === goodType);
  return Math.max(slotCapacity, upgradeLine?.amount ?? 0);
}

/** The `construction` material cost of a building entity's type — the goods that must be delivered and
 *  hammered in to raise it — or an empty list when the entity is not a typed building (a bare fixture)
 *  or its type declares no cost (a free type). The shared read behind {@link deliveredConstructionFraction},
 *  {@link constructionMaterialsPresent}, {@link nextNeededConstructionGood}, and {@link constructionTotalUnits}. */
function constructionCostOf(
  world: World,
  ctx: SystemContext,
  site: Entity,
): readonly { goodType: number; amount: number }[] {
  const b = world.tryGet(site, Building);
  if (b === undefined) return EMPTY_CONSTRUCTION;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.construction ?? EMPTY_CONSTRUCTION;
}

const EMPTY_CONSTRUCTION: readonly { goodType: number; amount: number }[] = [];

/** Total material units a construction site's cost sums to (Σ amount) — the denominator the delivered
 *  fraction and the per-swing labor quantum divide against. 0 for a free (empty-cost) type. */
export function constructionTotalUnits(world: World, ctx: SystemContext, site: Entity): number {
  let units = 0;
  for (const line of constructionCostOf(world, ctx, site)) units += line.amount;
  return units;
}

/**
 * The delivered-material fraction of a construction site, 0..ONE — Σ min(held, need) / Σ need over the
 * `construction` cost, each line capped at its own need so an over-delivery of one good can't mask a
 * missing other. ONE for a free (empty-cost) type. This is the MATERIAL cap on `Building.built`: the
 * ConstructionSystem sets `built = min(labor, this)`, and the builder drive hammers a site only while
 * its builder-work `labor` is below this fraction (there is material on hand to install).
 */
export function deliveredConstructionFraction(world: World, ctx: SystemContext, site: Entity): Fixed {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  let needed = 0;
  let delivered = 0;
  for (const line of constructionCostOf(world, ctx, site)) {
    needed += line.amount;
    delivered += Math.min(Math.max(stock?.get(line.goodType) ?? 0, 0), line.amount);
  }
  if (needed <= 0) return ONE; // free type — trivially "fully delivered"
  return fx.div(fx.fromInt(delivered), fx.fromInt(needed));
}

/** Whether a construction site holds every `construction` material in full (delivered fraction == ONE).
 *  A free (empty-cost) type is trivially satisfied. The completion gate the ConstructionSystem ANDs with
 *  a fully-hammered `labor`. */
export function constructionMaterialsPresent(world: World, ctx: SystemContext, site: Entity): boolean {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  for (const line of constructionCostOf(world, ctx, site)) {
    if ((stock?.get(line.goodType) ?? 0) < line.amount) return false;
  }
  return true;
}

/** The lowest-goodType `construction` material a site still lacks, with the shortfall (`need − held`) —
 *  the good, and how much, a builder fetches to keep its OWN site supplied — or null when every material
 *  is on hand. The cost is scanned in ascending goodType so the pick never depends on Map insertion order. */
export function nextNeededConstructionGood(
  world: World,
  ctx: SystemContext,
  site: Entity,
): { goodType: number; amount: number } | null {
  const stock = world.tryGet(site, Stockpile)?.amounts;
  const cost = [...constructionCostOf(world, ctx, site)].sort((a, b) => a.goodType - b.goodType);
  for (const line of cost) {
    const have = stock?.get(line.goodType) ?? 0;
    if (have < line.amount) return { goodType: line.goodType, amount: line.amount - have };
  }
  return null;
}

/** The lowest-id good a stockpile holds ≥1 unit of, or null if it is empty. Canonical (ascending
 *  goodType via {@link stockpileEntries}) so a pick keyed off it never depends on Map insertion order.
 *  The shared building block behind the ground-pile scans (`nearestGroundPile`, the collect-trunk drive). */
export function lowestStockedGood(stock: { amounts: Map<number, number> }): number | null {
  for (const [goodType, amount] of stockpileEntries(stock)) if (amount > 0) return goodType;
  return null;
}

/**
 * Whether `e` is a **loose gatherer-yard heap** — a bare {@link Stockpile}+{@link Position} that is NONE of
 * a persistent store ({@link Building} warehouse / {@link Vehicle} hull), an uncollected {@link GroundDrop}
 * trunk, or a {@link DeliveryFlag} marker. This is the ONE definition of "a settled goods heap resting on
 * the ground" the gathering economy shares: the tile a flag-bound gatherer stacks onto (`stackOntoTile`),
 * a candidate the yard search considers (`nearestFreeYardNode`), and what a scene check sums (`yardGood`).
 * Keeping it in one place stops those call sites from drifting when a future marker must also be excluded.
 */
export function isYardHeap(world: World, e: Entity): boolean {
  return (
    world.has(e, Stockpile) &&
    world.has(e, Position) &&
    !world.has(e, Building) &&
    !world.has(e, Vehicle) &&
    !world.has(e, GroundDrop) &&
    !world.has(e, DeliveryFlag)
  );
}

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
 * Cross-system: ProductionSystem gates starting/advancing a cycle on `> 0` AND advances the cycle by
 * this count per tick — the mill's two millers grind twice as fast as one (each operator works the
 * craft in parallel; observed original behaviour, the exact stacking rule isn't decoded).
 */
export function presentOperatorCount(world: World, ctx: SystemContext, building: Entity): number {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return 1; // unstaffed-by-design: no worker requirement to satisfy
  const at = interactionNode(world, ctx, building);
  if (at === null) return 0; // a placed-but-position-less workplace can't be stood on
  const bx = at.x;
  const by = at.y;
  let present = 0;
  for (const e of world.query(Settler, Position)) {
    const settler = world.get(e, Settler);
    if (settler.jobType === null || !jobs.has(settler.jobType)) continue;
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    if (n.hx === bx && n.hy === by) present++;
  }
  return Math.min(present, operatorSlotHeadcount(world, ctx, building, jobs));
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
 * Whether a good is **edible** — the food a hungry settler consumes to reset its hunger (the `eat`
 * atomic's target good). In the original, the eat slot (`setatomic <job> 10 "..._eat_slot_food"`)
 * consumes the `food_simple`/`food_extra` goods (`goodtypes.ini` types 16/17); there is no explicit
 * "iseatable" flag in `goodtypes.ini`, so the slot-food goods are identified by the good's `id`
 * carrying the `food` prefix (the source's own naming — `food_simple`/`food_extra`). (`potion_food_*`
 * are a separate potion-consumable mechanic, not the eat slot, so the `food_`-prefix match excludes
 * them by construction.)
 *
 * source-basis (approximated — see source basis): the eat atomic id (10) is pinned to the original's
 * `setatomic` bindings, but *which goods feed* is inferred from the slug rather than a source flag
 * (the original maps the food goods to the eat slot at a level not in the readable rule files). Refine
 * to a content flag if the slot→good binding is later decoded. Cross-system: the AI eat-drive planner
 * uses it to find food (carried or stored); the AtomicSystem consumes one unit on completion.
 */
export function isFood(ctx: SystemContext, goodType: number): boolean {
  const good = contentIndex(ctx.content).goods.get(goodType);
  if (good === undefined) return false;
  return good.id.startsWith(FOOD_GOOD_ID_PREFIX);
}

/**
 * The **housing capacity** a `tribe` currently has: the sum of the `homeSize` of its placed, fully
 * **built** `home` buildings. This is the sim's first consumer of the extracted `homeSize` param
 * (the original `logichousetype` `logichomesize` — the population a residence shelters: home level
 * 00 → 1, ... level 04 → 5). It is the ceiling the population grows into — the housing half of the
 * plan's `house leveling → population capacity → births→housing→births` loop, the number the
 * ReproductionSystem will gate births on (a tribe can only grow while it has room).
 *
 * Only a **built** residence counts (`built >= ONE`): a home still under construction shelters no
 * one yet (the slice places buildings already built, but the ConstructionSystem will start them at
 * `built = 0`, so the gate is forward-compatible). A `home`-kind building type with no `homeSize`
 * (none in the real data, but the schema defaults it to 0) contributes nothing.
 *
 * source-basis: the per-home capacity is the extracted `homeSize` param — faithful by construction; what
 * the capacity *gates* (births) is a later mechanic. Determinism: a pure sum over buildings (addition
 * commutes, so the `query` store order can't change the total — no canonical sort needed); no
 * RNG/wall-clock. A building whose type is absent from content contributes nothing.
 */
export function housingCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let capacity = 0;
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue; // wrong tribe, or not yet built — shelters no one
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || type.kind !== 'home') continue; // not a residence
    capacity += type.homeSize;
  }
  return capacity;
}

/**
 * The next tier in a `home`'s level chain, or undefined if `type` is not a `home` or is the top tier.
 *
 * The home level chain is the consecutive typeIds `home_level_00..04` (typeIds 2..6 in the real data),
 * each a distinct `home`-kind {@link BuildingType} carrying its OWN per-level `construction` cost and a
 * larger `homeSize`. So the next tier is the building type at `typeId + 1`, provided that type exists
 * AND is itself a `home` (the chain is contiguous; the type just past the chain's top, `home_level_04`,
 * is not a home, so a top-tier home has no next tier). Reading the chain off the consecutive typeId
 * keeps the upgrade purely data-driven — there is no separate "next level" pointer in the source; the
 * `home level NN` typeIds are sequential by construction.
 *
 * Cross-system: the ConstructionSystem uses it as the home level-up trigger (next tier's materials
 * present → upgrade), and {@link stockCapacity} uses it so a still-upgradable home advertises the next
 * tier's cost as carrier-delivery demand.
 */
export function homeNextTier(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.kind !== 'home') return undefined;
  const next = contentIndex(ctx.content).buildings.get(type.typeId + 1);
  return next?.kind === 'home' ? next : undefined;
}

/**
 * The current **population** of a `tribe`: the number of its living {@link Settler}s. The other half
 * of the housing read model ({@link housingCapacity} is the ceiling): the ReproductionSystem gates a
 * birth on `population < housingCapacity`, and a future "population vs housing capacity" invariant
 * compares the two. Counts every settler regardless of job (idle settlers are still mouths to house).
 *
 * Determinism: a pure count over `query(Settler)` (addition commutes — a count is order-independent,
 * so the store-order traversal is fine, like {@link workerPresentAt}'s any-match); no RNG/wall-clock.
 */
export function tribePopulation(world: World, tribe: number): number {
  let count = 0;
  for (const e of world.query(Settler)) {
    if (world.get(e, Settler).tribe === tribe) count++;
  }
  return count;
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
