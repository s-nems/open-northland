import type { AtomicEffect } from '../commands.js';
import {
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
  stockpileEntries,
} from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { fx } from '../fixed.js';
import type { CellId, TerrainGraph } from '../terrain.js';
import type { System, SystemContext } from './context.js';
import { inRange, recipeOf, stockCapacity } from './shared.js';

/**
 * AISystem — the settler planner: two layered passes per tick.
 *
 *  1. {@link atomicPlanner} (the *what*): for an idle settler (a job, no atomic running, not
 *     travelling), choose the next atomic in the harvest→carry→pileup chain — either issue a
 *     {@link MoveGoal} to walk to the next target (a resource, then a store), or, once standing on
 *     that target, start the {@link CurrentAtomic} the AtomicSystem will execute.
 *  2. {@link navigationPlanner} (the *where*): turn a {@link MoveGoal} on a path-less, request-less
 *     entity into a {@link PathRequest}; PathfindingSystem routes it, MovementSystem walks it, and
 *     the goal is removed on arrival.
 *
 * The split mirrors the original: the atomic vocabulary is the soul of the behavior, and navigation
 * is just how a settler physically reaches an atomic's target. The atomic planner runs first so a
 * freshly-set goal is picked up by the navigation pass in the same tick (no one-tick stall).
 *
 * Determinism: no RNG, no wall-clock; entities are visited in deterministic store order and every
 * choice is a pure function of the settler's components + the (canonically-scanned) world. No-ops
 * without a terrain graph (a mapless sim has no cells to navigate over — the golden is untouched).
 */
export const aiSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to navigate over
  atomicPlanner(world, ctx, ctx.terrain);
  navigationPlanner(world, ctx.terrain);
};

/**
 * The atomic-utility planner: pick the next atomic for each idle settler and drive the
 * harvest→carry→pileup chain.
 *
 * A settler is *idle* when it has a {@link Settler} + {@link Position} but no {@link CurrentAtomic}
 * running and is not currently travelling (no {@link MoveGoal}/{@link PathRequest}/{@link PathFollow}).
 * For each idle settler, in deterministic store order, the planner decides the next step from the
 * settler's state — a small state machine over "am I carrying anything?" and "what am I standing on?":
 *
 *  - Carrying goods, standing on a store that can stock them → start a `pileup` atomic.
 *  - Carrying goods, not on a suitable store → set a {@link MoveGoal} to the nearest such store.
 *  - Empty-handed, standing on a harvestable resource its job is allowed to harvest → start a
 *    `harvest` atomic (the resource's good's harvest atomic, gated by the job's `allowedAtomics`).
 *  - Empty-handed, not on a resource → set a {@link MoveGoal} to the nearest harvestable resource.
 *
 * The atomic id and its duration come from CONTENT, not code: the harvest atomic is the resource
 * good's `atomics.harvest`, and `duration` is resolved through the tribe's `setatomic` binding →
 * `atomicAnimations` length (see {@link atomicDuration}). This is the data-driven planner the
 * roadmap calls for — behavior is the atomic vocabulary, not bespoke per-job logic.
 *
 * "Utility" is minimal here (nearest reachable target by Manhattan distance, harvest-or-deposit by
 * load state); hunger/needs and job assignment are later slices (NeedsSystem/JobSystem). Targets are
 * scanned in canonical (ascending entity-id) order with a deterministic distance+id tie-break, so
 * the choice never depends on store insertion history.
 */
function atomicPlanner(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  for (const e of world.query(Settler, Position)) {
    // Busy: an atomic is running, or the settler is en route to a target. Leave it to play out.
    if (world.has(e, CurrentAtomic)) continue;
    if (world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow)) continue;

    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run

    const p = world.get(e, Position);
    const here = terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
    const load = world.tryGet(e, Carrying);

    if (load !== undefined && load.amount > 0) {
      // Loaded: take the goods to a store that can stock them.
      const store = nearestStoreFor(world, ctx, terrain, here, load.goodType);
      if (store === null) continue; // nowhere to deposit — idle this tick (a later slice may wait/drop)
      const cell = entityCell(world, terrain, store);
      if (cell === here) {
        startAtomic(
          world,
          e,
          PILEUP_ATOMIC_ID,
          { kind: 'pileup', store },
          atomicDuration(ctx, settler, PILEUP_ATOMIC_ID),
          store,
        );
      } else {
        world.add(e, MoveGoal, { cell });
      }
      continue;
    }

    // Empty-handed: go harvest. Pick the nearest resource this job is allowed to harvest.
    const node = nearestHarvestableFor(world, ctx, terrain, here, settler.jobType);
    if (node !== null) {
      const res = world.get(node, Resource);
      const cell = entityCell(world, terrain, node);
      if (cell === here) {
        startAtomic(
          world,
          e,
          res.harvestAtomic,
          { kind: 'harvest', resource: node, goodType: res.goodType },
          atomicDuration(ctx, settler, res.harvestAtomic),
          node,
        );
      } else {
        world.add(e, MoveGoal, { cell });
      }
      continue;
    }

    // Nothing to harvest: act as a carrier — haul finished outputs out of a workplace to a store
    // that can stock them (so a producing workplace doesn't clog on its own output and goods reach
    // the settlement's stores). Nearest workplace with a haulable output it can deliver somewhere.
    const haul = nearestWorkplaceOutput(world, ctx, terrain, here);
    if (haul === null) continue; // nothing to harvest AND nothing to haul — idle this tick
    const cell = entityCell(world, terrain, haul.workplace);
    if (cell === here) {
      startAtomic(
        world,
        e,
        PICKUP_ATOMIC_ID,
        { kind: 'pickup', goodType: haul.goodType, amount: CARRY_LOAD, from: haul.workplace },
        atomicDuration(ctx, settler, PICKUP_ATOMIC_ID),
        haul.workplace,
      );
    } else {
      world.add(e, MoveGoal, { cell });
    }
  }
}

/** The numeric atomic id for a carrier picking goods up out of a store (the original's generic
 *  pickup=22; like {@link PILEUP_ATOMIC_ID} the readable data binds no per-good pickup, and the id is
 *  only a content cross-reference / animation join key — the typed `pickup` effect is the behavior). */
const PICKUP_ATOMIC_ID = 22;

/** Units a carrier lifts per pickup swing — one good unit at a time, like `HARVEST_YIELD`. The
 *  pickup is capped at the source's available amount, so this is just the max a single haul moves. */
const CARRY_LOAD = 1;

/** The numeric atomic id used for depositing a carried load into a store. The READABLE data binds
 *  no per-good "pileup" atomic (harvest/produce are good-keyed; pickup=22/pileup are generic), and
 *  the id is only a content cross-reference / animation join key — the *effect* (typed `pileup`) is
 *  what the AtomicSystem applies. A constant keeps the planner data-driven where it matters (the
 *  harvest atomic IS read from content) without inventing a per-good deposit binding the data lacks. */
const PILEUP_ATOMIC_ID = 23;

/**
 * Start a {@link CurrentAtomic} on a settler: the executor (AtomicSystem) will advance it and apply
 * `effect` on completion. `duration` is the animation length in ticks (clamped to ≥1 by the
 * executor); `target` is the action's object (the resource/store), recorded for render/inspection.
 */
function startAtomic(
  world: World,
  settler: Entity,
  atomicId: number,
  effect: AtomicEffect,
  duration: number,
  target: Entity,
): void {
  world.add(settler, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect,
    targetEntity: target,
    targetTile: null,
  });
}

/**
 * Resolve an atomic's duration (animation length in ticks) through the data: the settler's tribe
 * binds `(jobType, atomicId)` to an animation name (`setatomic`, last-wins), and `atomicAnimations`
 * gives that name's `length`. Falls back to {@link DEFAULT_ATOMIC_DURATION} when the chain doesn't
 * resolve (the readable mod set is a subset of the base animations, and test fixtures may bind
 * neither) — a missing timing must not hang or zero-out the atomic.
 */
function atomicDuration(
  ctx: SystemContext,
  settler: { tribe: number; jobType: number | null },
  atomicId: number,
): number {
  if (settler.jobType === null) return DEFAULT_ATOMIC_DURATION;
  const tribe = ctx.content.tribes.find((t) => t.typeId === settler.tribe);
  if (tribe === undefined) return DEFAULT_ATOMIC_DURATION;
  // Last-wins over the file-order bindings (matches the original's config-override semantics).
  let animation: string | undefined;
  for (const b of tribe.atomicBindings) {
    if (b.jobType === settler.jobType && b.atomicId === atomicId) animation = b.animation;
  }
  if (animation === undefined) return DEFAULT_ATOMIC_DURATION;
  const anim = ctx.content.atomicAnimations.find((a) => a.name === animation);
  const length = anim?.length ?? 0;
  return length > 0 ? length : DEFAULT_ATOMIC_DURATION;
}

/** Duration (ticks) used when the atomic→animation→length chain doesn't resolve. A non-zero default
 *  so an unresolved atomic still takes visible time rather than completing instantly. */
const DEFAULT_ATOMIC_DURATION = 4;

/**
 * The nearest harvestable {@link Resource} the given job is allowed to harvest, by fixed-point
 * Manhattan distance from `here`, with ascending-cell-id as the deterministic tie-break. A resource
 * is eligible only if it has units remaining AND the job's `allowedAtomics` permits the resource
 * good's harvest atomic (the data-driven gate — a woodcutter harvests trees, not ore). Returns the
 * resource entity, or null if none qualifies. Scanned in canonical entity-id order so the result
 * never depends on store insertion history.
 */
function nearestHarvestableFor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  jobType: number,
): Entity | null {
  const allowed = jobAtomics(ctx, jobType);
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of world.canonicalEntities()) {
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) continue;
    if (!world.has(e, Position)) continue;
    if (!allowed.has(res.harvestAtomic)) continue; // data-driven gate: job must permit this atomic
    const cell = entityCell(world, terrain, e);
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
function nearestStoreFor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
  goodType: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of world.canonicalEntities()) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe?.outputs.some((o) => o.goodType === goodType)) continue; // never deliver to its producer
    const stock = world.get(e, Stockpile);
    const have = stock.amounts.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this good — skip
    const cell = entityCell(world, terrain, e);
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
function nearestWorkplaceOutput(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: CellId,
): { workplace: Entity; goodType: number } | null {
  let best: { workplace: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of world.canonicalEntities()) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a workplace — passive stores aren't hauled FROM
    const stock = world.get(e, Stockpile);
    const cell = entityCell(world, terrain, e);
    const dist = manhattan(terrain, here, cell);
    // Canonical (ascending goodType) so the chosen good never depends on Map insertion history.
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0) continue;
      if (!recipe.outputs.some((o) => o.goodType === goodType)) continue; // only haul outputs
      if (nearestStoreFor(world, ctx, terrain, cell, goodType) === null) continue; // nowhere to deliver
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

/** The cell an entity occupies — its {@link Position} (a resource node, a store) snapped to a cell. */
function entityCell(world: World, terrain: TerrainGraph, e: Entity): CellId {
  const p = world.get(e, Position);
  return terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
}

/** Integer Manhattan distance between two cells (a cheap planner heuristic; A* does the real cost). */
function manhattan(terrain: TerrainGraph, a: CellId, b: CellId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/**
 * The navigation planner: turn a {@link MoveGoal} on a path-less, request-less entity into a
 * {@link PathRequest} from the entity's current cell to the goal cell. The PathfindingSystem turns
 * that into a path and the MovementSystem walks it; when the entity reaches the goal cell the goal is
 * satisfied and removed. A goal whose request just failed (no route) is left in place but not
 * re-issued this tick — the failed flag is the planner's signal; a future slice decides abandon/wait/
 * repath. This is the *where* layer; {@link atomicPlanner} (the *what*) sets the goals.
 *
 * Determinism: no RNG, no wall-clock; entities are visited in the PathFollow/PathRequest-free subset
 * of the deterministic MoveGoal store order, and the action (issue a request, or remove a satisfied
 * goal) is a pure function of the entity's position and goal.
 */
function navigationPlanner(world: World, terrain: TerrainGraph): void {
  for (const e of world.query(Position, MoveGoal)) {
    // Already travelling — a request is queued or a path is being followed. Leave it to play out.
    if (world.has(e, PathRequest) || world.has(e, PathFollow)) continue;

    const goalCell = world.get(e, MoveGoal).cell;
    if (!inRange(terrain, goalCell)) {
      // An unreachable/off-map goal can never be satisfied; drop it rather than issue dead requests
      // every tick. (A planner that owns the goal can re-add a valid one.)
      world.remove(e, MoveGoal);
      continue;
    }

    const p = world.get(e, Position);
    const startCell = terrain.cellAtClamped(fx.toInt(p.x), fx.toInt(p.y));
    if (startCell === goalCell) {
      world.remove(e, MoveGoal); // arrived (or started on the goal): the goal is satisfied
      continue;
    }

    // Not there yet and not travelling: issue a fresh route request from where we stand to the goal.
    world.add(e, PathRequest, { start: startCell, goal: goalCell, failed: false });
  }
}
