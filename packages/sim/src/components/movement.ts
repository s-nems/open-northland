import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

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
 * is a *slower* step — see the `spawnAnimalHerd` handler and source basis "Animal locomotion pace"),
 * so a cow grazes at its own data-pinned speed instead of the settler default. A creature whose record
 * omits `movespeed` carries no `MoveSpeed` (the engine default applies = the universal pace).
 *
 * This is the entity's ONE pace — there is deliberately no run/sprint gait, OUR design: every unit
 * moves at its constant pace whatever it is doing. No human run speed is readable anywhere; the
 * `animaltypes.ini` `runspeed` param (an animal run gait the original does carry) stays extracted
 * in the IR but unconsumed.
 *
 * The pace is a positive {@link Fixed} (minted only via `fx.*`, so it hashes deterministically), read
 * identically to {@link MOVE_SPEED_PER_TICK} by the same drift-free arrival-snap, so a per-entity pace
 * introduces no rounding divergence — two runs stay byte-identical.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed }>('MoveSpeed');

/**
 * A path the entity is following: fixed-point waypoints + current index, plus the follower's live
 * GAIT state — the movement-inertia fields the MovementSystem ramps each tick. Inertia is a NAMED
 * APPROXIMATION that deliberately departs from the original (which walks at a constant
 * ticks-per-step pace with no acceleration anywhere in OpenVikings or readable data — see the
 * inertia note in `systems/movement/movement.ts`); it exists purely for movement feel.
 *
 * `speed` is the current per-tick world-metric pace: 0 at rest, ramped toward the entity's gait
 * ({@link MoveSpeed} / the universal default), braked into the final waypoint. `hx`/`hy` are the
 * current leg's unit world-metric heading, used to project momentum through corners — at waypoint
 * turns AND at a reroute's splice (`routing.ts` carries both `speed` and heading over and turns
 * them onto the new first leg, so a redirected walker keeps momentum straight ahead but sheds it
 * through a forced turn like any corner); (0,0) is the sentinel "no established heading" (a path
 * that has never moved). All three are Fixed sim state: minted via `fx.*`, hashed like every
 * component.
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
 * {@link PathRequest}). It is the *intent* layer above pathing — the AISystem (navigation planner)
 * turns a goal on a path-less, request-less entity into a {@link PathRequest} from the entity's
 * current cell; PathfindingSystem turns that into a {@link PathFollow}; MovementSystem walks it.
 * The goal is removed once the entity arrives, so an entity carrying a `MoveGoal` is "still
 * travelling". Kept separate from PathRequest/PathFollow (the transient mechanism) so the planner
 * can re-issue a request if a route is lost without forgetting where the entity was headed.
 *
 * One sanctioned outside write: for a COLLIDER whose goal node is occupied by a standing unit,
 * routing re-aims `cell` at the nearest free stand-in (the surround rule — see `drainPathRequests`),
 * so a goal's owner must not assume the exact cell it set survives the walk. A non-collider's goal
 * is never re-aimed — the economy's node-coincidence checks rely on it arriving verbatim.
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
 * A walker's grind-window state among unit bodies — the SeparationSystem stamps it on a
 * path-follower with colliders in its immediate (3×3 bucket) neighbourhood and judges blockage by
 * PROGRESS, not push direction. `x`/`y` anchor the current GRIND WINDOW — the
 * walker's position when it began — and `ticks` counts the window's length: any tick whose total
 * movement since the anchor reaches a per-tick progress floor RESTARTS the window (real progress —
 * a slide around a lone post, a slow shove through a brush-past), while a window that reaches the
 * re-route threshold with the walker still essentially where it started drops just its path — the
 * planner immediately re-plans around the blockers (the flanking behaviour) — and `reroutes`
 * tallies how many times this walk has done that. A walk that re-routes `OBSTRUCTED_MAX_REROUTES`
 * times without ever arriving stands down entirely (`clearNavState`) — the terminal backstop for a
 * fully contested destination (e.g. the last stragglers of a squad converging on one node, whose
 * every stand-in keeps being taken). Whoever owns the goal (the combat chase, a player order, an AI
 * drive) re-decides from where the unit stopped.
 *
 * A separate optional component (the {@link MoveSpeed}/{@link HerdMember} pattern): only a blocked
 * collider carries one, so sims without unit collision (every unowned fixture, the goldens) never
 * hash it. Integer counters + fixed-point anchor — deterministic like every component.
 */
export const Obstructed = defineComponent<{ ticks: number; reroutes: number; x: Fixed; y: Fixed }>(
  'Obstructed',
);
