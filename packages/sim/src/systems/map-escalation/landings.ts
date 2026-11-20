import type { MapSiege, MapSiegeTarget } from '@open-northland/data';
import {
  FOG_MODE,
  fogMode,
  type MapEscalationLandingRecord,
  mapEscalationProgress,
  Vehicle,
  VehicleDrive,
  vehiclePassengers,
  writeMapEscalation,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { removeSettlerSilently } from '../lifecycle/death.js';
import { spawnSettler } from '../spawn/index.js';
import { createVehicle } from '../vehicles/create.js';
import { attachToVehicle, boardRider, unloadPeople } from '../vehicles/crew.js';
import { dockVehicle } from '../vehicles/dock.js';
import { startVehicleDrive } from '../vehicles/movement.js';
import { removeVehicle } from '../vehicles/remove.js';
import { enlistAttackMan } from './focus.js';
import { occupiedTargets, siegeTribe } from './keep.js';

type LandingPoints = MapSiegeTarget['landings'][number];

// A wave's sea landing: each of its ships against a seat appears at the next of the seat's sea spawn
// points with the fresh men aboard, docks at that point's shore, sets them ashore, then sails back and
// leaves the map. The men belong to the raider seat like the land band and go for the same aim.

/**
 * Send `ships` ships against the target, one from each of its first landing points, each with `jobs`
 * aboard, owned by the target's raider. Returns the men aboard.
 */
export function launchLandings(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  target: MapSiegeTarget,
  ships: number,
  jobs: readonly number[],
): Entity[] {
  const men: Entity[] = [];
  for (let point = 0; point < Math.min(ships, target.landings.length); point++)
    men.push(...launchShip(world, ctx, siege, target, point, jobs));
  return men;
}

/**
 * Put `jobs` aboard a fresh ship at the landing's sea spawn point and send it to dock at its shore. The
 * men past its seats, the commander's included, stay home. Returns the men aboard; none when the ship
 * cannot be made or finds no way to the shore.
 */
function launchShip(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  target: MapSiegeTarget,
  point: number,
  jobs: readonly number[],
): Entity[] {
  const landings = siege.landings;
  const points = target.landings[point];
  const terrain = ctx.terrain;
  if (landings === undefined || points === undefined || terrain === undefined || jobs.length === 0) return [];
  const vehicleType = contentIndex(ctx.content).vehicleTypeBySlug.get(landings.vehicle);
  const tribe = siegeTribe(ctx, siege);
  if (vehicleType === undefined || tribe === undefined || !terrain.inBounds(points.spawnX, points.spawnY))
    return [];
  const ship = createVehicle(world, ctx, {
    vehicleType,
    x: points.spawnX,
    y: points.spawnY,
    tribe,
    owner: target.raider,
  });
  if (ship === null) return [];
  const men = boardMen(world, ctx, tribe, target, points, ship, jobs);
  const sails =
    men.length > 0 &&
    dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle: ship, x: points.x, y: points.y });
  if (!sails) {
    scrapLanding(world, ctx, ship);
    return [];
  }
  writeMapEscalation(world, (progress) => {
    progress.landings.push({ ship, seat: target.seat, point, seen: null, leg: 'inbound' });
  });
  return men;
}

/** Each man is born on the landing shore and stepped aboard at once, the way a map seats a crew
 *  inside a vehicle; the first takes the commander's seat. */
function boardMen(
  world: World,
  ctx: SystemContext,
  tribe: number,
  target: MapSiegeTarget,
  points: LandingPoints,
  ship: Entity,
  jobs: readonly number[],
): Entity[] {
  const men: Entity[] = [];
  for (const jobType of jobs) {
    if (!world.get(ship, Vehicle).passengers.includes(null)) break;
    const e = spawnSettler(world, ctx, {
      kind: 'spawnSettler',
      jobType,
      tribe,
      x: points.x,
      y: points.y,
      owner: target.raider,
    });
    if (e === null) continue;
    if (!attachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: e, vehicle: ship })) {
      removeSettlerSilently(world, e);
      continue;
    }
    boardRider(world, e, ship);
    enlistAttackMan(world, e);
    men.push(e);
  }
  return men;
}

/**
 * Move each ship under way on: an inbound one that moored sets its men ashore and turns back, scrapped
 * instead when the shore leaves any aboard; one that stopped short is sent to dock again, and scrapped
 * with whoever is aboard when no way is left; an outbound one that arrived, or stopped, leaves the map.
 * A ship gone (sunk) is forgotten.
 */
export function landingsTurn(world: World, ctx: SystemContext, siege: MapSiege): void {
  const landings = mapEscalationProgress(world).landings;
  if (landings.length === 0) return;
  const kept: MapEscalationLandingRecord[] = [];
  for (const landing of landings) {
    const { ship, point } = landing;
    const state = world.tryGet(ship, Vehicle);
    const points = siege.attacks.targets.find((target) => target.seat === landing.seat)?.landings[point];
    if (state === undefined || points === undefined) continue;
    const underWay = world.has(ship, VehicleDrive);
    if (landing.leg === 'outbound') {
      if (underWay) kept.push(copyRecord(landing));
      else removeVehicle(world, ctx, ship, 'script');
      continue;
    }
    if (state.moored && state.mooring?.hx === points.x && state.mooring.hy === points.y) {
      unloadPeople(world, ctx, { kind: 'unloadPeople', vehicle: ship });
      // Nobody stays aboard an outbound ship: men the shore had no room for are scrapped with it.
      if (aboard(world, ship).length > 0) scrapLanding(world, ctx, ship);
      else if (sailOut(world, ctx, ship, points)) kept.push({ ...copyRecord(landing), leg: 'outbound' });
      else removeVehicle(world, ctx, ship, 'script');
      continue;
    }
    // A ship stopped short of its shore, its `docks` task left standing or not, is sent to dock again.
    if (underWay || dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle: ship, x: points.x, y: points.y }))
      kept.push(copyRecord(landing));
    else scrapLanding(world, ctx, ship);
  }
  writeMapEscalation(world, (progress) => {
    progress.landings = kept;
  });
}

function copyRecord(landing: DeepReadonly<MapEscalationLandingRecord>): MapEscalationLandingRecord {
  return { ...landing, seen: landing.seen === null ? null : { ...landing.seen } };
}

/** How far a ship sails from where the players' view was last revealed before it is revealed again, in
 *  map points: well inside the reveal, so the ship never leaves the revealed water. */
const REVEAL_STEP = 2;

/**
 * Reveal the water around every ship under way to each occupied target seat, again each
 * time the ship moved {@link REVEAL_STEP} from the last reveal, so the players watch it the whole voyage.
 * The reveal stays, as a script's reveal does. Costs a position read per ship per tick and a reveal per
 * move.
 */
export function revealShips(world: World, ctx: SystemContext, siege: MapSiege): void {
  const radius = siege.landings?.revealNodes ?? 0;
  const fog = ctx.fog;
  const landings = mapEscalationProgress(world).landings;
  if (radius === 0 || fog === undefined || landings.length === 0 || fogMode(world) === FOG_MODE.OFF) return;
  const moved: Array<{ index: number; at: HalfCellNode }> = [];
  let watchers: ReturnType<typeof occupiedTargets> | undefined;
  landings.forEach((landing, index) => {
    const at = vehicleAnchor(world, landing.ship);
    if (at === null) return;
    const seen = landing.seen;
    if (seen !== null && hexDistanceBetween(seen.hx, seen.hy, at.hx, at.hy) < REVEAL_STEP) return;
    watchers ??= occupiedTargets(world, siege);
    for (const target of watchers) fog.revealArea(target.seat, at, radius);
    moved.push({ index, at });
  });
  if (moved.length === 0) return;
  writeMapEscalation(world, (progress) => {
    for (const { index, at } of moved) {
      const record = progress.landings[index];
      if (record !== undefined) record.seen = { hx: at.hx, hy: at.hy };
    }
  });
}

/** Send the emptied ship back to its spawn point. A ship sails on with nobody aboard, so the drive
 *  needs no commander. */
function sailOut(world: World, ctx: SystemContext, ship: Entity, points: LandingPoints): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false;
  if (!startVehicleDrive(world, ctx, terrain, ship, terrain.nodeAt(points.spawnX, points.spawnY)))
    return false;
  const live = world.mut(ship, Vehicle);
  live.task = 'none';
  live.mooring = null;
  return true;
}

/** The living men aboard the ship. */
function aboard(world: World, ship: Entity): Entity[] {
  const state = world.tryGet(ship, Vehicle);
  if (state === undefined) return [];
  return vehiclePassengers(state)
    .map((seat) => seat.entity)
    .filter((e) => world.isAlive(e));
}

/**
 * A ship that cannot land leaves the map with its men, who never set foot ashore. They leave the attack
 * too, and its sent count, so they never count as its dead.
 */
function scrapLanding(world: World, ctx: SystemContext, ship: Entity): void {
  const men = aboard(world, ship);
  for (const e of men) removeSettlerSilently(world, e);
  removeVehicle(world, ctx, ship, 'script');
  const attack = mapEscalationProgress(world).attack;
  if (attack === null) return;
  const gone = new Set(men);
  const kept = attack.men.filter((e) => !gone.has(e));
  if (kept.length === attack.men.length) return;
  writeMapEscalation(world, (progress) => {
    if (progress.attack === null) return;
    progress.attack.sent -= progress.attack.men.length - kept.length;
    progress.attack.men = kept;
  });
}
