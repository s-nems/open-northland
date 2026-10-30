import { Building, fightsPlayer, Health, MAX_PLAYERS, Vehicle } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { buildingCombatClass } from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { VEHICLE_TARGET_SNAP_RADIUS } from '../../../vehicles/movement.js';
import { believedBuildings } from '../../knowledge/intel/index.js';
import { clampNode, continentOf, nodeOf } from './geometry.js';
import { driveCatapult } from './orders.js';

// A wave's catapults at its objective: the towers first, then the objective. Every radius is an
// approximation.

/** How far around the objective an enemy tower is part of the siege. */
export const SIEGE_TOWER_RADIUS_NODES = 40;

/** How long the catapults stay on the towers before they go in on the objective whatever towers still
 *  stand: a tower no catapult can find a firing spot for would otherwise hold them forever. */
export const SIEGE_TIMEOUT_TICKS = 180 * TICKS_PER_SECOND;

/**
 * The catapults of a wave sent in on `objective`: while the siege lasts, each one not already firing at one
 * goes at the enemy tower nearest it within {@link SIEGE_TOWER_RADIUS_NODES} of the objective whose door
 * stands on its continent; with no such tower, or once the siege has lasted {@link SIEGE_TIMEOUT_TICKS}
 * from `since`, they attack-move onto the objective. The men never wait for them.
 */
export function siegeOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  catapults: readonly Entity[],
  objective: NodeId,
  since: number,
): PlayerCommand[] {
  if (catapults.length === 0) return [];
  const besieging = ctx.tick - since < SIEGE_TIMEOUT_TICKS;
  const towers = besieging ? siegeableTowers(world, ctx, terrain, player, objective, catapults) : [];
  if (towers.length === 0) {
    const goal = nodeOf(terrain, objective);
    return catapults.flatMap((vehicle) => driveCatapult(world, vehicle, goal, VEHICLE_TARGET_SNAP_RADIUS));
  }
  const commands: PlayerCommand[] = [];
  const towerSet = new Set(towers.map(({ tower }) => tower));
  for (const vehicle of catapults) {
    const attack = world.get(vehicle, Vehicle).attack;
    if (attack?.ordered === true && attack.target.kind === 'entity' && towerSet.has(attack.target.entity))
      continue;
    const command = catapultOnNearest(world, terrain, vehicle, towers);
    if (command !== null) commands.push(command);
  }
  return commands;
}

/** A building the catapults may drive up to, with the continent its door stands on. */
export interface SiegeTarget {
  readonly tower: Entity;
  readonly continent: number;
}

/** `vehicle` on the target nearest it whose door stands on its own continent, or null when none does. */
export function catapultOnNearest(
  world: World,
  terrain: TerrainGraph,
  vehicle: Entity,
  targets: readonly SiegeTarget[],
): PlayerCommand | null {
  const at = vehicleAnchor(world, vehicle);
  if (at === null) return null;
  const continent = continentOf(terrain, at);
  const reachable = targets.filter((t) => t.continent === continent).map(({ tower }) => tower);
  const tower = nearestTower(world, terrain, reachable, at);
  return tower === null
    ? null
    : { kind: 'attackWithVehicle', vehicle, target: { kind: 'entity', entity: tower } };
}

/** The towers near `objective` the seat sees and a catapult may drive up to, ascending id; a tower on
 *  another continent is left to the assault, one remembered out of sight until the wave sees it. */
function siegeableTowers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  objective: NodeId,
  catapults: readonly Entity[],
): SiegeTarget[] {
  return onCatapultContinents(
    world,
    ctx,
    terrain,
    believedTowersNear(world, ctx, terrain, player, objective)
      .filter(({ seen }) => seen)
      .map(({ entity }) => entity),
    catapults,
  );
}

/** Those of `buildings` whose door stands on the continent of one of `catapults`, in their order. */
export function onCatapultContinents(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  buildings: readonly Entity[],
  catapults: readonly Entity[],
): SiegeTarget[] {
  const continents = new Set<number>();
  for (const vehicle of catapults) {
    const at = vehicleAnchor(world, vehicle);
    const continent = at === null ? NO_COMPONENT : continentOf(terrain, at);
    if (continent !== NO_COMPONENT) continents.add(continent);
  }
  return buildings.flatMap((tower) => {
    const continent = terrain.componentOf(interactionCell(world, ctx, terrain, tower));
    return continents.has(continent) ? [{ tower, continent }] : [];
  });
}

/** A tower the seat believes stands near an objective; `seen` when it may be read live and named in an
 *  order. */
interface BelievedTower {
  readonly entity: Entity;
  readonly node: HalfCellNode;
  readonly seen: boolean;
}

/**
 * The enemy towers within {@link SIEGE_TOWER_RADIUS_NODES} of `objective` the seat believes stand
 * ({@link believedBuildings}): the seen ones with hitpoints left and the remembered ones out of sight,
 * ascending id. Read per enemy, so the cost is their buildings, like the campaign's target scan.
 */
function believedTowersNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  objective: NodeId,
): BelievedTower[] {
  const at = nodeOf(terrain, objective);
  const near = (node: HalfCellNode): boolean => nodeManhattan(node, at) <= SIEGE_TOWER_RADIUS_NODES;
  const towers: BelievedTower[] = [];
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === player || !fightsPlayer(world, player, other)) continue;
    const { seen, remembered } = believedBuildings(world, ctx, player, other);
    for (const e of seen) {
      if (buildingCombatClass(ctx, world.get(e, Building).buildingType) !== 'tower') continue;
      if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
      const node = anchorNodeOf(world, e);
      if (node !== null && near(node)) towers.push({ entity: e, node, seen: true });
    }
    for (const b of remembered) {
      const node = { hx: b.hx, hy: b.hy };
      if (buildingCombatClass(ctx, b.buildingType) === 'tower' && near(node))
        towers.push({ entity: b.entity, node, seen: false });
    }
  }
  return towers.sort((x, y) => x.entity - y.entity);
}

/** The anchors of the enemy towers the seat believes stand near `objective` ({@link believedTowersNear}):
 *  the ground the gathering point keeps clear of. */
export function enemyTowerNodesNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  objective: NodeId,
): HalfCellNode[] {
  return believedTowersNear(world, ctx, terrain, player, objective).map(({ node }) => node);
}

function nearestTower(
  world: World,
  terrain: TerrainGraph,
  towers: readonly Entity[],
  from: HalfCellNode,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tower of towers) {
    const node = anchorNodeOf(world, tower);
    if (node === null) continue;
    const distance = nodeManhattan(clampNode(terrain, node), from);
    if (distance < bestDistance) {
      best = tower;
      bestDistance = distance;
    }
  }
  return best;
}
