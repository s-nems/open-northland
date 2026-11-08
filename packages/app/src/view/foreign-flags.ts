import {
  type EntitySnapshot,
  firstDifference,
  indexesOf,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf, rallyFlagOf, workFlagOf } from '../game/snapshot/index.js';
import { ownedByAnotherSeat, pickableSeat, type ViewerSeat } from '../game/viewer-seat.js';

interface FlagHolding {
  readonly flag: number;
  readonly owner: number | undefined;
  /** The holder is a barracks and the flag its rally point, which shows only while the barracks is. */
  readonly rally: boolean;
}

/** Each flag holder's flag and owner; `version` bumps on every change, so a reader rebuilds per change. */
interface FlagHoldings {
  readonly byHolder: Map<number, FlagHolding>;
  version: number;
}

function holdingOf(e: EntitySnapshot): FlagHolding | undefined {
  const flag = workFlagOf(e) ?? rallyFlagOf(e);
  return flag === undefined
    ? undefined
    : { flag, owner: ownerPlayerOf(e), rally: rallyFlagOf(e) !== undefined };
}

const FLAG_HOLDINGS: SnapshotIndexSpec<FlagHoldings> = {
  name: 'flag holdings',
  reads: { values: ['WorkFlag', 'HaulFlag', 'RallyPoint', 'Owner'] },
  empty: () => ({ byHolder: new Map(), version: 0 }),
  add: (state, e) => {
    const holding = holdingOf(e);
    if (holding === undefined) return;
    state.byHolder.set(e.id, holding);
    state.version++;
  },
  remove: (state, e) => {
    if (state.byHolder.delete(e.id)) state.version++;
  },
  replace: (state, _previous, next) => {
    const holding = holdingOf(next);
    const held = state.byHolder.get(next.id);
    if (holding?.flag === held?.flag && holding?.owner === held?.owner && holding?.rally === held?.rally)
      return;
    if (holding === undefined) state.byHolder.delete(next.id);
    else state.byHolder.set(next.id, holding);
    state.version++;
  },
  differs: (held, fresh) => firstDifference(held.byHolder, fresh.byHolder, 'the holdings'),
};

export function flagHoldingsOf(snapshot: WorldSnapshot): FlagHoldings {
  return indexesOf(snapshot).get(FLAG_HOLDINGS);
}

/** The selection a rally flag's visibility follows, as the unit controls hold it. */
export interface FlagSelection {
  readonly ids: () => ReadonlySet<number>;
  readonly version: () => number;
}

const NO_SELECTION: ReadonlySet<number> = new Set();

/**
 * The flags hidden from `viewer`: a gatherer's, hunter's, fisher's or carrier's flag shows only to its
 * own seat, and a barracks' rally flag only to its owner and only while the owner keeps the barracks
 * selected - the `selection` the game view holds, whose absence hides every owner's rally flag (owner
 * ruling; a projection without a selection has none to show it by). The whole map shows every other
 * flag. Answers the same set until a holding, the viewer or the selection changes.
 */
export function createForeignFlags(
  viewer: ViewerSeat,
  selection?: FlagSelection,
): (snapshot: WorldSnapshot) => ReadonlySet<number> {
  let holdings: FlagHoldings | undefined;
  let version = -1;
  let seat: number | null = null;
  let selectionVersion = -1;
  let hidden: ReadonlySet<number> = new Set();
  return (snapshot) => {
    const current = flagHoldingsOf(snapshot);
    const currentSeat = pickableSeat(viewer);
    const currentSelection = selection?.version() ?? -1;
    if (
      current === holdings &&
      current.version === version &&
      currentSeat === seat &&
      currentSelection === selectionVersion
    )
      return hidden;
    holdings = current;
    version = current.version;
    seat = currentSeat;
    selectionVersion = currentSelection;
    const shown = selection?.ids() ?? NO_SELECTION;
    const foreign = new Set<number>();
    const own = new Set<number>();
    for (const [holder, holding] of current.byHolder) {
      const conceal = ownedByAnotherSeat(holding.owner, currentSeat) || (holding.rally && !shown.has(holder));
      (conceal ? foreign : own).add(holding.flag);
    }
    for (const flag of own) foreign.delete(flag);
    hidden = foreign;
    return hidden;
  };
}
