import type { BuildingFootprint } from '@open-northland/data';
import type { GeometryDebugItem } from '@open-northland/render';
import { nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { buildingTypeOf, isBuilding, positionOf } from '../game/snapshot.js';
import { workerIconNode } from './building-points.js';

/**
 * The `?debug=geometry` PROJECTION — turn the frozen snapshot into the per-building
 * {@link GeometryDebugItem} list the render overlay draws (the `computeDoorBadges` pattern: pure over
 * the snapshot + the building-type table, unit-tested headless; the app calls it only when the
 * building set changed). The worker-icon anchor comes from the SAME {@link workerIconNode} helper the
 * door badges use — including its doorless fallback (beside the building's anchor node) — so the blue
 * diagram dot and the live badge stack can never disagree.
 */

/** The slice of a building TYPE the projection needs: the FULL footprint (the overlay draws every
 *  channel, where the door-badge path needs only the door) plus the stable `id` — the worker-icon
 *  override key and the diagram label. game-view passes the one `indexById(sim.content.buildings)`
 *  map to this and the badge projection alike. */
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
    const icon = workerIconNode(fp, anchor, info?.id);
    items.push({
      anchor,
      blocked: fp?.blocked ?? [],
      reserved: fp?.reserved ?? [],
      door: fp?.door,
      iconAnchor: { dx: icon.hx - anchor.hx, dy: icon.hy - anchor.hy },
      label: info?.id ?? (typeId !== undefined ? `#${typeId}` : undefined),
    });
  }
  return items;
}

/**
 * A change-detection fingerprint over the snapshot's BUILDINGS — their ids, types, and positions — so the
 * overlay rebuilds exactly when a building appears, disappears, MOVES, or upgrades in place (a home
 * level-up mutates `buildingType` without an add/remove, which the placement-blocker version ignores) and
 * NOT when unrelated blockers churn (every felled tree bumps that version, re-rasterizing every building's
 * label map-wide per harvest). An order-sensitive 32-bit accumulate is enough for a view memo — snapshot
 * entity order is stable between identical building sets, and a stale-on-collision frame heals on the next
 * real change.
 */
export function buildingSetFingerprint(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, GeometryBuildingInfo>,
): number {
  // Fold the table identity in via its size so a content swap (new footprints) also invalidates.
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
  /** Per-frame: rebuild + push the overlay items, but only when the building set actually changed. */
  update(snapshot: WorldSnapshot): void;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
}

/**
 * The stateful DRIVER for the `?debug=geometry` overlay — the per-frame memo game-view runs. It holds the
 * last {@link buildingSetFingerprint} and pushes a fresh {@link computeGeometryDebugItems} projection to
 * `setItems` only when the building set changes (an add/remove/move/in-place upgrade), never per frame and
 * never on unrelated blocker churn. A no-op when `enabled` is false (the flag is absent).
 */
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
