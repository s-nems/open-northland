import type { ContentSet } from '@open-northland/data';
import { KilledBy, ResourceFootprint } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { bushesAtNode } from '../spatial/bushes.js';
import { openedChestsAtNode } from '../spatial/opened-chests.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { stumpsAtNode } from '../spatial/stumps.js';
import { tryFootprintCellsOf } from './resource-footprint-cells.js';
import { unstampResourceFootprint } from './resources.js';

// The ground rule a road, a wall and a signpost share, node by node, past the blocker set each already
// consults. Project rule: each clears what grows there, as a building clears bushes and fields, and leaves
// loose goods and carcasses lying, while a tree of any age or a stone has to be worked away first. The
// original refuses every landscape object but scenery under all three.

/** Whether resource `e` stands solid: its landscape record blocks walking once full-grown, as a tree, a
 *  stone or a mine does, so it refuses a road or wall even while young or part-mined. */
function standsSolid(world: World, content: ContentSet, e: Entity): boolean {
  const gfx = tryFootprintCellsOf(world, e)?.sourceGfxIndex;
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

/** Whether the `blockers` work-flag blocker contributions on node `(hx, hy)` are all resources anchored
 *  there that {@link clearLineGround} clears or leaves lying: where a signpost may stand although a work
 *  flag may not. Such a resource blocks no walking, so its one contribution is its anchor. */
export function onlyLineGroundBlocksAt(
  world: World,
  content: ContentSet,
  hx: number,
  hy: number,
  blockers: number,
): boolean {
  if (!lineGroundOpen(world, content, hx, hy)) return false;
  let anchors = 0;
  for (const e of resourcesAtNode(world, hx, hy)) if (world.has(e, ResourceFootprint)) anchors++;
  return blockers === anchors;
}

/**
 * Clear what a road or wall ordered, or a signpost erected, over `nodes` covers: the walk-through
 * resources such as mushrooms, clay or a crop, the bushes, the stumps and the opened chests. `groundCleared` names them, so the map's
 * static layer drops their sprites and the scenery on those nodes.
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
    razed.push(
      ...bushesAtNode(world, hx, hy),
      ...stumpsAtNode(world, hx, hy),
      ...openedChestsAtNode(world, hx, hy),
    );
  }
  for (const e of razed) world.destroy(e);
  ctx.events.emit({ kind: 'groundCleared', nodes, razed });
}
