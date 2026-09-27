import { messages } from '../../i18n/index.js';
import { contains } from '../geometry.js';
import { type ButtonHit, stockSlotRects } from './layout/index.js';
import type { PanelView } from './selection-view.js';
import { detailsStockTabLabels, visibleStockRows } from './stock-tabs.js';

// Pure probes for the details panel: map a canvas point in the current PanelView to the action target
// under it or the tooltip text that names it. No Pixi or DOM.

/** The buttons the current view exposes to pointer routing, in hit-test order. */
const panelButtons = (view: PanelView): readonly ButtonHit[] => {
  switch (view.kind) {
    case 'building':
      // The defence toggle lives inside the defence window, not the general button column, so it
      // carries its own layout slot and joins the routing list here.
      return [
        ...view.layout.buttons,
        ...(view.layout.defenceToggle === null ? [] : [view.layout.defenceToggle]),
        ...view.layout.homeQualityRows.map((row) => row.button),
      ];
    case 'signpost':
      return [view.layout.button];
    case 'palisade':
      return view.layout.buttons;
    case 'empty':
    case 'compact':
      return [];
  }
};

export const hitButton = (view: PanelView, x: number, y: number): ButtonHit | null =>
  panelButtons(view).find((b) => contains(b.rect, x, y)) ?? null;

/** The stock category tab under a canvas point, or null. */
export const hitStockTab = (view: PanelView, x: number, y: number): number | null => {
  const tabs = view.kind === 'building' ? view.layout.stockTabHits : [];
  const i = tabs.findIndex((r) => contains(r, x, y));
  return i >= 0 ? i : null;
};

/** The entity whose portrait box holds a canvas point, or null. */
export const hitPortrait = (view: PanelView, x: number, y: number): number | null => {
  if (view.kind !== 'building') return null;
  return contains(view.layout.preview, x, y) ? view.model.entityId : null;
};

/** The good name under a canvas point in the stock grid, or null. */
const hitStockGood = (
  view: PanelView,
  x: number,
  y: number,
  scale: number,
  activeStockTab: number,
): string | null => {
  if (view.kind !== 'building') return null;
  const { layout, model } = view;
  if (layout.stock === null) return null;
  const slot = stockSlotRects(layout.stock.body, scale, layout.stockRows).findIndex((r) => contains(r, x, y));
  if (slot < 0) return null;
  const rows = visibleStockRows(model.stock, layout.stockCompact, activeStockTab).slice(
    0,
    layout.stockRows * 2,
  );
  return rows[slot]?.label ?? null;
};

/** The hovered building health gauge ("Zdrowie: 300/1000"), or null. The tooltip carries the caption,
 *  since the drawn gauge has none. */
const buildingHealthValue = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const health = view.model.health;
  if (health === null || !contains(view.layout.health, x, y)) return null;
  return `${health.label}: ${health.hover}`;
};

/** The alarm toggle's tooltip names what the click will do, so the wording flips with the current mode. */
const defenceToggleHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const toggle = view.layout.defenceToggle;
  if (toggle === null || !contains(toggle.rect, x, y)) return null;
  return view.model.defenseEnabled ? messages().hud.lowerAlarmHint : messages().hud.raiseAlarmHint;
};

/** The Upgrade button's cost card ("Upgrade requires:" then one "- Drewno ×5" line per required good),
 *  or null when the building has no upgrade cost. */
const upgradeButtonHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const hit = view.layout.buttons.find((b) => contains(b.rect, x, y));
  if (hit?.action !== 'upgrade') return null;
  if (view.model.upgradeBlockedReason) return view.model.upgradeBlockedReason;
  if (view.model.upgradeCost.length === 0) return null;
  const lines = view.model.upgradeCost.map((c) => `- ${c.label} ×${c.amount}`).join('\n');
  return `${messages().hud.upgradeCostHint}\n${lines}`;
};

/** The hovered Produkcja row's recipe card ("Krótki Miecz:" then one "- Żelazo ×2" line per input), or null. */
const productionRowHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building' || view.model.production?.kind !== 'recipe') return null;
  const i = view.layout.productionRowRects.findIndex((r) => contains(r, x, y));
  const row = i < 0 ? undefined : view.model.production.rows[i];
  if (row === undefined || row.inputs.length === 0) return null;
  return `${row.label}:\n${row.inputs}`;
};

/**
 * The tooltip text for a canvas point inside a non-empty panel, or null. Each probe answers for one
 * layout kind; where two could match a point, the order below is the resolution precedence.
 */
export const tooltipTextAt = (
  view: PanelView,
  x: number,
  y: number,
  scale: number,
  activeStockTab: number,
): string | null => {
  const rowName = hitStockGood(view, x, y, scale, activeStockTab);
  const tab = rowName === null ? hitStockTab(view, x, y) : null;
  const tabLabel = tab !== null ? (detailsStockTabLabels()[tab] ?? null) : null;
  return (
    rowName ??
    tabLabel ??
    buildingHealthValue(view, x, y) ??
    productionRowHint(view, x, y) ??
    upgradeButtonHint(view, x, y) ??
    defenceToggleHint(view, x, y)
  );
};
