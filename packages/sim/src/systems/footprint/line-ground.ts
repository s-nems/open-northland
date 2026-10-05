import type { ContentSet } from '@open-northland/data';
import { KilledBy, ResourceFootprint } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { bushesAtNode } from '../spatial/bushes.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { stumpsAtNode } from '../spatial/stumps.js';
import { unstampResourceFootprint } from './resources.js';

// The ground rule a road and a wall share, node by node, past the blocker grid both already consult.
// Project rule: either covers what grows or lies loose there and clears it, as a building clears bushes
// and fields, while a tree of any age or a stone has to be worked away first. The original refuses every
// landscape object but scenery under either.

/** Whether resource `e` stands solid: its landscape record blocks walking once full-grown, as a tree, a
 *  stone or a mine does, so it refuses a road or wall even while young or part-mined. */
function standsSolid(world: World, content: ContentSet, e: Entity): boolean {
  const gfx = world.tryGet(e, ResourceFootprint)?.sourceGfxIndex;
  if (gfx === undefined) return false;
  return (contentIndex(content).landscapeGfxByIndex.get(gfx)?.walkBlockAreas.length ?? 0) > 0;
}

/** A hunted carcass lies on the ground like loose goods: a road or wall leaves it where it lies. */
function liesLoose(world: World, e: Entity): boolean {
  return world.has(e, KilledBy);
}

/** Whether nothing solid grows or stands on node `(hx, hy)` that a road or wall would have to wait for. */
export function lineGroundOpen(world: World, content: ContentSet, hx: number, hy: number): boolean {
  for (const e of resourcesAtNode(world, hx, hy)) if (standsSolid(world, content, e)) return false;
  return true;
}

/**
 * Clear what a road or wall ordered over `nodes` covers: the walk-through resources such as mushrooms,
 * clay or a crop, the bushes and the stumps. `groundCleared` names them, so the map's static layer drops
 * their sprites and the scenery on those nodes.
 */
export function clearLineGround(world: World, ctx: SystemContext, nodes: readonly HalfCellNode[]): void {
  const razed: Entity[] = [];
  for (const { hx, hy } of nodes) {
    // Copied first: each probe hands back the index's live node bucket, which the destroys below splice.
    for (const e of [...resourcesAtNode(world, hx, hy)]) {
      if (standsSolid(world, ctx.content, e) || liesLoose(world, e)) continue;
      unstampResourceFootprint(world, e);
      razed.push(e);
    }
    razed.push(...bushesAtNode(world, hx, hy), ...stumpsAtNode(world, hx, hy));
  }
  for (const e of razed) world.destroy(e);
  ctx.events.emit({ kind: 'groundCleared', nodes, razed });
}
