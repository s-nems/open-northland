import { messages } from '../../i18n/index.js';
import { contains } from '../geometry.js';
import { type ButtonHit, type EquipActionHit, type EquipSlotRef, stockSlotRects } from './layout/index.js';
import type { PanelView } from './selection-view.js';
import { detailsStockTabLabels, visibleStockRows } from './stock-tabs.js';

// Pure probes for the details panel: map a canvas point in the current PanelView to the action target
// under it or the tooltip text that names it, and resolve what a craft-choice click does to the product
// selection. No Pixi or DOM, so this seam is tested headlessly (see details-panel-hit-test.test.ts);
// `pointer-intent.ts` composes the probes into the click and hover decisions panel.ts acts on.

/** The buttons the current view exposes to pointer routing, in hit-test order. */
const panelButtons = (view: PanelView): readonly ButtonHit[] => {
  switch (view.kind) {
    case 'building':
      return view.layout.buttons;
    case 'settler':
      return [view.layout.assignButton, view.layout.homeButton, view.layout.unassignButton];
    case 'signpost':
      return [view.layout.button];
    case 'empty':
    case 'compact':
      return [];
  }
};

export const hitButton = (view: PanelView, x: number, y: number): ButtonHit | null =>
  panelButtons(view).find((b) => contains(b.rect, x, y)) ?? null;

/** The stock category tab under a canvas point, or null - only building layouts carry a tab strip. */
export const hitStockTab = (view: PanelView, x: number, y: number): number | null => {
  if (view.kind !== 'building') return null;
  const i = view.layout.stockTabHits.findIndex((r) => contains(r, x, y));
  return i >= 0 ? i : null;
};

export const hitGatherChoice = (view: PanelView, x: number, y: number): number | null | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.gatherChoiceHits.find((hit) => contains(hit.rect, x, y))?.goodType;
};

/** The craft product toggle under a canvas point, or undefined (settler layouts only). */
export const hitCraftChoice = (view: PanelView, x: number, y: number): number | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.craftChoiceHits.find((hit) => contains(hit.rect, x, y))?.goodType;
};

/**
 * The next selection after a craft-choice click, given the worker's `products` (all its craftable
 * goods) and current `selected` set. A plain click REPLACES the selection with just the clicked product
 * (the RTS radio-button default); a Ctrl/Cmd click TOGGLES it in the multi-set (user decision
 * 2026-07-16). The toggle normalizes both edges: all products selected reads as the `[]` all-mode (so
 * the sim drops the component), and toggling the LAST product off falls back to all-mode too (a worker
 * can't craft nothing).
 */
export const nextCraftGoods = (
  products: readonly number[],
  selected: readonly number[],
  goodType: number,
  toggle: boolean,
): readonly number[] => {
  if (!toggle) return products.length === 1 ? [] : [goodType];
  const next = new Set(selected);
  if (next.has(goodType)) next.delete(goodType);
  else next.add(goodType);
  if (next.size === 0 || next.size === products.length) return [];
  return products.filter((g) => next.has(g));
};

/** The per-slot equipment action button under a canvas point, or undefined (settler layouts only). */
export const hitEquipAction = (view: PanelView, x: number, y: number): EquipActionHit | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.equipActionHits.find((hit) => contains(hit.rect, x, y));
};

/** The good name under a canvas point in the stock grid, or null. Probes the same slot rects the rows
 *  draw into ({@link stockSlotRects}), then maps the slot index through the same visible-row split the
 *  draw applies, so a hovered slot names exactly the drawn good. */
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

/** The hovered Ogólne stat bar's value ("300/1000" health, "75%" need), or null. Probes the whole
 *  label+gauge row (layout.bars, same order as model.bars) - more forgiving than the gauge alone. */
const hitBarValue = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const i = view.layout.bars.findIndex((r) => contains(r, x, y));
  return i < 0 ? null : (view.model.bars[i]?.hover ?? null);
};

/** The Praca control buttons' tooltips (assign-workplace / assign-home / remove-from-home) - the round
 *  glyph buttons carry no drawn label, so the tooltip is what names them. */
const assignButtonHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const { assignButton, homeButton, unassignButton } = view.layout;
  if (contains(assignButton.rect, x, y)) return messages().hud.assignWorkplaceHint;
  if (contains(homeButton.rect, x, y)) return messages().hud.assignHomeHint;
  if (contains(unassignButton.rect, x, y)) return messages().hud.unassignHomeHint;
  return null;
};

/** The hovered choice round button's good name ("Wszystko" for gather-all), or null - the icon buttons
 *  carry no drawn label. A craft button also spells out the click semantics (plain = pick one, Ctrl/Cmd
 *  = toggle), the only affordance for the modifier. Gather and craft blocks never coexist. */
const gatherChoiceHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const gather = view.layout.gatherChoiceHits.find((hit) => contains(hit.rect, x, y))?.label;
  if (gather !== undefined) return gather;
  const craft = view.layout.craftChoiceHits.find((hit) => contains(hit.rect, x, y))?.label;
  return craft !== undefined ? `${craft}\n${messages().hud.craftToggleHint}` : null;
};

/** The worn good under a hovered equipment socket ("Miód (50%)" - the percent is what's LEFT), or
 *  null - an iconless potion/amulet draws the generic pile, so the socket tooltip is what identifies
 *  the item. Empty sockets name nothing. */
const equipSocketHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  for (let i = 0; i < view.layout.equipRows.length; i++) {
    const rects = view.layout.equipRows[i]?.slots ?? [];
    const j = rects.findIndex((r) => contains(r, x, y));
    if (j < 0) continue;
    const slot = view.model.equipmentRows[i]?.slots[j];
    if (slot?.label === undefined) return null;
    return slot.conditionPct !== null ? `${slot.label} (${slot.conditionPct}%)` : slot.label;
  }
  return null;
};

/** Condition percent of an untouched item - below this the swap/take-off discard warning shows. */
const FULL_CONDITION_PCT = 100;

/** Whether the addressed slot holds a part-used wearing item - the discard-warning trigger. */
const holdsUsedItem = (view: PanelView, ref: EquipSlotRef): boolean => {
  if (view.kind !== 'settler') return false;
  const slot = view.model.equipmentRows.find((row) => row.group === ref.group)?.slots[ref.slot];
  return slot?.conditionPct != null && slot.conditionPct < FULL_CONDITION_PCT;
};

/** The equip action buttons' tooltips - the glyph faces carry no label; a swap/take-off button names
 *  the worn good on its second line and warns when the order would discard a part-used item (the sim's
 *  no-regeneration rule destroys it silently, so the warning is the player's only notice). */
const equipActionHint = (view: PanelView, x: number, y: number): string | null => {
  const hit = hitEquipAction(view, x, y);
  if (hit === undefined) return null;
  const hud = messages().hud;
  const lines = [
    hit.kind === 'equip' ? hud.equipSlotHint : hit.kind === 'swap' ? hud.swapSlotHint : hud.unequipSlotHint,
  ];
  if (hit.label !== undefined) lines.push(hit.label);
  if (hit.kind !== 'equip' && holdsUsedItem(view, hit.ref)) lines.push(hud.usedItemDiscardHint);
  return lines.join('\n');
};

/** The Upgrade button's cost card ("Upgrade requires:" then one "- Drewno ×5" line per required good),
 *  or null. Only building layouts carry the button, and only an upgradable building has a cost. */
const upgradeButtonHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const hit = view.layout.buttons.find((b) => contains(b.rect, x, y));
  if (hit?.action !== 'upgrade' || view.model.upgradeCost.length === 0) return null;
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
 * The value/name tooltip text for a canvas point inside a non-empty panel, or null when nothing there
 * carries one. The probes are layout-kind-exclusive, so at most one hits; the order is the resolution
 * precedence (a stock row's good name wins over its tab, a settler's live bar value over its buttons).
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
    hitBarValue(view, x, y) ??
    gatherChoiceHint(view, x, y) ??
    equipSocketHint(view, x, y) ??
    equipActionHint(view, x, y) ??
    productionRowHint(view, x, y) ??
    upgradeButtonHint(view, x, y) ??
    assignButtonHint(view, x, y)
  );
};
