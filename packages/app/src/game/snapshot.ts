import type { Fixed, WorldSnapshot } from '@open-northland/sim';

/**
 * Typed read helpers over the frozen {@link WorldSnapshot} — the shared owner/position/kind reads the
 * controls and panels all need, so they stop re-inventing the same `as {...}` casts per file (display
 * panels still cast their own presentation-only fields, e.g. the details panel's needs/carry/stance).
 * These read the snapshot (the allowed one-way flow), never live component stores; every read is
 * defensive (`undefined` on a missing component/field) because a snapshot entity carries only the
 * components it has.
 */

/** One serialized entity of a snapshot. */
export type SnapshotEntity = WorldSnapshot['entities'][number];

/** The entity with `id`, or undefined (linear — panels only resolve the selected few). */
export function entityById(snapshot: WorldSnapshot, id: number): SnapshotEntity | undefined {
  return snapshot.entities.find((e) => e.id === id);
}

/** Narrow an unknown component field to a number, else undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** The owning player of an entity (its `Owner.player`), or undefined for a neutral/unowned entity. */
export function ownerPlayerOf(e: SnapshotEntity): number | undefined {
  const owner = e.components.Owner as { player?: unknown } | undefined;
  return num(owner?.player);
}

/** The entity's fixed-point `Position`, or undefined. The snapshot serializes the sim's branded
 *  `Fixed` values as plain numbers; this reader is the ONE place the brand is restored (by the
 *  sim's own invariant a snapshot Position IS fixed-point), so consumers can feed grid seams like
 *  `nodeOfPosition` without minting the brand themselves. */
export function positionOf(e: SnapshotEntity): { x: Fixed; y: Fixed } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x: x as Fixed, y: y as Fixed } : undefined;
}

/** True when the entity is a settler / a building (carries the marker component). */
export function isSettler(e: SnapshotEntity): boolean {
  return e.components.Settler !== undefined;
}
export function isBuilding(e: SnapshotEntity): boolean {
  return e.components.Building !== undefined;
}
/** The `buildingType` typeId of a building entity, or undefined if it isn't one / carries none. */
export function buildingTypeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { buildingType?: unknown } | undefined;
  return num(b?.buildingType);
}

/** The drop-off FLAG entity a gatherer carries (its `WorkFlag.flag`), or undefined for a non-gatherer. */
export function workFlagOf(e: SnapshotEntity): number | undefined {
  const wf = e.components.WorkFlag as { flag?: unknown } | undefined;
  return num(wf?.flag);
}

/**
 * Map each gatherer's drop-off FLAG entity → its owning gatherer, for the human `player` only — the
 * INVERSE of the gatherer→flag {@link workFlagOf} edge (a flag stores no back-reference, so resolving
 * "which gatherer owns this flag" needs this scan). Lets a click on a flag resolve to the gatherer to
 * select. A gatherer binds to exactly one flag, so the map is 1:1.
 */
export function gathererByFlag(snapshot: WorldSnapshot, player: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (ownerPlayerOf(e) !== player) continue;
    const flag = workFlagOf(e);
    if (flag !== undefined) out.set(flag, e.id);
  }
  return out;
}
