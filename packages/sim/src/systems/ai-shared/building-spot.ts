import { type FootprintCell, footprintCellDx, footprintCellMaxAbsDx } from '@open-northland/data';
import { Building, Resource } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { seatPlacementProbe } from '../conflict/contested-ground.js';
import type { SystemContext } from '../context.js';
import { ANCHOR_ONLY, buildingFlagBody, buildingFootprintOf } from '../footprint/geometry.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { roadSitesByNode } from '../roads/site-index.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { goodTypeByContentId } from './content-lookup.js';
import type { EnemyFire } from './military/defence/index.js';
import { anchorNodeOf } from './node-geometry.js';

/** How far from a `plantable` entry's anchor free sowable ground may lie when none fits under its
 *  footprint, in lattice Manhattan nodes (authored): a few steps, well inside the field radius the
 *  workers sow within. */
export const GRASS_BESIDE_NODES = 6;

/** The deposits a workshop's gatherers dig, which a seat building never covers (authored): the scarce
 *  ones a covered deposit would lose. The engine's blockers already keep a zone off every walk body, so
 *  this adds only the walk-free deposits. Owner ruling: a seat builds wherever there is room, so clay,
 *  mushrooms, herbs, trunks and carcasses stay coverable. */
const DEPOSIT_GOOD_IDS: readonly string[] = ['stone', 'iron', 'gold'];

/** How far out from its anchor a building of the type's chain ever has a wall, in Manhattan nodes: what an
 *  enemy shot at the building reaches for. */
function wallSpan(ctx: SystemContext, buildingTypeId: number, tribe: number): number {
  const footprint = buildingFootprintOf(ctx.content, buildingTypeId, tribe);
  let span = 0;
  for (const c of [...(footprint?.familyBody ?? []), ...(footprint?.blocked ?? [])]) {
    span = Math.max(span, footprintCellMaxAbsDx(c) + Math.abs(c.dy));
  }
  return span;
}

/**
 * The seat's placement test for one building type, built once a search: the anchors every building on
 * the map holds, the seat's own placement probe, and the deposit zone. {@link SpotAcceptor.around} narrows
 * it to one search's fan: a node is accepted when the building may anchor there, the anchor is free, and
 * no enemy shooter reaches the site. With `spareGrass` the building's reserved zone must also keep off
 * every grass node (`grassReserved`).
 */
export interface SpotAcceptor {
  around(
    underFire: EnemyFire,
    centre: HalfCellNode,
    fan: number,
    spareGrass?: boolean,
  ): (x: number, y: number) => boolean;
  /** Whether a sowable node no building stands on or reserves lies within {@link GRASS_BESIDE_NODES} of
   *  `(x, y)` on its walk component, where the workers can reach it. */
  grassBeside(x: number, y: number): boolean;
}

export function spotAcceptor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  buildingTypeId: number,
  tribe: number,
): SpotAcceptor {
  const span = wallSpan(ctx, buildingTypeId, tribe);
  const occupied = new Set<NodeId>(); // an off-grid anchor can never match a candidate, so it is left out
  for (const e of world.query(Building)) {
    const node = anchorNodeOf(world, e);
    if (node !== null && terrain.inBounds(node.hx, node.hy)) occupied.add(terrain.nodeAt(node.hx, node.hy));
  }
  const probe = seatPlacementProbe(world, ctx.content, terrain, ctx.fog, buildingTypeId, tribe, player);
  const reserved = buildingFootprintOf(ctx.content, buildingTypeId, tribe)?.reserved;
  const zone = reserved !== undefined && reserved.length > 0 ? reserved : ANCHOR_ONLY;
  const deposits = new Set<number>();
  for (const id of DEPOSIT_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good !== undefined) deposits.add(good.typeId);
  }
  const body = buildingFlagBody(ctx.content, { buildingType: buildingTypeId, tribe });
  const roadSites = roadSitesByNode(world, terrain);
  let zones: Uint16Array | null = null;
  return {
    grassBeside(x, y) {
      if (!terrain.inBounds(x, y)) return false;
      zones ??= placementBlockerGrid(world, ctx.content, terrain).buildingZone;
      const land = terrain.componentOf(terrain.nodeAt(x, y));
      for (let dy = -GRASS_BESIDE_NODES; dy <= GRASS_BESIDE_NODES; dy++) {
        const span = GRASS_BESIDE_NODES - Math.abs(dy);
        for (let dx = -span; dx <= span; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          if (!terrain.inBounds(cx, cy)) continue;
          const node = terrain.nodeAt(cx, cy);
          if (!terrain.isPlantable(node) || !terrain.isWalkable(node) || occupied.has(node)) continue;
          if ((zones[cy * terrain.width + cx] ?? 0) === 0 && terrain.componentOf(node) === land) return true;
        }
      }
      return false;
    },
    around(underFire, centre, fan, spareGrass = false) {
      const fire = underFire.around(centre.hx, centre.hy, fan, span);
      return (x, y) => {
        if (!terrain.inBounds(x, y)) return false;
        const node = terrain.nodeAt(x, y);
        if (!terrain.isBuildable(node) || occupied.has(node) || fire.reaches(x, y, span)) return false;
        if (spareGrass && coversGrass(terrain, zone, x, y)) return false;
        return (
          probe.canPlace(x, y) &&
          !coversLiveDeposit(world, deposits, zone, x, y) &&
          !coversRoad(terrain, roadSites, body, x, y)
        );
      };
    },
  };
}

/** Whether the body `cells` anchored at `(x, y)` covers a road or a road site. A seat building never does
 *  (authored): a laid road would break under its walls and a site under them is withdrawn. */
function coversRoad(
  terrain: TerrainGraph,
  roadSites: ReadonlyMap<NodeId, Entity>,
  cells: readonly { dx: number; dy: number }[],
  x: number,
  y: number,
): boolean {
  for (const c of cells) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) continue;
    const node = terrain.nodeAt(cx, cy);
    if (terrain.isRoad(node) || roadSites.has(node)) return true;
  }
  return false;
}

/** Whether the zone `cells` anchored at `(x, y)` covers the node of a `deposits` resource with goods left. */
function coversLiveDeposit(
  world: World,
  deposits: ReadonlySet<number>,
  cells: readonly { dx: number; dy: number }[],
  x: number,
  y: number,
): boolean {
  if (deposits.size === 0) return false;
  for (const c of cells) {
    for (const e of resourcesAtNode(world, x + footprintCellDx(y, c), y + c.dy)) {
      const r = world.get(e, Resource);
      if (r.remaining > 0 && deposits.has(r.goodType)) return true;
    }
  }
  return false;
}

/** Whether the zone `cells` anchored at `(x, y)` covers a grass node. */
function coversGrass(terrain: TerrainGraph, cells: readonly FootprintCell[], x: number, y: number): boolean {
  for (const c of cells) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (terrain.inBounds(cx, cy) && terrain.isPlantable(terrain.nodeAt(cx, cy))) return true;
  }
  return false;
}
