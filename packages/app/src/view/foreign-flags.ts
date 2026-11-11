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
  /** A barracks' rally flag, which the banner layer draws in place of the flag sprite. */
  readonly rally: boolean;
}

/** Each flag holder's flag and owner; `version` bumps on every change, so a reader rebuilds per change. */
interface FlagHoldings {
  readonly byHolder: Map<number, FlagHolding>;
  version: number;
}

function holdingOf(e: EntitySnapshot): FlagHolding | undefined {
  const work = workFlagOf(e);
  const flag = work ?? rallyFlagOf(e);
  return flag === undefined ? undefined : { flag, owner: ownerPlayerOf(e), rally: work === undefined };
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
    if (holding?.flag === held?.flag && holding?.owner === held?.owner) return;
    if (holding === undefined) state.byHolder.delete(next.id);
    else state.byHolder.set(next.id, holding);
    state.version++;
  },
  differs: (held, fresh) => firstDifference(held.byHolder, fresh.byHolder, 'the holdings'),
};

export function flagHoldingsOf(snapshot: WorldSnapshot): FlagHoldings {
  return indexesOf(snapshot).get(FLAG_HOLDINGS);
}

/**
 * The flag sprites hidden from `viewer`: a gatherer's, hunter's, fisher's or carrier's flag shows only to
 * its own seat, and the whole map shows every such flag. Owner ruling. A barracks' rally flag never
 * draws as a sprite: its banner does (`projections/rally-banners.ts`). Answers the same set until a
 * holding or the viewer changes.
 */
export function createForeignFlags(viewer: ViewerSeat): (snapshot: WorldSnapshot) => ReadonlySet<number> {
  let holdings: FlagHoldings | undefined;
  let version = -1;
  let seat: number | null = null;
  let hidden: ReadonlySet<number> = new Set();
  return (snapshot) => {
    const current = flagHoldingsOf(snapshot);
    const currentSeat = pickableSeat(viewer);
    if (current === holdings && current.version === version && currentSeat === seat) return hidden;
    holdings = current;
    version = current.version;
    seat = currentSeat;
    const foreign = new Set<number>();
    const own = new Set<number>();
    for (const { flag, owner, rally } of current.byHolder.values()) {
      (rally || ownedByAnotherSeat(owner, currentSeat) ? foreign : own).add(flag);
    }
    for (const flag of own) foreign.delete(flag);
    hidden = foreign;
    return hidden;
  };
}
