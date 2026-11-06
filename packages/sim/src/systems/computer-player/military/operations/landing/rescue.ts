import {
  type ColonyPhase,
  type ColonyState,
  playerPlacementTribes,
  type RescueOperation,
  type SeaLanding,
} from '../../../../../components/index.js';
import type { DeepReadonly, Entity } from '../../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../../nav/halfcell.js';
import type { NodeId } from '../../../../../nav/terrain/index.js';
import { colonyBuildingsOn, seatColonies } from '../../../../ai-shared/home-roster.js';
import {
  insideBox,
  type SettlementBox,
  settlementBox,
  threatWatchNodes,
} from '../../../../ai-shared/military/defence/threat.js';
import { ownedFightersOf } from '../../../../movement/collision/owned-fighters.js';
import { recentThreat } from '../../../colony/settlement/garrison.js';
import { visibleEnemyMooredShips } from '../../../knowledge/intel/index.js';
import { landOfPoint } from '../../../sea-route.js';
import { SOLDIERS_PER_SHIP } from '../../../workforce/craft.js';
import { launchRatioReached } from '../../plan.js';
import { isLiveFighter, unitPoints } from '../../points.js';
import type { OperationEnv } from '../lifecycle.js';
import { nodeOfEntity, visibleEnemyFighters } from '../raid-target.js';
import {
  LANDING_EDGE,
  type LandingAim,
  type LandingRoom,
  pointsAshore,
  prefixPoints,
  type RankedMan,
} from './aim.js';
import { believedLand } from './target.js';

// A rescue (owner ruling): an enemy band on one of the seat's colonies sends men from home over the sea to
// fight it, sized to outweigh what the seat sees there beside the colony's own fighters; an enemy ship
// moored at the colony adds the load it may still carry. The landed men go for the enemy fighters they see
// on the colony and sail home once none is left. Every figure is authored.

/** The fewest men a rescue sails with. */
export const RESCUE_LEAST_MEN = 5;

/** An enemy fighter the seat sees inside a colony's watch. */
interface ColonyThreatSeen {
  readonly land: number;
  readonly owner: number;
  readonly at: HalfCellNode;
  readonly points: number;
}

/** An enemy ship the seat sees moored inside the watch of its colony on `land`. */
interface MooredThreat {
  readonly land: number;
  readonly owner: number;
  readonly at: HalfCellNode;
}

/** The seat's colonies a rescue may sail for on this decision ({@link threatenedColonies}), and the enemy
 *  ships moored inside their watch. */
export interface ColonyThreats {
  readonly colonies: readonly DeepReadonly<ColonyState>[];
  readonly ships: readonly MooredThreat[];
}

const NOBODY: ReadonlySet<Entity> = new Set();

/** The colony phases in which the colony stands on its land, so there is something to rescue. */
const STANDING_PHASES: ReadonlySet<ColonyPhase> = new Set(['landing', 'founding', 'running']);

/** Whether `op` is a rescue rather than a landing at a rival. */
export function isRescue(op: DeepReadonly<SeaLanding>): op is DeepReadonly<RescueOperation> {
  return op.kind === 'rescue';
}

/**
 * The seat's colonies standing on their land with a band their garrison remembers ({@link recentThreat},
 * though it shrank since) or an enemy ship the seat sees moored inside their watch, or null with none, so a
 * seat at peace on its colonies musters nobody for a rescue. Costs the enemies' ships while a colony stands.
 */
export function threatenedColonies(env: OperationEnv): ColonyThreats | null {
  const { world, ctx, seat } = env;
  const standing = seatColonies(world, seat).filter((c) => STANDING_PHASES.has(c.phase));
  if (standing.length === 0) return null;
  const ships = enemyShipsAt(env, standing);
  const colonies = standing.filter(
    (c) => ships.some((s) => s.land === c.land) || recentThreat(c, ctx.tick) > 0,
  );
  return colonies.length === 0 ? null : { colonies, ships };
}

/** One threatened colony as a rescue weighs it: the enemy points there, the seat's own fighters' beside them
 *  and how far those fall short of {@link LANDING_EDGE}, and the first enemy fighter seen. */
interface Shortfall {
  readonly land: number;
  readonly enemy: number;
  readonly own: number;
  readonly short: number;
  readonly first: ColonyThreatSeen;
}

/**
 * The first rescue `launch` makes of the `threats`' colonies, or null: for each with enemy fighters in sight
 * inside its watch, the enemy points seen there, or the load the moored ships may carry when larger
 * ({@link SOLDIERS_PER_SHIP} men of the `ranked` men's mean a ship, an approximation of a load the seat
 * cannot see), offered in turn as the seat's own fighters there fall furthest short of {@link LANDING_EDGE},
 * the earlier colony on a tie; each with the strongest of `ranked` whose men ashore ({@link pointsAshore},
 * the helms stay aboard) reach that edge beside them, at least {@link RESCUE_LEAST_MEN}, within `room`.
 * Costs the enemies' fighters and the seat's own.
 */
export function rescueAim<T>(
  env: OperationEnv,
  threats: ColonyThreats,
  ranked: readonly RankedMan[],
  room: LandingRoom,
  launch: (aim: LandingAim) => T | null,
): T | null {
  if (ranked.length === 0) return null;
  const prefix = prefixPoints(ranked);
  const shipPoints = Math.floor(((prefix.at(-1) ?? 0) * SOLDIERS_PER_SHIP) / ranked.length);
  const lands = threats.colonies.map((c) => c.land);
  const fighters = enemyFightersOn(env, lands);
  const own = ownPointsOn(env, new Set(lands));
  const shortfalls: Shortfall[] = [];
  for (const colony of threats.colonies) {
    const band = fighters.filter((t) => t.land === colony.land);
    const first = band[0];
    if (first === undefined) continue;
    // The men a moored ship carried are aboard still or ashore in the band, so the larger of the two.
    let seen = 0;
    for (const t of band) seen += t.points;
    let carried = 0;
    for (const t of threats.ships) if (t.land === colony.land) carried += shipPoints;
    const enemy = Math.max(seen, carried);
    const there = own.get(colony.land) ?? 0;
    if (launchRatioReached(there, enemy, LANDING_EDGE)) continue;
    const short = enemy * LANDING_EDGE.num - there * LANDING_EDGE.den;
    shortfalls.push({ land: colony.land, enemy, own: there, short, first });
  }
  // A stable sort: colonies equally short keep their order.
  shortfalls.sort((a, b) => b.short - a.short);
  for (const colony of shortfalls) {
    const count = rescueMen(prefix, ranked.length, room, colony);
    if (count === null) continue;
    const launched = launch({
      land: colony.land,
      owner: colony.first.owner,
      towards: colony.first.at,
      entity: null,
      believed: believedLand(env, colony.land),
      storm: false,
      men: ranked.slice(0, count).map((m) => m.entity),
    });
    if (launched !== null) return launched;
  }
  return null;
}

/** How many of the strongest men of `prefix` ({@link prefixPoints}) a rescue of `colony` takes, or null
 *  when all `men` within `room` cannot reach its edge. */
function rescueMen(
  prefix: readonly number[],
  men: number,
  room: LandingRoom,
  colony: Shortfall,
): number | null {
  const reached = (count: number): boolean =>
    count >= RESCUE_LEAST_MEN &&
    launchRatioReached(pointsAshore(prefix, count, room.ships) + colony.own, colony.enemy, LANDING_EDGE);
  let count = 0;
  while (!reached(count)) {
    if (count >= Math.min(men, room.seats)) return null;
    count++;
  }
  return count;
}

/**
 * Where the men a rescue set ashore on `land` go: the enemy fighter the seat sees within the watch of the
 * colony there ({@link enemyFightersOn}) nearest `from`, the first in sighting order on a tie, or null once
 * it sees none.
 */
export function rescueObjective(env: OperationEnv, land: number, from: HalfCellNode): NodeId | null {
  const { terrain } = env;
  let best: { readonly at: HalfCellNode; readonly distance: number } | null = null;
  for (const t of enemyFightersOn(env, [land])) {
    const distance = nodeManhattan(t.at, from);
    if (best === null || distance < best.distance) best = { at: t.at, distance };
  }
  return best === null ? null : terrain.nodeAtClamped(best.at.hx, best.at.hy);
}

/** The enemy ships the seat sees moored at one of `colonies`, inside the colony's watch
 *  ({@link colonyWatch}). Costs the enemies' vehicles and the colonies' buildings. */
function enemyShipsAt(env: OperationEnv, colonies: readonly DeepReadonly<ColonyState>[]): MooredThreat[] {
  const { world, ctx, seat } = env;
  const ships = visibleEnemyMooredShips(world, ctx, seat);
  if (ships.length === 0) return [];
  const seen: MooredThreat[] = [];
  for (const colony of colonies) {
    const watches = colonyWatch(env, colony.land);
    for (const ship of ships)
      if (watches(ship.at)) seen.push({ land: colony.land, owner: ship.owner, at: ship.at });
  }
  return seen;
}

/** Whether a spot lies on the colony's `land` inside the watch of its buildings ({@link settlementBox}), the
 *  reach its garrison notes a band in, or before its first building stands, the watch of a building at its
 *  site ({@link siteBox}); never, for a land the seat holds no colony on. */
function colonyWatch(env: OperationEnv, land: number): (at: HalfCellNode) => boolean {
  const { world, ctx, terrain, seat } = env;
  const box =
    settlementBox(world, ctx, terrain, colonyBuildingsOn(world, ctx, seat, land)) ?? siteBox(env, land);
  return (at) => box !== null && landOfPoint(terrain, at) === land && insideBox(box, at.hx, at.hy);
}

/** The watch box round the site of the seat's colony on `land`, a building's watch of the seat's tribe
 *  ({@link threatWatchNodes}) every way, the shape {@link settlementBox} gives one building; null with no
 *  colony there or no tribe. */
function siteBox(env: OperationEnv, land: number): SettlementBox | null {
  const { world, ctx, seat } = env;
  const colony = seatColonies(world, seat).find((c) => c.land === land);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  if (colony === undefined || tribe === undefined) return null;
  const band = threatWatchNodes(ctx, tribe);
  const { hx, hy } = colony.site;
  return { minX: hx - band - 1, maxX: hx + band + 1, minY: hy - band, maxY: hy + band };
}

/** The enemy fighters the seat sees inside the watch of its colony on one of `lands` ({@link colonyWatch}),
 *  so a rival's own men far off on a shared island are no band of the colony's. */
function enemyFightersOn(env: OperationEnv, lands: readonly number[]): ColonyThreatSeen[] {
  const watches = lands.map((land) => ({ land, watches: colonyWatch(env, land) }));
  const seen: ColonyThreatSeen[] = [];
  for (const f of visibleEnemyFighters(env.world, env.ctx, env.seat)) {
    const colony = watches.find((w) => w.watches(f.at));
    if (colony !== undefined) seen.push({ land: colony.land, owner: f.owner, at: f.at, points: f.points });
  }
  return seen;
}

/** The points of the seat's own fighters standing on `land` but `except`: what a rescue finds there. */
export function ownPointsOnLand(env: OperationEnv, land: number, except: ReadonlySet<Entity>): number {
  return ownPointsOn(env, new Set([land]), except).get(land) ?? 0;
}

/** The seat's own fighters' points by the land of `lands` they stand on, but `except`. */
function ownPointsOn(
  env: OperationEnv,
  lands: ReadonlySet<number>,
  except: ReadonlySet<Entity> = NOBODY,
): Map<number, number> {
  const { world, ctx, seat } = env;
  const byLand = new Map<number, number>();
  for (const e of ownedFightersOf(world, ctx.content, seat)) {
    if (except.has(e) || !isLiveFighter(world, e)) continue;
    const at = nodeOfEntity(world, e);
    if (at === null) continue;
    const land = landOfPoint(env.terrain, at);
    if (lands.has(land)) byLand.set(land, (byLand.get(land) ?? 0) + unitPoints(world, ctx, e));
  }
  return byLand;
}
