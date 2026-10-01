import { contains } from '../geometry.js';
import type { ButtonHit } from './layout/index.js';
import type { PanelView } from './selection-view.js';

// Pure probes for the details panel: map a canvas point in the current PanelView to the button under it.
// No Pixi or DOM.

/** The buttons the current view exposes to pointer routing, in hit-test order. */
const panelButtons = (view: PanelView): readonly ButtonHit[] => {
  switch (view.kind) {
    case 'signpost':
      return [view.layout.button];
    case 'palisade':
      return view.layout.buttons;
    case 'empty':
      return [];
  }
};

export const hitButton = (view: PanelView, x: number, y: number): ButtonHit | null =>
  panelButtons(view).find((b) => contains(b.rect, x, y)) ?? null;
