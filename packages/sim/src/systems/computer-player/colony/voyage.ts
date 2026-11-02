import {
  type ColonyScout,
  ComputerColony,
  type ComputerColonyState,
  mapBriefOf,
  Vehicle,
  VehicleDrive,
  vehiclePassengers,
  zoneOfNode,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../nav/terrain/index.js';
import { civilianCount } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { mooringSpotsOf } from '../../vehicles/dock.js';
import { seatBaseOf } from '../base.js';
import { minutesToTicks } from '../game-phase.js';
import { freeShips, otherShore } from '../military/operations/landing.js';
import { believedLand, underFire } from '../military/operations/landing-target.js';
import { nodeOfEntity } from '../military/operations/raid-target.js';
import { SEA_SCOUT_TRIP_TIMEOUT_TICKS, scoutLoop } from '../military/operations/sea-scout.js';
import { shorePoints } from '../sea-route.js';
import { spareMen } from './people.js';
import { colonySiteClear, siteBlockHolds, surveyColonySite } from './survey.js';

export type ColonyView = DeepReadonly<ComputerColonyState>;

/** One colony decision's world. {@link ColonyEnv.edit} acquires the state for a change, and only then: each
 *  write drops the seat's home view. */
export interface ColonyEnv {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly seat: number;
  readonly carrier: Entity;
  readonly edit: () => ComputerColonyState;
}

/** The civilians a seat holds before it looks for a site (authored from the home island's size: a colony
 *  takes a quarter of them and home keeps 30). */
const COLONY_FROM_CIVILIANS = 40;
/** How long a failed voyage holds the seat's next one (authored): time for the home stores to refill. */
const COLONY_RETRY_TICKS = minutesToTicks(10);
/** The failed voyages a seat gives its colony (authored): past them it stays at home. */
export const COLONY_MAX_FAILURES = 2;
/** How long a helm may take to board (authored: a landing's forming time). */
const HELM_BOARD_TICKS = minutesToTicks(4);
/** How long a ship sailing home keeps the colony waiting before it is let go where it is (authored: a full
 *  scouting trip, the longest a ship stays out). */
const RETURN_TIMEOUT_TICKS = SEA_SCOUT_TRIP_TIMEOUT_TICKS;
/** The shores a site's fire test keeps, nearest the site first (authored): enough that one whose ground
 *  refuses a store leaves others to try. */
const SHORE_CANDIDATES = 6;

/** The land the seat's base stands on, or {@link NO_COMPONENT}. */
export function homeLandOf(env: ColonyEnv): number {
  const { world, ctx, terrain, seat } = env;
  const base = seatBaseOf(world, ctx, seat);
  return base === null ? NO_COMPONENT : terrain.componentOf(interactionCell(world, ctx, terrain, base));
}

function landOf(terrain: TerrainGraph, at: DeepReadonly<HalfCellNode> | null): number {
  return at !== null && terrain.inBounds(at.hx, at.hy)
    ? terrain.componentOf(terrain.nodeAt(at.hx, at.hy))
    : NO_COMPONENT;
}

/** Where `ship` lies moored, or null. */
export function mooringOf(world: World, ship: Entity): DeepReadonly<HalfCellNode> | null {
  const state = world.tryGet(ship, Vehicle);
  return state?.moored === true ? state.mooring : null;
}

/** Whether `ship` lies moored on `land`. */
export function mooredOn(env: ColonyEnv, ship: Entity, land: number): boolean {
  return land !== NO_COMPONENT && landOf(env.terrain, mooringOf(env.world, ship)) === land;
}

/** Whether `ship` lies still with no drive and no goal held for a boarding: its last order is spent. */
export function lyingStill(world: World, ship: Entity): boolean {
  return !world.has(ship, VehicleDrive) && world.tryGet(ship, Vehicle)?.heldGoal === null;
}

export function dock(ship: Entity, at: DeepReadonly<HalfCellNode>): PlayerCommand {
  return { kind: 'dockVehicle', vehicle: ship, x: at.hx, y: at.hy };
}

/** The ship's riders step ashore where it lies moored. */
export function unloadAt(ship: Entity, at: DeepReadonly<HalfCellNode>): PlayerCommand {
  return { kind: 'unloadPeople', vehicle: ship, mooring: { x: at.hx, y: at.hy } };
}

/** The zone of the colony's site. */
function siteZone(world: World, colony: ColonyView): number {
  const brief = mapBriefOf(world);
  return brief === null ? 0 : zoneOfNode(brief, colony.site.hx, colony.site.hy);
}

/** The shores `ship` may land at on the site's land: the spots no believed tower or shelter reaches,
 *  nearest the site first, spaced as {@link shorePoints} spaces them. */
export function colonyShores(env: ColonyEnv, ship: Entity, land: number, site: HalfCellNode): HalfCellNode[] {
  const { world, ctx, terrain } = env;
  const fire = believedLand(env, land).sources;
  const clear = (at: HalfCellNode): boolean => !underFire(fire, at);
  return shorePoints(world, ctx, terrain, ship, land, site, clear, SHORE_CANDIDATES);
}

/** The mooring spots of the colony's land in its site's block: what the first ship sails round. */
function siteCoast(env: ColonyEnv, ship: Entity, colony: ColonyView): HalfCellNode[] {
  const { world, ctx, terrain } = env;
  const brief = mapBriefOf(world);
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null || brief === null) return [];
  const zone = siteZone(world, colony);
  const coast: HalfCellNode[] = [];
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== colony.land) continue;
    const { x, y } = terrain.coordsOf(node);
    if (siteBlockHolds(brief, zone, x, y)) coast.push({ hx: x, hy: y });
  }
  return coast;
}

/** A fresh colony state on `site`, keeping what the seat learned from `was`. */
function settledOn(
  env: ColonyEnv,
  site: { readonly land: number; readonly centre: HalfCellNode },
  rejected: readonly number[],
  failures: number,
  retryAt: number,
): ComputerColonyState {
  return {
    phase: 'siteChosen',
    since: env.ctx.tick,
    land: site.land,
    site: { hx: site.centre.hx, hy: site.centre.hy },
    shore: null,
    berth: null,
    scout: null,
    ship: null,
    people: [],
    rest: [],
    failures,
    rejected: [...rejected],
    retryAt,
    builds: [],
    line: null,
    overflow: [],
  };
}

/** A seat with no colony and civilians enough takes the survey's best site, or stays as it is. */
export function chooseSite(env: ColonyEnv): void {
  const { world, ctx, seat, carrier } = env;
  if (civilianCount(world, ctx, seat) < COLONY_FROM_CIVILIANS) return;
  const site = surveyColonySite(world, ctx, seat, []);
  if (site !== null) world.add(carrier, ComputerColony, settledOn(env, site, [], 0, 0));
}

/** Move on from a site the seat lost: past {@link COLONY_MAX_FAILURES} the colony is abandoned where it
 *  stands, else the next site the survey offers, else no colony at all until a later survey finds one. */
function nextSite(env: ColonyEnv, colony: ColonyView): void {
  const { world, ctx, seat, carrier } = env;
  if (colony.failures >= COLONY_MAX_FAILURES) {
    const live = env.edit();
    live.phase = 'abandoned';
    live.since = ctx.tick;
    live.scout = null;
    live.ship = null;
    live.people = [];
    live.rest = [];
    return;
  }
  const site = surveyColonySite(world, ctx, seat, colony.rejected);
  if (site === null) {
    world.remove(carrier, ComputerColony);
    return;
  }
  const retryAt = colony.failures > 0 ? ctx.tick + COLONY_RETRY_TICKS : 0;
  Object.assign(env.edit(), settledOn(env, site, colony.rejected, colony.failures, retryAt));
}

/** Give the site up for good and ask {@link nextSite}. */
function rejectSite(env: ColonyEnv, colony: ColonyView): void {
  const zone = siteZone(env.world, colony);
  const live = env.edit();
  if (!live.rejected.includes(zone)) live.rejected.push(zone);
  nextSite(env, live);
}

/**
 * Site chosen: the first free moored ship takes one spare man at the helm and sails round the site's coast
 * ({@link scoutLoop}), past no peace gate: a sail refuses no target outside the peace's keep-out. A site
 * gone unclear, or with no shore the ship can land at, is rejected.
 */
export function claimScoutShip(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  if (ctx.tick < colony.retryAt) return [];
  const home = homeLandOf(env);
  const ship = home === NO_COMPONENT ? undefined : freeShips(env, home).at(-1);
  const berth = ship === undefined ? null : mooringOf(world, ship);
  if (ship === undefined || berth === null) return [];
  const helm = spareMen(world, ctx, seat).find((e) => landOf(terrain, nodeOfEntity(world, e)) === home);
  if (helm === undefined) return [];
  const { site, land } = colony;
  const clear = colonySiteClear(world, ctx, seat, site);
  const waypoints = clear ? scoutLoop(terrain, siteCoast(env, ship, colony), berth) : [];
  const shore = colonyShores(env, ship, land, { hx: site.hx, hy: site.hy })[0];
  const first = waypoints[0];
  if (shore === undefined || first === undefined) {
    rejectSite(env, colony);
    return [];
  }
  const live = env.edit();
  live.phase = 'scouting';
  live.since = ctx.tick;
  live.shore = shore;
  live.berth = { hx: berth.hx, hy: berth.hy };
  live.scout = { ship, helm, waypoints, leg: 0 };
  return [
    { kind: 'attachToVehicle', entity: helm, vehicle: ship },
    { kind: 'moveVehicle', vehicle: ship, x: first.hx, y: first.hy },
  ];
}

/** Turn every held ship for home, counting a failure, the site rejected with `reject`. */
function turnHome(env: ColonyEnv, reject: boolean): PlayerCommand[] {
  const live = env.edit();
  if (reject) {
    const zone = siteZone(env.world, live);
    if (!live.rejected.includes(zone)) live.rejected.push(zone);
  }
  live.failures++;
  live.phase = 'returning';
  live.since = env.ctx.tick;
  return heldShips(live).flatMap((ship) =>
    live.berth === null || mooredOn(env, ship, homeLandOf(env)) ? [] : [dock(ship, live.berth)],
  );
}

function heldShips(colony: ColonyView): Entity[] {
  const ships: Entity[] = [];
  if (colony.scout !== null) ships.push(colony.scout.ship);
  if (colony.ship !== null) ships.push(colony.ship);
  return ships;
}

/** Whether a rider sits inside the ship. */
function crewed(world: World, ship: Entity): boolean {
  const state = world.tryGet(ship, Vehicle);
  return state !== undefined && vehiclePassengers(state).some((rider) => rider.inside);
}

/** A voyage with no helm or hull left to bring home: the scout ship is let go. */
function loseScout(env: ColonyEnv, colony: ColonyView): void {
  const live = env.edit();
  live.failures++;
  live.scout = null;
  nextSite(env, live);
}

/**
 * Scouting: each time the ship lies still it sails for the next waypoint, and past the last it docks at
 * home. Its sight may show a rival inside the colony's range: the site is rejected and it turns home. Lost,
 * or out past the trip limit, the voyage fails. Home again it lets its helm go and the colony fits out.
 */
export function scouting(
  env: ColonyEnv,
  colony: ColonyView,
  scout: DeepReadonly<ColonyScout>,
): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const { ship, helm } = scout;
  const elapsed = ctx.tick - colony.since;
  if (!world.has(ship, Vehicle) || !world.isAlive(helm)) {
    loseScout(env, colony);
    return [];
  }
  if (elapsed >= SEA_SCOUT_TRIP_TIMEOUT_TICKS) return turnHome(env, false);
  const berth = colony.berth;
  if (scout.leg === 0 && !crewed(world, ship)) {
    if (elapsed < HELM_BOARD_TICKS || berth === null) return [];
    loseScout(env, colony);
    return [unloadAt(ship, berth)];
  }
  if (!lyingStill(world, ship) || berth === null) return [];
  const leg = scout.leg + 1;
  if (leg <= scout.waypoints.length) {
    if (!colonySiteClear(world, ctx, seat, colony.site)) return turnHome(env, true);
    const live = env.edit();
    if (live.scout !== null) live.scout.leg = leg;
    const next = scout.waypoints[leg];
    return next === undefined
      ? [dock(ship, berth)]
      : [{ kind: 'moveVehicle', vehicle: ship, x: next.hx, y: next.hy }];
  }
  const mooring = mooringOf(world, ship);
  if (mooring === null || !mooredOn(env, ship, homeLandOf(env)))
    return [dock(ship, otherShore(env, ship, berth) ?? berth)];
  const live = env.edit();
  live.phase = 'fittingOut';
  live.since = ctx.tick;
  return [unloadAt(ship, mooring)];
}

/**
 * Returning: each held ship docks at home, at another shore when that is refused, and lets its riders go
 * there. Past {@link RETURN_TIMEOUT_TICKS} a ship moored anywhere lets them go where it lies and one still at
 * sea is let go. Then the seat moves on from the site.
 */
export function returning(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const home = homeLandOf(env);
  const late = ctx.tick - colony.since >= RETURN_TIMEOUT_TICKS;
  const commands: PlayerCommand[] = [];
  let out = false;
  for (const ship of heldShips(colony)) {
    if (!world.has(ship, Vehicle)) continue;
    const mooring = mooringOf(world, ship);
    if (mooring !== null && (mooredOn(env, ship, home) || late)) commands.push(unloadAt(ship, mooring));
    else if (!late) {
      out = true;
      if (lyingStill(world, ship) && colony.berth !== null)
        commands.push(dock(ship, otherShore(env, ship, colony.berth) ?? colony.berth));
    }
  }
  if (!out) nextSite(env, colony);
  return commands;
}
