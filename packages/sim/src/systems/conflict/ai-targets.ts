import {
  Building,
  JobAssignment,
  Position,
  Resource,
  Settler,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { interactionTile } from '../footprint.js';
import { buildingEnabled, settlerMeetsNeed } from '../progression.js';
import {
  buildingWorkerJobs,
  canonicalById,
  isFood,
  isTemple,
  manhattan,
  recipeOf,
  stockCapacity,
} from '../shared.js';

// The AI planner's TARGET-SCAN layer: build the per-tick candidate lists and answer every "nearest X"
// / "may this settler staff that workplace" query the atomic planner asks. Split out of ai.ts (which
// keeps the planner state-machine + drives + navigation) so each file is one job. Determinism: every
// scan walks the candidate lists in canonical (ascending entity-id) order with a Manhattan-distance +
// ascending-cell-id tie-break, so the winner never depends on store insertion history (goldens hold).

/**
 * The atomic planner's target candidates for one tick, each an **ascending-entity-id** list — the same
 * order `world.canonicalEntities()` scanned, so the distance + id tie-break in every `nearest*` helper
 * still picks the identical winner (goldens stay byte-identical). Built once per tick by {@link
 * collectTargets} and shared across all settlers instead of each re-scanning + re-sorting the whole world.
 */
export interface TargetCandidates {
  /** Harvest targets: entities with {@link Resource} + {@link Position}. */
  readonly resources: readonly Entity[];
  /** Stores / food stores / workplace outputs: entities with {@link Stockpile} + {@link Position}. */
  readonly stockpiles: readonly Entity[];
  /** Building-keyed targets (temples): entities with {@link Building} + {@link Position}. */
  readonly buildings: readonly Entity[];
}

/**
 * Snapshot the planner's target categories once for the tick. Each `query` is one pass over the matching
 * entities; {@link canonicalById} makes the scan order canonical (ascending id), matching the old
 * full-world scan so the winner — and therefore every golden — is unchanged. This is what turns the
 * planner from `O(settlers · entities · log n)` (per-settler re-scan + re-sort of the world) into
 * `O(entities + settlers · candidates)`, the fix for the big-crowd stall (see {@link atomicPlanner}).
 */
export function collectTargets(world: World): TargetCandidates {
  return {
    resources: canonicalById(world.query(Resource, Position)),
    stockpiles: canonicalById(world.query(Stockpile, Position)),
    buildings: canonicalById(world.query(Building, Position)),
  };
}

/**
 * The nearest harvestable {@link Resource} the given settler is allowed to harvest, by fixed-point
 * Manhattan distance from `here`, with ascending-cell-id as the deterministic tie-break. A resource
 * is eligible only if it has units remaining AND its harvest passes **both** data-driven gates:
 *
 *  - the job's `allowedAtomics` permits the resource good's harvest atomic (a woodcutter harvests
 *    trees, not ore — {@link jobAtomics});
 *  - the settler's accrued XP clears the harvested good's `needforgood` thresholds for its tribe
 *    ({@link settlerMeetsNeed}) — the *who-may-do-it* progression gate, the per-settler sibling of the
 *    production-side tribe-presence `jobEnablesGood` gate. A settler trains a good's track by
 *    harvesting it (`grantWorkExperience`), so a low-XP settler is held out of the goods whose
 *    threshold it hasn't yet reached; an unthresholded good (no `needforgood`) is harvestable by any
 *    settler, so this gate is inert where no requirement exists.
 *
 * Returns the resource entity, or null if none qualifies. Scanned in canonical entity-id order so the
 * result never depends on store insertion history. Determinism: both gates are pure reads over content
 * + the settler's components (no RNG/wall-clock).
 */
export function nearestHarvestableFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  settler: { jobType: number; tribe: number; experience: ReadonlyMap<number, number> },
): Entity | null {
  const allowed = jobAtomics(ctx, settler.jobType);
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) continue;
    if (!world.has(e, Position)) continue;
    if (!allowed.has(res.harvestAtomic)) continue; // data-driven gate: job must permit this atomic
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    if (!settlerMeetsNeed(ctx, settler.tribe, 'good', res.goodType, settler.experience)) continue;
    const cell = interactionCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest store (a {@link Building} with a {@link Stockpile}) that can stock `goodType` — i.e.
 * its building type declares a stock slot for that good and the slot is not already full — by
 * Manhattan distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order.
 * Returns the store entity or null if none can take the good.
 *
 * A workplace that PRODUCES `goodType` (a recipe output) is never a delivery target for it — goods
 * are hauled *out* of a producer to a store, never back into it (otherwise a carrier would deposit
 * its load straight back where it picked it up and livelock). A workplace consuming the good as an
 * input, or a passive store, is a valid sink.
 */
export function nearestStoreFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  goodType: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe?.outputs.some((o) => o.goodType === goodType)) continue; // never deliver to its producer
    const stock = world.get(e, Stockpile);
    const have = stock.amounts.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this good — skip
    const cell = interactionCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that holds at least one unit of an
 * edible good ({@link isFood}), by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. Returns the store and the specific food good to eat, or null
 * if no reachable store holds food. The good within a store is chosen in canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order — so the choice never
 * depends on store insertion history. A producing workplace counts too (a settler eats the food it
 * makes); the eater consumes one unit on the `eat` atomic's completion (AtomicSystem).
 */
export function nearestFoodStore(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): { store: Entity; goodType: number } | null {
  let best: { store: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const stock = world.get(e, Stockpile);
    const cell = interactionCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0 || !isFood(ctx, goodType)) continue;
      if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
        best = { store: e, goodType };
        bestDist = dist;
        bestCell = cell;
      }
      break; // this store's lowest-id food good is its candidate; move to the next store
    }
  }
  return best;
}

/**
 * The nearest {@link isTemple temple} a devout settler should walk to in order to pray, by Manhattan
 * distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order. Returns the
 * temple entity or null if no temple exists. This is the piety need's satisfier→building-target lookup
 * — the genuinely-new piece a target-bound need introduces (eat resolves to a store, sleep to no site;
 * pray resolves to a specific building the settler must reach).
 */
export function nearestTemple(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Building) || !world.has(e, Position)) continue;
    if (!isTemple(world, ctx, e)) continue;
    const cell = interactionCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * Whether ANY workplace holds a haulable output this tick — a producing {@link Building} ({@link recipeOf}
 * defined) whose {@link Stockpile} holds ≥1 unit of one of its recipe outputs. The population-level gate
 * for {@link nearestWorkplaceOutput}: if this is false no carrier can haul, so idle settlers skip the
 * per-settler scan entirely (the same "holds an output" test the scan's inner loop applies, so a false
 * here means every scan would return null — identical behavior, done once instead of per settler). It is
 * deliberately WEAKER than the full scan (no "a store can take it" check): a true still runs the real
 * scan, which returns null if delivery is impossible — the gate only ever elides a provably-empty scan.
 */
export function hasHaulableOutput(world: World, ctx: SystemContext, stockpiles: readonly Entity[]): boolean {
  for (const e of stockpiles) {
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue;
    const stock = world.get(e, Stockpile);
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount > 0 && recipe.outputs.some((o) => o.goodType === goodType)) return true;
    }
  }
  return false;
}

/**
 * The nearest workplace with a finished output good a carrier should haul away to a store. A
 * candidate is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (it is a workplace, so a stocked good is finished output, not a passive store's reserve), holding
 * at least one unit of one of its recipe's output goods that a *different* store can stock. Returns
 * the workplace and the specific good to haul, or null if nothing needs hauling.
 *
 * Determinism: workplaces are scanned in canonical entity-id order with a Manhattan-distance +
 * ascending-cell-id tie-break; within a workplace the good is chosen by canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order. The "some other
 * store can take it" check ({@link nearestStoreFor}) keeps the carrier from picking up a good it
 * could never deliver (which would just shuttle it back and forth).
 */
export function nearestWorkplaceOutput(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): { workplace: Entity; goodType: number } | null {
  let best: { workplace: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a workplace — passive stores aren't hauled FROM
    const stock = world.get(e, Stockpile);
    const cell = interactionCell(world, ctx, terrain, e);
    const dist = manhattan(terrain, here, cell);
    // Canonical (ascending goodType) so the chosen good never depends on Map insertion history.
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0) continue;
      if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
      // Deliverability check reuses the SAME stockpile candidates (a store is a Stockpile+Position too).
      if (nearestStoreFor(candidates, world, ctx, terrain, cell, goodType) === null) continue;
      if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
        best = { workplace: e, goodType };
        bestDist = dist;
        bestCell = cell;
      }
      break; // this workplace's lowest haulable goodType is its candidate; move to the next workplace
    }
  }
  return best;
}

/**
 * The set of atomic ids a job may run: its `allowedAtomics` ∪ `baseAtomics`, minus `forbiddenAtomics`
 * (an explicit denial overrides an allow). An unknown jobType yields an empty set (no permissions),
 * so a settler with a job absent from content harvests nothing rather than everything. This is the
 * data-driven permission gate from `jobtypes` — the planner picks atomics the job is allowed, never
 * a hardcoded per-job list.
 */
function jobAtomics(ctx: SystemContext, jobType: number): ReadonlySet<number> {
  const job = ctx.content.jobs.find((j) => j.typeId === jobType);
  if (job === undefined) return EMPTY_ATOMICS;
  const set = new Set<number>(job.allowedAtomics);
  for (const a of job.baseAtomics) set.add(a);
  for (const a of job.forbiddenAtomics) set.delete(a);
  return set;
}

const EMPTY_ATOMICS: ReadonlySet<number> = new Set<number>();

/**
 * Whether the settler is standing on its **bound workplace** ({@link JobAssignment}) and that building
 * is a producing workplace it staffs — a {@link Building} with a `recipe` (not a passive store/HQ),
 * sharing the settler's integer tile, whose `workers` slots name the settler's `jobType`. Such a
 * settler is the workplace's operator — the atomic planner leaves it put so the ProductionSystem's
 * worker-presence gate stays satisfied. An unbound settler is never pinned (it has no station yet).
 *
 * Keying on the binding (not on standing-on-*any*-workplace) is what keeps a worker latched to ITS
 * mill: a woodcutter the HQ lists as a worker isn't frozen on the HQ (its binding is the sawmill, or
 * it has none and must go harvest), and a brief step onto a *different* same-type mill doesn't re-home
 * it. Determinism: a single binding lookup + a positional compare, no chosen-entity ordering.
 */
export function staffsBoundWorkplaceHere(world: World, ctx: SystemContext, settler: Entity): boolean {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return false; // unemployed/unbound: nothing pins it here
  const s = world.get(settler, Settler);
  if (s.jobType === null) return false; // job was cleared but binding lingers — not an operator
  const b = binding.workplace;
  if (recipeOf(world, ctx, b) === undefined) return false; // bound building isn't a producing workplace
  if (!buildingWorkerJobs(world, ctx, b).has(s.jobType)) return false; // doesn't employ this job
  const at = interactionTile(world, ctx, b); // the door cell — where an operator stands (footprint types)
  const sp = world.tryGet(settler, Position);
  if (at === null || sp === undefined) return false;
  return at.x === fx.toInt(sp.x) && at.y === fx.toInt(sp.y);
}

/**
 * The building a bound `tribe` settler of `jobType` should WALK TO in order to staff it — its
 * {@link JobAssignment} workplace, the target of the walk-to-workplace drive (the movement half
 * {@link staffsBoundWorkplaceHere}, the already-here pin, was missing). The settler heads for *its own*
 * mill, not the nearest unstaffed one, so it stays latched across a brief step-off and two same-type
 * workplaces staff independently. Returns the bound building, or null when the settler isn't bound to
 * a usable station (so it falls through to harvest/haul) — which holds when:
 *
 *  - it has no {@link JobAssignment} (an unassigned harvester — go harvest), OR
 *  - the bound building is gone / not a producing workplace it staffs / not tech-enabled / not the
 *    same tribe — a stale or unusable binding, treated as "no station" so the settler isn't stranded.
 *
 * Determinism: a single binding lookup + pure predicate checks, no chosen-entity ordering. (`terrain`
 * and `here` are unused now the target is the bound building rather than a nearest-of search, but kept
 * for signature symmetry with the other drive targets; the navigation pass routes to it.)
 */
export function boundWorkplaceTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): Entity | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null; // unassigned: no station to walk to
  const b = binding.workplace;
  const building = world.tryGet(b, Building);
  if (building === undefined || building.tribe !== tribe) return null; // gone / wrong tribe
  if (recipeOf(world, ctx, b) === undefined) return null; // not a producing workplace
  if (!buildingWorkerJobs(world, ctx, b).has(jobType)) return null; // doesn't employ this job
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null; // not tech-enabled yet
  if (!world.has(b, Position)) return null; // a position-less workplace can't be walked to
  return b;
}

/**
 * The cell a walk-to / are-we-there target resolves to. For a {@link Building} this is its
 * **interaction tile** — the door cell when the type's footprint names one ({@link interactionTile}),
 * since the walls themselves are now walk-blocked and the original's settlers enter through the door.
 * Everything else (a resource node, a bare store fixture, a boat hull) keeps its {@link Position}
 * tile. Distances, walk goals, and the `cell === here` arrival checks all resolve through here, so
 * the goal a settler walks to and the tile that counts as "at the building" can never disagree.
 */
export function interactionCell(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): CellId {
  const at = interactionTile(world, ctx, e);
  if (at !== null) return terrain.cellAtClamped(at.x, at.y);
  const p = world.get(e, Position);
  return terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
}
