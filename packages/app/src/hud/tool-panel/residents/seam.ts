import type { ResidentRow, TradePick } from './rows.js';

/** What the residents window reads from the game and asks of it. */
export interface ResidentsSeam {
  /** The seat's people for the current tick; the same array until the next one. Pulled only while
   *  the window is open: it is one walk over the snapshot's actors. */
  readonly rows: () => readonly ResidentRow[];
  /** Whether the sim would let the settler take the trade (`SessionHost.canChooseJob`) and, for a pick
   *  held to a good, has earned that good (`SessionHost.hasEarnedGood`). */
  readonly canBecome: (id: number, pick: TradePick) => boolean;
  /** Bumped when a `canBecome` answer lands anew. */
  readonly answersVersion?: () => number;
  /** The unit controls' selection; `version` moves with every change. */
  readonly selection: { readonly ids: () => ReadonlySet<number>; readonly version: () => number };
  /** Replace the selection with `ids`; with `show` the map also centres on a single one. */
  readonly onSelect: (ids: readonly number[], show: boolean) => void;
}
