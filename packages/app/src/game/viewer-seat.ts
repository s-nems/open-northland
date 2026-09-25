/**
 * The seat whose perspective the view shows: fog, the summary figures, the notes, what a click may
 * select. A played session's is its own seat for good; a spectator's is the seat it chose to watch,
 * or none for the whole map.
 */
export interface ViewerSeat {
  /** The watched seat, or null while a spectator watches the whole map: no fog, nobody's figures,
   *  no notes, every entity pickable. */
  seat(): number | null;
  /** Bumps on every switch, so a memo keyed on a snapshot also keys on it. */
  version(): number;
}

/** A spectator's seat, switched from the HUD. */
export interface SwitchableViewerSeat extends ViewerSeat {
  watch(seat: number | null): void;
  /** Runs after every switch, with the seat now watched. */
  onSwitch(listener: (seat: number | null) => void): void;
}

/** A seat that never switches: a played session's own, or null for a whole-map view with no picker. */
export function fixedViewerSeat(seat: number | null): ViewerSeat {
  return { seat: () => seat, version: () => 0 };
}

export function switchableViewerSeat(initial: number | null): SwitchableViewerSeat {
  let seat = initial;
  let version = 0;
  const listeners: ((seat: number | null) => void)[] = [];
  return {
    seat: () => seat,
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
