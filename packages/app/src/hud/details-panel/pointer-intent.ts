import { hitButton, hitPortrait, hitStockTab } from './hit-test.js';
import type { ButtonAction } from './layout/index.js';
import type { PanelView } from './selection-view.js';

/** One resolved left-click intent: `stockTab` re-bakes the panel and `centerOnEntity` moves the view,
 *  the rest are player orders. */
export type PanelClick =
  | { readonly kind: 'centerOnEntity'; readonly entityId: number }
  | { readonly kind: 'stockTab'; readonly tab: number }
  | { readonly kind: 'upgrade'; readonly entityId: number }
  | { readonly kind: 'cancelUpgrade'; readonly entityId: number }
  | { readonly kind: 'demolish'; readonly entityId: number }
  | { readonly kind: 'setDefenceMode'; readonly entityId: number; readonly enabled: boolean }
  | {
      readonly kind: 'setHouseholdGoodUse';
      readonly player: number;
      readonly effect: 'cooking' | 'rest' | 'piety';
      readonly allowed: boolean;
    }
  | { readonly kind: 'demolishSignpost'; readonly entityId: number }
  | { readonly kind: 'demolishPalisade'; readonly entityId: number }
  | { readonly kind: 'setPalisadeGate'; readonly entityId: number; readonly open: boolean };

/** The intent of an enabled button, or null for an action this view kind does not wire. */
const buttonClick = (view: PanelView, action: ButtonAction): PanelClick | null => {
  switch (view.kind) {
    case 'building': {
      const entityId = view.model.entityId;
      if (action === 'upgrade') return { kind: 'upgrade', entityId };
      if (action === 'cancelUpgrade') return { kind: 'cancelUpgrade', entityId };
      if (action === 'center') return { kind: 'centerOnEntity', entityId };
      if (action === 'toggle-defence') {
        return { kind: 'setDefenceMode', entityId, enabled: !view.model.defenseEnabled };
      }
      const homeEffect =
        action === 'toggle-home-cooking'
          ? 'cooking'
          : action === 'toggle-home-rest'
            ? 'rest'
            : action === 'toggle-home-piety'
              ? 'piety'
              : null;
      if (homeEffect !== null) {
        const row = view.model.homeQuality.find((quality) => quality.effect === homeEffect);
        return row === undefined ||
          view.model.ownerPlayer === undefined ||
          !view.model.canSetHouseholdGoodPolicy
          ? null
          : {
              kind: 'setHouseholdGoodUse',
              player: view.model.ownerPlayer,
              effect: homeEffect,
              allowed: !row.allowed,
            };
      }
      return action === 'demolish' ? { kind: 'demolish', entityId } : null;
    }
    case 'signpost':
      return action === 'demolish' ? { kind: 'demolishSignpost', entityId: view.model.entityId } : null;
    case 'palisade':
      if (action === 'demolish-palisade') return { kind: 'demolishPalisade', entityId: view.model.entityId };
      if (action === 'toggle-gate' && view.model.gateOpen !== null) {
        return {
          kind: 'setPalisadeGate',
          entityId: view.model.entityId,
          open: !view.model.gateOpen,
        };
      }
      return null;
    case 'empty':
    case 'compact':
      return null;
  }
};

/** What a left-click inside the panel does, or null when it lands on inert chrome or a disabled button. */
export const panelClickAt = (view: PanelView, x: number, y: number): PanelClick | null => {
  const portrait = hitPortrait(view, x, y);
  if (portrait !== null) return { kind: 'centerOnEntity', entityId: portrait };
  const tab = hitStockTab(view, x, y);
  if (tab !== null) return { kind: 'stockTab', tab };
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
