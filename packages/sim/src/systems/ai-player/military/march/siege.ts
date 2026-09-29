import { Building, diplomacyStance, Health, MAX_PLAYERS, Vehicle } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { buildingCombatClass, MILITARY_MODE } from '../../../readviews/index.js';
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

/**
 * The wave at its last leg end. With catapults and an enemy tower within {@link SIEGE_TOWER_RADIUS_NODES}
 * of the objective, the catapults and the archers go at the towers, each at the one nearest it, while the
 * melee holds its ranks behind the catapult line on the IGNORE stance. Otherwise everybody goes in on the
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
  const towers = wave.catapults.length === 0 ? [] : enemyTowersNear(world, ctx, terrain, player, objective);
  if (towers.length === 0) {
    const goal = nodeOf(terrain, objective);
    return [
      ...ringOrders(world, terrain, wave.men, objective),
      ...wave.catapults.flatMap((vehicle) => driveCatapult(world, vehicle, goal, VEHICLE_TARGET_SNAP_RADIUS)),
    ];
  }
  const commands: PlayerCommand[] = [];
  const towerSet = new Set(towers);
  for (const vehicle of wave.catapults) {
    const attack = world.get(vehicle, Vehicle).attack;
    if (attack?.ordered === true && attack.target.kind === 'entity' && towerSet.has(attack.target.entity))
      continue;
    const at = vehicleAnchor(world, vehicle);
    const tower = at === null ? null : nearestTower(world, terrain, towers, at);
    if (tower !== null)
      commands.push({ kind: 'attackWithVehicle', vehicle, target: { kind: 'entity', entity: tower } });
  }
  const melee: Entity[] = [];
  for (const e of wave.men) {
    if (!isRangedFighter(world, ctx, e)) {
      melee.push(e);
      continue;
    }
    if (!orderable(world, e)) continue;
    const tower = nearestTower(world, terrain, towers, nodeOf(terrain, entityNode(world, terrain, e)));
    if (tower !== null) commands.push({ kind: 'attackUnit', entity: e, target: tower });
  }
  // IGNORE, not DEFEND: a tower inside a defender's search would draw the melee into its fire.
  const places = formation(world, ctx, terrain, state, wave.members, wave.catapults);
  return [...commands, ...placeOrders(world, ctx, terrain, melee, places, fire, MILITARY_MODE.IGNORE)];
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
