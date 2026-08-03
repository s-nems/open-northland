import type { BuildingFootprint } from '@open-northland/data';
import type { GeometryDebugItem } from '@open-northland/render';
import { nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { buildingTypeOf, isBuilding, positionOf } from '../../game/snapshot.js';
import { workerIconNode } from './building-points.js';

/** The per-building footprint diagram behind the `?debug=geometry` flag. */

export interface GeometryBuildingInfo {
  readonly id?: string | undefined;
  readonly footprint?: BuildingFootprint | undefined;
}

export function computeGeometryDebugItems(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, GeometryBuildingInfo>,
): GeometryDebugItem[] {
  const items: GeometryDebugItem[] = [];
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const anchor = nodeOfPosition(pos.x, pos.y);
    const typeId = buildingTypeOf(e);
    const info = typeId !== undefined ? buildingsByType.get(typeId) : undefined;
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
export function buildingSetFingerprint(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, GeometryBuildingInfo>,
): number {
  // Seeded with the table size so a content swap invalidates too.
  let h = buildingsByType.size | 0;
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
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
  readonly buildingsByType: ReadonlyMap<number, GeometryBuildingInfo>;
  readonly setItems: (items: GeometryDebugItem[]) => void;
}): GeometryDebugOverlay {
  let fingerprint: number | null = null;
  let enabled = opts.enabled;
  return {
    update(snapshot: WorldSnapshot): void {
      if (!enabled) return;
      const fp = buildingSetFingerprint(snapshot, opts.buildingsByType);
      if (fp === fingerprint) return;
      fingerprint = fp;
      opts.setItems(computeGeometryDebugItems(snapshot, opts.buildingsByType));
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
