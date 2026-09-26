/**
 * The settler panel steps aside (unseen, taking no pointer) while an action ring opened from it is up,
 * since the ring is drawn on the canvas under the plane. It comes back as soon as that ring is down,
 * whatever closed it: a pressed order, Space, Escape or a lost selection.
 */
export interface RingVeil {
  /** The ring opened from the panel. */
  raise(): void;
  /** Once a frame: lift the veil when the ring is down. */
  refresh(): void;
}

export function createRingVeil(panel: { veil(on: boolean): void }, ringUp: () => boolean): RingVeil {
  let veiled = false;
  return {
    raise(): void {
      veiled = true;
      panel.veil(true);
    },
    refresh(): void {
      if (!veiled || ringUp()) return;
      veiled = false;
      panel.veil(false);
    },
  };
}
