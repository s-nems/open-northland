import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

/**
 * A herd membership: the {@link Entity} leading the pack this animal belongs to, stamped on every member of
 * a herd whose `animaltypes.ini` record sets `searchforleader`. The herd's lowest-id member is the leader
 * and points at itself, so a self-referential `HerdMember` marks a leader without a second flag.
 */
export const HerdMember = defineComponent<{ leader: Entity }>('HerdMember');

/**
 * An animal's territory anchor: the node the grazing drive leashes its roaming to. Only a creature
 * `spawnAnimalHerd` placed on a map carries one, so it doubles as the roaming-wildlife marker.
 */
export const StayPoint = defineComponent<{ cell: NodeId }>('StayPoint');

/**
 * How far this entity advances toward its current {@link PathFollow} waypoint each tick, in fixed-point
 * tile units; an entity without one walks at the universal settler pace (`MOVE_SPEED_PER_TICK`).
 * `spawnAnimalHerd` stamps it from the `animaltypes.ini` `movespeed` param, where a creature with
 * `movespeed` N walks `ONE / N` tile/tick, so a larger `movespeed` is a slower step. It is the entity's one
 * pace: no run/sprint gait is modelled, and the `animaltypes.ini` `runspeed` param stays extracted but
 * unconsumed.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed }>('MoveSpeed');

/**
 * A path the entity is following: fixed-point waypoints and index, plus the follower's live gait state.
 * `speed` is the current per-tick world-metric pace - 0 at rest, ramped toward the entity's gait, braked
 * into the final waypoint. `hx`/`hy` are the current leg's unit world-metric heading, carrying momentum
 * through corners and across a reroute's splice; (0,0) means no established heading.
 *
 * Approximation: the inertia ramp departs from the original's observed constant pace, for movement feel.
 */
export const PathFollow = defineComponent<{
  waypoints: Array<{ x: Fixed; y: Fixed }>;
  index: number;
  speed: Fixed;
  hx: Fixed;
  hy: Fixed;
}>('PathFollow');

/**
 * A navigation goal: the destination cell an entity wants to reach, kept separate from the transient
 * {@link PathRequest}/{@link PathFollow} so a re-issued request does not forget it, and removed on arrival.
 *
 * One sanctioned outside write: for a collider whose goal node is occupied by a standing unit, routing
 * re-aims `cell` at the nearest free stand-in, so its owner must not assume the exact cell it set survives
 * the walk. A non-collider's goal is never re-aimed - the economy's node-coincidence checks rely on it
 * arriving verbatim.
 */
export const MoveGoal = defineComponent<{ cell: NodeId }>('MoveGoal');

/**
 * A pending navigation request, drained under a per-tick budget: it either replaces the entity's
 * {@link PathFollow} and is removed, or sets `failed` so the planner reacts instead of retrying the same
 * dead query every tick. `start`/`goal` are branded row-major node ids (`y*width + x`); the brand is
 * compile-time only, so the component stays plain-number serializable.
 */
export const PathRequest = defineComponent<{ start: NodeId; goal: NodeId; failed: boolean }>('PathRequest');

/**
 * A stranded walker's retry pacing: its route failed and no drive with its own failure protocol owns it, so
 * the planner parks the dead nav state until tick `retryAt`, then sheds it and re-plans. Cleared with the
 * rest of the nav state, so an authoritative cancel restarts the walk at once.
 */
export const Stranded = defineComponent<{ retryAt: number }>('Stranded');

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
export const UnreachableGoals = defineComponent<{ entries: readonly UnreachableGoal[] }>('UnreachableGoals');

/**
 * A walker's grind-window among unit bodies: blockage is judged by progress, not push direction. `x`/`y`
 * anchor the window where the walker stood when it began and `ticks` counts its length; movement past a
 * progress floor restarts it. A window reaching the re-route threshold drops just the path so the planner
 * flanks the blockers, and `reroutes` tallies that; after `OBSTRUCTED_MAX_REROUTES` the walk stands down
 * entirely, leaving whoever owns the goal to re-decide.
 */
export const Obstructed = defineComponent<{ ticks: number; reroutes: number; x: Fixed; y: Fixed }>(
  'Obstructed',
);
