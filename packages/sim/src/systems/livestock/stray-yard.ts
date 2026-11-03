import { Building } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ownedBuildings } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';

interface YardDoor {
  readonly entity: Entity;
  readonly cell: NodeId;
  readonly x: number;
  readonly y: number;
}

/** A balanced door tree: distant stock searches actual yards rather than rings of empty map nodes. */
export interface StrayYard {
  readonly door: YardDoor;
  readonly splitX: boolean;
  readonly left: StrayYard | null;
  readonly right: StrayYard | null;
}

/** Per land component, the yard an animal standing on it walks to. */
export type StrayYards = ReadonlyMap<number, StrayYard>;

/** The doors one land offers: its headquarters alone, else its finished storehouses, else every finished
 *  building. */
interface LandDoors {
  headquarters: YardDoor | null;
  storageOnly: boolean;
  readonly doors: YardDoor[];
}

/**
 * Built once per owner and assignment sweep, from the highest available building priority of each land:
 * an animal never walks to a yard across water, so a settlement on another island keeps its own strays.
 */
export function strayYardOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): StrayYards {
  const types = contentIndex(ctx.content).buildings;
  const lands = new Map<number, LandDoors>();
  for (const e of ownedBuildings(world, player)) {
    const building = world.get(e, Building);
    if (building.built < ONE) continue;
    const type = types.get(building.buildingType);
    if (type === undefined) continue;
    const cell = interactionNodeId(world, ctx, terrain, e);
    if (cell === null) continue;
    const component = terrain.componentOf(cell);
    let land = lands.get(component);
    if (land === undefined) {
      land = { headquarters: null, storageOnly: false, doors: [] };
      lands.set(component, land);
    }
    if (land.headquarters !== null) continue;
    const door = { entity: e, cell, ...terrain.coordsOf(cell) };
    if (type.id === HEADQUARTERS_BUILDING_ID) {
      land.headquarters = door;
      continue;
    }
    if (type.kind === 'storage' && !land.storageOnly) {
      land.doors.length = 0;
      land.storageOnly = true;
    }
    if (!land.storageOnly || type.kind === 'storage') land.doors.push(door);
  }
  const yards = new Map<number, StrayYard>();
  for (const [component, land] of lands) {
    const yard =
      land.headquarters === null
        ? doorTree(land.doors, true)
        : { door: land.headquarters, splitX: true, left: null, right: null };
    if (yard !== null) yards.set(component, yard);
  }
  return yards;
}

function doorTree(doors: YardDoor[], splitX: boolean): StrayYard | null {
  const axis = splitX ? 'x' : 'y';
  doors.sort((a, b) => a[axis] - b[axis] || a.entity - b.entity);
  const middle = Math.floor(doors.length / 2);
  const door = doors[middle];
  if (door === undefined) return null;
  return {
    door,
    splitX,
    left: doorTree(doors.slice(0, middle), !splitX),
    right: doorTree(doors.slice(middle + 1), !splitX),
  };
}

/** The nearest door of the yard on the animal's land by Manhattan distance, equal distances choosing the
 *  lower entity id; null when the player holds no yard there. */
export function nearestYardDoor(
  world: World,
  terrain: TerrainGraph,
  yards: StrayYards,
  animal: Entity,
): NodeId | null {
  const here = entityNode(world, terrain, animal);
  const yard = yards.get(terrain.componentOf(here));
  if (yard === undefined) return null;
  const at = terrain.coordsOf(here);
  let best = yard.door;
  let distance = Math.abs(at.x - best.x) + Math.abs(at.y - best.y);
  const visit = (node: StrayYard | null): void => {
    if (node === null) return;
    const door = node.door;
    const candidateDistance = Math.abs(at.x - door.x) + Math.abs(at.y - door.y);
    if (candidateDistance < distance || (candidateDistance === distance && door.entity < best.entity)) {
      best = door;
      distance = candidateDistance;
    }
    const delta = node.splitX ? at.x - door.x : at.y - door.y;
    visit(delta <= 0 ? node.left : node.right);
    // Keep the boundary for an equal-distance candidate with a lower id across the split.
    if (Math.abs(delta) <= distance) visit(delta <= 0 ? node.right : node.left);
  };
  visit(yard);
  return best.cell;
}
