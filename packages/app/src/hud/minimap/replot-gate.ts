import type { WorldSnapshot } from '@open-northland/sim';

/** Wall-clock ms between re-plots, a 2 Hz ceiling against the sim's 12 ticks per second at speed 1.
 *  Authored: the minimap reads at a glance, and a walker crosses about one minimap px a second at x3, so
 *  a re-plot twice a second moves no dot by more than a px. */
export const REPLOT_MIN_MS = 500;

/**
 * Throttles the retained dot raster. Call once per rendered frame and re-plot exactly when it answers
 * true, which spends that window's slot. Keyed on snapshot identity rather than `snapshot.tick`, since a
 * same-tick world mutation hands out a new snapshot under an unchanged tick: an already-plotted snapshot
 * costs nothing however long it is held, and a plot the window refused still lands within
 * `REPLOT_MIN_MS` instead of waiting for the next tick. `viewer` is the seat the dots are plotted for
 * (the fog's, else the view's, null on a whole-map view): a spectator switching seats under a held
 * snapshot sees different fog and owner scope.
 */
export function createDotReplotGate(
  now: () => number,
): (snapshot: WorldSnapshot, viewer: number | null) => boolean {
  let plotted: WorldSnapshot | null = null;
  let plottedViewer: number | null = null;
  let plottedAt = Number.NEGATIVE_INFINITY;
  return (snapshot, viewer) => {
    if (snapshot === plotted && viewer === plottedViewer) return false;
    const nowMs = now();
    if (nowMs - plottedAt < REPLOT_MIN_MS) return false;
    plotted = snapshot;
    plottedViewer = viewer;
    plottedAt = nowMs;
    return true;
  };
}
