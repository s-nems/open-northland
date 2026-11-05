import { BUILDING_KIND } from '@open-northland/data';
import {
  AttackOrder,
  Building,
  Engagement,
  operationMembersOf,
  Rider,
  Settler,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import { nodeManhattan } from '../../../../nav/halfcell.js';
import { colonyGarrisons } from '../../../ai-shared/home-roster.js';
import { isRangedFighter, takeCensus } from '../../../ai-shared/military/census.js';
import {
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  TOWER_GARRISON_ARCHERS,
  towerPostOrders,
} from '../../../ai-shared/military/defence/index.js';
import { type Raider, raidersNearAny } from '../../../ai-shared/military/defence/threat.js';
import { spokenFor } from '../../../ai-shared/military/errand.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import { towerPostFor } from '../../../conflict/tower-post.js';
import { minutesToTicks } from '../../game-phase.js';
import { isFitSoldier, NO_ARMOUR_WAIT } from '../../military/fit.js';
import { ARMY_FLOOR_MIN, underAttack } from '../../workforce/garrison.js';
import { type ColonyEnv, type ColonyView, homeLandOf } from '../env.js';
import { colonists, colonyBuildings, colonyOrigin, standsOn } from '../roster.js';
import { colonySeats } from './posts.js';
import { colonyFed } from './provision.js';

/** The towers a garrisoned colony raises with no threat seen (owner ruling: two defence towers at once). */
export const COLONY_TOWERS_LEAST = 2;
/** The fighters a running colony holds with no threat seen (owner ruling: a small garrison): its first
 *  towers' archers, so each of them shoots. */
const GARRISON_LEAST = COLONY_TOWERS_LEAST * TOWER_GARRISON_ARCHERS;
/** A garrison man more per this many of the colony's own people (owner ruling: the garrison grows with the
 *  colony; authored figure). */
const PEOPLE_PER_GUARD = 4;
/** A garrison man more per standing workshop of the colony (authored): its industries are what a raid
 *  takes. */
const GUARDS_PER_WORKSHOP = 1;
/** The most a colony holds for the raiders it has seen (owner ruling: a small garrison; authored figure: two
 *  towers' archers and two men for the sortie). */
const THREAT_MOST = 8;
/** The most a colony holds however large it grows (authored: about a seat's whole army early in the game,
 *  far below it late). */
const GARRISON_MOST = 20;
/** The garrison men a crossing takes past the colony's least garrison and its threat (authored): a growing
 *  garrison leaves the ferry's other seats to the colony's hands. */
const GROWTH_PER_CROSSING = 3;
/** The seat's garrisons together hold at most one fighter of this many of its own, garrisons included
 *  (authored): a sixth, so the home army keeps five men in six. */
const FIGHTERS_PER_GARRISON_MAN = 6;
/** How long a band seen about the colony keeps its garrison and towers raised after it was last seen
 *  (authored: long enough for a beaten band to come back, untuned: no colony was raided in the probes). */
export const THREAT_MEMORY_TICKS = minutesToTicks(30);
/** How far from the colony's store, in Manhattan nodes, an idle garrison man walks back (authored: inside a
 *  tower's reach of the store). */
const STATION_NODES = 12;

/** The most raiders seen about the colony within {@link THREAT_MEMORY_TICKS}, 0 for none. */
export function recentThreat(colony: ColonyView, tick: number): number {
  const threat = colony.threat;
  return threat === null || tick - threat.since >= THREAT_MEMORY_TICKS ? 0 : threat.men;
}

/** What a colony is worth guarding: its own people, garrison apart, its standing workshops that seat a
 *  hand, and whether it feeds everyone on its land and a crossing's growth more. */
export interface ColonyWorth {
  readonly people: number;
  readonly workshops: number;
  readonly fed: boolean;
}

/** The garrison a colony wants: none before it runs, then {@link GARRISON_LEAST} and a man more per raider
 *  seen lately, up to {@link THREAT_MOST}; while it would still feed everyone with a crossing's growth
 *  more, a man more per {@link PEOPLE_PER_GUARD} of its people and {@link GUARDS_PER_WORKSHOP} per
 *  workshop; up to {@link GARRISON_MOST}. The seat's army bounds how many sail ({@link garrisonRoom}), so
 *  the garrison grows with the colony and with the army. */
export function garrisonWant(colony: ColonyView, tick: number, worth: ColonyWorth): number {
  if (colony.phase !== 'running') return 0;
  const held = Math.min(THREAT_MOST, GARRISON_LEAST + recentThreat(colony, tick));
  const growth = worth.fed
    ? Math.floor(worth.people / PEOPLE_PER_GUARD) + GUARDS_PER_WORKSHOP * worth.workshops
    : 0;
  return Math.min(GARRISON_MOST, held + growth);
}

/** The garrison men a crossing takes when `held` of `want` stand: all it lacks of its least garrison and its
 *  threat ({@link THREAT_MOST} at most), else up to {@link GROWTH_PER_CROSSING}. */
export function garrisonCrossing(colony: ColonyView, tick: number, want: number, held: number): number {
  const urgent = Math.min(THREAT_MOST, GARRISON_LEAST + recentThreat(colony, tick)) - held;
  return Math.max(0, Math.min(want - held, Math.max(urgent, GROWTH_PER_CROSSING)));
}

/** {@link ColonyWorth} read off the colony's land. */
function worthOf(env: ColonyEnv, colony: ColonyView): ColonyWorth {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const buildings = colonyBuildings(env);
  const people = colonists(env);
  const guards = new Set(colony.garrison);
  const workshops = buildings.filter((e) => {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    return (
      isBuilt(world, e) &&
      type?.kind === BUILDING_KIND.workplace &&
      colonySeats(ctx, type).some((slot) => slot.count > 0)
    );
  }).length;
  return {
    people: people.filter((e) => !guards.has(e)).length,
    workshops,
    fed: colonyFed(env, buildings, people, GROWTH_PER_CROSSING),
  };
}

/** The colony's garrison men alive and standing on its land. */
export function garrisonAshore(env: ColonyEnv, colony: ColonyView): Entity[] {
  const { world, ctx } = env;
  return colony.garrison.filter(
    (e) => world.isAlive(e) && !world.has(e, Rider) && standsOn(world, ctx, e, colony.land),
  );
}

/** The home army's armed men free to sail: in the census, on home's land, in no operation and on no
 *  errand. */
function homeFighters(env: ColonyEnv): { readonly army: number; readonly free: readonly Entity[] } {
  const { world, ctx, seat } = env;
  const home = homeLandOf(env);
  const away = operationMembersOf(world, seat);
  const army = takeCensus(world, ctx, seat).ready.filter(
    (e) => !away.has(e) && standsOn(world, ctx, e, home),
  );
  const free = army.filter((e) => !spokenFor(world, e) && isFitSoldier(world, ctx, e, NO_ARMOUR_WAIT));
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

/** The men home owes the colony's garrison on this crossing ({@link garrisonCrossing}), archers first and
 *  then ascending id: none while home is raided, and no more than {@link garrisonRoom} lets go. The colony's
 *  ferry seats them at home. */
export function garrisonOwed(env: ColonyEnv, colony: ColonyView): Entity[] {
  const { world, ctx, seat } = env;
  if (colony.phase !== 'running' || underAttack(world, seat)) return [];
  const want = garrisonWant(colony, ctx.tick, worthOf(env, colony));
  const lacking = garrisonCrossing(colony, ctx.tick, want, colony.garrison.length);
  if (lacking <= 0) return [];
  const { army, free } = homeFighters(env);
  const take = Math.min(lacking, garrisonRoom(army, colonyGarrisons(world, seat).length));
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
 *  a man landed home is home's again. A man ordered aboard boards only next tick, so a running ferry forgets
 *  the one the door refused once it is done. Only a change writes. */
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
    const at = anchorNodeOf(world, e);
    if (at === null || spokenFor(world, e) || nodeManhattan(at, origin) <= STATION_NODES) return [];
    return [{ kind: 'moveUnit', entity: e, x: origin.hx, y: origin.hy } as const];
  });
}

/**
 * The garrison holds the colony as home holds its settlement, over the colony's buildings alone: its archers
 * man the colony's towers, and the rest go for a raider about them or, with none, stand by the store. The
 * home army never answers a colony's raid: its defence guards home's buildings only.
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
