import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

/**
 * A herd membership: the {@link Entity} leading the pack this animal belongs to. Stamped on every member of
 * a herd whose `animaltypes.ini` record sets `searchforleader`; the herd's lowest-id member is the leader
 * and points at itself, so a self-referential `HerdMember` marks a leader without a second flag. A solitary
 * animal carries none.
 */
export const HerdMember = defineComponent<{ leader: Entity }>('HerdMember');

/**
 * An animal's territory anchor: the node the grazing drive leashes its roaming to. Only a creature
 * `spawnAnimalHerd` placed on a map carries one, so it doubles as the roaming-wildlife marker.
 */
export const StayPoint = defineComponent<{ cell: NodeId }>('StayPoint');

/**
 * A per-entity locomotion pace: how far this entity advances toward its current {@link PathFollow} waypoint
 * each tick, in fixed-point tile units. An entity without one walks at the universal settler pace
 * (`MOVE_SPEED_PER_TICK`). `spawnAnimalHerd` stamps it from the `animaltypes.ini` `movespeed` param,
 * where a creature with `movespeed` N walks `ONE / N` tile/tick, so a larger `movespeed` is a slower step.
 *
 * The entity's one pace: there is deliberately no run/sprint gait, and the `animaltypes.ini` `runspeed`
 * param stays extracted but unconsumed.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed }>('MoveSpeed');

/**
 * A path the entity is following: fixed-point waypoints and index, plus the follower's live gait state.
 * `speed` is the current per-tick world-metric pace - 0 at rest, ramped toward the entity's gait, braked
 * into the final waypoint. `hx`/`hy` are the current leg's unit world-metric heading, used to project
 * momentum through corners and across a reroute's splice; (0,0) is the "no established heading" sentinel.
 *
 * Approximation: the inertia ramp departs from the original's observed constant pace and exists purely for
 * movement feel.
 */
export const PathFollow = defineComponent<{
  waypoints: Array<{ x: Fixed; y: Fixed }>;
  index: number;
  speed: Fixed;
  hx: Fixed;
  hy: Fixed;
}>('PathFollow');

/**
 * A navigation goal: the destination cell an entity wants to reach. Kept separate from the transient
 * {@link PathRequest}/{@link PathFollow} so the planner can re-issue a request without forgetting the
 * destination, and removed once the entity arrives.
 *
 * One sanctioned outside write: for a collider whose goal node is occupied by a standing unit, routing
 * re-aims `cell` at the nearest free stand-in, so a goal's owner must not assume the exact cell it set
 * survives the walk. A non-collider's goal is never re-aimed - the economy's node-coincidence checks rely
 * on it arriving verbatim.
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
 * the planner parks the dead nav state until tick `retryAt`, then sheds it and re-plans. Without it a
 * failed request reads as "travelling" forever and the settler freezes. Cleared with the rest of the nav
 * state, so an authoritative cancel restarts the walk at once.
 */
export const Stranded = defineComponent<{ retryAt: number }>('Stranded');

/** One remembered route failure: the goal node, and the tick it stops being excluded. */
export interface UnreachableGoal {
  readonly cell: NodeId;
  readonly until: number;
}

/**
 * The goals this settler's routes recently failed to reach, so a re-plan does not choose the same
 * unreachable target the deterministic nearest-first pick would otherwise return every retry. A bounded
 * FIFO rather than one cell, so a settler ringed by several walled-off targets cannot cycle between them.
 * Provably sealed goals are the route-region memo's job; this covers what that one cannot prove.
 */
export const UnreachableGoals = defineComponent<{ entries: readonly UnreachableGoal[] }>('UnreachableGoals');

/**
 * A walker's grind-window among unit bodies: blockage is judged by progress, not push direction. `x`/`y`
 * anchor the window at the walker's position when it began and `ticks` counts its length; movement past a
 * progress floor restarts it. A window reaching the re-route threshold drops just the path, so the planner
 * flanks the blockers, and `reroutes` tallies that. A walk that re-routes `OBSTRUCTED_MAX_REROUTES` times
 * without arriving stands down entirely, leaving whoever owns the goal to re-decide.
 */
export const Obstructed = defineComponent<{ ticks: number; reroutes: number; x: Fixed; y: Fixed }>(
  'Obstructed',
);
