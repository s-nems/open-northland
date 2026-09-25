import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { seatBaseOf } from '../base.js';
import type { EnemyFire } from '../military/defence/index.js';
import { anchorCentroid, anchorNodeOf, firstRingNode, outwardNode } from '../node-geometry.js';
import { ownedSettlers } from '../seat-roster.js';
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

/** The nodes a coverage entry spreads its buildings from: the seat's base plus its towers (or its stores)
 *  in any construction state, so coverage arrives with the site rather than with the finished building. */
function coverageCentres(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): HalfCellNode[] {
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
  return centres;
}

/**
 * The first node the coverage must reach that lies outside every coverage circle, or null when the seat
 * stands covered. A tower covers every owned building (canonical ascending id). A store covers what fills
 * it: the seat's workplaces, so a far production cluster has somewhere to unload, and then its gatherers'
 * work flags (canonical settler order), where the mined and quarried goods pile up; homes and towers pass,
 * since a tower rings the settlement's edge and would pull warehouses out to it.
 */
export function firstUncovered(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): HalfCellNode | null {
  const index = contentIndex(ctx.content);
  const centres = coverageCentres(world, ctx, player, owned, coverage);
  const covered = (node: HalfCellNode): boolean =>
    centres.some((c) => withinNodeRadius(c.hx, c.hy, node.hx, node.hy, coverage.radius));
  for (const e of owned) {
    if (
      coverage.by === 'store' &&
      index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'workplace'
    )
      continue;
    const node = anchorNodeOf(world, e);
    if (node !== null && !covered(node)) return node;
  }
  if (coverage.by === 'tower') return null;
  for (const e of ownedSettlers(world, player)) {
    const flag = liveWorkFlag(world, e);
    if (flag === undefined) continue;
    const node = anchorNodeOf(world, flag.flag);
    if (node !== null && !covered(node)) return node;
  }
  return null;
}

/**
 * The spot the next covering building goes on, or null when none covers the target: a tower is seeded just
 * past the target, out from the settlement, a warehouse on the target itself. Two towers side by side
 * double the defence, but two stores side by side serve the same ground, so a warehouse's spot also lies
 * outside every standing store's own circle. The accept combines two metrics: world-metric coverage of the
 * target and the seat's Manhattan build reach. It needs the full ring budget because the world metric is
 * anisotropic (34 px E/W against 19 px N/S), so a covering node can sit almost twice the coverage radius
 * in rows from the target.
 */
export function coveragePlacementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  target: HalfCellNode,
  coverage: Coverage,
  underFire: EnemyFire,
): HalfCellNode | null {
  const centroid = anchorCentroid(world, owned) ?? target;
  const seed = coverage.by === 'tower' ? outwardNode(centroid, target, TOWER_OUTSKIRTS_PUSH_NODES) : target;
  const apartFrom = coverage.by === 'tower' ? [] : coverageCentres(world, ctx, player, owned, coverage);
  const fan = 2 * BUILD_SEARCH_MAX_RADIUS_NODES;
  const accept = buildingSpotAccept(world, ctx, terrain, player, type.typeId, underFire, seed, fan);
  const reach = buildReach(world, owned, anchor).around(seed, fan);
  return firstRingNode(seed.hx, seed.hy, fan, (x, y) => {
    // Coverage first: one distance test, and it passes only nodes near the target, itself in the reach.
    if (!withinNodeRadius(x, y, target.hx, target.hy, coverage.radius)) return false;
    if (apartFrom.some((c) => withinNodeRadius(c.hx, c.hy, x, y, coverage.radius))) return false;
    if (!reach.contains(x, y)) return false;
    return accept(x, y);
  });
}
