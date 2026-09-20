import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position', 'movement');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity', 'movement');

/**
 * A herd membership: the {@link Entity} leading the pack this animal belongs to, stamped on every member of
 * a herd whose `animaltypes.ini` record sets `searchforleader`. The herd's lowest-id member is the leader
 * and points at itself, so a self-referential `HerdMember` marks a leader without a second flag.
 */
export const HerdMember = defineComponent<{ leader: Entity }>('HerdMember', 'movement');

/**
 * An animal's territory anchor: the node the grazing drive leashes its roaming to. Only a creature
 * `spawnAnimalHerd` placed on a map carries one, so it doubles as the roaming-wildlife marker.
 */
export const StayPoint = defineComponent<{ cell: NodeId }>('StayPoint', 'movement');

/**
 * How far this entity advances toward its current {@link PathFollow} waypoint each tick, in fixed-point
 * tile units. Only a creature carries one: `spawnAnimalHerd` stamps it from the `animaltypes.ini`
 * `movespeed` param, where a creature with `movespeed` N walks `ONE / N` tile/tick, so a larger
 * `movespeed` is a slower step. It is the entity's one pace: no run/sprint gait is modelled, and the
 * `animaltypes.ini` `runspeed` param stays extracted but unconsumed. A walker without one is a human and
 * is paced per step by `walkStepTicks`.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed }>('MoveSpeed', 'movement');

/** One stop of a route: a fixed-point position and the lattice node the walker stands on there, whose
 *  roughness paces and shoes the step that leaves it. A diagonal lattice edge carries its midpoint as a
 *  stop of its own, the original's intermediate node on that edge. */
export interface Waypoint {
  x: Fixed;
  y: Fixed;
  node: NodeId;
}

/**
 * A path the entity is following: its stops and the index of the one it walks toward. `legTicks` counts
 * the ticks spent on the current leg and `legCost` the ticks it takes, fixed when the leg starts and 0
 * until then, so the walker reaches each stop after exactly its step cost like the original's per-step
 * accumulator. A creature paced by {@link MoveSpeed} leaves both at 0 and walks its constant pace.
 */
export const PathFollow = defineComponent<{
  waypoints: Waypoint[];
  index: number;
  legTicks: number;
  legCost: number;
}>('PathFollow', 'movement');

/**
 * A navigation goal: the destination cell an entity wants to reach, kept separate from the transient
 * {@link PathRequest}/{@link PathFollow} so a re-issued request does not forget it, and removed on arrival.
 *
 * One sanctioned outside write: for a collider whose goal node is occupied by a standing unit, routing
 * re-aims `cell` at the nearest free stand-in, so its owner must not assume the exact cell it set survives
 * the walk. A non-collider's goal is never re-aimed - the economy's node-coincidence checks rely on it
 * arriving verbatim.
 */
export const MoveGoal = defineComponent<{ cell: NodeId }>('MoveGoal', 'movement');

/**
 * A pending navigation request, drained under a per-tick budget: it either replaces the entity's
 * {@link PathFollow} and is removed, or sets `failed` so the planner reacts instead of retrying the same
 * dead query every tick. `start`/`goal` are branded row-major node ids (`y*width + x`); the brand is
 * compile-time only, so the component stays plain-number serializable.
 */
export const PathRequest = defineComponent<{ start: NodeId; goal: NodeId; failed: boolean }>(
  'PathRequest',
  'movement',
);

/**
 * A stranded walker's retry pacing: its route failed and no drive with its own failure protocol owns it, so
 * the planner parks the dead nav state until tick `retryAt`, then sheds it and re-plans. Cleared with the
 * rest of the nav state, so an authoritative cancel restarts the walk at once.
 */
export const Stranded = defineComponent<{ retryAt: number }>('Stranded', 'movement');

/**
 * A settler standing lost: an ordered walk, a chase or its work found no way within its signpost reach.
 * Lifted once a drive or an obeyed order gives the settler something to do. `cutOff` says the idle tail
 * found no door of its seat in reach; that tail lifts the marker once a door is back in reach.
 */
export const LostWay = defineComponent<{ cutOff: boolean }>('LostWay', 'movement');

/** One remembered route failure: the goal node, and the tick it stops being excluded. */
export interface UnreachableGoal {
  readonly cell: NodeId;
  readonly until: number;
}

/**
 * The goals this settler's routes recently failed to reach, so a re-plan does not keep choosing the same
 * unreachable target the deterministic nearest-first pick would otherwise return. A bounded FIFO rather
 * than one cell, so a settler ringed by several walled-off targets cannot cycle between them; provably
 * sealed goals are the route-region memo's job.
 */
export const UnreachableGoals = defineComponent<{ entries: readonly UnreachableGoal[] }>(
  'UnreachableGoals',
  'movement',
);

/**
 * A walker's grind-window among unit bodies: blockage is judged by progress, not push direction. `x`/`y`
 * anchor the window where the walker stood when it began and `ticks` counts its length; movement past a
 * progress floor restarts it. A window reaching the re-route threshold drops just the path so the planner
 * flanks the blockers, and `reroutes` tallies that; after `OBSTRUCTED_MAX_REROUTES` the walk stands down
 * entirely, leaving whoever owns the goal to re-decide.
 */
export const Obstructed = defineComponent<{ ticks: number; reroutes: number; x: Fixed; y: Fixed }>(
  'Obstructed',
  'movement',
);
