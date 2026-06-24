import type { ContentSet } from '@vinland/data';
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
  Resource,
  Settler,
  Stockpile,
  Velocity,
} from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import type { EventBuffer } from '../events.js';
import { type Fixed, fx } from '../fixed.js';
import { findPath } from '../pathfinding.js';
import type { Rng } from '../rng.js';
import type { CellId, TerrainGraph } from '../terrain.js';

/**
 * A System is a pure function over the world for one tick. Systems run in a fixed registered
 * order (see SYSTEM_ORDER below and docs/ECS.md). They may read/write components and use ctx.rng,
 * but must not touch wall-clock, Math.random, the DOM, or I/O.
 */
export interface SystemContext {
  readonly content: ContentSet;
  readonly rng: Rng;
  /** Monotonic tick counter. */
  readonly tick: number;
  /** Emit one-shot events for render/audio (never read back in sim logic). */
  readonly events: EventBuffer;
  /**
   * The terrain cell-adjacency graph — the navigation/placement model (see terrain.ts). Optional
   * because trivial fixtures (the determinism golden) run with no map; the pathfinding/terrain
   * systems that need it must check and no-op when it is absent rather than assume it exists.
   */
  readonly terrain?: TerrainGraph;
}

export type System = (world: World, ctx: SystemContext) => void;

/**
 * How far an entity following a {@link PathFollow} advances per tick, in fixed-point tile units.
 * Cell-centre waypoints are one tile apart, so at this speed an entity reaches the next waypoint in
 * four ticks (a deliberate, tunable settler pace). A divisor of ONE keeps each step landing exactly
 * on integer fractions — no accumulated rounding drift — so two runs stay byte-identical.
 */
export const MOVE_SPEED_PER_TICK: Fixed = fx.div(fx.fromInt(1), fx.fromInt(4));

/**
 * MovementSystem — advances entity positions one tick.
 *
 * Two movement modes, in this precedence:
 *  1. {@link PathFollow}: step toward the current waypoint's cell centre by {@link MOVE_SPEED_PER_TICK},
 *     per-axis clamped so we never overshoot. On reaching the waypoint, advance `index`; when the
 *     last waypoint is reached the path is complete and {@link PathFollow} is removed (the planner
 *     sees an entity with no path as idle/arrived). A path-following entity ignores any Velocity.
 *  2. {@link Velocity} (no PathFollow): the original constant-velocity integration — kept for the
 *     determinism golden and any free-moving entity that isn't path-driven.
 *
 * Fixed-point only; per-axis clamp-toward means no floats, no sqrt/normalisation, no overshoot —
 * the step is a pure function of position + waypoint, so identical inputs yield identical state.
 */
export const movementSystem: System = (world) => {
  // Entities the path pass moved this tick. A path can complete (PathFollow removed) within the
  // pass, so membership can't be re-derived in pass 2 by checking has(PathFollow); record it here.
  // Used only as a skip filter — never iterated for a decision — so it stays determinism-safe.
  const pathHandled = new Set<Entity>();

  // Path followers first — deterministic insertion-order iteration of the PathFollow store, and a
  // path-driven entity's Velocity (if any) is ignored so it never moves twice in a tick.
  for (const e of world.query(Position, PathFollow)) {
    pathHandled.add(e);
    const pf = world.get(e, PathFollow);
    const target = pf.waypoints[pf.index];
    if (target === undefined) {
      // Empty/exhausted path — nothing to follow; drop it so the entity reads as arrived.
      world.remove(e, PathFollow);
      continue;
    }

    const p = world.get(e, Position);
    p.x = stepToward(p.x, target.x);
    p.y = stepToward(p.y, target.y);

    if (p.x === target.x && p.y === target.y) {
      // Arrived at this waypoint; advance to the next, or finish the path.
      if (pf.index + 1 >= pf.waypoints.length) {
        world.remove(e, PathFollow); // path complete
      } else {
        pf.index += 1;
      }
    }
  }

  // Free constant-velocity movers (entities the path pass did not handle this tick). Checking the
  // recorded set (not has(PathFollow)) means an entity whose path just completed isn't ALSO velocity-
  // integrated in the same tick — the "path overrides Velocity" contract holds on the arrival tick too.
  for (const e of world.query(Position, Velocity)) {
    if (pathHandled.has(e)) continue; // path-driven this tick: already moved above
    const p = world.get(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
};

/**
 * Move `from` toward `target` by at most {@link MOVE_SPEED_PER_TICK}, clamping so the result never
 * passes `target`. Returns `target` exactly once within one step of it — the equality the caller
 * uses to detect arrival. Pure fixed-point: no division of the delta, so no rounding drift.
 */
function stepToward(from: Fixed, target: Fixed): Fixed {
  const delta = fx.sub(target, from);
  if (delta === 0) return target;
  const dist = fx.abs(delta);
  if (dist <= MOVE_SPEED_PER_TICK) return target; // within one step — snap to the target
  return delta > 0 ? fx.add(from, MOVE_SPEED_PER_TICK) : fx.sub(from, MOVE_SPEED_PER_TICK);
}

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
    if (node === null) continue; // nothing to harvest — idle this tick
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
  }
}

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
      addCarry(world, settler, effect.goodType, effect.amount);
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

/* ----------------------------------------------------------------------------------------------
 * The remaining systems are stubs to be implemented per docs/ROADMAP.md. They are listed here so
 * the execution order and intent are explicit and version-controlled. Each maps onto original
 * content types (goodtypes/jobtypes/housetypes/weapontypes/animaltypes/vehicletypes/tribetypes).
 * -------------------------------------------------------------------------------------------- */
const todo =
  (name: string): System =>
  () => {
    /* not yet implemented — see docs/ROADMAP.md */
    void name;
  };

export const commandSystem: System = todo('CommandSystem'); // apply queued serializable player commands
export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility (cell graph)
export const needsSystem: System = todo('NeedsSystem'); // hunger/health + the food/goods chain
export const progressionSystem: System = todo('ProgressionSystem'); // experience + tech graph (needfor*/allow*/jobEnables*) gates jobs/goods/houses/vehicles
// aiSystem is a REAL system now (above) — the settler planner: the atomic-utility planner picks the
// next atomic (harvest→carry→pileup) for each idle settler, and the navigation planner turns the
// resulting MoveGoal into a PathRequest. atomicSystem (above) advances CurrentAtomic and applies its
// effect on completion. Behavior lives in these two + the data atomic vocabulary, not bespoke systems.
export const jobSystem: System = todo('JobSystem'); // match idle settlers to open jobs/workplaces
// pathfindingSystem is a REAL system now (above) — A* on the cell graph, budgeted/tick.
export const productionSystem: System = todo('ProductionSystem'); // recipes (goodtypes.productionInputGoods): inputs -> outputs, enforce stock capacity
export const transportSystem: System = todo('TransportSystem'); // carriers physically haul goods between stores (no global bank)
export const constructionSystem: System = todo('ConstructionSystem'); // deliver materials, advance build, level houses
export const combatSystem: System = todo('CombatSystem'); // N-tribe combat from weapontypes/armortypes (large subsystem)
export const reproductionSystem: System = todo('ReproductionSystem'); // families/children, gated by house level capacity
export const cleanupSystem: System = todo('CleanupSystem'); // destroy dead entities (ids are NOT recycled), emit events for render/audio

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
