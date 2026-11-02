import {
  type ColonyScout,
  ComputerColony,
  type ComputerColonyState,
  Female,
  mapBriefOf,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
  zoneOfNode,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../nav/terrain/index.js';
import { civilianCount } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { mooringSpotsOf } from '../../vehicles/dock.js';
import { isCargoHand, isLoaderRider } from '../../vehicles/stock.js';
import { seatBaseOf } from '../base.js';
import { minutesToTicks } from '../game-phase.js';
import { freeShips, LANDING_SAIL_TIMEOUT_TICKS, otherShore } from '../military/operations/landing.js';
import { believedLand, underFire } from '../military/operations/landing-target.js';
import { nodeOfEntity } from '../military/operations/raid-target.js';
import { SEA_SCOUT_TRIP_TIMEOUT_TICKS, scoutLoop } from '../military/operations/sea-scout.js';
import { shorePoints } from '../sea-route.js';
import { holdDone, holdLoad, holdsStoreBill, manifestInStock, pinHold, wantManifest } from './cargo.js';
import { mayBuildTradeShip, TRADE_SHIP_ID } from './fleet.js';
import { COLONY_BUILDS } from './founding.js';
import { startLine } from './line.js';
import { boardOrders, pickParty, spareMen } from './people.js';
import { shoreWithStore } from './spot.js';
import { homeStockOf } from './stock.js';
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
/** How long the second ship may take once the first is home (authored). */
const COLONY_FIT_OUT_TICKS = minutesToTicks(20);
/** How long a party loads before it sails with what it has (authored). Seen on
 *  arabskie_wyspy_wolna_gra_mieszana: eight hands bring 34 to 46 units in it. */
const COLONY_LOAD_TICKS = minutesToTicks(6);
/** How long a ship may sail out (authored: a landing's sail limit). */
const COLONY_SAIL_TICKS = LANDING_SAIL_TIMEOUT_TICKS;
/** The men kept aboard beside the helm to empty the hold. */
const COLONY_LANDING_HANDS = 5;
/** How long they get before they step ashore and leave what is left aboard (authored). */
const COLONY_UNLOAD_TICKS = minutesToTicks(5);
/** The shores a site's fire test keeps, nearest the site first (authored): spaced ten nodes apart, these span
 *  about the block's coast, so {@link shoreWithStore} has real choices to weigh. */
const SHORE_CANDIDATES = 12;

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
  const shore = shoreWithStore(env, land, colonyShores(env, ship, land, { hx: site.hx, hy: site.hy }));
  const first = waypoints[0];
  if (shore === null || first === undefined) {
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

function shipId(env: ColonyEnv, ship: Entity): string | undefined {
  const type = env.world.tryGet(ship, Vehicle)?.vehicleType;
  return type === undefined ? undefined : contentIndex(env.ctx.content).vehicles.get(type)?.id;
}

/** The seat's free moored ship that may carry its colony: a trade ship where its tribe builds one. */
export function carryingShip(env: ColonyEnv): Entity | null {
  const { world, ctx, seat } = env;
  const wantsTrade = mayBuildTradeShip(world, ctx, seat);
  const free = freeShips(env, homeLandOf(env));
  return free.find((e) => !wantsTrade || shipId(env, e) === TRADE_SHIP_ID) ?? null;
}

/** Hand the party to the ships: the colony ship's seats, and with a `scout` ship the rest behind a man at
 *  its helm. */
function splitParty(
  world: World,
  party: readonly Entity[],
  ship: Entity,
  scout: Entity | null,
): { readonly people: Entity[]; readonly rest: Entity[] } {
  const seats = world.get(ship, Vehicle).passengers.length;
  if (scout === null) return { people: party.slice(0, seats), rest: [] };
  const men = party.filter((e) => !world.has(e, Female));
  const women = party.filter((e) => world.has(e, Female));
  const helm = men.pop();
  const people = [...men, ...women].slice(0, seats);
  const rest = [...men, ...women].slice(seats);
  return { people, rest: helm === undefined ? rest : [helm, ...rest] };
}

/**
 * Fitting out: the second ship is claimed as soon as it lies free. Past {@link COLONY_FIT_OUT_TICKS} with
 * none the scout ship carries the whole party; with no ship at all the voyage fails. The same span then runs
 * for the manifest to lie in the home stock and a party to be spared: the site is looked at once more and
 * loading starts. A scout ship the party does not need goes free here.
 */
export function fittingOut(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const late = ctx.tick - colony.since >= COLONY_FIT_OUT_TICKS;
  if (colony.ship === null) {
    const ship = carryingShip(env) ?? (late ? (colony.scout?.ship ?? null) : null);
    if (ship === null) return late ? turnHome(env, false) : [];
    const live = env.edit();
    live.ship = ship;
    live.since = ctx.tick;
    if (ship === colony.scout?.ship) live.scout = null;
    return [];
  }
  const ship = colony.ship;
  if (!world.has(ship, Vehicle)) {
    env.edit().ship = null;
    return [];
  }
  if (late) return turnHome(env, false);
  const home = homeLandOf(env);
  if (!mooredOn(env, ship, home) || !manifestInStock(world, ctx, homeStockOf(world, ctx, seat), ship))
    return [];
  const party = pickParty(world, ctx, seat, home);
  if (party.length === 0) return [];
  if (!colonySiteClear(world, ctx, seat, colony.site)) return turnHome(env, true);
  const tradeShip = shipId(env, ship) === TRADE_SHIP_ID ? (colony.scout?.ship ?? null) : null;
  const { people, rest } = splitParty(world, party, ship, tradeShip);
  const live = env.edit();
  live.phase = 'loading';
  live.since = ctx.tick;
  live.people = people;
  live.rest = rest;
  if (tradeShip === null) live.scout = null;
  else if (live.scout !== null && rest[0] !== undefined) live.scout.helm = rest[0];
  return [...boardOrders(world, people, ship), ...wantManifest(ctx, ship)];
}

/** The home could not fill the hold: the party goes back to work, what lies aboard stays, and the fit-out
 *  waits on the rest. */
function backToFittingOut(env: ColonyEnv, ship: Entity): PlayerCommand[] {
  const mooring = mooringOf(env.world, ship);
  const live = env.edit();
  live.phase = 'fittingOut';
  live.since = env.ctx.tick;
  live.people = [];
  live.rest = [];
  return mooring === null ? [] : [unloadAt(ship, mooring)];
}

/**
 * Loading: the riders fetch the manifest until the hold is done or {@link COLONY_LOAD_TICKS} pass, twice that
 * while it lacks a warehouse's bill, and then the party goes back ashore. Else the hold is pinned, or hands would
 * fetch at the far shore, and each ship docks at a shore of its own, boarding its crew first.
 */
export function loading(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const ship = colony.ship;
  if (ship === null || !world.has(ship, Vehicle)) return turnHome(env, false);
  const elapsed = ctx.tick - colony.since;
  const billed = holdsStoreBill(world, ctx, ship);
  if (!holdDone(world, ship) && (elapsed < COLONY_LOAD_TICKS || (!billed && elapsed < 2 * COLONY_LOAD_TICKS)))
    return [];
  if (!billed) return backToFittingOut(env, ship);
  if (!colonySiteClear(world, ctx, seat, colony.site)) return turnHome(env, true);
  const shores = colonyShores(env, ship, colony.land, { hx: colony.site.hx, hy: colony.site.hy });
  const shore = shoreWithStore(env, colony.land, shores);
  if (shore === null) return turnHome(env, true);
  const second = shores.find((at) => at !== shore);
  const live = env.edit();
  live.phase = 'sailing';
  live.since = ctx.tick;
  live.shore = shore;
  const commands = [...pinHold(world, ship), dock(ship, shore)];
  const scout = colony.scout?.ship;
  if (scout !== undefined && world.has(scout, Vehicle))
    commands.push(...boardOrders(world, colony.rest, scout), dock(scout, second ?? shore));
  return commands;
}

/**
 * Sailing: the colony ship moored on the site's land ends it. A dock refused or spent short goes to another
 * shore of that land. The ship lost, nobody lands and the voyage fails; out past {@link COLONY_SAIL_TICKS}
 * every ship turns home.
 */
export function sailing(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const { ship, shore } = colony;
  if (ship === null || !world.has(ship, Vehicle)) return turnHome(env, false);
  if (mooredOn(env, ship, colony.land)) {
    const live = env.edit();
    live.phase = 'landing';
    live.since = ctx.tick;
    return [];
  }
  if (ctx.tick - colony.since >= COLONY_SAIL_TICKS) return turnHome(env, false);
  if (!lyingStill(world, ship) || shore === null) return [];
  const next = otherShore(env, ship, shore) ?? shore;
  env.edit().shore = next;
  return [dock(ship, next)];
}

/** The riders of `ship` but its helm, and with `hands` that many men besides, step ashore. */
function setAshore(world: World, ctx: SystemContext, ship: Entity, hands: number): PlayerCommand[] {
  const state = world.tryGet(ship, Vehicle);
  if (state === undefined) return [];
  const helm = vehicleCommander(state);
  let kept = 0;
  const commands: PlayerCommand[] = [];
  for (const seat of vehiclePassengers(state)) {
    if (seat.entity === helm || !world.isAlive(seat.entity)) continue;
    if (
      kept < hands &&
      isCargoHand(world, ctx.content, ship, seat.entity) &&
      isLoaderRider(world, ctx.content, seat.entity)
    ) {
      kept++;
      continue;
    }
    commands.push({ kind: 'detachFromVehicle', entity: seat.entity });
  }
  return commands;
}

/** The scout ship's part of a landing: moored on the site's land it sets the rest ashore and sails home
 *  with its helm, who steps off there and goes back to the seat, and the ship with him. */
export function bringScoutHome(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const scout = colony.scout;
  if (scout === null) return [];
  if (!world.has(scout.ship, Vehicle) || !world.isAlive(scout.helm)) {
    env.edit().scout = null;
    return [];
  }
  if (!lyingStill(world, scout.ship) || colony.berth === null) return [];
  const riders = world.tryGet(scout.ship, Vehicle);
  if (riders !== undefined && vehiclePassengers(riders).length > 1) {
    if (mooredOn(env, scout.ship, colony.land)) return setAshore(world, ctx, scout.ship, 0);
    if (mooredOn(env, scout.ship, homeLandOf(env)) || colony.shore === null) return [];
    return [dock(scout.ship, otherShore(env, scout.ship, colony.shore) ?? colony.shore)];
  }
  const mooring = mooringOf(world, scout.ship);
  if (mooring === null || !mooredOn(env, scout.ship, homeLandOf(env)))
    return [dock(scout.ship, otherShore(env, scout.ship, colony.berth) ?? colony.berth)];
  const live = env.edit();
  live.scout = null;
  live.rest = live.rest.filter((e) => e !== scout.helm);
  return [unloadAt(scout.ship, mooring)];
}

/**
 * Landing: at the shore every rider but the helm and {@link COLONY_LANDING_HANDS} hands steps ashore, and the
 * hands empty the hold into a warehouse within reach, or onto the ground at their feet. Founding starts as
 * the passengers stand ashore. The hands follow them once the hold is empty, or past {@link COLONY_UNLOAD_TICKS}.
 */
export function landing(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const ship = colony.ship;
  if (ship === null || !world.has(ship, Vehicle)) return turnHome(env, false);
  const live = env.edit();
  live.phase = 'founding';
  live.since = ctx.tick;
  live.builds = COLONY_BUILDS.map((building) => ({ building, placed: false }));
  return [
    { kind: 'clearVehicleWanted', vehicle: ship },
    ...setAshore(world, ctx, ship, COLONY_LANDING_HANDS),
  ];
}

/** Whether the hold is empty or out of time: the hands are done. */
export function unloaded(env: ColonyEnv, colony: ColonyView, ship: Entity): boolean {
  return holdLoad(env.world, ship) === 0 || env.ctx.tick - colony.since >= COLONY_UNLOAD_TICKS;
}

/** What a founding colony's ships still do: the scout ship goes home, and an unloaded colony ship turns
 *  into the shipping line, or, sunk first, leaves the seat owing one. */
export function afterLanding(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const commands = bringScoutHome(env, colony);
  const ship = colony.ship;
  if (ship !== null && !env.world.has(ship, Vehicle)) env.edit().ship = null;
  else if (ship !== null && mooringOf(env.world, ship) !== null && unloaded(env, colony, ship))
    commands.push(...startLine(env, colony, ship));
  return commands;
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
 * Returning: each held ship docks at home, at another shore when that is refused, empties its hold and lets
 * its riders go there. Past {@link RETURN_TIMEOUT_TICKS} a ship moored anywhere lets them go where it lies and one still at
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
    if (mooring !== null && mooredOn(env, ship, home) && !late && holdLoad(world, ship) > 0) {
      out = true;
      commands.push({ kind: 'clearVehicleWanted', vehicle: ship });
    } else if (mooring !== null && (mooredOn(env, ship, home) || late))
      commands.push(unloadAt(ship, mooring));
    else if (!late) {
      out = true;
      if (lyingStill(world, ship) && colony.berth !== null)
        commands.push(dock(ship, otherShore(env, ship, colony.berth) ?? colony.berth));
    }
  }
  if (!out) nextSite(env, colony);
  return commands;
}
