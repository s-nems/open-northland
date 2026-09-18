import type { PlacementStrip, PlacementStripView } from '../../src/hud/dom/placement-strip.js';

/** A placement strip without a DOM: what it shows, or null once cleared. */
export function stubPlacementStrip(): PlacementStrip & { shown: PlacementStripView | null } {
  const strip = {
    shown: null as PlacementStripView | null,
    show: (view: PlacementStripView): void => {
      strip.shown = view;
    },
    clear: (): void => {
      strip.shown = null;
    },
    dispose: (): void => undefined,
  };
  return strip;
}
