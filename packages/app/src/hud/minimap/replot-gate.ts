import type { WorldSnapshot } from '@open-northland/sim';

/** Wall-clock ms between re-plots, a 5 Hz ceiling against the sim's 12 ticks per second at speed 1.
 *  Authored: the minimap reads at a glance, so the whole-roster plot is amortized across frames. */
export const REPLOT_MIN_MS = 200;

/**
 * Throttles the retained dot raster. Call once per rendered frame and re-plot exactly when it answers
 * true, which spends that window's slot. Keyed on snapshot identity rather than `snapshot.tick`, since a
 * same-tick world mutation hands out a new snapshot under an unchanged tick: an already-plotted snapshot
 * costs nothing however long it is held, and a plot the window refused still lands within
 * `REPLOT_MIN_MS` instead of waiting for the next tick.
 */
export function createDotReplotGate(now: () => number): (snapshot: WorldSnapshot) => boolean {
  let plotted: WorldSnapshot | null = null;
  let plottedAt = Number.NEGATIVE_INFINITY;
  return (snapshot) => {
    if (snapshot === plotted) return false;
    const nowMs = now();
    if (nowMs - plottedAt < REPLOT_MIN_MS) return false;
    plotted = snapshot;
    plottedAt = nowMs;
    return true;
  };
}
