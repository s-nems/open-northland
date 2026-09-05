import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { seatBaseOf } from '../base.js';
import { anchorCentroid, anchorNodeOf, firstRingNode, outwardNode } from '../node-geometry.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './entries.js';
import { buildingSpotAccept } from './placement.js';

// The coverage circle is a planning heuristic only; what a tower does under an alarm is
// `systems/defence/`.

/** Planning radius of a tower's or the base's assumed defence circle, in world-metric nodes.
 *  Deliberately under the house bow's own 0-29 reach (`readviews/defence.ts`): observation - towers
 *  ringed at full bow range stand too far out to read as part of the settlement. */
export const TOWER_DEFENCE_RADIUS_NODES = 22;

/** Covering towers are an id allowlist, not `kind === 'tower'`: `work_pottery_02` shares the kind but
 *  is the defence wall. */
export const TOWER_CONTENT_IDS: readonly string[] = ['tower_00', 'tower_01'];

/** How far past the covering target the search seed is pushed out from the settlement centroid, in
 *  nodes. Approximation: far enough to bias the pick outward, short enough to land just beyond the
 *  last building. */
const TOWER_OUTSKIRTS_PUSH_NODES = 6;

/**
 * The first owned building (canonical ascending id) outside every coverage circle, or null when the
 * settlement stands covered. Circle centres are the seat's base plus its towers in any construction
 * state, so coverage arrives with the site rather than with the finished tower.
 */
export function firstUncoveredBuilding(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): Entity | null {
  const index = contentIndex(ctx.content);
  const base = seatBaseOf(world, ctx, player);
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    const id = index.buildings.get(world.get(e, Building).buildingType)?.id;
    if (e !== base && (id === undefined || !TOWER_CONTENT_IDS.includes(id))) continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) centres.push(node);
  }
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const covered = centres.some((c) =>
      withinNodeRadius(c.hx, c.hy, node.hx, node.hy, TOWER_DEFENCE_RADIUS_NODES),
    );
    if (!covered) return e;
  }
  return null;
}

/**
 * The spot the next tower builds on, or null to stall the entry. The accept combines two metrics:
 * world-metric coverage of the target and the Manhattan anchor disc. It needs the full ring budget
 * because the world metric is anisotropic (34 px E/W against 19 px N/S), so a covering node can sit
 * almost twice the coverage radius in rows from the target.
 */
export function towerPlacementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  target: Entity,
): HalfCellNode | null {
  const targetNode = anchorNodeOf(world, target);
  if (targetNode === null) return null;
  const centroid = anchorCentroid(world, owned) ?? targetNode;
  const seed = outwardNode(centroid, targetNode, TOWER_OUTSKIRTS_PUSH_NODES);
  const accept = buildingSpotAccept(world, ctx, terrain, player, type.typeId);
  return firstRingNode(seed.hx, seed.hy, 2 * BUILD_SEARCH_MAX_RADIUS_NODES, (x, y) => {
    if (Math.abs(x - anchor.hx) + Math.abs(y - anchor.hy) > BUILD_SEARCH_MAX_RADIUS_NODES) return false;
    if (!withinNodeRadius(x, y, targetNode.hx, targetNode.hy, TOWER_DEFENCE_RADIUS_NODES)) return false;
    return accept(x, y);
  });
}
