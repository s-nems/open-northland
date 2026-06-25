import type { Recipe } from '@vinland/data';
import { assertNever } from '../brand.js';
import type { AtomicEffect } from '../commands.js';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
  stockpileEntries,
} from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { fx } from '../fixed.js';
import { findPath } from '../pathfinding.js';
import type { CellId, TerrainGraph } from '../terrain.js';
import { commandSystem } from './command.js';
import type { System, SystemContext } from './context.js';
import { MOVE_SPEED_PER_TICK, movementSystem } from './movement.js';
import {
  cleanupSystem,
  combatSystem,
  constructionSystem,
  jobSystem,
  needsSystem,
  progressionSystem,
  reproductionSystem,
  terrainSystem,
  timeSystem,
  transportSystem,
} from './stubs.js';

// The System/SystemContext types, the CommandSystem, the MovementSystem, and the not-yet-implemented
// stub systems live in their own modules now; the barrel re-exports them so `@vinland/sim`'s
// `systems` namespace (and the tests) keep a single import site. This is the ongoing systems/ split
// — see docs/TECH-DEBT.md.
export type { System, SystemContext };
export { commandSystem };
export { MOVE_SPEED_PER_TICK, movementSystem };
export {
  cleanupSystem,
  combatSystem,
  constructionSystem,
  jobSystem,
  needsSystem,
  progressionSystem,
  reproductionSystem,
  terrainSystem,
  timeSystem,
  transportSystem,
};

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

/** Units a carrier lifts per pickup swing — one good unit at a time, like {@link HARVEST_YIELD}. The
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

/**
 * The maximum number of {@link PathRequest}s the pathfinder will resolve in a single tick. A*
 * is the heaviest per-call work in the schedule, so spreading many requests over several ticks
 * keeps the tick cost bounded — the budget is the determinism-safe spread (we always serve the
 * lowest entity ids first, never a wall-clock cutoff). Tune as crowds grow; one is plenty for
 * the single-settler slice.
 */
export const PATHFINDING_BUDGET_PER_TICK = 8;

/**
 * PathfindingSystem — drains pending {@link PathRequest}s and turns each into a followable path.
 *
 * For up to {@link PATHFINDING_BUDGET_PER_TICK} requests per tick (lowest entity ids first, so the
 * spread is history-independent), it runs A* on `ctx.terrain` from the request's `start` to `goal`
 * cell. On success it writes the cell sequence into the entity's {@link PathFollow} (cell centres,
 * in fixed-point tile units) and removes the request; on failure it flags the request `failed` and
 * removes any stale path, leaving the request for the planner to inspect rather than silently
 * retrying the same dead query every tick. No-ops entirely when no terrain graph is present — a
 * mapless sim (the determinism golden) has nothing to route over.
 *
 * Determinism: A* is pure and canonically tie-broken; requests are served in ascending entity-id
 * order (a canonical sort, not Map insertion order); cell ids are validated against the graph so an
 * out-of-range request fails gracefully instead of throwing inside the search.
 */
export const pathfindingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to route over

  // Serve in ascending entity-id order so the per-tick budget cut is canonical (never insertion
  // order). canonicalEntities() is the sorted id list; filter to those with a live request.
  let served = 0;
  for (const e of world.canonicalEntities()) {
    if (served >= PATHFINDING_BUDGET_PER_TICK) break;
    const req = world.tryGet(e, PathRequest);
    if (req === undefined || req.failed) continue; // already-failed requests aren't retried
    served++;

    const path = resolvePath(terrain, req.start, req.goal);
    if (path === null) {
      req.failed = true; // signal the planner; keep the request so it isn't silently re-issued
      world.remove(e, PathFollow); // drop any stale path so movement doesn't follow a dead route
      continue;
    }

    // Success: hand the entity a fresh PathFollow of cell-centre waypoints and clear the request.
    const waypoints = path.map((cell) => {
      const { x, y } = terrain.coordsOf(cell);
      return { x: fx.fromInt(x), y: fx.fromInt(y) };
    });
    world.add(e, PathFollow, { waypoints, index: 0 });
    world.remove(e, PathRequest);
  }
};

/**
 * Run A* for a request, guarding the raw cell ids against the graph bounds first. An id outside
 * `0..cellCount-1` is a bad request (e.g. a goal off a smaller map) — treat it as "no route"
 * (null) rather than letting it throw inside the heuristic, since a request is boundary input.
 */
function resolvePath(terrain: TerrainGraph, start: number, goal: number): CellId[] | null {
  if (!inRange(terrain, start) || !inRange(terrain, goal)) return null;
  return findPath(terrain, start as CellId, goal as CellId);
}

function inRange(terrain: TerrainGraph, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < terrain.cellCount;
}

/**
 * AtomicSystem — the executor half of the settler planner: advance the {@link CurrentAtomic} a
 * settler is running and, on completion, apply its typed {@link AtomicEffect}.
 *
 * Each tick, for every entity with a CurrentAtomic, the integer `elapsed` counter advances; a
 * `duration` of D ticks completes on the D-th tick (a 0/1-tick animation completes the first tick —
 * `duration` is clamped to at least 1). Timing is the exact integer compare `elapsed >= duration`,
 * NOT an accumulated fixed-point step: `ONE / duration` truncates, so summing it `duration` times
 * would fall short of ONE and the atomic would hang. `progress` (0..ONE) is recomputed each tick as
 * a derived display value for render interpolation only. When the atomic completes the executor
 * applies the effect (the state mutation), emits an `atomicCompleted` event for render/audio, and
 * removes the component — the planner reads an entity with no CurrentAtomic as ready for its next.
 *
 * `applyEffect` is an exhaustive switch over the {@link AtomicEffect} union (`assertNever` makes a
 * new variant a compile error here), so behavior is the typed effect, not an opaque atomicId. The
 * harvest→pickup→carry→pileup chain that the single-settler slice needs is implemented; `produce`
 * and `attack` belong to ProductionSystem/CombatSystem and only signal completion here for now.
 *
 * Determinism: no RNG, no wall-clock. Entities are visited in the CurrentAtomic store's deterministic
 * insertion order, and each effect is a pure function of the entity + its target's current state
 * (Stockpile writes go through the canonical Map, never iterated for a decision). Fixed-point only.
 */
export const atomicSystem: System = (world, ctx) => {
  for (const e of world.query(CurrentAtomic)) {
    const atomic = world.get(e, CurrentAtomic);
    const duration = Math.max(1, atomic.duration);
    atomic.elapsed += 1;
    // Derived 0..ONE display value (render interpolation); clamped so it never exceeds ONE.
    atomic.progress = fx.div(fx.fromInt(Math.min(atomic.elapsed, duration)), fx.fromInt(duration));
    if (atomic.elapsed < duration) continue; // still running

    // Completed this tick: apply the effect, notify render/audio, and free the settler.
    applyEffect(world, ctx, e, atomic.effect);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: atomic.atomicId });
    world.remove(e, CurrentAtomic);
  }
};

/**
 * Apply a completed atomic's effect. Exhaustive over {@link AtomicEffect}: adding a variant is a
 * compile error until it is handled here (`assertNever`). Each branch is a pure function of current
 * state — no RNG, no wall-clock.
 */
function applyEffect(world: World, ctx: SystemContext, settler: Entity, effect: AtomicEffect): void {
  switch (effect.kind) {
    case 'harvest':
      // The settler gathers HARVEST_YIELD unit(s) of the resource's good onto its back (carriers
      // haul; goods never teleport) AND the harvested node loses that many units. The yield and the
      // depletion use the same constant so a node releases exactly what settlers carry away — goods
      // are conserved and a finite node empties (planner's `remaining <= 0` gate then skips it).
      harvestFromNode(world, settler, effect.resource, effect.goodType);
      return;
    case 'pickup':
      pickupFromStore(world, settler, effect.from, effect.goodType, effect.amount);
      return;
    case 'pileup':
      pileupIntoStore(world, ctx, settler, effect.store);
      return;
    case 'eat':
      // Eating clears hunger; the good is consumed from whatever the settler carries/holds. The
      // needs/consumption accounting is the Phase-3 NeedsSystem — here we only zero hunger.
      if (world.has(settler, Settler)) world.get(settler, Settler).hunger = fx.fromInt(0);
      return;
    case 'move':
    case 'idle':
      // Pure markers: the actual walking is the navigation layer (PathFollow/MovementSystem). The
      // atomic just completing is the signal; no extra state change.
      return;
    case 'produce':
    case 'attack':
      // Owned by ProductionSystem / CombatSystem (later slices). Completing the atomic + emitting
      // the event is enough for now; the heavy mutation lands when those systems exist.
      return;
    default:
      assertNever(effect); // a new AtomicEffect variant is a compile error until handled above
  }
}

/**
 * Units a single completed `harvest` atomic yields — granted to the settler AND removed from the
 * harvested node. One unit per swing keeps the node draining in step with what gets carried away,
 * so goods are conserved (a node of N units survives exactly N harvests). A real per-good yield
 * (some nodes drop more per swing) is a later balance slice — kept a constant so tuning is a diff.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest: grant {@link HARVEST_YIELD} of `goodType` onto the settler's back
 * and deplete the harvested node by the same amount (clamped at 0). The node may already be gone
 * (destroyed/consumed between the atomic starting and completing) — a missing {@link Resource} just
 * skips the decrement; the carry still happens (the swing was made). `remaining` reaching 0 is the
 * planner's "nothing left here" gate, so the node is left in place (a later slice may clean it up).
 */
function harvestFromNode(world: World, settler: Entity, node: Entity, goodType: number): void {
  addCarry(world, settler, goodType, HARVEST_YIELD);
  const res = world.tryGet(node, Resource);
  if (res === undefined) return; // node already gone — nothing to deplete
  res.remaining = Math.max(0, res.remaining - HARVEST_YIELD);
}

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from a source store's
 * {@link Stockpile} onto the settler's back. Goods are conserved — the carrier gains exactly what
 * the source loses, so a pickup never creates or destroys goods (carriers haul; nothing teleports).
 * When `from` is null (a sourceless pickup) the goods simply appear carried; otherwise the available
 * amount caps the transfer (the source may have shrunk between the planner choosing it and the swing
 * completing — a competing system or another carrier). A source with nothing left to give is a no-op.
 */
function pickupFromStore(
  world: World,
  settler: Entity,
  from: Entity | null,
  goodType: number,
  amount: number,
): void {
  if (from === null) {
    addCarry(world, settler, goodType, amount);
    return;
  }
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return; // source gone — nothing to take (don't conjure goods)
  const have = stock.amounts.get(goodType) ?? 0;
  const moved = Math.min(amount, have);
  if (moved <= 0) return; // source emptied since the planner chose it — nothing to carry
  stock.amounts.set(goodType, have - moved);
  addCarry(world, settler, goodType, moved);
}

/**
 * Add `amount` of `goodType` to a settler's carried load, merging if it already carries that good.
 *
 * A settler carries one good at a time (single-slot {@link Carrying}). Asking it to pick up a
 * *different* good while still loaded would silently overwrite — and so destroy — the held good,
 * breaking goods conservation. That can only be a planner bug (the planner must pile up the current
 * load first), so we throw rather than corrupt state (CLAUDE.md: throw for bugs).
 */
function addCarry(world: World, settler: Entity, goodType: number, amount: number): void {
  const held = world.tryGet(settler, Carrying);
  if (held !== undefined) {
    if (held.goodType !== goodType) {
      throw new Error(
        `settler ${settler} already carries good ${held.goodType}; cannot pick up good ${goodType} (pile up first)`,
      );
    }
    held.amount += amount;
    return;
  }
  world.add(settler, Carrying, { goodType, amount });
}

/**
 * Deposit a settler's carried load into a store's {@link Stockpile}, capped at the building type's
 * per-good capacity. Any overflow stays on the settler's back (goods are conserved — never dropped).
 * No-op if the settler carries nothing or the store has no stockpile.
 */
function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): void {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return;
  const stock = world.tryGet(store, Stockpile);
  if (stock === undefined) return;

  const have = stock.amounts.get(load.goodType) ?? 0;
  const capacity = stockCapacity(world, ctx, store, load.goodType);
  const space = Math.max(0, capacity - have);
  const moved = Math.min(load.amount, space);
  if (moved <= 0) return; // store full for this good — keep carrying

  stock.amounts.set(load.goodType, have + moved);
  const remaining = load.amount - moved;
  if (remaining > 0) load.amount = remaining;
  else world.remove(settler, Carrying); // fully unloaded
}

/**
 * The per-good capacity of a store's stockpile, from its building type's stock slots. A good with no
 * declared slot has no room (capacity 0); a store with no Building/type is treated as uncapped so a
 * test fixture without a building still accepts deposits.
 */
function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building === undefined) return Number.MAX_SAFE_INTEGER; // bare store fixture: uncapped
  const type = ctx.content.buildings.find((b) => b.typeId === building.buildingType);
  if (type === undefined) return 0;
  const slot = type.stock.find((s) => s.goodType === goodType);
  return slot?.capacity ?? 0;
}

/**
 * ProductionSystem — one workplace turns input goods into output goods over time.
 *
 * A workplace is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (inputs → outputs over `recipe.ticks`). Each tick, for every such building:
 *
 *  - **Running a cycle** (`{@link Production}` present): advance the integer `elapsed` counter; on the
 *    `duration`-th tick, deposit the recipe outputs into the building's own stockpile (the room was
 *    reserved when the cycle started, so they fit), emit a `productionCompleted` event, and remove
 *    the {@link Production} component (the workplace is idle again).
 *  - **Idle** (no `Production`): start a cycle iff (a) the stockpile holds every input in full, and
 *    (b) every output has free room up to the building type's per-good capacity. Starting consumes
 *    the inputs immediately (reserving them) and snapshots `recipe.ticks` as the cycle `duration`.
 *
 * Inputs are consumed at cycle start and outputs deposited at completion, so a cycle is the net
 * transformation inputs→outputs — goods are conserved (nothing teleports; consumption and production
 * are explicit stockpile writes). Per-good capacity is enforced on the output side: a cycle never
 * begins unless its outputs will fit, so the stockpile never overflows.
 *
 * Determinism: no RNG, no wall-clock; buildings are visited in the Production/Building stores'
 * deterministic insertion order, the recipe is read from CONTENT, and every stockpile write goes
 * through the canonical Map (never iterated for a decision). Timing is the exact integer compare
 * `elapsed >= duration` — not an accumulated fixed-point step (which truncates and would hang).
 */
export const productionSystem: System = (world, ctx) => {
  // Advance running cycles first, then start new ones — so a cycle started this tick doesn't also
  // get advanced in the same tick (it begins counting next tick, like CurrentAtomic).
  for (const e of world.query(Production, Stockpile)) {
    const prod = world.get(e, Production);
    const duration = Math.max(1, prod.duration);
    prod.elapsed += 1;
    if (prod.elapsed < duration) continue; // still producing

    // Completed: deposit the outputs (room was reserved at start), notify, and go idle.
    const recipe = recipeOf(world, ctx, e);
    if (recipe !== undefined) depositOutputs(world, ctx, e, recipe);
    world.remove(e, Production);
  }

  // Start cycles on idle workplaces whose inputs are present and outputs have room.
  for (const e of world.query(Building, Stockpile)) {
    if (world.has(e, Production)) continue; // already producing
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a producing workplace
    if (!canStartCycle(world, ctx, e, recipe)) continue; // missing inputs or no output room

    consumeInputs(world, e, recipe);
    world.add(e, Production, { elapsed: 0, duration: recipe.ticks });
  }
};

/** The recipe a building's type declares, or undefined if it has no Building/type or no recipe. */
function recipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  return type?.recipe;
}

/**
 * Whether a workplace may begin a production cycle now: its own stockpile holds every input good in
 * full, AND every output good has free room up to its per-good stock capacity. The output check is
 * the capacity enforcement — a cycle that couldn't deposit its outputs is never started, so the
 * stockpile never overflows (and outputs aren't produced and then dropped).
 */
function canStartCycle(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  const stock = world.get(building, Stockpile).amounts;
  for (const input of recipe.inputs) {
    if ((stock.get(input.goodType) ?? 0) < input.amount) return false; // input not available
  }
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    const capacity = stockCapacity(world, ctx, building, output.goodType);
    if (capacity - have < output.amount) return false; // no room for this output — enforce capacity
  }
  return true;
}

/**
 * Remove the recipe's input goods from the workplace's stockpile (consumed at cycle start). The
 * caller has already verified via {@link canStartCycle} that every input is present in full, so a
 * count can't go negative. A consumed good that hits zero is left as a 0 entry (the canonical Map
 * tolerates it); the stockpile is never iterated for a decision, so a stale 0 is harmless.
 */
function consumeInputs(world: World, building: Entity, recipe: Recipe): void {
  const stock = world.get(building, Stockpile).amounts;
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    stock.set(input.goodType, have - input.amount);
  }
}

/**
 * Deposit the recipe's output goods into the workplace's stockpile on cycle completion and emit a
 * `goodProduced` event per output (render/audio cue). The room was reserved by {@link canStartCycle}
 * at cycle start (no input consumption or competing producer can have removed capacity since —
 * production is the only writer of a workplace's own outputs), so the outputs always fit; the
 * per-good capacity is not re-checked here.
 */
function depositOutputs(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): void {
  const stock = world.get(building, Stockpile).amounts;
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    stock.set(output.goodType, have + output.amount);
    ctx.events.emit({
      kind: 'goodProduced',
      building,
      goodType: output.goodType,
      amount: output.amount,
    });
  }
}

// The systems composing SYSTEM_ORDER live across this directory: the REAL ones in their own files —
// commandSystem (./command.ts, drains the CommandQueue and applies each serializable command first),
// movementSystem (./movement.ts) — and the REAL ones still defined above (aiSystem: the settler
// planner picking atomics + turning a MoveGoal into a PathRequest; pathfindingSystem: budgeted A* on
// the cell graph; atomicSystem: advance CurrentAtomic and apply its effect; productionSystem: a
// workplace consuming recipe inputs → outputs under per-good stock capacity). The not-yet-implemented
// placeholders live in ./stubs.ts (re-exported above). See docs/TECH-DEBT.md for the ongoing split.

/**
 * The canonical per-tick execution order. Order is part of the design — change deliberately.
 * Note the AI->Atomic split: AISystem chooses an atomic, AtomicSystem executes it to completion.
 * Most "behavior" lives in these two + the data-driven atomic vocabulary, not in bespoke systems.
 */
export const SYSTEM_ORDER: readonly System[] = [
  commandSystem,
  timeSystem,
  terrainSystem,
  needsSystem,
  progressionSystem,
  aiSystem,
  jobSystem,
  pathfindingSystem,
  movementSystem,
  atomicSystem,
  productionSystem,
  transportSystem,
  constructionSystem,
  combatSystem,
  reproductionSystem,
  cleanupSystem,
];
