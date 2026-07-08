import type { WorldSnapshot } from '@vinland/sim';

/**
 * Typed read helpers over the frozen {@link WorldSnapshot} — the ONE place the view layer's knowledge
 * of snapshot component shapes lives, so the panels/controls stop re-inventing `as {...}` casts per
 * file. These read the snapshot (the allowed one-way flow), never live component stores; every read is
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

/** The entity's fixed-point `Position`, or undefined. */
export function positionOf(e: SnapshotEntity): { x: number; y: number } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

/** True when the entity is a settler / a building (carries the marker component). */
export function isSettler(e: SnapshotEntity): boolean {
  return e.components.Settler !== undefined;
}
export function isBuilding(e: SnapshotEntity): boolean {
  return e.components.Building !== undefined;
}
