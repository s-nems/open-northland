import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { buildingBodyNodes } from '../../../conflict/target-node.js';
import type { MapContext } from '../../../context.js';
import { entityNode } from '../../../spatial/nodes.js';

// The defence measures its bands from a building's walls: the house bow shoots from the nearest wall
// (`conflict/shelter-fire.ts`) and a siege engine or a bowman aims at it (`conflict/target-node.ts`), so a
// band read from the anchor of a wide building would let a catapult hit it from outside the band.

/** Per held body (`buildingBodyNodes` keeps one array per building until it changes or moves): how far its
 *  farthest wall stands from its anchor. */
const spans = new WeakMap<readonly NodeId[], number>();

/** How far `building`'s farthest wall stands from its anchor, in map points: what a band measured from the
 *  walls reaches past the same band measured from the anchor. */
export function wallSpanOf(world: World, ctx: MapContext, terrain: TerrainGraph, building: Entity): number {
  const body = buildingBodyNodes(world, ctx, terrain, building);
  let span = spans.get(body);
  if (span === undefined) {
    const at = terrain.coordsOf(entityNode(world, terrain, building));
    span = 0;
    for (const node of body)
      span = Math.max(span, hexDistanceBetween(at.x, at.y, terrain.xOf(node), terrain.yOf(node)));
    spans.set(body, span);
  }
  return span;
}

/** The map-point distance from `(x, y)` to `building`'s nearest wall, or null when it is past `band`: the
 *  anchor test turns away most points before the walls are read. */
export function wallDistanceWithin(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  building: Entity,
  band: number,
  x: number,
  y: number,
): number | null {
  const at = terrain.coordsOf(entityNode(world, terrain, building));
  if (hexDistanceBetween(x, y, at.x, at.y) > band + wallSpanOf(world, ctx, terrain, building)) return null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const node of buildingBodyNodes(world, ctx, terrain, building))
    nearest = Math.min(nearest, hexDistanceBetween(x, y, terrain.xOf(node), terrain.yOf(node)));
  return nearest <= band ? nearest : null;
}
