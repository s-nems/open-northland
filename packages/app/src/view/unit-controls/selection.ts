import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { memoBySnapshot, selectedWorkFlags } from '../projections/index.js';

/** Shared empty id set, so an empty selection allocates nothing per call. */
const EMPTY_IDS: ReadonlySet<number> = new Set();

/** Whether an id may share a selection with others: settlers and vehicles do. */
export type IsUnit = (id: number) => boolean;

const sameIds = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

/**
 * The ids `added` leaves on a selection holding `held`, replacing it unless `add`. Owner ruling: a
 * selection of several holds only units; a building, palisade, signpost or site is selected alone.
 * So an added non-unit takes the selection alone (the last one added), and a result of several ids
 * keeps its units, or its last id when none is a unit.
 */
export function selectionAfter(
  held: Iterable<number>,
  added: Iterable<number>,
  add: boolean,
  isUnit: IsUnit,
): number[] {
  const incoming = [...added];
  if (add) {
    for (let i = incoming.length - 1; i >= 0; i--) {
      const id = incoming[i];
      if (id !== undefined && !isUnit(id)) return [id];
    }
  }
  const result = [...new Set(add ? [...held, ...incoming] : incoming)];
  if (result.length <= 1) return result;
  const units = result.filter(isUnit);
  if (units.length > 0) return units;
  return result.slice(-1);
}

export interface UnitSelection {
  readonly ids: () => ReadonlySet<number>;
  /** Memo key over the selection: {@link ids} is one set mutated in place, and a click can re-select
   *  within one tick, so neither its identity nor the snapshot's can invalidate a cached read. */
  readonly version: () => number;
  /** Replaces the set, or extends it when `add`, under {@link selectionAfter}; true when the set
   *  actually changed. */
  readonly apply: (ids: Iterable<number>, add: boolean) => boolean;
  /** Drops the members `snapshot` no longer holds; true when any went. Looks up only the selected ids,
   *  once per snapshot and selection change. */
  readonly dropGone: (snapshot: WorldSnapshot) => boolean;
  /** Memoized per tick and change: the renderer reads these every frame. */
  readonly workFlagIds: (snapshot: WorldSnapshot) => ReadonlySet<number>;
}

export function createUnitSelection(isUnit: IsUnit): UnitSelection {
  const selected = new Set<number>();
  let version = 0;
  /** The selection version each snapshot was last checked for gone members under. */
  const checkedAt = new WeakMap<WorldSnapshot, number>();

  const workFlagsFor = memoBySnapshot(
    (snapshot: WorldSnapshot) => (selected.size === 0 ? EMPTY_IDS : selectedWorkFlags(snapshot, selected)),
    () => version,
  );

  return {
    ids: () => selected,
    version: () => version,
    apply: (ids, add) => {
      const next = selectionAfter(selected, ids, add, isUnit);
      const before = new Set(selected);
      selected.clear();
      for (const id of next) selected.add(id);
      if (sameIds(before, selected)) return false;
      version++;
      return true;
    },
    dropGone: (snapshot) => {
      if (checkedAt.get(snapshot) === version) return false;
      let gone = false;
      for (const id of selected) {
        if (entityById(snapshot, id) !== undefined) continue;
        selected.delete(id);
        gone = true;
      }
      if (gone) version++;
      checkedAt.set(snapshot, version);
      return gone;
    },
    workFlagIds: (snapshot) => workFlagsFor(snapshot),
  };
}
