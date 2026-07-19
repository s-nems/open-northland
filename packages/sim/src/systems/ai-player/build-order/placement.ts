import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf } from '../../footprint/geometry.js';
import { placementProbe } from '../../footprint/index.js';
import { anchorNodeOf, firstRingNode, goodTypeByContentId, nearestLiveResource } from '../shared.js';
import type { BuildOrderEntry, PlacementAffinity } from './entries.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './entries.js';

// PLACEMENT SPOT SEARCH — where a build-order `place` entry lands: always inside the near-HQ
// Manhattan disc, ring-searched outward from the entry's affinity centre (the plan's "mason toward
// the stone, chains cluster" rules) instead of the HQ itself, with the farm's plantable-ground
// rule as an extra accept filter. No affinity and no ground rule reproduces the original
// closest-to-HQ pick exactly.

/** One affinity anchor resolved to a node: the seat's first (lowest-id) owned building of the id,
 *  the live resource of the good nearest the HQ, or the map's centre node. Unresolvable anchors
 *  are dropped. */
function affinityNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  hq: HalfCellNode,
  affinity: PlacementAffinity,
): HalfCellNode | null {
  switch (affinity.kind) {
    case 'building': {
      const index = contentIndex(ctx.content);
      for (const e of owned) {
        if (index.buildings.get(world.get(e, Building).buildingType)?.id === affinity.id) {
          return anchorNodeOf(world, e);
        }
      }
      return null;
    }
    case 'resource': {
      const good = goodTypeByContentId(ctx.content, affinity.good);
      if (good === undefined) return null;
      const resource = nearestLiveResource(world, good.typeId, hq);
      return resource === null ? null : anchorNodeOf(world, resource);
    }
    case 'mapCentre':
      return { hx: Math.floor(terrain.width / 2), hy: Math.floor(terrain.height / 2) };
  }
}

/** The centre the ring search grows from: the integer-mean of the entry's resolved affinity nodes,
 *  pulled back along the straight line to the HQ when it falls outside the near-HQ disc (so the
 *  search still starts inside the legal band and stays bounded). No resolved anchor → the HQ. */
function searchCentre(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  hq: HalfCellNode,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): HalfCellNode {
  const anchors: HalfCellNode[] = [];
  for (const affinity of entry.near ?? []) {
    const node = affinityNode(world, ctx, terrain, owned, hq, affinity);
    if (node !== null) anchors.push(node);
  }
  if (anchors.length === 0) return hq;
  let sx = 0;
  let sy = 0;
  for (const a of anchors) {
    sx += a.hx;
    sy += a.hy;
  }
  const centre = { hx: Math.floor(sx / anchors.length), hy: Math.floor(sy / anchors.length) };
  const dx = centre.hx - hq.hx;
  const dy = centre.hy - hq.hy;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist <= BUILD_SEARCH_MAX_RADIUS_NODES) return centre;
  // Integer projection toward the HQ; trunc keeps |dx'|+|dy'| ≤ the radius. Plain `/` on integer
  // operands is IEEE-exact-rounded, hence byte-identical across engines (no transcendental math).
  return {
    hx: hq.hx + Math.trunc((dx * BUILD_SEARCH_MAX_RADIUS_NODES) / dist),
    hy: hq.hy + Math.trunc((dy * BUILD_SEARCH_MAX_RADIUS_NODES) / dist),
  };
}

/** The plantable-ground accept filter for a `ground: 'plantable'` entry: every reserved footprint
 *  cell (the anchor node itself for footprint-less synthetic content) must be sowable ground.
 *  Named approximation: "the farm stands on grass" is encoded as its reserved zone on `plantable`
 *  terrain (the original's `biocanplanton` class) — the surrounding field ring is not pre-checked;
 *  sowing already skips barren nodes (`agents/farming/targets.ts`). */
function groundAccepted(
  ctx: SystemContext,
  terrain: TerrainGraph,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  x: number,
  y: number,
): boolean {
  if (entry.ground === undefined) return true;
  const footprint = buildingFootprintOf(ctx.content, type.typeId);
  if (footprint === undefined) return terrain.isPlantable(terrain.nodeAt(x, y));
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy) || !terrain.isPlantable(terrain.nodeAt(cx, cy))) return false;
  }
  return true;
}

/**
 * The spot a `place` entry builds on: the legal anchor closest to the entry's {@link searchCentre},
 * restricted to the near-HQ disc, on buildable (and, when required, plantable) ground, off every
 * existing building's anchor, and accepted by the shared placement probe. Ring order is canonical,
 * so the winner is deterministic; the search is bounded by twice the HQ radius (a centre inside the
 * disc reaches every disc node within that), never the whole map. Null stalls the entry.
 */
export function placementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  hq: HalfCellNode,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): HalfCellNode | null {
  // Occupied anchors are rejected explicitly so a footprint-less type (synthetic content, where
  // the probe accepts everything) still never stacks on an existing building.
  const occupied = new Set<string>();
  for (const e of world.query(Building)) {
    const node = anchorNodeOf(world, e);
    if (node !== null) occupied.add(`${node.hx},${node.hy}`);
  }
  const probe = placementProbe(world, ctx.content, terrain, type.typeId);
  const centre = searchCentre(world, ctx, terrain, owned, hq, entry);
  return firstRingNode(centre.hx, centre.hy, 2 * BUILD_SEARCH_MAX_RADIUS_NODES, (x, y) => {
    // The pure-arithmetic HQ-disc test first: an affinity-pulled centre puts up to half of every ring
    // outside the disc, and a permanently stalled entry re-walks the whole fan every decision.
    if (Math.abs(x - hq.hx) + Math.abs(y - hq.hy) > BUILD_SEARCH_MAX_RADIUS_NODES) return false;
    if (!terrain.inBounds(x, y) || !terrain.isBuildable(terrain.nodeAt(x, y))) return false;
    if (occupied.has(`${x},${y}`) || !groundAccepted(ctx, terrain, type, entry, x, y)) return false;
    return probe.canPlace(x, y);
  });
}
