import { type BuildingType, footprintCellDx } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { seatPlacementProbe } from '../../conflict/contested-ground.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf } from '../../footprint/geometry.js';
import { goodTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { nearestLiveResource } from '../live-resources.js';
import { anchorCentroid, anchorNodeOf, firstRingNode, outwardNode } from '../node-geometry.js';
import type { BuildOrderEntry, PlacementAffinity } from './entries.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './entries.js';

/** How far past the frontier building an `outskirts` anchor is pushed out from the settlement
 *  centroid, in nodes. Approximation: a footprint plus clearance beyond the built edge. */
const OUTSKIRTS_PUSH_NODES = 8;

/** One affinity resolved to a node, or null when it cannot be. A `building` affinity takes the seat's
 *  lowest-id owned match, so the pick is deterministic. */
function affinityNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  sameKindAnchors: readonly HalfCellNode[],
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
      const resource = nearestLiveResource(world, good.typeId, anchor);
      return resource === null ? null : anchorNodeOf(world, resource);
    }
    case 'mapCentre':
      return { hx: Math.floor(terrain.width / 2), hy: Math.floor(terrain.height / 2) };
    case 'outskirts':
      return outskirtsNode(world, ctx, owned, type, sameKindAnchors);
  }
}

/** Lattice Manhattan distance, not the anisotropic world metric the spacing veto measures in. */
function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/**
 * The `outskirts` anchor: the frontier building ranked first by clearance from the same-kind anchors
 * and only then by reach from the centroid, so a second warehouse anchors past the settlement's
 * least-served side. Strict `>` over the canonical list keeps the lowest id on ties.
 */
function outskirtsNode(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  type: BuildingType,
  sameKindAnchors: readonly HalfCellNode[],
): HalfCellNode | null {
  const centroid = anchorCentroid(world, owned);
  if (centroid === null) return null;
  const index = contentIndex(ctx.content);
  const ownChain = tiersAtOrAbove(index, type);
  let frontier: HalfCellNode | null = null;
  let bestClearance = -1;
  let bestReach = -1;
  for (const e of owned) {
    if (ownChain.has(world.get(e, Building).buildingType)) continue; // never anchor on its own chain
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    let clearance = Number.POSITIVE_INFINITY;
    for (const a of sameKindAnchors) clearance = Math.min(clearance, nodeDistance(node, a));
    if (clearance === Number.POSITIVE_INFINITY) clearance = 0;
    const reach = nodeDistance(node, centroid);
    if (clearance > bestClearance || (clearance === bestClearance && reach > bestReach)) {
      frontier = node;
      bestClearance = clearance;
      bestReach = reach;
    }
  }
  return frontier === null ? null : outwardNode(centroid, frontier, OUTSKIRTS_PUSH_NODES);
}

/** The centre the ring search grows from: the integer mean of the entry's resolved affinity nodes,
 *  clamped back into the anchor disc, or the anchor itself when nothing resolves. */
function searchCentre(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  sameKindAnchors: readonly HalfCellNode[],
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): HalfCellNode {
  const anchors: HalfCellNode[] = [];
  for (const affinity of entry.near ?? []) {
    const node = affinityNode(world, ctx, terrain, owned, anchor, type, sameKindAnchors, affinity);
    if (node !== null) anchors.push(node);
  }
  if (anchors.length === 0) return anchor;
  let sx = 0;
  let sy = 0;
  for (const a of anchors) {
    sx += a.hx;
    sy += a.hy;
  }
  const centre = { hx: Math.floor(sx / anchors.length), hy: Math.floor(sy / anchors.length) };
  const dx = centre.hx - anchor.hx;
  const dy = centre.hy - anchor.hy;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist <= BUILD_SEARCH_MAX_RADIUS_NODES) return centre;
  // Integer projection toward the anchor; trunc keeps |dx'|+|dy'| ≤ the radius. Plain `/` on integer
  // operands is exactly rounded, so the result is byte-identical across engines.
  return {
    hx: anchor.hx + Math.trunc((dx * BUILD_SEARCH_MAX_RADIUS_NODES) / dist),
    hy: anchor.hy + Math.trunc((dy * BUILD_SEARCH_MAX_RADIUS_NODES) / dist),
  };
}

/** Every reserved footprint cell must be sowable ground. Approximation: "the farm stands on grass" is
 *  encoded as the reserved zone on `plantable` terrain (the original's `biocanplanton` class); the
 *  surrounding field ring is not pre-checked, since sowing already skips barren nodes. */
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
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy) || !terrain.isPlantable(terrain.nodeAt(cx, cy))) return false;
  }
  return true;
}

/**
 * Shared legality test for a spot search: in-bounds buildable ground, off every existing building's
 * anchor (explicit, so a footprint-less synthetic type never stacks), and accepted by the seat's placement
 * probe. It scans the occupied set once per call, so build the closure per search, not per candidate.
 */
export function buildingSpotAccept(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  buildingTypeId: number,
): (x: number, y: number) => boolean {
  const occupied = new Set<NodeId>(); // an off-grid anchor can never match a candidate, so it is left out
  for (const e of world.query(Building)) {
    const node = anchorNodeOf(world, e);
    if (node !== null && terrain.inBounds(node.hx, node.hy)) occupied.add(terrain.nodeAt(node.hx, node.hy));
  }
  const probe = seatPlacementProbe(world, ctx.content, terrain, ctx.fog, buildingTypeId, player);
  return (x, y) => {
    if (!terrain.inBounds(x, y)) return false;
    const node = terrain.nodeAt(x, y);
    if (!terrain.isBuildable(node) || occupied.has(node)) return false;
    return probe.canPlace(x, y);
  };
}

/** How far an `apart` placement keeps from the seat's other same-kind buildings, in world-metric
 *  nodes. Approximation: far enough that two warehouses serve different corners of the search disc. */
const KIND_SPACING_NODES = 20;

/** The anchors an `apart` entry keeps away from: same-kind buildings, not same-id, so a warehouse
 *  also spreads away from the base. */
function kindSpacingAnchors(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  type: BuildingType,
): HalfCellNode[] {
  const index = contentIndex(ctx.content);
  const anchors: HalfCellNode[] = [];
  for (const e of owned) {
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind !== type.kind) continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) anchors.push(node);
  }
  return anchors;
}

/**
 * The legal node closest to {@link searchCentre} and inside the anchor disc, or null to stall the
 * entry. The ring budget is twice the anchor radius because a centre inside the disc reaches every
 * disc node within that. The `apart` veto runs as a first pass only, so the preference never stalls.
 */
export function placementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): HalfCellNode | null {
  const accept = buildingSpotAccept(world, ctx, terrain, player, type.typeId);
  const sameKindAnchors = entry.apart === true ? kindSpacingAnchors(world, ctx, owned, type) : [];
  const centre = searchCentre(world, ctx, terrain, owned, anchor, type, sameKindAnchors, entry);
  const search = (veto: readonly HalfCellNode[]): HalfCellNode | null =>
    firstRingNode(centre.hx, centre.hy, 2 * BUILD_SEARCH_MAX_RADIUS_NODES, (x, y) => {
      // Cheapest test first: an affinity-pulled centre puts up to half of every ring outside the
      // disc, and a stalled entry re-walks the whole fan every decision.
      if (Math.abs(x - anchor.hx) + Math.abs(y - anchor.hy) > BUILD_SEARCH_MAX_RADIUS_NODES) return false;
      if (veto.some((a) => withinNodeRadius(a.hx, a.hy, x, y, KIND_SPACING_NODES))) return false;
      if (!terrain.inBounds(x, y)) return false; // groundAccepted resolves nodes - bounds come first
      if (!groundAccepted(ctx, terrain, type, entry, x, y)) return false;
      return accept(x, y);
    });
  if (sameKindAnchors.length === 0) return search([]);
  return search(sameKindAnchors) ?? search([]);
}
