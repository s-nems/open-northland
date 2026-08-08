import {
  type BuildingFootprint,
  type ContentSet,
  type FootprintCell,
  footprintCellDx,
  footprintCellMaxAbsDx,
} from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** Whether two cell sets hold exactly the same nodes - the blocked-set memo verifiers' held-vs-fresh
 *  compare. */
export function sameCells(a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean {
  if (a.size !== b.size) return false;
  for (const cell of a) if (!b.has(cell)) return false;
  return true;
}

/** The footprint of a building type, or undefined when the type is unknown or carries none. Keyed by
 *  content (not a full SystemContext) so the placement-overlay probe can resolve footprints without a tick. */
export function buildingFootprintOf(
  content: ContentSet,
  buildingType: number,
): BuildingFootprint | undefined {
  return contentIndex(content).buildings.get(buildingType)?.footprint;
}

/** Translate a footprint cell list onto an anchor node, applying the odd-row parity shift
 *  (`footprintCellDx`) and dropping cells outside the terrain grid, so a border-hugging building simply
 *  blocks or reserves fewer cells than its template. */
export function translatedCells(
  terrain: TerrainGraph,
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
): NodeId[] {
  const out: NodeId[] = [];
  for (const c of cells) {
    const x = anchorX + footprintCellDx(anchorY, c);
    const y = anchorY + c.dy;
    if (terrain.inBounds(x, y)) out.push(terrain.nodeAt(x, y));
  }
  return out;
}

/** The 1-cell footprint a footprint-less building presents to placement checks. */
export const ANCHOR_ONLY: readonly FootprintCell[] = Object.freeze([{ dx: 0, dy: 0 }]);

/** The cells of `buildingType` that a work flag may not occupy, anchor-relative: its family body (a
 *  level-0 house reserves its top tier's space), or the bare anchor for a footprint-less type. Shared by
 *  the rule that REFUSES a flag here (`eachBlockerCell`'s OBSTACLE channel) and the push-out that CLEARS
 *  one from here (`evictWorkFlagsFromFootprint`), so a placement cannot leave a flag on ground the plant
 *  rule rejects. */
export function buildingFlagBody(content: ContentSet, buildingType: number): readonly FootprintCell[] {
  const fp = buildingFootprintOf(content, buildingType);
  return fp?.familyBody.length ? fp.familyBody : ANCHOR_ONLY;
}

/** A building's reserved build-exclusion zone as {@link NodeId}s. See {@link reservedZoneOf}. */
export interface ReservedZone {
  readonly zone: ReadonlySet<NodeId>;
  /** Chebyshev bound of the reserved cells - the box `reach` a region-index `near` query must span to be a
   *  provable superset of the zone. */
  readonly reach: number;
}

/**
 * The reserved build-exclusion zone of a building anchored at half-cell `(anchorHx, anchorHy)`: its type's
 * `reserved` footprint cells, or the bare anchor for a footprint-less type, translated onto the anchor.
 * Undefined when the zone is empty, which needs a fully off-grid anchor.
 */
export function reservedZoneOf(
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
  anchorHx: number,
  anchorHy: number,
): ReservedZone | undefined {
  const cells = buildingFootprintOf(content, buildingType)?.reserved ?? ANCHOR_ONLY;
  const zone = new Set<NodeId>(translatedCells(terrain, cells, anchorHx, anchorHy));
  if (zone.size === 0) return undefined;
  let reach = 0;
  for (const c of cells) reach = Math.max(reach, footprintCellMaxAbsDx(c), Math.abs(c.dy));
  return { zone, reach };
}
