import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { seatBaseOf } from '../base.js';
import type { FireTest } from '../military/defence/index.js';
import { anchorCentroid, anchorNodeOf, firstRingNode, outwardNode } from '../node-geometry.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES, type BuildOrderEntry } from './entries.js';
import { buildingSpotAccept, buildReach } from './placement.js';

// The coverage circle is a planning heuristic only; what a tower does under an alarm is
// `systems/defence/`.

/** Planning radius of a tower's or the base's assumed defence circle, in world-metric nodes.
 *  Deliberately under the house bow's own 0-29 reach (`readviews/defence.ts`): observation - towers
 *  ringed at full bow range stand too far out to read as part of the settlement. */
export const TOWER_DEFENCE_RADIUS_NODES = 19;

/** Covering towers are an id allowlist, not `kind === 'tower'`: `work_pottery_02` shares the kind but
 *  is the defence wall. */
export const TOWER_CONTENT_IDS: readonly string[] = ['tower_00', 'tower_01'];

/** How far past the covering target the search seed is pushed out from the settlement centroid, in
 *  nodes. Approximation: far enough to bias the pick outward, short enough to land just beyond the
 *  last building. */
const TOWER_OUTSKIRTS_PUSH_NODES = 6;

/** Which buildings a coverage entry spreads, and how far each one reaches, in world-metric nodes. */
export interface Coverage {
  readonly by: 'tower' | 'store';
  readonly radius: number;
}

export function coverageOf(
  entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>,
): Coverage {
  return entry.kind === 'towerCoverage'
    ? { by: 'tower', radius: entry.radius ?? TOWER_DEFENCE_RADIUS_NODES }
    : { by: 'store', radius: entry.radius };
}

/**
 * The first owned building (canonical ascending id) outside every coverage circle, or null when the
 * settlement stands covered. Circle centres are the seat's base plus its towers (or its stores) in any
 * construction state, so coverage arrives with the site rather than with the finished building. Store
 * coverage passes over the towers: they ring the settlement's edge and would pull warehouses out to it.
 */
export function firstUncoveredBuilding(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): Entity | null {
  const index = contentIndex(ctx.content);
  const base = seatBaseOf(world, ctx, player);
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    const centre =
      coverage.by === 'tower'
        ? type !== undefined && TOWER_CONTENT_IDS.includes(type.id)
        : type?.kind === 'storage';
    if (e !== base && !centre) continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) centres.push(node);
  }
  for (const e of owned) {
    if (
      coverage.by === 'store' &&
      index.buildings.get(world.get(e, Building).buildingType)?.kind === 'tower'
    ) {
      continue;
    }
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const covered = centres.some((c) => withinNodeRadius(c.hx, c.hy, node.hx, node.hy, coverage.radius));
    if (!covered) return e;
  }
  return null;
}

/**
 * The spot the next covering building goes on, or null to stall the entry: a tower is seeded just past the
 * target, out from the settlement, a warehouse on the target itself. The accept combines two metrics:
 * world-metric coverage of the target and the seat's Manhattan build reach. It needs the full ring budget
 * because the world metric is anisotropic (34 px E/W against 19 px N/S), so a covering node can sit
 * almost twice the coverage radius in rows from the target.
 */
export function coveragePlacementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  target: Entity,
  coverage: Coverage,
  underFire: FireTest,
): HalfCellNode | null {
  const targetNode = anchorNodeOf(world, target);
  if (targetNode === null) return null;
  const centroid = anchorCentroid(world, owned) ?? targetNode;
  const seed =
    coverage.by === 'tower' ? outwardNode(centroid, targetNode, TOWER_OUTSKIRTS_PUSH_NODES) : targetNode;
  const accept = buildingSpotAccept(world, ctx, terrain, player, type.typeId, underFire);
  const fan = 2 * BUILD_SEARCH_MAX_RADIUS_NODES;
  const reach = buildReach(world, owned, anchor).around(seed, fan);
  return firstRingNode(seed.hx, seed.hy, fan, (x, y) => {
    // Coverage first: one distance test, and it passes only nodes near the target, itself in the reach.
    if (!withinNodeRadius(x, y, targetNode.hx, targetNode.hy, coverage.radius)) return false;
    if (!reach.contains(x, y)) return false;
    return accept(x, y);
  });
}
