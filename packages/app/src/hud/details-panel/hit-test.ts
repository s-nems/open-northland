import { formatMessage, messages } from '../../i18n/index.js';
import { contains } from '../geometry.js';
import {
  type ButtonHit,
  type EquipActionHit,
  type EquipSlotRef,
  stockSlotRects,
  type TradeImportHit,
  type TradeOfferHit,
  tradeButtons,
} from './layout/index.js';
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
      return view.layout.defenceToggle === null
        ? view.layout.buttons
        : [...view.layout.buttons, view.layout.defenceToggle];
    case 'settler':
      return [...view.layout.workControls.map((c) => c.button), ...tradeButtons(view.layout.trade)];
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
 * The next selection after a craft-choice click. A plain click replaces the selection with the clicked
 * product; `toggle` (Ctrl/Cmd) flips it in the multi-set. Selecting every product or none normalizes to
 * the `[]` all-mode, so the sim drops the component.
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

/** The import mark under a canvas point in a trader's Handel section, or undefined. */
export const hitTradeImport = (view: PanelView, x: number, y: number): TradeImportHit | undefined => {
  if (view.kind !== 'settler' || view.layout.trade === null) return undefined;
  for (const stop of view.layout.trade.stops) {
    const hit = stop.imports.find((h) => contains(h.rect, x, y));
    if (hit !== undefined) return hit;
  }
  return undefined;
};

/** The agreement row under a canvas point in a trader's Handel section, or undefined. */
export const hitTradeOffer = (view: PanelView, x: number, y: number): TradeOfferHit | undefined => {
  if (view.kind !== 'settler' || view.layout.trade === null) return undefined;
  return view.layout.trade.offers.find((h) => contains(h.rect, x, y));
};

/** The stop whose detach button holds a canvas point, or undefined. */
export const hitTradeDetach = (view: PanelView, x: number, y: number): number | undefined => {
  if (view.kind !== 'settler' || view.layout.trade === null) return undefined;
  return view.layout.trade.stops.find((stop) => contains(stop.detach.rect, x, y))?.house;
};

/** The per-slot equipment action button under a canvas point, or undefined (settler layouts only). */
export const hitEquipAction = (view: PanelView, x: number, y: number): EquipActionHit | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.equipActionHits.find((hit) => contains(hit.rect, x, y));
};

/** The entity whose portrait box holds a canvas point, or null. */
export const hitPortrait = (view: PanelView, x: number, y: number): number | null => {
  if (view.kind !== 'settler' && view.kind !== 'building') return null;
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

/** The hovered Ogólne stat bar's value ("300/1000" health, "75%" need), or null. Probes the whole
 *  label+gauge row, which is more forgiving than the gauge alone. */
const hitBarValue = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const i = view.layout.bars.findIndex((r) => contains(r, x, y));
  return i < 0 ? null : (view.model.bars[i]?.hover ?? null);
};

/** The hovered building health gauge ("Zdrowie: 300/1000"), or null. Unlike {@link hitBarValue} the
 *  tooltip carries the caption, since the drawn gauge has none. */
const buildingHealthValue = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const health = view.model.health;
  if (health === null || !contains(view.layout.health, x, y)) return null;
  return `${health.label}: ${health.hover}`;
};

/** The Praca control buttons' tooltips; the drawn labels name the order, so these spell out what it does. */
const workControlHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const hud = messages().hud;
  const tradeHint = tradeControlHint(view, x, y, hud);
  if (tradeHint !== null) return tradeHint;
  const action = view.layout.workControls.find((c) => contains(c.button.rect, x, y))?.action;
  if (action === undefined) return null;
  switch (action) {
    case 'assign-workplace':
      return hud.assignWorkplaceHint;
    case 'unassign-workplace':
      return hud.unassignWorkplaceHint;
    case 'assign-home':
      return hud.assignHomeHint;
    case 'unassign-home':
      return hud.unassignHomeHint;
  }
};

/** The Handel section's tooltips: the route buttons, an import mark's good, an agreement row. */
const tradeControlHint = (
  view: Extract<PanelView, { kind: 'settler' }>,
  x: number,
  y: number,
  hud: ReturnType<typeof messages>['hud'],
): string | null => {
  const trade = view.layout.trade;
  if (trade === null) return null;
  if (trade.attach !== null && contains(trade.attach.button.rect, x, y)) return hud.tradeAttachHouseHint;
  if (trade.stops.some((stop) => contains(stop.detach.rect, x, y))) return hud.tradeDetachHouse;
  const mark = hitTradeImport(view, x, y);
  if (mark !== undefined) return formatMessage(hud.tradeImportHint, { good: mark.label });
  if (hitTradeOffer(view, x, y) !== undefined) return hud.tradeOfferHint;
  return null;
};

/** The alarm toggle's tooltip names what the click will do, so the wording flips with the current mode. */
const defenceToggleHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const toggle = view.layout.defenceToggle;
  if (toggle === null || !contains(toggle.rect, x, y)) return null;
  return view.model.defenseEnabled ? messages().hud.lowerAlarmHint : messages().hud.raiseAlarmHint;
};

/** The hovered choice button's good name ("Wszystko" for gather-all), or null; the icon buttons carry no
 *  drawn label. A craft button also spells out the click semantics, the only affordance for the modifier. */
const gatherChoiceHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const gather = view.layout.gatherChoiceHits.find((hit) => contains(hit.rect, x, y))?.label;
  if (gather !== undefined) return gather;
  const craft = view.layout.craftChoiceHits.find((hit) => contains(hit.rect, x, y))?.label;
  return craft !== undefined ? `${craft}\n${messages().hud.craftToggleHint}` : null;
};

/** The worn good under a hovered equipment socket ("Miód (50%)"), whose percent is the condition left;
 *  an iconless good draws the generic pile, so this tooltip is what identifies it. */
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

/** The equip action buttons' tooltips; the glyph faces carry no label. A swap or take-off button warns
 *  when the order would discard a part-used item, which the sim destroys silently. */
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
    hitBarValue(view, x, y) ??
    buildingHealthValue(view, x, y) ??
    gatherChoiceHint(view, x, y) ??
    equipSocketHint(view, x, y) ??
    equipActionHint(view, x, y) ??
    productionRowHint(view, x, y) ??
    upgradeButtonHint(view, x, y) ??
    defenceToggleHint(view, x, y) ??
    workControlHint(view, x, y)
  );
};
