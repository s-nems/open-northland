import {
  aiControlEntity,
  ComputerNoWay,
  OPERATION_KINDS,
  type SeaLanding,
  Vehicle,
} from '../../../../../components/index.js';
import type { Entity } from '../../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../../nav/terrain/index.js';
import {
  dockRoute,
  docksReachedThrough,
  type MooringSpots,
  mooringSpotsOf,
} from '../../../../vehicles/dock.js';
import { minutesToTicks } from '../../../game-phase.js';
import { shorePoints } from '../../../sea-route.js';
import type { OperationEnv } from '../lifecycle.js';
import { RAID_TOWER_CLEARANCE_NODES } from '../raid-target.js';
import type { LandingAim } from './aim.js';
import { believedLands, type FireSource, underFire } from './target.js';

// Where a landing's or rescue's fleet may moor and how it gets there: shores clear of the fire the seat
// believes stands, and courses there that pass none of it.

/**
 * Each crew's shore on the `aim`'s land ({@link landingShores}, {@link shoresOf}), or null when that land
 * offers none, no clear way leads there, or `judge` already judged another land's courses this decision.
 */
export function crewShores(
  env: OperationEnv,
  kind: SeaLanding['kind'],
  aim: LandingAim,
  crews: readonly { readonly ship: Entity }[],
  judge: CourseJudge,
): (HalfCellNode | undefined)[] | null {
  const first = crews[0];
  if (first === undefined) return null;
  const found = landingShores(env, first.ship, aim, crews.length * SHORES_PER_SHIP);
  return found.length === 0 ? null : shoresOf(env, kind, aim.land, crews, found, judge);
}

/**
 * The shore points of a landing's ships ({@link shorePoints}) on the `aim`'s land, nearest where it heads,
 * outside the reach of every tower and shelter the seat believes stands there ({@link underFire}), so the
 * hulls waiting at the shore are not shot; a storm too lands clear of them and walks in. Authored: observed
 * on arabskie_wyspy_wolna_gra_mieszana, ships moored beside a rival's headquarters, its people shooting
 * from inside, lost most hulls and every man aboard before the last one moored.
 */
function landingShores(env: OperationEnv, ship: Entity, aim: LandingAim, count: number): HalfCellNode[] {
  const { world, ctx, terrain } = env;
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return [];
  const fire = fireKeyOf(aim.believed.sources);
  const failed = shoreless.get(spots);
  if (failed?.get(aim.land) === fire) return [];
  const clear = (at: HalfCellNode): boolean => !underFire(aim.believed.sources, at);
  const shores = shorePoints(world, ctx, terrain, ship, aim.land, aim.towards, clear, count);
  if (shores.length === 0) {
    if (failed === undefined) shoreless.set(spots, new Map([[aim.land, fire]]));
    else failed.set(aim.land, fire);
  }
  return shores;
}

/**
 * Per set of mooring spots a ship reaches ({@link mooringSpotsOf}), the lands whose search found no shore
 * clear of the fire believed there, with that fire ({@link fireKeyOf}): a pure function of the two, so the
 * search is skipped until either changes. A derived cache: a restored game finds the same answers anew.
 */
const shoreless = new WeakMap<MooringSpots, Map<number, string>>();

/** The believed towers' and shelters' spots, in a key that changes when any of them does. */
function fireKeyOf(sources: readonly FireSource[]): string {
  return sources
    .map((s) => `${s.at.hx},${s.at.hy}`)
    .sort()
    .join(';');
}

/** The clear shores a landing looks for per ship, so ships whose way to the nearest passes a tower have
 *  others to take. */
const SHORES_PER_SHIP = 2;

/**
 * Each crew's shore of `shores`, nearest first, among those its fleet reaches through water outside the
 * reach of every tower and shelter the seat believes stands on any land ({@link fireMaskOf}), judged by one
 * flood from the first ship ({@link docksReachedThrough}): the first one no other crew took, else its share
 * of them. Null when the fleet reaches none that way or no course checked is clear ({@link clearCourses}),
 * and null for every land after the first `judge` saw this decision: the landing tries another land on a
 * later decision. Approximation: the fleet's ships moor side by side at home, so the first ship's water
 * stands for theirs. Authored: observed on arabskie_wyspy_wolna_gra_mieszana, fleets sailing past coastal
 * towers lost most hulls before they reached the shore, and ships sank on their way home past a tower
 * their seat knew, their shore far from it.
 */
function shoresOf(
  env: OperationEnv,
  kind: SeaLanding['kind'],
  land: number,
  crews: readonly { readonly ship: Entity }[],
  shores: readonly HalfCellNode[],
  judge: CourseJudge,
): (HalfCellNode | undefined)[] | null {
  const first = crews[0];
  if (first === undefined) return [];
  const { world, ctx, terrain } = env;
  // The fire about the fleet's own berths it must sail out of anyway: only the fire beyond closes the sea.
  const berths = crews.flatMap((crew) => world.get(crew.ship, Vehicle).mooring ?? []);
  const sources = [...believedLands(env).values()]
    .flatMap((believed) => believed.sources)
    .filter((source) => !berths.some((at) => nodeManhattan(source.at, at) <= RAID_TOWER_CLEARANCE_NODES));
  if (sources.length === 0) return crews.map((_, i) => shores[i] ?? shores[i % shores.length]);
  // One land's courses are judged a decision; the next land waits for the next decision.
  if (judge.judged) return null;
  judge.judged = true;
  const fire = fireMaskOf(terrain, sources);
  const closed = (node: NodeId): boolean => fire[node] === UNDER_FIRE;
  const reached = docksReachedThrough(world, ctx, terrain, first.ship, shores, closed);
  const open = shores.filter((_, i) => reached[i] === true);
  const picked = open.length === 0 ? null : clearCourses(env, crews, open, closed);
  if (picked === null) noteNoWay(env, kind, land);
  return picked;
}

/** How long a land a landing or rescue found no clear way to waits before it is judged again (authored): two
 *  game minutes, so the other lands get their turn and a changed fire is seen soon. */
export const NO_WAY_RECHECK_TICKS = minutesToTicks(2);

/** Whether the seat's `kind` found no clear way to `land` within {@link NO_WAY_RECHECK_TICKS}. */
export function noWayTo(env: OperationEnv, kind: SeaLanding['kind'], land: number): boolean {
  const carrier = aiControlEntity(env.world, env.seat);
  const lands = carrier === null ? undefined : env.world.tryGet(carrier, ComputerNoWay)?.lands;
  return lands?.some((l) => l.kind === kind && l.land === land && env.ctx.tick < l.until) ?? false;
}

/** Remember that the seat's `kind` found no clear way to `land` now, dropping the lapsed entries. */
function noteNoWay(env: OperationEnv, kind: SeaLanding['kind'], land: number): void {
  const { world, ctx, seat } = env;
  const carrier = aiControlEntity(world, seat);
  if (carrier === null) return;
  if (!world.has(carrier, ComputerNoWay)) world.add(carrier, ComputerNoWay, { lands: [] });
  const live = world.mut(carrier, ComputerNoWay);
  live.lands = [
    ...live.lands.filter((l) => ctx.tick < l.until && !(l.kind === kind && l.land === land)),
    { kind, land, until: ctx.tick + NO_WAY_RECHECK_TICKS },
  ].sort((a, b) => OPERATION_KINDS.indexOf(a.kind) - OPERATION_KINDS.indexOf(b.kind) || a.land - b.land);
}

/** Whether one opening's decision has judged a land's courses ({@link shoresOf}), so it floods and searches
 *  courses for one land: each opener mints its own. */
export interface CourseJudge {
  judged: boolean;
}

/** The most crews of a landing whose dock course {@link clearCourses} checks, each a route search. */
const COURSE_CHECKS = 3;

/**
 * Each crew's shore of `open` once the course its dock order would sail there is checked against `closed`
 * ({@link dockRoute}) for the first {@link COURSE_CHECKS} crews, one route search each: a crew whose course
 * passes the fire, or one past those checked, shares the shore of a crew whose course was clear. Null when
 * no checked course is clear.
 */
function clearCourses(
  env: OperationEnv,
  crews: readonly { readonly ship: Entity }[],
  open: readonly HalfCellNode[],
  closed: (node: NodeId) => boolean,
): (HalfCellNode | undefined)[] | null {
  const { world, ctx, terrain } = env;
  const own = crews.map((_, i) => open[i] ?? open[i % open.length]);
  const clear = crews.map((crew, i) => {
    const shore = own[i];
    if (i >= COURSE_CHECKS || shore === undefined) return false;
    const route = dockRoute(world, ctx, terrain, crew.ship, shore);
    return route?.every((at) => !closed(terrain.nodeAtClamped(at.hx, at.hy))) ?? false;
  });
  const safe = own.filter((shore, i): shore is HalfCellNode => shore !== undefined && clear[i] === true);
  if (safe.length === 0) return null;
  let next = 0;
  return own.map((shore, i) => {
    if (shore !== undefined && clear[i] === true) return shore;
    const shared = safe[next % safe.length];
    next++;
    return shared;
  });
}

const UNDER_FIRE = 1;

/** The nodes within {@link RAID_TOWER_CLEARANCE_NODES} of one of `sources`, the towers and shelters the
 *  seat believes stand, marked {@link UNDER_FIRE}. Costs the reach of each. */
function fireMaskOf(terrain: TerrainGraph, sources: readonly FireSource[]): Uint8Array {
  const mask = new Uint8Array(terrain.nodeCount);
  const reach = RAID_TOWER_CLEARANCE_NODES;
  for (const { at } of sources) {
    for (let dy = -reach; dy <= reach; dy++) {
      const span = reach - Math.abs(dy);
      for (let dx = -span; dx <= span; dx++) {
        const hx = at.hx + dx;
        const hy = at.hy + dy;
        if (terrain.inBounds(hx, hy)) mask[terrain.nodeAt(hx, hy)] = UNDER_FIRE;
      }
    }
  }
  return mask;
}
