/**
 * Where an original walker stands between two sim ticks under the motion enhancement. Its walk clip
 * plays one authored frame per tick, and the art moves a planted foot less than the body travels per
 * tick, so any body motion inside a frame hold drags that foot along the ground.
 *
 * - `anchor`: the tick position all along, as the original engine draws it; the whole step lands with
 *   the frame change, so the foot reads as planted and the body moves in tick-rate steps.
 * - `linear`: even interpolation over the tick; the smoothest body, the longest foot drag.
 * - `window`: the body rests, then moves over the last part of the tick and arrives with the frame
 *   change; the foot drags only inside that window.
 */
export type WalkPlacement = 'anchor' | 'linear' | 'window';

export const DEFAULT_WALK_PLACEMENT: WalkPlacement = 'linear';

/** The tick fraction `window` placement moves the body over. Approximation: two of the five display
 *  frames a 60 Hz screen shows per 12 Hz tick, short enough to read as a step rather than a glide. */
const WINDOW_FRACTION = 0.4;

/** The interpolation fraction to draw at for the frame fraction `alpha` (0..1 into the tick). */
export function walkPlacementAlpha(alpha: number, placement: WalkPlacement): number {
  switch (placement) {
    case 'anchor':
      return 1;
    case 'linear':
      return alpha;
    case 'window': {
      const t = (alpha - (1 - WINDOW_FRACTION)) / WINDOW_FRACTION;
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return t * t * (3 - 2 * t);
    }
  }
}
