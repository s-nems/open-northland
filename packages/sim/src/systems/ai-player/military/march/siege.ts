import { Building, diplomacyStance, Health, MAX_PLAYERS, Vehicle } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { buildingCombatClass, MILITARY_MODE } from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { VEHICLE_TARGET_SNAP_RADIUS } from '../../../vehicles/movement.js';
import { anchorNodeOf } from '../../node-geometry.js';
import { ownedBuildings } from '../../seat-roster.js';
import { isRangedFighter } from '../census.js';
import { formation, type WaveMarchView } from './formation.js';
import { clampNode, manhattanOf, nodeOf } from './geometry.js';
import { driveCatapult, type Fire, orderable, placeOrders, ringOrders, type Wave } from './orders.js';

// A wave at its objective: the towers first, then everybody in. Every radius is an approximation.

/** How far around the objective an enemy tower is part of the siege. */
export const SIEGE_TOWER_RADIUS_NODES = 40;

/** How long the siege lasts before everybody goes in on the objective whatever towers still stand: a
 *  tower no catapult can find a firing spot for would otherwise hold the wave forever. */
export const SIEGE_TIMEOUT_TICKS = 180 * TICKS_PER_SECOND;

/**
 * The wave at its last leg end. With catapults and an enemy tower within {@link SIEGE_TOWER_RADIUS_NODES}
 * of the objective whose door stands on a catapult's continent, the catapults and the archers go at the
 * towers, each at the one nearest it, while the melee holds its ranks behind the catapult line on the IGNORE
 * stance. Otherwise, or once the siege has lasted {@link SIEGE_TIMEOUT_TICKS}, everybody goes in on the
 * objective: the men as `marchOrders` (`muster.ts`) sends a wave, the catapults on an attack-move to it.
 */
export function arrivalOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  state: WaveMarchView,
  wave: Wave,
  objective: NodeId,
  fire: readonly Fire[],
): PlayerCommand[] {
  const besieging = wave.catapults.length > 0 && ctx.tick - state.legSince < SIEGE_TIMEOUT_TICKS;
  const towers = besieging ? siegeableTowers(world, ctx, terrain, player, objective, wave.catapults) : [];
  if (towers.length === 0) {
    const goal = nodeOf(terrain, objective);
    return [
      ...ringOrders(world, terrain, wave.men, objective),
      ...wave.catapults.flatMap((vehicle) => driveCatapult(world, vehicle, goal, VEHICLE_TARGET_SNAP_RADIUS)),
    ];
  }
  const commands: PlayerCommand[] = [];
  const towerSet = new Set(towers.map(({ tower }) => tower));
  for (const vehicle of wave.catapults) {
    const attack = world.get(vehicle, Vehicle).attack;
    if (attack?.ordered === true && attack.target.kind === 'entity' && towerSet.has(attack.target.entity))
      continue;
    const at = vehicleAnchor(world, vehicle);
    if (at === null) continue;
    const continent = continentOf(terrain, at);
    const reachable = towers.filter((t) => t.continent === continent).map(({ tower }) => tower);
    const tower = nearestTower(world, terrain, reachable, at);
    if (tower !== null)
      commands.push({ kind: 'attackWithVehicle', vehicle, target: { kind: 'entity', entity: tower } });
  }
  const melee: Entity[] = [];
  const all = [...towerSet];
  for (const e of wave.men) {
    if (!isRangedFighter(world, ctx, e)) {
      melee.push(e);
      continue;
    }
    if (!orderable(world, e)) continue;
    const tower = nearestTower(world, terrain, all, nodeOf(terrain, entityNode(world, terrain, e)));
    if (tower !== null) commands.push({ kind: 'attackUnit', entity: e, target: tower });
  }
  // IGNORE, not DEFEND: a tower inside a defender's search would draw the melee into its fire.
  const places = formation(world, ctx, terrain, state, wave.members, wave.catapults);
  return [...commands, ...placeOrders(world, ctx, terrain, melee, places, fire, MILITARY_MODE.IGNORE)];
}

/** The towers near `objective` whose door stands on the continent of one of `catapults`, ascending id:
 *  the ones a catapult may drive up to. A tower on another continent is left to the assault. */
function siegeableTowers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  objective: NodeId,
  catapults: readonly Entity[],
): { readonly tower: Entity; readonly continent: number }[] {
  const continents = new Set<number>();
  for (const vehicle of catapults) {
    const at = vehicleAnchor(world, vehicle);
    const continent = at === null ? NO_COMPONENT : continentOf(terrain, at);
    if (continent !== NO_COMPONENT) continents.add(continent);
  }
  return enemyTowersNear(world, ctx, terrain, player, objective).flatMap((tower) => {
    const continent = terrain.componentOf(interactionCell(world, ctx, terrain, tower));
    return continents.has(continent) ? [{ tower, continent }] : [];
  });
}

function continentOf(terrain: TerrainGraph, at: HalfCellNode): number {
  return terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy));
}

/**
 * The standing enemy towers within {@link SIEGE_TOWER_RADIUS_NODES} of `objective`, ascending id. Read off
 * the rosters of the seat's enemies, so the cost is their buildings, like the campaign's target scan.
 */
function enemyTowersNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  objective: NodeId,
): Entity[] {
  const at = nodeOf(terrain, objective);
  const towers: Entity[] = [];
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === player || diplomacyStance(world, player, other) !== 'enemy') continue;
    for (const e of ownedBuildings(world, other)) {
      if (buildingCombatClass(ctx, world.get(e, Building).buildingType) !== 'tower') continue;
      if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
      const node = anchorNodeOf(world, e);
      if (node !== null && manhattanOf(node, at) <= SIEGE_TOWER_RADIUS_NODES) towers.push(e);
    }
  }
  return towers.sort((a, b) => a - b);
}

export function enemyTowerNodesNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  objective: NodeId,
): HalfCellNode[] {
  return enemyTowersNear(world, ctx, terrain, player, objective).flatMap((tower) => {
    const node = anchorNodeOf(world, tower);
    return node === null ? [] : [node];
  });
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
    const distance = manhattanOf(clampNode(terrain, node), from);
    if (distance < bestDistance) {
      best = tower;
      bestDistance = distance;
    }
  }
  return best;
}
