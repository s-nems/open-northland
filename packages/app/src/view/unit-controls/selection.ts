import type { WorldSnapshot } from '@open-northland/sim';
import { memoBySnapshot, selectedWorkFlags } from '../projections/index.js';

/** Shared empty id set, so an empty selection allocates nothing per call. */
const EMPTY_IDS: ReadonlySet<number> = new Set();

const sameIds = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

export interface UnitSelection {
  readonly ids: () => ReadonlySet<number>;
  /** Memo key over the selection: {@link ids} is one set mutated in place, and a click can re-select
   *  within one tick, so neither its identity nor the snapshot's can invalidate a cached read. */
  readonly version: () => number;
  /** Replaces the set, or extends it when `add`; true when the set actually changed. */
  readonly apply: (ids: Iterable<number>, add: boolean) => boolean;
  /** Memoized per tick and change: the renderer reads these every frame. */
  readonly workFlagIds: (snapshot: WorldSnapshot) => ReadonlySet<number>;
}

export function createUnitSelection(): UnitSelection {
  const selected = new Set<number>();
  let version = 0;

  const workFlagsFor = memoBySnapshot(
    (snapshot: WorldSnapshot) => (selected.size === 0 ? EMPTY_IDS : selectedWorkFlags(snapshot, selected)),
    () => version,
  );

  return {
    ids: () => selected,
    version: () => version,
    apply: (ids, add) => {
      const before = new Set(selected);
      if (!add) selected.clear();
      for (const id of ids) selected.add(id);
      if (sameIds(before, selected)) return false;
      version++;
      return true;
    },
    workFlagIds: (snapshot) => workFlagsFor(snapshot),
  };
}
