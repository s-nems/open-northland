import type {
  ColonyPhase,
  ColonyState,
  RescueOperation,
  SeaLanding,
} from '../../../../../components/index.js';
import type { DeepReadonly, Entity } from '../../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../../nav/halfcell.js';
import type { NodeId } from '../../../../../nav/terrain/index.js';
import { colonyBuildingsOn, seatColonies } from '../../../../ai-shared/home-roster.js';
import { insideBox, settlementBox } from '../../../../ai-shared/military/defence/threat.js';
import { ownedFightersOf } from '../../../../movement/collision/owned-fighters.js';
import { minutesToTicks } from '../../../game-phase.js';
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

/** How long a band seen about a colony keeps it worth rescuing after the colony last saw it: the colony's
 *  own threat memory is longer, but a rescue sails for a band still there. */
const RESCUE_THREAT_TICKS = minutesToTicks(5);

/** An enemy ship the seat sees moored at a colony's land, or an enemy fighter it sees there. */
interface ColonyThreatSeen {
  readonly land: number;
  readonly owner: number;
  readonly at: HalfCellNode;
  readonly points: number;
}

const NOBODY: ReadonlySet<Entity> = new Set();

/** The colony phases in which the colony stands on its land, so there is something to rescue. */
const STANDING_PHASES: ReadonlySet<ColonyPhase> = new Set(['landing', 'founding', 'running']);

/** Whether the seat has a colony standing on its land, which a rescue may sail for. */
export function mayRescue(env: OperationEnv): boolean {
  return seatColonies(env.world, env.seat).some((c) => STANDING_PHASES.has(c.phase));
}

/** Whether `op` is a rescue rather than a landing at a rival. */
export function isRescue(op: DeepReadonly<SeaLanding>): op is DeepReadonly<RescueOperation> {
  return op.kind === 'rescue';
}

/**
 * The rescue of the colony the seat sees most threatened, or null: for each colony standing on its land
 * with a band its garrison saw lately or an enemy ship moored there, and enemy fighters in sight on that
 * land, the enemy points seen there (a moored ship adds {@link SOLDIERS_PER_SHIP} men of the `ranked` men's
 * mean, an approximation of a load the seat cannot see), the one the seat's own fighters there fall
 * furthest short of by {@link LANDING_EDGE}; the strongest of `ranked` whose men ashore
 * ({@link pointsAshore}, the helms stay aboard) reach that edge beside them, at least
 * {@link RESCUE_LEAST_MEN}, within `room`.
 * Costs the enemies' ships and, with a colony to weigh, their fighters and the seat's own.
 */
export function rescueAim(
  env: OperationEnv,
  ranked: readonly RankedMan[],
  room: LandingRoom,
): LandingAim | null {
  const { world, ctx, seat } = env;
  const colonies = seatColonies(world, seat).filter((c) => STANDING_PHASES.has(c.phase));
  if (colonies.length === 0 || ranked.length === 0) return null;
  const prefix = prefixPoints(ranked);
  const shipPoints = Math.floor(((prefix.at(-1) ?? 0) * SOLDIERS_PER_SHIP) / ranked.length);
  const ships = enemyShipsAt(env, colonies, shipPoints);
  const watched = colonies.filter(
    (c) =>
      ships.some((s) => s.land === c.land) ||
      (c.threat !== null && ctx.tick - c.threat.since < RESCUE_THREAT_TICKS),
  );
  if (watched.length === 0) return null;
  const fighters = enemyFightersOn(
    env,
    watched.map((c) => c.land),
  );
  const own = ownPointsOn(env, new Set(watched.map((c) => c.land)));
  let best: {
    readonly land: number;
    readonly enemy: number;
    readonly own: number;
    readonly short: number;
    readonly first: ColonyThreatSeen;
  } | null = null;
  for (const colony of watched) {
    const band = fighters.filter((t) => t.land === colony.land);
    const first = band[0];
    if (first === undefined) continue;
    let enemy = 0;
    for (const t of [...band, ...ships.filter((t) => t.land === colony.land)]) enemy += t.points;
    const there = own.get(colony.land) ?? 0;
    if (launchRatioReached(there, enemy, LANDING_EDGE)) continue;
    const short = enemy * LANDING_EDGE.num - there * LANDING_EDGE.den;
    if (best === null || short > best.short) best = { land: colony.land, enemy, own: there, short, first };
  }
  if (best === null) return null;
  const { enemy, own: beside } = best;
  const reached = (count: number): boolean =>
    count >= RESCUE_LEAST_MEN &&
    launchRatioReached(pointsAshore(prefix, count, room.ships) + beside, enemy, LANDING_EDGE);
  let count = 0;
  while (!reached(count)) {
    if (count >= Math.min(ranked.length, room.seats)) return null;
    count++;
  }
  return {
    land: best.land,
    owner: best.first.owner,
    towards: best.first.at,
    entity: null,
    believed: believedLand(env, best.land),
    storm: false,
    men: ranked.slice(0, count).map((m) => m.entity),
  };
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

/** The enemy ships the seat sees moored at one of `colonies`, each weighed `points`, inside the colony's
 *  watch ({@link colonyWatch}). Costs the enemies' vehicles and the colonies' buildings. */
function enemyShipsAt(
  env: OperationEnv,
  colonies: readonly DeepReadonly<ColonyState>[],
  points: number,
): ColonyThreatSeen[] {
  const { world, ctx, seat } = env;
  const ships = visibleEnemyMooredShips(world, ctx, seat);
  if (ships.length === 0) return [];
  const seen: ColonyThreatSeen[] = [];
  for (const colony of colonies) {
    const watches = colonyWatch(env, colony.land);
    for (const ship of ships)
      if (watches(ship.at)) seen.push({ land: colony.land, owner: ship.owner, at: ship.at, points });
  }
  return seen;
}

/** Whether a spot lies on the colony's `land` inside the watch of its buildings ({@link settlementBox}), the
 *  reach its garrison notes a band in; never, for a land with no building of the seat's. */
function colonyWatch(env: OperationEnv, land: number): (at: HalfCellNode) => boolean {
  const { world, ctx, terrain, seat } = env;
  const box = settlementBox(world, ctx, terrain, colonyBuildingsOn(world, ctx, seat, land));
  return (at) => box !== null && landOfPoint(terrain, at) === land && insideBox(box, at.hx, at.hy);
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
