import type { Fixed } from '../core/fixed.js';
import { type Entity, defineComponent } from '../ecs/world.js';

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

/**
 * A herd membership: the {@link Entity} that leads the pack this animal belongs to. The animal-spawn
 * mechanic (the `spawnAnimalHerd` command) adds it to every member of a herd whose `animaltypes.ini`
 * record sets `searchforleader` — a leader is designated (the herd's lowest-id member, which points
 * `leader` at **itself**) and each follower points `leader` at it. A **solitary** animal (a record
 * with `searchforleader` false) carries **no** `HerdMember` at all: it has no leader to follow.
 *
 * This is the data foundation the **follow-the-leader** movement drive consumes (`herdingSystem`: a
 * strayed follower walks back within `maximumLeaderDistance` of its leader — the spawn slice records
 * the relation, the herding slice reads it). Like
 * {@link JobAssignment}/{@link Age}/{@link Health} it is a **separate optional component**: only a
 * herding animal carries one, so a civilization settler / the golden slice has none and the hash is
 * untouched. `leader` is an {@link Entity} id (a monotonic integer), so it hashes deterministically
 * like every other component. A leader carrying a self-referential `HerdMember` is intentional — it
 * marks "this is a herd leader" without a second flag component, and a follower can read its leader's
 * membership uniformly. Determinism: set once at spawn from a canonical (lowest-id) leader pick, no
 * RNG/wall-clock.
 */
export const HerdMember = defineComponent<{ leader: Entity }>('HerdMember');

/**
 * A per-entity **locomotion pace** override: how far this entity advances toward its current
 * {@link PathFollow} waypoint each tick, in fixed-point tile units. The MovementSystem reads `perTick`
 * (the **walking** gait) for a path-follower that carries one; an entity **without** it walks at the
 * universal settler pace ({@link MOVE_SPEED_PER_TICK}), so the golden/vertical-slice (no entity stamps a
 * `MoveSpeed`) is untouched — the separate-optional-component pattern of
 * {@link HerdMember}/{@link Age}/{@link Health}.
 *
 * The animal-spawn mechanic stamps it on each herd creature from the `animaltypes.ini` `movespeed`
 * param: a creature with an explicit `movespeed` of `N` walks `ONE / N` tile/tick (a larger `movespeed`
 * is a *slower* step — see the `spawnAnimalHerd` handler and docs/FIDELITY.md "Animal locomotion pace"),
 * so a cow grazes at its own data-pinned speed instead of the settler default. A creature whose record
 * omits `movespeed` carries no `MoveSpeed` (the engine default applies = the universal pace).
 *
 * `runPerTick` is the animal's **running** gait (the `runspeed` param) — the *faster* pace a fleeing or
 * charging creature moves at (a smaller `runspeed` than `movespeed` = `ONE/runspeed` > `ONE/walk`, the
 * faster step under the same step-period reading). It is **recorded on the entity but not yet consumed**:
 * the flee/charge DRIVE that switches to it (when an animal runs vs walks) is undocumented "soul"
 * behaviour with no oracle, deferred (docs/FIDELITY.md "Animal locomotion pace"); landing the param on the
 * entity now — the same "data-on-the-entity before its consumer" discipline as `Armor`/`cargoGoods` —
 * means that drive becomes a pure read switch, not a re-extraction. `null` when the record omits
 * `runspeed` (only the walk pace is known). The MovementSystem reads only `perTick`, so this field is
 * inert today.
 *
 * Both paces are positive {@link Fixed}s (minted only via `fx.*`, so they hash deterministically). The
 * walk pace is read identically to {@link MOVE_SPEED_PER_TICK} by the same drift-free arrival-snap, so a
 * per-entity pace introduces no rounding divergence — two runs stay byte-identical.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed; runPerTick: Fixed | null }>('MoveSpeed');

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
