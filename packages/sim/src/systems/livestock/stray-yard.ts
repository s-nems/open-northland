import { Building } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ownedBuildings } from '../ai-player/seat-roster.js';
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

/** Built once per owner and assignment sweep, from the highest available building priority. */
export function strayYardOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): StrayYard | null {
  const types = contentIndex(ctx.content).buildings;
  const doors: YardDoor[] = [];
  let storageOnly = false;
  for (const e of ownedBuildings(world, player)) {
    const building = world.get(e, Building);
    if (building.built < ONE) continue;
    const type = types.get(building.buildingType);
    if (type === undefined) continue;
    const cell = interactionNodeId(world, ctx, terrain, e);
    if (cell === null) continue;
    const door = { entity: e, cell, ...terrain.coordsOf(cell) };
    if (type.id === HEADQUARTERS_BUILDING_ID) {
      return { door, splitX: true, left: null, right: null };
    }
    if (type.kind === 'storage' && !storageOnly) {
      doors.length = 0;
      storageOnly = true;
    }
    if (!storageOnly || type.kind === 'storage') doors.push(door);
  }
  return doorTree(doors, true);
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

/** Manhattan distance from the animal to the door; equal distances choose the lower entity id. */
export function nearestYardDoor(
  world: World,
  terrain: TerrainGraph,
  yard: StrayYard,
  animal: Entity,
): NodeId {
  const at = terrain.coordsOf(entityNode(world, terrain, animal));
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
