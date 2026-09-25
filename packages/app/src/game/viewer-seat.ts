/**
 * The seat whose perspective the view shows: the summary figures, the notes, the papers, the chest,
 * and, unless the view spans the whole map, the fog and what a click may select. A played session's
 * is its own seat for good; a spectator's is the seat it chose to watch, or none for the whole map.
 */
export interface ViewerSeat {
  /** The seat whose figures, notes, papers and chest the HUD shows; null shows nobody's. */
  seat(): number | null;
  /** Whether the view spans the whole map: no fog, every entity pickable. */
  wholeMap(): boolean;
  /** Bumps on every switch, so a memo keyed on a snapshot also keys on it. */
  version(): number;
}

/** A spectator's seat, switched from the HUD. */
export interface SwitchableViewerSeat extends ViewerSeat {
  watch(seat: number | null): void;
  /** Runs after every switch, with the seat now watched. */
  onSwitch(listener: (seat: number | null) => void): void;
}

/** The owner a click or a control-group recall is limited to; null on the whole map, where every
 *  owner's entities are the viewer's to pick. */
export function pickableSeat(viewer: ViewerSeat): number | null {
  return viewer.wholeMap() ? null : viewer.seat();
}

/** A played session's own seat: its fog, its entities, its figures. */
export function fixedViewerSeat(seat: number): ViewerSeat {
  return { seat: () => seat, wholeMap: () => false, version: () => 0 };
}

/** The overseer's view: the whole map to see and pick, with `seat`'s figures, chest and papers, since
 *  its orders and paper plans go out as that seat's. */
export function overseerViewerSeat(seat: number): ViewerSeat {
  return { seat: () => seat, wholeMap: () => true, version: () => 0 };
}

/** A spectator's switchable seat; watching none (null) is the whole map with nobody's figures. */
export function switchableViewerSeat(initial: number | null): SwitchableViewerSeat {
  let seat = initial;
  let version = 0;
  const listeners: ((seat: number | null) => void)[] = [];
  return {
    seat: () => seat,
    wholeMap: () => seat === null,
    version: () => version,
    watch: (next) => {
      if (next === seat) return;
      seat = next;
      version++;
      for (const listener of listeners) listener(next);
    },
    onSwitch: (listener) => {
      listeners.push(listener);
    },
  };
}
