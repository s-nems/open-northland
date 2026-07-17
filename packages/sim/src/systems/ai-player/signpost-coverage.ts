import {
  ErectSignpostOrder,
  PlayerOrder,
  Settler,
  SIGNPOST_NAV_RADIUS_NODES,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { withinNodeRadius } from '../../nav/node-metric.js';
import type { SystemContext } from '../context.js';
import { SCOUT_JOB } from '../readviews/stances.js';
import { signpostNetwork, signpostProbe } from '../signposts/index.js';
import type { AiPlayerModule } from './index.js';
import { anchorNodeOf, firstRingNode, headquartersOf, ownedBuildings, ownedSettlers } from './shared.js';

/**
 * The GuideBuild module — the scout keeps the seat's buildings under signpost coverage (user plan:
 * posts cover every building plus its surroundings; the surroundings come free from the generous
 * nav circle, {@link SIGNPOST_NAV_RADIUS_NODES}). One order per decision: the first uncovered
 * building (canonical order) gets a post on the closest legal node that still covers it. The module
 * waits while the scout is already walking an order, and idles until the workforce module has
 * designated a scout.
 */

/** How far around an uncovered building the spot search reaches — within the nav radius, so the
 *  erected post is guaranteed to cover the building that asked for it. */
export const SIGNPOST_SEARCH_MAX_RADIUS_NODES = SIGNPOST_NAV_RADIUS_NODES;

function runSignpostCoverage(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  if (headquartersOf(world, ctx, player) === null) return [];
  const scout = ownedSettlers(world, player).find((e) => world.get(e, Settler).jobType === SCOUT_JOB);
  if (scout === undefined) return [];
  if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) return []; // busy

  const posts = signpostNetwork(world).get(player) ?? [];
  for (const building of ownedBuildings(world, player)) {
    const node = anchorNodeOf(world, building);
    if (node === null) continue;
    const covered = posts.some((s) => withinNodeRadius(s.hx, s.hy, node.hx, node.hy, s.navRadius));
    if (covered) continue;
    // The spot must both be legal and still cover the building that asked for it.
    const probe = signpostProbe(world, ctx.content, terrain, player);
    const spot = firstRingNode(node.hx, node.hy, SIGNPOST_SEARCH_MAX_RADIUS_NODES, (x, y) => {
      return withinNodeRadius(x, y, node.hx, node.hy, SIGNPOST_NAV_RADIUS_NODES) && probe.canPlace(x, y);
    });
    if (spot === null) return []; // no legal spot near this building — retry next decision
    return [{ kind: 'placeSignpost', entity: scout, x: spot.hx, y: spot.hy }];
  }
  return []; // every building covered
}

export const signpostCoverageModule: AiPlayerModule = {
  id: 'guideBuild',
  run: runSignpostCoverage,
};
