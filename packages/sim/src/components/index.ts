import type { AtomicEffect } from '../commands.js';
import { defineComponent } from '../ecs/world.js';
import type { Fixed } from '../fixed.js';

/**
 * Components are PLAIN DATA only. Positions/velocities are fixed-point (see fixed.ts) — never floats.
 * This set covers the Phase-2 vertical slice and the atomic-action model; grow it as systems land.
 */

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

/**
 * A settler: an autonomous individual. In Cultures, settlers don't "do jobs" as monolithic logic —
 * they execute ATOMIC actions (see CurrentAtomic) chosen by a planner. `jobType` constrains which
 * atomics are allowed (jobtypes.allowatomic); `experience` keyed by specialization gates progression.
 */
export const Settler = defineComponent<{
  tribe: number;
  jobType: number | null;
  /** 0..ONE hunger; rises over time, NeedsSystem drives eating. */
  hunger: Fixed;
  /**
   * 0..ONE fatigue/tiredness; rises over time like {@link hunger}, the second need the NeedsSystem
   * tracks. The original satisfies it with the `sleep` atomic (id 8, bound for every job/tribe in
   * `tribetypes` `setatomic <job> 8 "..._sleep"`); the rise/reset loop mirrors hunger's. The rest
   * *drive* (a settler heading off to sleep when fatigue crosses a threshold) is a later slice — this
   * field + its rise is the fatigue-rise half (the same split hunger went through).
   */
  fatigue: Fixed;
  /**
   * 0..ONE piety — the first **target-bound** non-food need (a settler must walk to a SITE to satisfy
   * it, unlike eat at a store or sleep in place). Rises over time like {@link hunger}/{@link fatigue};
   * the original satisfies it with the `pray` atomic (id 12, bound for the civilist job in
   * `tribetypes` `setatomic 6 12 "..._pray"`) run **at a temple** — the need→satisfier→building-target
   * lookup is the genuinely-new piece the *drive* introduces (a later slice). This field + its rise is
   * the piety-rise half (the same rise-then-drive split hunger and fatigue went through). The other
   * target-bound needs (`enjoy` id 17 / `make_love` id 78) follow the same shape.
   */
  piety: Fixed;
  /** specialization id -> experience points (humanjobexperiencetypes). */
  experience: Map<number, number>;
}>('Settler');

/**
 * The atomic micro-action a settler is currently executing (the unit of behavior in Cultures, e.g.
 * pickup=22, harvest=24, eat=10, attack=81). The planner (AISystem) sets this; the AtomicSystem
 * advances `progress` from 0 to ONE over `duration` ticks, and on completion applies the typed
 * {@link AtomicEffect} (the state mutation), emits an `atomicCompleted` event, and removes the
 * component — the planner sees an entity with no CurrentAtomic as ready for its next atomic.
 *
 * `atomicId` keeps the numeric content cross-reference (fidelity / the join key onto a tribe's
 * `setatomic` animation); `effect` is the typed action the executor applies, so the apply switch is
 * exhaustive and golden traces are human-readable rather than opaque ints. `duration` is the
 * animation length in ticks (`AtomicAnimation.length`, supplied by the planner) — at least 1, so a
 * zero-length animation still completes in exactly one tick. `targetEntity`/`targetTile` are the
 * action's object (the resource to harvest, the store to pile up at).
 *
 * Timing is driven by the INTEGER `elapsed` tick counter, not by accumulating a fixed-point step:
 * `ONE / duration` truncates (e.g. ONE/3), so a fractional step summed `duration` times would never
 * reach ONE and the atomic would hang. Completion is the exact `elapsed >= duration`; `progress`
 * (0..ONE) is a derived display value for render interpolation, never the completion test.
 */
export const CurrentAtomic = defineComponent<{
  atomicId: number;
  /** Whole ticks executed so far; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Derived `elapsed/duration` in 0..ONE — for render interpolation only, not the completion test. */
  progress: Fixed;
  duration: number; // animation length in ticks (>= 1)
  effect: AtomicEffect;
  targetEntity: number | null;
  targetTile: { x: number; y: number } | null;
}>('CurrentAtomic');

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  built: Fixed; // 0..ONE construction progress
  level: number; // houses level up (home level 00..04 -> population capacity)
}>('Building');

/**
 * A goods store attached to a building: goodType -> amount, with per-good capacity from the
 * building type. DETERMINISM: never iterate this Map directly for game decisions — use
 * stockpileEntries() which returns ascending-goodType order. Raw Map iteration is insertion-order
 * (history-dependent) and is a determinism footgun (see CLAUDE.md anti-patterns).
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

/** Canonical (ascending goodType) view of a stockpile. Always use this for game logic. */
export function stockpileEntries(s: { amounts: Map<number, number> }): Array<[number, number]> {
  return [...s.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

/** A settler carrying goods (carriers physically haul; goods never teleport to a global bank). */
export const Carrying = defineComponent<{ goodType: number; amount: number }>('Carrying');

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its
 * `goodType` when a settler runs the good's harvest atomic on its cell; `remaining` is the units
 * left — each completed harvest decrements it (AtomicSystem's harvest effect), so a finite node
 * empties and the planner's `remaining <= 0` gate then skips it. `harvestAtomic` is the
 * numeric atomic id to run (the good's `atomicForHarvesting`), kept so the planner stays data-driven
 * — it picks the atomic from content, never hardcodes one. A node sits on the cell under its
 * {@link Position} (snapped to a cell by `cellAtClamped`).
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
}>('Resource');

/**
 * An in-progress production cycle on a workplace (a {@link Building} whose building type carries a
 * `recipe`). The ProductionSystem consumes the recipe's input goods from the building's own
 * {@link Stockpile} when a cycle starts, advances the integer `elapsed` tick counter, and on the
 * `recipe.ticks`-th tick deposits the output goods (capped at the building type's per-good capacity,
 * with room reserved at start so they always fit). The component exists only while a cycle is
 * running — its absence means the workplace is idle/ready to start the next cycle.
 *
 * Timing is the exact integer compare `elapsed >= duration` (like {@link CurrentAtomic}) — never an
 * accumulated fixed-point step, which would truncate and hang. `duration` mirrors the recipe's
 * `ticks` (snapshotted so a content edit mid-cycle can't change an in-flight cycle's length).
 */
export const Production = defineComponent<{
  /** Whole ticks elapsed in the current cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks one cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
}>('Production');

/** A path the entity is following: fixed-point waypoints + current index. */
export const PathFollow = defineComponent<{ waypoints: Array<{ x: Fixed; y: Fixed }>; index: number }>(
  'PathFollow',
);

/**
 * A navigation goal: the destination cell an entity wants to reach (a raw row-major cell id, like
 * {@link PathRequest}). It is the *intent* layer above pathing — the AISystem (navigation planner)
 * turns a goal on a path-less, request-less entity into a {@link PathRequest} from the entity's
 * current cell; PathfindingSystem turns that into a {@link PathFollow}; MovementSystem walks it.
 * The goal is removed once the entity arrives, so an entity carrying a `MoveGoal` is "still
 * travelling". Kept separate from PathRequest/PathFollow (the transient mechanism) so the planner
 * can re-issue a request if a route is lost without forgetting where the entity was headed.
 */
export const MoveGoal = defineComponent<{ cell: number }>('MoveGoal');

/**
 * A pending navigation request: route this entity from cell `start` to cell `goal`. The
 * PathfindingSystem drains these (budgeted per tick), runs A* on `ctx.terrain`, and on success
 * replaces the entity's {@link PathFollow} with the result then removes the request; on failure
 * (no route / unwalkable endpoint / no terrain) it sets `failed` so the planner can react and
 * stops retrying the same dead query every tick. `start`/`goal` are raw row-major cell ids
 * (`y*width + x`) — plain numbers here so this component stays serializable like every other.
 */
export const PathRequest = defineComponent<{ start: number; goal: number; failed: boolean }>('PathRequest');
