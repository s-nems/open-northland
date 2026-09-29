import type { ContentSet } from '@open-northland/data';
import { KilledBy, Position, Resource, type ResourceLayer, ResourceLayers } from '../../components/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import {
  anchorOnlyFootprint,
  buildingDoorNodes,
  dynamicBlockOverlay,
  resourceFootprintForGood,
  stampResourceFootprintData,
  unstampResourceFootprint,
  walkBlockedBodyOf,
} from '../footprint/index.js';
import { canonicalById } from '../spatial/nodes.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { sowNodeOccupied } from './fields.js';

type ResourceState = typeof Resource extends Component<infer T> ? T : never;

/** A hunted body's harvestable state: the head good plus its buried layers, and the hunter who claims it. */
export interface CarcassBody {
  readonly resource: Readonly<ResourceState>;
  readonly layers: readonly ResourceLayer[];
  readonly killedBy: Entity;
}

/** Lay a hunted body down on half-cell node `(hx, hy)`. */
export function placeCarcass(
  world: World,
  content: ContentSet,
  hx: number,
  hy: number,
  body: CarcassBody,
): Entity {
  const e = world.create();
  world.add(e, Position, positionOfNode(hx, hy));
  world.add(e, Resource, { ...body.resource });
  world.add(e, KilledBy, { by: body.killedBy });
  if (body.layers.length > 0) world.add(e, ResourceLayers, { layers: body.layers.map((l) => ({ ...l })) });
  stampCarcassFootprint(world, content, e, body.resource.goodType);
  return e;
}

/**
 * Stamp a carcass with its good's walk and work areas but no build zone. The cadaver records author a
 * one-node `LogicBuildBlockArea`, yet the body is walkable ground like a bush or a stump, so a building may
 * cover it and pushes it aside on placement (project rule: the player's building is never held back by it).
 */
export function stampCarcassFootprint(world: World, content: ContentSet, e: Entity, goodType: number): void {
  const footprint = resourceFootprintForGood(content, goodType) ?? anchorOnlyFootprint();
  stampResourceFootprintData(world, e, { ...footprint, build: [] });
}

/**
 * Move every carcass lying in `building`'s walk-blocked body to the nearest free node outside it, keeping
 * its meat and its hunter's claim. A resource never moves in the node index, so each body is re-created at
 * its landing, in canonical id order. A boxed-in carcass stays where it lies.
 */
export function evictCarcassesFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const body = walkBlockedBodyOf(world, ctx, terrain, building);
  if (body === null) return;
  const buried: Entity[] = [];
  for (const cell of body) {
    const { x, y } = terrain.coordsOf(cell);
    for (const e of resourcesAtNode(world, x, y)) if (world.has(e, KilledBy)) buried.push(e);
  }
  if (buried.length === 0) return;
  const blocked = dynamicBlockOverlay(world, ctx, terrain); // includes this building's own body
  const doors = buildingDoorNodes(world, ctx, terrain);
  for (const carcass of canonicalById(buried)) {
    const pos = world.get(carcass, Position);
    const n = nodeOfPosition(pos.x, pos.y);
    const landing = ringSearch(terrain, terrain.nodeAtClamped(n.hx, n.hy), STAND_SEARCH_CAP, {
      traverse: (c: NodeId) => !blocked.has(c) || body.has(c),
      accept: (c: NodeId) => {
        if (blocked.has(c) || doors.has(c)) return false;
        return !sowNodeOccupied(world, terrain.xOf(c), terrain.yOf(c));
      },
    });
    if (landing === null) continue;
    const moved: CarcassBody = {
      resource: world.get(carcass, Resource),
      layers: world.tryGet(carcass, ResourceLayers)?.layers ?? [],
      killedBy: world.get(carcass, KilledBy).by,
    };
    placeCarcass(world, ctx.content, terrain.xOf(landing), terrain.yOf(landing), moved);
    unstampResourceFootprint(world, carcass);
    world.destroy(carcass);
  }
}
