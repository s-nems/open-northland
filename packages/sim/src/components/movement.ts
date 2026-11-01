import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity, type World } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/** World position in fixed-point tile units. */
export const Position = defineComponent<PositionState>('Position', 'movement');

export interface PositionState {
  x: Fixed;
  y: Fixed;
}

/** A {@link Position} record in the `{ x, y }` literal shape the live code writes. */
export function positionRecord(position: Readonly<PositionState>): PositionState {
  return { x: position.x, y: position.y };
}

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
 * A free-roaming animal's range and appetite, the state the original keeps beside its {@link StayPoint}.
 * Only a map-spawned or wild-born animal carries one; a claim drops it.
 */
export const WildHabitat = defineComponent<{
  /** The point the animal's range is measured from; a wild herd's drifts away from foreign buildings. */
  birth: NodeId;
  /** The point a leader's next graze leg starts from; it creeps one map point at a time over grass. */
  workCenter: NodeId;
  /** The tick its hunger runs out: hunger falls one per tick and a meal adds to it. */
  fedUntil: number;
  /** A leader's grazing left around its stay point; the herd's meals use it up. */
  food: number;
  /** The tick of its next stay decision, the end of the idle or meal clip it plays. */
  nextStayAt: number;
  /** The node a leader's graze leg aims at, until it decides again. */
  nextPoint?: NodeId | undefined;
}>('WildHabitat', 'movement', { simOnly: true });

/** Original behavior: the bits of a map's `setanimal` flags word an animal honours. */
export const ANIMAL_FLAG = {
  /** Its work center never moves. */
  FIXED_WORK_CENTER: 1,
  /** It never breeds. */
  NEVER_BREEDS: 2,
  /** Its stay range is 5 map points, whatever its species' `maximumdistancetostaypoint`. */
  NARROW_STAY_RANGE: 4,
  /** A blow takes none of its hitpoints; everything else about the blow still happens. */
  TAKES_NO_DAMAGE: 8,
} as const;
export type AnimalFlag = (typeof ANIMAL_FLAG)[keyof typeof ANIMAL_FLAG];

/** An animal's nonzero `setanimal` flags word, kept whole and passed on to the young it bears. It
 *  outlives a claim, since the bits belong to the animal rather than to its wild range. */
export const AnimalFlags = defineComponent<{ bits: number }>('AnimalFlags', 'movement');

export function hasAnimalFlag(world: World, e: Entity, flag: AnimalFlag): boolean {
  return ((world.tryGet(e, AnimalFlags)?.bits ?? 0) & flag) !== 0;
}

/**
 * How far this entity advances toward its current {@link PathFollow} waypoint each tick, in fixed-point
 * tile units. An explicitly paced mover may carry one. A walker without one uses its own step timing.
 */
export const MoveSpeed = defineComponent<{ perTick: Fixed }>('MoveSpeed', 'movement');

/** Ticks to cross one route waypoint step. Animals read `animaltypes.ini` `movespeed` here; each
 * lattice step gets its own duration regardless of its screen-space length. */
export const MoveStepPeriod = defineComponent<{ ticks: number }>('MoveStepPeriod', 'movement');

/** A moving animal using its `animaltypes.ini` `runspeed` gait. */
export const AnimalRunning = defineComponent<Record<string, never>>('AnimalRunning', 'movement');

/** The original's walk direction vocabulary, with its numbering. */
export const WALK_DIRECTION = { E: 0, SE: 1, SW: 2, W: 3, NW: 4, NE: 5, N: 6, S: 7 } as const;
export type WalkDirection = (typeof WALK_DIRECTION)[keyof typeof WALK_DIRECTION];

/** Retained between routes; turning is simulation state, not a render interpolation. */
export const WalkFacing = defineComponent<{ direction: WalkDirection; target: WalkDirection }>(
  'WalkFacing',
  'movement',
);

/** One stop of a route: a fixed-point position and the lattice node the walker stands on there, whose
 *  roughness paces and shoes the step that leaves it. */
export interface Waypoint {
  x: Fixed;
  y: Fixed;
  node: NodeId;
}

/**
 * A walker's progress along its {@link PathRoute}: the index of the stop it walks toward. `legStartedAt` anchors
 * its executed movement ticks; while turning or awaiting its first step, `legElapsed` holds them.
 * `legCost` is its movement cost,
 * fixed when the leg starts and 0 until then. A {@link MoveStepPeriod} follower uses the same counters;
 * a {@link MoveSpeed} follower leaves them at 0 and walks its constant distance per tick. `legPace`
 * captures the full-step pace when a route starts between nodes. `departureCharged` follows an active
 * human step across route changes so equipment and food are charged once per node departure.
 * `bootsDegree` is the worn boots' degree of use as this walk's steps wore them, ahead of
 * `Equipment.boots` until the walk ends, so a step leaves the equipment record unwritten.
 */
export const PathFollow = defineComponent<PathFollowState>('PathFollow', 'movement');

export interface PathFollowState {
  index: number;
  legStartedAt?: number | undefined;
  legElapsed: number;
  legCost: number;
  legPace?: Fixed | undefined;
  departureCharged?: true | undefined;
  bootsDegree?: Fixed | undefined;
}

/** Every {@link PathFollowState} key required, an optional one present as undefined, so a key added to the
 *  state cannot be left out of {@link pathFollowRecord}. */
type CompletePathFollow = { [K in keyof PathFollowState]-?: PathFollowState[K] };

/** A {@link PathFollow} record with every key present in one order, so routed and restored walkers share
 *  one hidden class and the movement pass's reads stay monomorphic. An undefined key hashes and saves as
 *  absent, so the shape is invisible to state. */
export function pathFollowRecord(follow: Readonly<PathFollowState>): PathFollowState {
  const record: CompletePathFollow = {
    index: follow.index,
    legStartedAt: follow.legStartedAt,
    legElapsed: follow.legElapsed,
    legCost: follow.legCost,
    legPace: follow.legPace,
    departureCharged: follow.departureCharged,
    bootsDegree: follow.bootsDegree,
  };
  return record;
}

/** Executed movement ticks, excluding any pending or held turn ticks. */
export function pathLegTicks(
  follow: { readonly legStartedAt?: number | undefined; readonly legElapsed: number },
  tick: number,
): number {
  return follow.legStartedAt === undefined ? follow.legElapsed : tick - follow.legStartedAt;
}

/**
 * The stops of the route a {@link PathFollow} walks, present exactly while it is. Written only when a
 * route is delivered, so a step along it does not re-fold the stops into the sync digest.
 */
export const PathRoute = defineComponent<{ waypoints: readonly Waypoint[] }>('PathRoute', 'movement');

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
 * {@link PathFollow} and is removed, is removed with the live route kept when it is a `grind` ask that
 * found that route or whose walker moved on, or sets `failed` so the planner reacts instead of retrying
 * the same dead query every tick. `start`/`goal` are branded row-major node ids (`y*width + x`); the brand is
 * compile-time only, so the component stays plain-number serializable.
 */
export const PathRequest = defineComponent<{
  start: NodeId;
  goal: NodeId;
  failed: boolean;
  /** Finish the retained safe prefix before the detour from `start` after topology changes. */
  retainRoute?: true | undefined;
  /** A grind reroute asked beside the live route, which stands when the new route matches it. */
  grind?: true | undefined;
}>('PathRequest', 'movement');

/**
 * Routing stood a collider in at `at` beside its `goal`, a node a standing unit it cannot share occupies.
 * A drive whose stance cell is that goal acts from `at` instead of re-aiming at the occupied node every
 * tick. Set with the stand-in route, cleared by the drive that acts on it, by a route delivered without
 * a stand-in, and with the rest of the nav state.
 */
export const StandIn = defineComponent<{ goal: NodeId; at: NodeId }>('StandIn', 'movement', {
  simOnly: true,
});

/**
 * A stranded walker's retry pacing: its route failed and no drive with its own failure protocol owns it, so
 * the planner parks the dead nav state until tick `retryAt`, then sheds it and re-plans. Cleared with the
 * rest of the nav state, so an authoritative cancel restarts the walk at once.
 */
export const Stranded = defineComponent<{ retryAt: number }>('Stranded', 'movement');

/**
 * A settler standing lost: an ordered walk, a chase or its work found no way within its signpost reach.
 * A mark its own walk earned lifts once a route to work is found, an obeyed order's, or a trade sets it
 * to work in place; a meal, an errand or a chat on the way is not the way. `cutOff` says the idle tail
 * found its own workplace, every door of its seat or its only work out of reach; that mark lifts when the
 * tail finds the way back in reach or a trade rung takes the settler. `since` is the tick the episode
 * began; `goal` is the node the latest refused way led to, shown to the player; `tried` is the work
 * walk's goal whose route, once found, lifts the mark.
 */
export const LostWay = defineComponent<{
  cutOff: boolean;
  since: number;
  goal: NodeId;
  tried: NodeId | null;
}>('LostWay', 'movement');

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
  { simOnly: true },
);

/**
 * A walker's grind-window among unit bodies: blockage is judged by progress, not push direction. `x`/`y`
 * anchor the window where the walker stood when it began and `ticks` counts its length; movement past a
 * progress floor restarts it. A window reaching the re-route threshold asks for a route that flanks the
 * blockers, and `reroutes` tallies the windows; after `OBSTRUCTED_MAX_REROUTES` the walk stands down
 * entirely, leaving whoever owns the goal to re-decide. `hold` is the windows still waited out on the kept
 * route before asking again: a reroute that found the route already walked sets it to the tally so far,
 * so the asks of a body wedged in a crowd thin out at a doubling interval.
 */
export const Obstructed = defineComponent<{
  ticks: number;
  reroutes: number;
  hold: number;
  x: Fixed;
  y: Fixed;
}>('Obstructed', 'movement', { simOnly: true });
