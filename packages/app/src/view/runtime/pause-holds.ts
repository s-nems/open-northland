/** The one forced-pause slot the save/load session owns, which several overlays now share. */
export interface ForcedPauseSeam {
  forcePause(): void;
  releaseForcedPause(): void;
}

/** A keyed hold over that slot: the sim stays paused while any owner holds it. */
export interface PauseHolds {
  hold(owner: string): void;
  release(owner: string): void;
  /** True while any owner holds, so a speed press cannot run the game behind its overlay. */
  isHeld(): boolean;
}

/** Owners hold and release independently, so a menu closing over an open sheet leaves the sheet's hold
 *  in place; the seam is forced on the first hold and released on the last. */
export function createPauseHolds(seam: ForcedPauseSeam): PauseHolds {
  const owners = new Set<string>();
  return {
    hold(owner): void {
      if (owners.size === 0) seam.forcePause();
      owners.add(owner);
    },
    release(owner): void {
      if (!owners.delete(owner)) return;
      if (owners.size === 0) seam.releaseForcedPause();
    },
    isHeld: () => owners.size > 0,
  };
}
