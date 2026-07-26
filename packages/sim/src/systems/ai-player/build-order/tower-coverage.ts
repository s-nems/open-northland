import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-metric.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import {
  anchorCentroid,
  anchorNodeOf,
  firstRingNode,
  HEADQUARTERS_BUILDING_ID,
  outwardNode,
} from '../shared.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './entries.js';
import { buildingSpotAccept } from './placement.js';

// TOWER COVERAGE — the `towerCoverage` entry's shared reading and spot search. The AI keeps every
// owned building inside some tower's (or the HQ's) assumed defence circle; no defence mechanic
// exists yet (docs/tickets/features/tower-defence-mode.md), so the circle is purely a planning
// heuristic the future garrison fire will inherit.

/** The planning radius of a tower's and the HQ's assumed defence circle, in world-metric nodes. Under
 *  the house bow's own range 0–29 (weapons.ini type 20, recorded in the tower-defence-mode ticket):
 *  towers ringed at full bow range stood too far out to read as part of the settlement, so the
 *  planning circle is tightened (user decision 2026-07-26). */
export const TOWER_DEFENCE_RADIUS_NODES = 22;

/** The content ids that count as covering towers — an id allowlist, deliberately NOT
 *  `kind === 'tower'`: `work_pottery_02` shares the kind but is the defence wall. */
export const TOWER_CONTENT_IDS: readonly string[] = ['tower_00', 'tower_01'];

/** How far past the covering target the spot search's seed is pushed away from the settlement
 *  centroid — enough to bias the pick outward, short enough that the tower lands just beyond the
 *  last building rather than out in the field (named approximation, user decision 2026-07-26). */
export const TOWER_OUTSKIRTS_PUSH_NODES = 6;

/**
 * The first owned building (canonical ascending id) outside every coverage circle, or null when the
 * settlement stands covered. Centres are the HQ and the {@link TOWER_CONTENT_IDS} buildings in ANY
 * construction state — coverage arrives with the site, and the one-site gate already serializes
 * tower construction. The one shared reading of the `towerCoverage` entry: `entryStatus` and the
 * executor both call it, so status and action can never disagree.
 */
export function firstUncoveredBuilding(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
): Entity | null {
  const index = contentIndex(ctx.content);
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    const id = index.buildings.get(world.get(e, Building).buildingType)?.id;
    if (id !== HEADQUARTERS_BUILDING_ID && (id === undefined || !TOWER_CONTENT_IDS.includes(id))) {
      continue;
    }
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
 * The spot the next tower builds on: the legal anchor closest to the uncovered target's outskirts
 * seed (the target anchor pushed {@link TOWER_OUTSKIRTS_PUSH_NODES} away from the settlement
 * centroid) that actually covers the target ({@link TOWER_DEFENCE_RADIUS_NODES}, world metric) and
 * stays inside the Manhattan near-HQ disc — the accept combines both metrics, like the signpost
 * lattice documents its Manhattan over-bound. Ring budget is the shared `placementSpot` bound: the
 * world metric is anisotropic (34 px E/W against 19 px N/S), so a covering node can sit almost twice
 * the radius in rows from the target and the circle needs the full fan. Null stalls the entry.
 */
export function towerPlacementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  hq: HalfCellNode,
  type: BuildingType,
  target: Entity,
): HalfCellNode | null {
  const targetNode = anchorNodeOf(world, target);
  if (targetNode === null) return null;
  const centroid = anchorCentroid(world, owned) ?? targetNode;
  const seed = outwardNode(centroid, targetNode, TOWER_OUTSKIRTS_PUSH_NODES);
  const accept = buildingSpotAccept(world, ctx, terrain, type.typeId);
  return firstRingNode(seed.hx, seed.hy, 2 * BUILD_SEARCH_MAX_RADIUS_NODES, (x, y) => {
    if (Math.abs(x - hq.hx) + Math.abs(y - hq.hy) > BUILD_SEARCH_MAX_RADIUS_NODES) return false;
    if (!withinNodeRadius(x, y, targetNode.hx, targetNode.hy, TOWER_DEFENCE_RADIUS_NODES)) return false;
    return accept(x, y);
  });
}
