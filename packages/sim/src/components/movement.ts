import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

/**
 * A herd membership: the {@link Entity} that leads the pack this animal belongs to. The `spawnAnimalHerd`
 * command adds it to every member of a herd whose `animaltypes.ini` record sets `searchforleader` — the
 * herd's lowest-id member is the leader (its `leader` points at itself) and each follower points `leader` at
 * it. A solitary animal (`searchforleader` false) carries none.
 *
 * The data the follow-the-leader drive consumes (`herdingSystem`: a strayed follower walks back within
 * `maximumLeaderDistance` of its leader). A separate optional component (the {@link JobAssignment}/{@link Age}
 * pattern): only a herding animal carries one. A leader's self-referential `HerdMember` marks "this is a herd
 * leader" without a second flag, and a follower reads its leader's membership uniformly.
 */
export const HerdMember = defineComponent<{ leader: Entity }>('HerdMember');

/**
 * A per-entity locomotion pace override: how far this entity advances toward its current {@link PathFollow}
 * waypoint each tick, in fixed-point tile units. The MovementSystem reads `perTick` for a path-follower that
 * carries one; an entity without it walks at the universal settler pace ({@link MOVE_SPEED_PER_TICK}).
 *
 * The `spawnAnimalHerd` mechanic stamps it from the `animaltypes.ini` `movespeed` param: a creature with
 * `movespeed` of `N` walks `ONE / N` tile/tick (a larger `movespeed` is a slower step — see source basis
 * "Animal locomotion pace"). A creature whose record omits `movespeed` carries none (engine default = the
 * universal pace).
 *
 * The entity's one pace — there is deliberately no run/sprint gait (our design); the `animaltypes.ini`
 * `runspeed` param stays extracted but unconsumed. Read by the same drift-free arrival-snap as
 * {@link MOVE_SPEED_PER_TICK}, so it introduces no rounding divergence.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed }>('MoveSpeed');

/**
 * A path the entity is following: fixed-point waypoints + current index, plus the follower's live gait state
 * — the movement-inertia fields the MovementSystem ramps each tick. Inertia is a named approximation that
 * departs from the original's observed constant pace (see the inertia note in
 * `systems/movement/movement.ts`); it exists purely
 * for movement feel.
 *
 * `speed` is the current per-tick world-metric pace: 0 at rest, ramped toward the entity's gait
 * ({@link MoveSpeed} / the universal default), braked into the final waypoint. `hx`/`hy` are the current leg's
 * unit world-metric heading, used to project momentum through corners — at waypoint turns and at a reroute's
 * splice (`routing.ts` carries both over, so a redirected walker keeps momentum straight ahead but sheds it
 * through a forced turn); (0,0) is the "no established heading" sentinel. All three are Fixed sim state.
 */
export const PathFollow = defineComponent<{
  waypoints: Array<{ x: Fixed; y: Fixed }>;
  index: number;
  speed: Fixed;
  hx: Fixed;
  hy: Fixed;
}>('PathFollow');

/**
 * A navigation goal: the destination cell an entity wants to reach (a raw row-major cell id, like
 * {@link PathRequest}). The intent layer above pathing — the AISystem turns a goal on a path-less,
 * request-less entity into a {@link PathRequest}; PathfindingSystem turns that into a {@link PathFollow};
 * MovementSystem walks it. Removed once the entity arrives, so an entity carrying a `MoveGoal` is still
 * travelling. Kept separate from PathRequest/PathFollow (the transient mechanism) so the planner can re-issue
 * a request if a route is lost without forgetting the destination.
 *
 * One sanctioned outside write: for a collider whose goal node is occupied by a standing unit, routing
 * re-aims `cell` at the nearest free stand-in (the surround rule — see `drainPathRequests`), so a goal's
 * owner must not assume the exact cell it set survives the walk. A non-collider's goal is never re-aimed —
 * the economy's node-coincidence checks rely on it arriving verbatim.
 */
export const MoveGoal = defineComponent<{ cell: NodeId }>('MoveGoal');

/**
 * A pending navigation request: route this entity from cell `start` to cell `goal`. The
 * PathfindingSystem drains these (budgeted per tick), runs A* on `ctx.terrain`, and on success
 * replaces the entity's {@link PathFollow} with the result then removes the request; on failure
 * (no route / unwalkable endpoint / no terrain) it sets `failed` so the planner can react and
 * stops retrying the same dead query every tick. `start`/`goal` are branded row-major node ids
 * (`y*width + x`); the brand is compile-time only, so the component remains plain-number serializable.
 */
export const PathRequest = defineComponent<{ start: NodeId; goal: NodeId; failed: boolean }>('PathRequest');

/**
 * A walker's grind-window state among unit bodies — the SeparationSystem stamps it on a path-follower with
 * colliders in its immediate (3×3 bucket) neighbourhood and judges blockage by progress, not push direction.
 * `x`/`y` anchor the current grind window — the walker's position when it began — and `ticks` counts the
 * window's length: any tick whose total movement since the anchor reaches a per-tick progress floor restarts
 * the window (real progress — a slide around a lone post, a shove through a brush-past), while a window that
 * reaches the re-route threshold with the walker still essentially where it started drops just its path (the
 * planner re-plans around the blockers — the flanking behaviour), and `reroutes` tallies how many times this
 * walk has done that. A walk that re-routes `OBSTRUCTED_MAX_REROUTES` times without arriving stands down
 * entirely (`clearNavState`) — the terminal backstop for a fully contested destination. Whoever owns the goal
 * (the combat chase, a player order, an AI drive) re-decides from where the unit stopped.
 *
 * A separate optional component (the {@link MoveSpeed}/{@link HerdMember} pattern): only a blocked collider
 * carries one, so sims without unit collision (every unowned fixture, the goldens) never hash it.
 */
export const Obstructed = defineComponent<{ ticks: number; reroutes: number; x: Fixed; y: Fixed }>(
  'Obstructed',
);
