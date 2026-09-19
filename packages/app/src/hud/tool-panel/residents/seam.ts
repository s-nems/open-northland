import type { WorldSnapshot } from '@open-northland/sim';
import type { ResidentRow } from './rows.js';

/** What the residents window reads from the game and asks of it. */
export interface ResidentsSeam {
  /** The seat's people for the current tick; the same array until the next one. Pulled only while
   *  the window is open: it is one walk over the snapshot's actors. */
  readonly rows: () => readonly ResidentRow[];
  /** The snapshot those rows came from, which the row figures are drawn off. */
  readonly snapshot: () => WorldSnapshot;
  /** Whether the sim would let the settler take the trade (`Simulation.canChooseJob`). */
  readonly canBecome: (id: number, jobType: number) => boolean;
  /** The unit controls' selection; `version` moves with every change. */
  readonly selection: { readonly ids: () => ReadonlySet<number>; readonly version: () => number };
  /** Replace the selection with `ids` and show a single one on the map, or with `extend` add them
   *  to the selected group. */
  readonly onSelect: (ids: readonly number[], extend: boolean) => void;
}
