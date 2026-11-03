import { AttackOrder, Engagement, operationMembersOf, Rider, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity } from '../../../ecs/world.js';
import { nodeManhattan } from '../../../nav/halfcell.js';
import { colonyGarrisons } from '../../ai-shared/home-roster.js';
import { isRangedFighter, takeCensus } from '../../ai-shared/military/census.js';
import {
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  TOWER_GARRISON_ARCHERS,
  towerPostOrders,
} from '../../ai-shared/military/defence/index.js';
import { type Raider, raidersNearAny } from '../../ai-shared/military/defence/threat.js';
import { spokenFor } from '../../ai-shared/military/errand.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import { minutesToTicks } from '../game-phase.js';
import { isFitSoldier } from '../military/fit.js';
import { nodeOfEntity } from '../military/operations/raid-target.js';
import { ARMY_FLOOR_MIN, underAttack } from '../workforce/garrison.js';
import { colonyOrigin } from './founding.js';
import { standsOn } from './people.js';
import { colonyBuildings } from './spot.js';
import { type ColonyEnv, type ColonyView, homeLandOf } from './voyage.js';

/** The fighters a running colony holds with no threat seen (owner ruling: a small garrison): one tower's
 *  archers, so its first tower shoots. */
const GARRISON_LEAST = TOWER_GARRISON_ARCHERS;
/** The most a colony holds however many raiders it has seen (owner ruling: a small garrison; authored
 *  figure: two towers' archers and two men for the sortie). */
const GARRISON_MOST = 8;
/** The seat's garrisons together hold at most one fighter of this many of its own, garrisons included
 *  (authored): a sixth, so the home army keeps five men in six. */
const FIGHTERS_PER_GARRISON_MAN = 6;
/** How long a band seen about the colony keeps its garrison and towers raised after it was last seen
 *  (authored: a raid's return, from the probe's raids). */
export const THREAT_MEMORY_TICKS = minutesToTicks(30);
/** How far from the colony's store, in Manhattan nodes, an idle garrison man walks back (authored: inside a
 *  tower's reach of the store). */
const STATION_NODES = 12;

/** The most raiders seen about the colony within {@link THREAT_MEMORY_TICKS}, 0 for none. */
export function recentThreat(colony: ColonyView, tick: number): number {
  const threat = colony.threat;
  return threat === null || tick - threat.since >= THREAT_MEMORY_TICKS ? 0 : threat.men;
}

/** The garrison a colony wants: none before it runs, then {@link GARRISON_LEAST}, a man more per raider seen
 *  lately, up to {@link GARRISON_MOST}. */
export function garrisonWant(colony: ColonyView, tick: number): number {
  if (colony.phase !== 'running') return 0;
  return Math.min(GARRISON_MOST, GARRISON_LEAST + recentThreat(colony, tick));
}

/** The colony's garrison men alive and standing on its land. */
export function garrisonAshore(env: ColonyEnv, colony: ColonyView): Entity[] {
  const { world, ctx } = env;
  return colony.garrison.filter(
    (e) => world.isAlive(e) && !world.has(e, Rider) && standsOn(world, ctx, e, colony.land),
  );
}

/** The home army's armed men free to sail: in the census, on home's land, in no operation and on no errand. */
function homeFighters(env: ColonyEnv): { readonly army: number; readonly free: readonly Entity[] } {
  const { world, ctx, seat } = env;
  const home = homeLandOf(env);
  const away = operationMembersOf(world, seat);
  const army = takeCensus(world, ctx, seat).ready.filter(
    (e) => !away.has(e) && standsOn(world, ctx, e, home),
  );
  const free = army.filter((e) => !spokenFor(world, e) && isFitSoldier(world, ctx, e, false));
  return { army: army.length, free };
}

/**
 * How many more fighters the seat's garrisons may take, `held` of them already, from an `army` at home: the
 * gate that keeps the home army whole. The garrisons hold at most one fighter in
 * {@link FIGHTERS_PER_GARRISON_MAN} of the army at home and in them, and home keeps {@link ARMY_FLOOR_MIN}
 * men. The army floor counts a garrison man as its own, so the drill does not replace him with a civilian.
 */
export function garrisonRoom(army: number, held: number): number {
  const share = Math.floor((army + held) / FIGHTERS_PER_GARRISON_MAN) - held;
  return Math.max(0, Math.min(share, army - ARMY_FLOOR_MIN));
}

/** Who sails to garrison the colony, in at most `seats`, archers first and then ascending id: none while home
 *  is raided, and no more than {@link garrisonRoom} lets go. */
export function garrisonBoarders(env: ColonyEnv, colony: ColonyView, seats: number): Entity[] {
  const { world, ctx, seat } = env;
  const lacking = garrisonWant(colony, ctx.tick) - colony.garrison.length;
  if (seats <= 0 || lacking <= 0 || underAttack(world, seat)) return [];
  const { army, free } = homeFighters(env);
  const take = Math.min(seats, lacking, garrisonRoom(army, colonyGarrisons(world, seat).length));
  if (take <= 0) return [];
  return free
    .map((e) => ({ e, ranged: isRangedFighter(world, ctx, e) }))
    .sort((a, b) => Number(b.ranged) - Number(a.ranged) || a.e - b.e)
    .slice(0, take)
    .map((m) => m.e);
}

/** Keep the record of the largest band seen about the colony's buildings on its land: a band as large or
 *  larger renews it, and it lapses after {@link THREAT_MEMORY_TICKS}. Only a change writes. */
function noteThreat(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
  raiders: readonly Raider[],
): void {
  const { world, ctx, terrain } = env;
  const near = raidersNearAny(world, ctx, terrain, buildings, raiders).filter(
    (r) => r.component === colony.land,
  );
  const lately = recentThreat(colony, ctx.tick);
  const first = near[0];
  if (first !== undefined && near.length >= lately) {
    env.edit().threat = { men: near.length, at: { hx: first.x, hy: first.y }, since: ctx.tick };
  } else if (lately === 0 && colony.threat !== null) {
    env.edit().threat = null;
  }
}

/** Drop from the garrison who has died, and with `landed` who stands neither aboard nor on the colony's land:
 *  a man landed home is home's again. A man ordered aboard boards only next tick, so a running line forgets
 *  the one the door refused at its next home stop instead. Only a change writes. */
export function forgetGarrison(env: ColonyEnv, colony: ColonyView, landed: boolean): void {
  const { world, ctx } = env;
  const stays = (e: Entity): boolean =>
    world.isAlive(e) && (!landed || world.has(e, Rider) || standsOn(world, ctx, e, colony.land));
  if (colony.garrison.every(stays)) return;
  const live = env.edit();
  live.garrison = live.garrison.filter(stays);
}

/** Idle men who strayed from the store walk back to it. */
function stationOrders(env: ColonyEnv, colony: ColonyView, men: readonly Entity[]): PlayerCommand[] {
  const { world } = env;
  const origin = colonyOrigin(env, colony, colonyBuildings(env));
  if (origin === null) return [];
  return men.flatMap((e) => {
    const at = nodeOfEntity(world, e);
    if (at === null || spokenFor(world, e) || nodeManhattan(at, origin) <= STATION_NODES) return [];
    return [{ kind: 'moveUnit', entity: e, x: origin.hx, y: origin.hy } as const];
  });
}

/**
 * The garrison holds the colony as home holds its settlement, over the colony's buildings alone: its archers
 * man the colony's towers, and the rest go for a raider about them or, with none, stand by the store. The home
 * army never answers a colony's raid: its defence guards home's buildings only.
 */
export function defendColony(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  forgetGarrison(env, colony, false);
  const buildings = colonyBuildings(env);
  const raiders = seatRaiders(world, ctx, terrain, seat);
  noteThreat(env, colony, buildings, raiders);
  const free = garrisonAshore(env, env.colony).filter((e) => {
    const job = world.get(e, Settler).jobType;
    const posted = job !== null && towerPostFor(world, ctx, e, job) !== null;
    return !posted && !world.has(e, AttackOrder) && !world.has(e, Engagement);
  });
  if (free.length === 0) return [];
  const posts = towerPostOrders(world, ctx, terrain, buildings, free, 'computer-player', () => raiders);
  const loose = free.filter((e) => !posts.claimed.has(e));
  const raid = raidOnTheSettlement(world, ctx, terrain, buildings, raiders);
  const field = raid === null ? stationOrders(env, colony, loose) : sortieOrders(world, terrain, loose, raid);
  return [...posts.commands, ...field];
}
