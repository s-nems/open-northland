import {
  Building,
  GroundDrop,
  JobAssignment,
  Position,
  Resource,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { interactionTile, positionedInteractionCell, resourceWorkCell } from '../footprint.js';
import { buildingEnabled, settlerMeetsNeed } from '../progression.js';
import { canonicalById, manhattan } from '../spatial.js';
import {
  buildingWorkerJobs,
  isFood,
  isTemple,
  lowestStockedGood,
  recipeOf,
  stockCapacity,
} from '../stores.js';

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
  /**
   * Felled trunks / dropped-good piles — entities with {@link GroundDrop} + {@link Stockpile} +
   * {@link Position}. The **tiny subset** a collector's own-trunk drive scans, so it never walks the
   * whole {@link stockpiles} list (which includes every building store + delivery flag): with no drops
   * on the map the collect scan is O(0), the dormancy the drive needs to stay cheap for a big idle crowd.
   */
  readonly groundDrops: readonly Entity[];
  /**
   * `goodType → its harvest atomic id` (the good's `atomicForHarvesting`), built once per tick from
   * content — a lookup index so the collect scan resolves a dropped good's harvest atomic without a
   * `content.goods.find` per pile per settler (the content-index anti-pattern, packages/sim/AGENTS.md).
   */
  readonly harvestAtomicByGood: ReadonlyMap<number, number>;
}

/**
 * Snapshot the planner's target categories once for the tick. Each `query` is one pass over the matching
 * entities; {@link canonicalById} makes the scan order canonical (ascending id), matching the old
 * full-world scan so the winner — and therefore every golden — is unchanged. This is what turns the
 * planner from `O(settlers · entities · log n)` (per-settler re-scan + re-sort of the world) into
 * `O(entities + settlers · candidates)`, the fix for the big-crowd stall (see {@link atomicPlanner}).
 */
export function collectTargets(world: World, ctx: SystemContext): TargetCandidates {
  // A content-load-static good→harvestAtomic index (rebuilt per tick — cheap, O(goods)), so the collect
  // scan resolves a dropped good's harvest atomic by lookup, not a `content.goods.find` per pile.
  const harvestAtomicByGood = new Map<number, number>();
  for (const g of ctx.content.goods) {
    if (g.atomics.harvest !== undefined) harvestAtomicByGood.set(g.typeId, g.atomics.harvest);
  }
  return {
    resources: canonicalById(world.query(Resource, Position)),
    stockpiles: canonicalById(world.query(Stockpile, Position)),
    buildings: canonicalById(world.query(Building, Position)),
    groundDrops: canonicalById(world.query(GroundDrop, Stockpile, Position)),
    harvestAtomicByGood,
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
    const cell = interactionCell(world, ctx, terrain, e, here);
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
 * The nearest **collectable ground drop** a felling collector should carry off — a bare
 * {@link GroundDrop} trunk pile (a felled tree's dropped wood) whose good THIS settler's job may
 * harvest — with its Manhattan distance, or null if none is in reach. Scoped two ways so it stays the
 * collector's *own-trade* loop, not a general porter drive: (1) to `GroundDrop` piles only (a felled
 * trunk / dropped good), never a designated delivery flag or a boat hull — both equally-bare
 * `Stockpile`s; (2) to a good the settler harvests, via the SAME {@link jobAtomics} gate
 * {@link nearestHarvestableFor} uses (a woodcutter collects wood, not a stonecutter's dropped stone).
 *
 * Nearest by Manhattan + ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked
 * good ({@link stockpileEntries}, never raw Map order). The planner weighs the returned `dist` against
 * {@link nearestHarvestableFor}'s node so, standing on its fresh trunk (distance 0), the collector
 * picks the wood up before wandering to the next tree — the original's fell-then-carry cadence.
 * Unlike harvesting, collecting an already-dropped good applies no `needforgood` XP gate (carrying a
 * trunk is hauling, not harvesting). Determinism: pure reads over content + components, no RNG.
 */
export function nearestCollectablePileFor(
  candidates: readonly Entity[],
  harvestAtomicByGood: ReadonlyMap<number, number>,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  jobType: number,
): { pile: Entity; goodType: number; dist: number } | null {
  const allowed = jobAtomics(ctx, jobType);
  let best: { pile: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  // `candidates` is the GroundDrop candidate list, so every entry already has GroundDrop+Stockpile+Position
  // (built by collectTargets) — no per-pile marker re-check, and the scan is O(drops), ~0 when none exist.
  for (const e of candidates) {
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an emptied drop (about to be reaped) — nothing to collect
    const harvestAtomic = harvestAtomicByGood.get(good);
    if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) continue; // not this job's trade
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = { pile: e, goodType: good };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best === null ? null : { ...best, dist: bestDist };
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
    // A GroundDrop (a felled trunk / dropped good) is a SOURCE to collect, never a delivery SINK —
    // otherwise a collector would deposit the wood straight back into the trunk it just lifted from
    // (a livelock). A designated flag (a bare Stockpile with no marker) stays a valid sink.
    if (world.has(e, GroundDrop)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe?.outputs.some((o) => o.goodType === goodType)) continue; // never deliver to its producer
    const stock = world.get(e, Stockpile);
    const have = stock.amounts.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this good — skip
    const cell = interactionCell(world, ctx, terrain, e, here);
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
    const cell = interactionCell(world, ctx, terrain, e, here);
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
    const cell = interactionCell(world, ctx, terrain, e, here);
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
    const cell = interactionCell(world, ctx, terrain, e, here);
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
  return contentIndex(ctx.content).atomicsByJob.get(jobType) ?? EMPTY_ATOMICS;
}

const EMPTY_ATOMICS: ReadonlySet<number> = new Set<number>();

/**
 * The building a bound `tribe` settler of `jobType` should WALK TO / hold at in order to staff it — its
 * {@link JobAssignment} workplace, the station the producer drive ({@link planProducer} in ai.ts) heads
 * for and pins on. The settler heads for *its own* mill, not the nearest unstaffed one, so it stays
 * latched across a brief step-off and two same-type workplaces staff independently. Returns the bound
 * building, or null when the settler isn't bound to a usable station (so it falls through to harvest/
 * haul / porter drives) — which holds when:
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
 * A footprinted {@link Resource} resolves to its data-driven work cell, while an unfootprinted one
 * keeps the old anchor-tile fixture behavior. Everything else (a bare store fixture, a boat hull, a
 * loose ground drop) resolves to its {@link Position} tile unless that tile is under a resource walk
 * block, in which case the nearest free neighbour is used. Distances, walk goals, and the
 * `cell === here` arrival checks all resolve through here, so the goal a settler walks to and the
 * tile that counts as "at the target" can never disagree.
 */
export function interactionCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  from?: CellId,
): CellId {
  const at = interactionTile(world, ctx, e);
  if (at !== null) return terrain.cellAtClamped(at.x, at.y);
  if (world.has(e, Resource)) return resourceWorkCell(world, terrain, e, from);
  return positionedInteractionCell(world, terrain, e, from);
}
