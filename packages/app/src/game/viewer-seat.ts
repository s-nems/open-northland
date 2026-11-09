/**
 * The seat whose perspective the view shows: the summary figures, the notes, the papers, the assistant,
 * and, unless the view spans the whole map, the fog and what a click may select. A played session's
 * is its own seat for good; a spectator's is the seat it chose to watch, or none for the whole map,
 * uncovered or under every watched seat's sight together.
 */
export interface ViewerSeat {
  /** The seat whose figures, notes, papers and assistant the HUD shows; null shows nobody's. */
  seat(): number | null;
  /** Whether the view spans the whole map: every entity pickable, and no fog unless `sharedSight`. */
  wholeMap(): boolean;
  /** Whether the whole map draws under the watched seats' sight together instead of uncovered. */
  sharedSight(): boolean;
  /** Bumps on every switch, so a memo keyed on a snapshot also keys on it. */
  version(): number;
}

/** A spectator's every-seat choice that draws the watched seats' sight together. */
export const PLAYERS_SIGHT = 'playersSight';

/** What a spectator watches: one seat, the whole map uncovered (null), or {@link PLAYERS_SIGHT}. */
export type WatchTarget = number | null | typeof PLAYERS_SIGHT;

/** A spectator's seat, switched from the HUD. */
export interface SwitchableViewerSeat extends ViewerSeat {
  target(): WatchTarget;
  watch(target: WatchTarget): void;
  /** Runs after every switch, with the choice now watched. */
  onSwitch(listener: (target: WatchTarget) => void): void;
}

/** The owner a click or a control-group recall is limited to; null on the whole map, where every
 *  owner's entities are the viewer's to pick. */
export function pickableSeat(viewer: ViewerSeat): number | null {
  return viewer.wholeMap() ? null : viewer.seat();
}

/** Whether an entity of `owner` is another seat's to the viewer limited to `seat`: an ownerless one (a
 *  scene's stray) is nobody else's, and the whole map (null) is the viewer's own. */
export function ownedByAnotherSeat(owner: number | undefined, seat: number | null): boolean {
  return seat !== null && owner !== undefined && owner !== seat;
}

/** A played session's own seat: its fog, its entities, its figures. */
export function fixedViewerSeat(seat: number): ViewerSeat {
  return { seat: () => seat, wholeMap: () => false, sharedSight: () => false, version: () => 0 };
}

/** A spectator's switchable seat; watching no single seat is the whole map with nobody's figures. */
export function switchableViewerSeat(initial: WatchTarget): SwitchableViewerSeat {
  let target = initial;
  let version = 0;
  const listeners: ((target: WatchTarget) => void)[] = [];
  return {
    seat: () => (typeof target === 'number' ? target : null),
    wholeMap: () => typeof target !== 'number',
    sharedSight: () => target === PLAYERS_SIGHT,
    version: () => version,
    target: () => target,
    watch: (next) => {
      if (next === target) return;
      target = next;
      version++;
      for (const listener of listeners) listener(next);
    },
    onSwitch: (listener) => {
      listeners.push(listener);
    },
  };
}
