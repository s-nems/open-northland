import { hitButton } from './hit-test.js';
import type { ButtonAction } from './layout/index.js';
import type { PanelView } from './selection-view.js';

/** One resolved left-click intent: a player order. */
export type PanelClick =
  | { readonly kind: 'demolishSignpost'; readonly entityId: number }
  | { readonly kind: 'demolishPalisade'; readonly entityId: number }
  | { readonly kind: 'cancelRoadSite'; readonly entityId: number }
  | { readonly kind: 'setPalisadeGate'; readonly entityId: number; readonly open: boolean };

/** The intent of an enabled button, or null for an action this view kind does not wire. */
const buttonClick = (view: PanelView, action: ButtonAction): PanelClick | null => {
  switch (view.kind) {
    case 'signpost':
      return action === 'demolish' ? { kind: 'demolishSignpost', entityId: view.model.entityId } : null;
    case 'palisade':
      if (action === 'demolish-palisade') {
        return {
          kind: view.model.roadSite ? 'cancelRoadSite' : 'demolishPalisade',
          entityId: view.model.entityId,
        };
      }
      if (action === 'toggle-gate' && view.model.gateOpen !== null) {
        return {
          kind: 'setPalisadeGate',
          entityId: view.model.entityId,
          open: !view.model.gateOpen,
        };
      }
      return null;
    case 'empty':
      return null;
  }
};

/** What a left-click inside the panel does, or null when it lands on inert chrome or a disabled button. */
export const panelClickAt = (view: PanelView, x: number, y: number): PanelClick | null => {
  const hit = hitButton(view, x, y);
  return hit === null || !hit.enabled ? null : buttonClick(view, hit.action);
};

/** Everything a hover changes in the drawn panel, so a rebuild is skipped while it holds. */
export interface PanelHover {
  readonly action: ButtonAction | null;
}

export const NO_PANEL_HOVER: PanelHover = { action: null };

export const panelHoverAt = (view: PanelView, x: number, y: number): PanelHover => ({
  action: hitButton(view, x, y)?.action ?? null,
});

export const sameHover = (a: PanelHover, b: PanelHover): boolean => a.action === b.action;
