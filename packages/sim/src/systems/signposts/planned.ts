import { ErectSignpostOrder, OrderQueue, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** A signpost's spot, standing or planned, in half-cell nodes. */
export interface SignpostSpot {
  readonly hx: number;
  readonly hy: number;
}

/**
 * The spots `player`'s scouts are on their way to erect a signpost at: the errand a scout walks and every
 * queued one. The placement overlay keeps the spacing from them, so a chain of queued posts can be laid
 * out before the first one stands. Left out: the hammer swing, which ends with the post, and an order
 * parked behind an atomic, so that no parked order in the world moves {@link plannedSignpostsVersion}.
 */
export function plannedSignposts(world: World, terrain: TerrainGraph, player: number): SignpostSpot[] {
  const planned: SignpostSpot[] = [];
  const add = (node: NodeId): void => {
    const c = terrain.coordsOf(node);
    planned.push({ hx: c.x, hy: c.y });
  };
  const owns = (e: Entity): boolean => world.tryGet(e, Owner)?.player === player;
  for (const e of world.query(ErectSignpostOrder)) {
    if (owns(e)) add(world.get(e, ErectSignpostOrder).goal);
  }
  for (const e of world.query(OrderQueue)) {
    if (!owns(e)) continue;
    for (const order of world.get(e, OrderQueue).orders) {
      if (order.kind === 'placeSignpost') add(terrain.nodeAtClamped(order.x, order.y));
    }
  }
  return planned;
}

/** A key that moves whenever {@link plannedSignposts} may answer differently. */
export function plannedSignpostsVersion(world: World): string {
  return [
    world.componentGeneration(ErectSignpostOrder),
    world.componentGeneration(OrderQueue),
    world.componentValueGeneration(OrderQueue),
  ].join(':');
}
