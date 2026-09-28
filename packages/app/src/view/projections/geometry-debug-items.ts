import type { BuildingFootprint } from '@open-northland/data';
import type { GeometryDebugItem } from '@open-northland/render';
import { entitiesWith, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { buildingTribeOf, buildingTypeOf, positionOf } from '../../game/snapshot.js';
import { workerIconNode } from './building-points.js';

/** The per-building footprint diagram behind the `?debug=geometry` flag. */

export interface GeometryBuildingInfo {
  readonly id?: string | undefined;
  readonly footprint?: BuildingFootprint | undefined;
}

/** A building's geometry by type and the tribe that built it. */
export type GeometryBuildingInfoOf = (
  typeId: number | undefined,
  tribe: number | undefined,
) => GeometryBuildingInfo | undefined;

export function computeGeometryDebugItems(
  snapshot: WorldSnapshot,
  geometryOf: GeometryBuildingInfoOf,
): GeometryDebugItem[] {
  const items: GeometryDebugItem[] = [];
  for (const e of entitiesWith(snapshot, 'Building')) {
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const anchor = nodeOfPosition(pos.x, pos.y);
    const typeId = buildingTypeOf(e);
    const info = geometryOf(typeId, buildingTribeOf(e));
    const fp = info?.footprint;
    items.push({
      anchor,
      blocked: fp?.blocked ?? [],
      reserved: fp?.reserved ?? [],
      door: fp?.door,
      // An absolute node, already door-resolved: the overlay's authored-frame shift must not touch it.
      iconAnchor: workerIconNode(fp, anchor, info?.id),
      label: info?.id ?? (typeId !== undefined ? `#${typeId}` : undefined),
    });
  }
  return items;
}

/**
 * A change key over building ids, types, and positions: an in-place upgrade mutates `buildingType`
 * without an add or remove. Order-sensitive 32-bit accumulate, so a collision costs one stale frame
 * and heals on the next real change.
 */
export function buildingSetFingerprint(snapshot: WorldSnapshot): number {
  let h = 0;
  for (const e of entitiesWith(snapshot, 'Building')) {
    const pos = positionOf(e);
    h = (Math.imul(h, 31) + e.id) | 0;
    h = (Math.imul(h, 31) + (buildingTypeOf(e) ?? -1)) | 0;
    h = (Math.imul(h, 31) + (pos !== undefined ? pos.x + pos.y : -1)) | 0;
  }
  return h;
}

export interface GeometryDebugOverlay {
  update(snapshot: WorldSnapshot): void;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
}

/** Pushes a fresh projection to `setItems` only when the building set changes, never per frame. */
export function createGeometryDebugOverlay(opts: {
  readonly enabled: boolean;
  readonly geometryOf: GeometryBuildingInfoOf;
  readonly setItems: (items: GeometryDebugItem[]) => void;
}): GeometryDebugOverlay {
  let fingerprint: number | null = null;
  let enabled = opts.enabled;
  return {
    update(snapshot: WorldSnapshot): void {
      if (!enabled) return;
      const fp = buildingSetFingerprint(snapshot);
      if (fp === fingerprint) return;
      fingerprint = fp;
      opts.setItems(computeGeometryDebugItems(snapshot, opts.geometryOf));
    },
    enabled: () => enabled,
    setEnabled(next): void {
      if (next === enabled) return;
      enabled = next;
      fingerprint = null;
      if (!enabled) opts.setItems([]);
    },
  };
}
