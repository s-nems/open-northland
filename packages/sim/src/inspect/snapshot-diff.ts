import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';

/**
 * `diffSnapshots` — the **"diff state between two ticks"** half of the time-travel / replay inspector
 * (plan "Cross-cutting DX"). `replay()` jumps to tick N and `HashTrace` finds tick N; this turns
 * two of those reconstructed states into a per-entity / per-component DELTA the overlay renders ("what
 * changed between tick 431 and tick 432?", "dump entity 7's changes").
 *
 * It is a pure function of two {@link WorldSnapshot} values — plain, structurally-cloned data with no
 * class instances, live `Map`s, or `Entity` brands (see `snapshot.ts`). So it is render-agnostic and
 * agent-self-verifiable headlessly, exactly like `replay()`/`HashTrace`; the human-eyed dev overlay
 * consumes this rather than reimplementing the comparison.
 *
 * ## Determinism / ordering
 *
 * Snapshots are already canonical: entities ascending by id, and a component `Map` is cloned to a
 * sorted `[key,value]` array (`snapshot.ts` `clonePlain`). This diff walks both entity lists in that
 * ascending-id order (a merge join) and walks each entity's component names in sorted order, so its
 * output arrays are deterministic without any extra sort — same two snapshots in, byte-identical diff
 * out, regardless of how the live stores happened to be traversed.
 *
 * ## Equality
 *
 * Component values are compared by **canonical JSON** (`JSON.stringify` over the already-sorted plain
 * clone). Because the clone sorts object keys and Map entries, two values that are deeply equal
 * serialize identically — and the snapshot's plain shape has no functions/cycles to trip `stringify`.
 * This mirrors how `hashState()` fingerprints a component, so "diverged" here agrees with the hash.
 */

/** A single component's change on an entity present in both snapshots. */
export interface ComponentChange {
  readonly name: string;
  /**
   * `'added'` — the component is on the entity in `b` but not `a`; `'removed'` — on `a` but not `b`;
   * `'changed'` — on both, but the value differs.
   */
  readonly kind: 'added' | 'removed' | 'changed';
  /** The value in `a` (the "before"), or `undefined` for an `'added'` component. */
  readonly before?: unknown;
  /** The value in `b` (the "after"), or `undefined` for a `'removed'` component. */
  readonly after?: unknown;
}

/** An entity that exists in BOTH snapshots but whose components differ, with its per-component delta. */
export interface ChangedEntity {
  readonly id: number;
  /** The component changes, in ascending component-name order (at least one). */
  readonly changes: readonly ComponentChange[];
}

/**
 * The delta between two snapshots: which entities appeared, which vanished, and — for survivors — what
 * changed on them. Entities with NO component change are omitted from `changed`. All arrays are in
 * ascending-id order; `changed[].changes` is in ascending component-name order.
 */
export interface SnapshotDiff {
  /** The tick of the "before" snapshot (`a.tick`). */
  readonly fromTick: number;
  /** The tick of the "after" snapshot (`b.tick`). */
  readonly toTick: number;
  /** Entities present in `b` but not `a`, ascending by id. */
  readonly added: readonly EntitySnapshot[];
  /** Entities present in `a` but not `b`, ascending by id. */
  readonly removed: readonly EntitySnapshot[];
  /** Entities in both whose components differ, ascending by id. */
  readonly changed: readonly ChangedEntity[];
}

/** Canonical equality over two already-sorted plain snapshot values (mirrors how `hashState` fingerprints). */
function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compute the per-component delta for an entity present in both snapshots (empty when nothing changed).
 * Exported so `entity-dump.ts`'s `traceEntity` reuses the EXACT comparison — a single-entity per-tick
 * delta is then guaranteed to equal that entity's slice of the full two-tick diff (they can't drift).
 */
export function diffComponents(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): ComponentChange[] {
  // Union of component names, sorted, so the output is deterministic regardless of store traversal.
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
 * Diff two world snapshots into a per-entity / per-component delta. Pure: it reads only the two plain
 * snapshot values and allocates a fresh result, never touching the live world. Both snapshots are
 * assumed canonical (ascending entity ids — guaranteed by `takeSnapshot`); the entity lists are merged
 * in that order, so the diff is O(|a| + |b|) and its arrays come out ascending-id without a re-sort.
 */
export function diffSnapshots(a: WorldSnapshot, b: WorldSnapshot): SnapshotDiff {
  const added: EntitySnapshot[] = [];
  const removed: EntitySnapshot[] = [];
  const changed: ChangedEntity[] = [];

  // Merge join over the two ascending-id entity lists.
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
  // Tails: whatever remains in `a` was removed; whatever remains in `b` was added.
  for (; i < ea.length; i++) removed.push(ea[i] as EntitySnapshot);
  for (; j < eb.length; j++) added.push(eb[j] as EntitySnapshot);

  return { fromTick: a.tick, toTick: b.tick, added, removed, changed };
}
