import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';

export interface ComponentChange {
  readonly name: string;
  /** Whether the component is on the entity in `b` only, `a` only, or on both with a different value. */
  readonly kind: 'added' | 'removed' | 'changed';
  /** The value in `a`, or `undefined` for an `'added'` component. */
  readonly before?: unknown;
  /** The value in `b`, or `undefined` for a `'removed'` component. */
  readonly after?: unknown;
}

export interface ChangedEntity {
  readonly id: number;
  /** Ascending by component name, never empty. */
  readonly changes: readonly ComponentChange[];
}

/** Entities with no component change are omitted from `changed`. */
export interface SnapshotDiff {
  readonly fromTick: number;
  readonly toTick: number;
  /** Entities present in `b` but not `a`, ascending by id. */
  readonly added: readonly EntitySnapshot[];
  /** Entities present in `a` but not `b`, ascending by id. */
  readonly removed: readonly EntitySnapshot[];
  /** Entities in both whose components differ, ascending by id. */
  readonly changed: readonly ChangedEntity[];
}

/**
 * Canonical-JSON equality. Sound because `clonePlain` leaves a component's object keys in one
 * deterministic order and sorts Map entries, and it matches how `hashState` fingerprints a component.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The per-component delta for an entity present in both snapshots. Shared with `traceEntity` so a
 * single-entity delta cannot drift from that entity's slice of the full diff.
 */
export function diffComponents(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): ComponentChange[] {
  // Sorted union, so the output does not depend on store traversal order.
  const names = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changes: ComponentChange[] = [];
  for (const name of [...names].sort()) {
    const inA = Object.hasOwn(before, name);
    const inB = Object.hasOwn(after, name);
    if (inA && !inB) {
      changes.push({ name, kind: 'removed', before: before[name] });
    } else if (!inA && inB) {
      changes.push({ name, kind: 'added', after: after[name] });
    } else if (!valuesEqual(before[name], after[name])) {
      changes.push({ name, kind: 'changed', before: before[name], after: after[name] });
    }
  }
  return changes;
}

/**
 * Diff two world snapshots into a per-entity, per-component delta. Both must be canonical (ascending
 * entity ids), so the merge join is O(|a| + |b|) and the output stays ascending-id without a re-sort.
 */
export function diffSnapshots(a: WorldSnapshot, b: WorldSnapshot): SnapshotDiff {
  const added: EntitySnapshot[] = [];
  const removed: EntitySnapshot[] = [];
  const changed: ChangedEntity[] = [];

  let i = 0;
  let j = 0;
  const ea = a.entities;
  const eb = b.entities;
  while (i < ea.length && j < eb.length) {
    const ae = ea[i] as EntitySnapshot;
    const be = eb[j] as EntitySnapshot;
    if (ae.id < be.id) {
      removed.push(ae);
      i++;
    } else if (ae.id > be.id) {
      added.push(be);
      j++;
    } else {
      const changes = diffComponents(ae.components, be.components);
      if (changes.length > 0) changed.push({ id: ae.id, changes });
      i++;
      j++;
    }
  }
  for (; i < ea.length; i++) removed.push(ea[i] as EntitySnapshot);
  for (; j < eb.length; j++) added.push(eb[j] as EntitySnapshot);

  return { fromTick: a.tick, toTick: b.tick, added, removed, changed };
}
