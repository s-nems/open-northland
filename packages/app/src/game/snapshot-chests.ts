import type { ContentSet } from '@open-northland/data';
import { CHEST_KINDS, type ChestKind, systems } from '@open-northland/sim';
import { type SnapshotEntity, settlerJobType } from './snapshot-base.js';
import { isAdult } from './snapshot-family.js';

// Snapshot reads for the chest feature.

/** A closed chest's kind, or undefined for an entity that is no chest. */
export function chestKindOf(e: SnapshotEntity): ChestKind | undefined {
  const chest = e.components.Chest as { kind?: unknown } | undefined;
  const kind = chest?.kind;
  return CHEST_KINDS.find((k) => k === kind);
}

/** Whether the settler may open a `kind` chest: grown, and of a trade the chest admits. */
export function canOpenChest(e: SnapshotEntity, kind: ChestKind, content: ContentSet): boolean {
  return isAdult(e) && systems.jobCanOpenChest(content, settlerJobType(e) ?? null, kind);
}
