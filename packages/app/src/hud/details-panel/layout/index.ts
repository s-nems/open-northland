import type { Rect } from '../../geometry.js';
import type { BuildingLayout, ButtonHit } from './building.js';
import type { SettlerLayout } from './settler.js';
import { mapTradeLayout } from './settler-trade.js';
import { PANEL_W, panelRect, ROW_H, type SectionRect, sectionAt } from './shared.js';

export {
  BAR_H,
  type BuildingLayout,
  type ButtonAction,
  type ButtonHit,
  DEFENCE_LABEL_GAP,
  HOME_QUALITY_ROW_H,
  layoutBuilding,
  MAX_STOCK_ROWS,
  PREVIEW_INSET,
  STOCK_PLATE_H,
  STOCK_ROW_H,
  stockSlotRects,
} from './building.js';
export {
  layoutSettler,
  type SettlerLayout,
  type WorkControlAction,
  type WorkControlRow,
} from './settler.js';
export {
  EQUIP_ROW_H,
  type EquipActionHit,
  type EquipSlotRef,
  equipActionKey,
} from './settler-equipment.js';
export {
  type TradeImportHit,
  type TradeLayout,
  type TradeOfferHit,
  type TradeStopLayout,
  tradeButtons,
} from './settler-trade.js';
export { ROW_H, ROW_TEXT_PAD, type SectionRect } from './shared.js';

/** The multi-select / generic views: one section window with a single hint row. */
export interface CompactLayout {
  readonly kind: 'compact';
  readonly panel: Rect;
  readonly section: SectionRect;
}

/** A selected signpost: one section window whose body is the tear-down button. */
export interface SignpostLayout {
  readonly kind: 'signpost';
  readonly panel: Rect;
  readonly section: SectionRect;
  readonly button: ButtonHit;
}

export type DetailsLayout = BuildingLayout | SettlerLayout | CompactLayout | SignpostLayout;

/** One body row: the selection count lives in the headline, the body is the controls hint. */
const COMPACT_ROWS = 1;
/** The signpost tear-down button's height. */
const SIGNPOST_BUTTON_H = 18;
/** Inset between that button and its section body, on both axes. */
const SIGNPOST_BUTTON_PAD = 2;

/**
 * Apply `fn` to every rect in a layout, returning a new layout of the same shape. The off-screen
 * supersample draw layout is derived from the on-canvas hit layout this way, so drawn geometry equals
 * hit-tested geometry by construction rather than by two passes agreeing on rounding.
 */
export function mapLayout<T extends DetailsLayout>(layout: T, fn: (r: Rect) => Rect): T {
  const sec = (s: SectionRect): SectionRect => ({ frame: fn(s.frame), title: fn(s.title), body: fn(s.body) });
  if (layout.kind === 'building') {
    return {
      ...layout,
      panel: fn(layout.panel),
      general: sec(layout.general),
      preview: fn(layout.preview),
      name: fn(layout.name),
      health: fn(layout.health),
      buttons: layout.buttons.map((b) => ({ ...b, rect: fn(b.rect) })),
      construction: layout.construction ? sec(layout.construction) : null,
      defence: layout.defence ? sec(layout.defence) : null,
      defenceToggle: layout.defenceToggle
        ? { ...layout.defenceToggle, rect: fn(layout.defenceToggle.rect) }
        : null,
      production: layout.production ? sec(layout.production) : null,
      productionRowRects: layout.productionRowRects.map(fn),
      stock: layout.stock ? sec(layout.stock) : null,
      stockTabHits: layout.stockTabHits.map(fn),
      workers: sec(layout.workers),
      homeQuality: layout.homeQuality ? sec(layout.homeQuality) : null,
      homeQualityRows: layout.homeQualityRows.map((row) => ({
        ...row,
        text: fn(row.text),
        button: { ...row.button, rect: fn(row.button.rect) },
      })),
      offers: layout.offers ? sec(layout.offers) : null,
      offerRows: layout.offerRows.map(fn),
    };
  }
  if (layout.kind === 'settler') {
    return {
      ...layout,
      panel: fn(layout.panel),
      general: sec(layout.general),
      preview: fn(layout.preview),
      name: fn(layout.name),
      meta: fn(layout.meta),
      bars: layout.bars.map(fn),
      work: sec(layout.work),
      workRows: layout.workRows.map(fn),
      workControls: layout.workControls.map((c) => ({
        ...c,
        button: { ...c.button, rect: fn(c.button.rect) },
        label: fn(c.label),
      })),
      gatherChoiceHits: layout.gatherChoiceHits.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
      craftChoiceHits: layout.craftChoiceHits.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
      experience: layout.experience === null ? null : sec(layout.experience),
      expRows: layout.expRows.map(fn),
      equipment: layout.equipment === null ? null : sec(layout.equipment),
      equipRows: layout.equipRows.map((r) => ({ label: fn(r.label), slots: r.slots.map(fn) })),
      equipActionHits: layout.equipActionHits.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
      trade: layout.trade === null ? null : mapTradeLayout(layout.trade, fn),
    };
  }
  if (layout.kind === 'signpost') {
    return {
      ...layout,
      panel: fn(layout.panel),
      section: sec(layout.section),
      button: { ...layout.button, rect: fn(layout.button.rect) },
    };
  }
  return { ...layout, panel: fn(layout.panel), section: sec(layout.section) };
}

export function layoutCompact(
  screen: { readonly width: number; readonly height: number },
  s: number,
): CompactLayout {
  const w = Math.round(PANEL_W * s);
  const bodyH = COMPACT_ROWS * Math.round(ROW_H * s);
  const probe = sectionAt(0, 0, w, bodyH, s);
  const panel = panelRect(probe.frame.h, screen, s);
  return { kind: 'compact', panel, section: sectionAt(panel.x, panel.y, w, bodyH, s) };
}

export function layoutSignpost(
  screen: { readonly width: number; readonly height: number },
  s: number,
): SignpostLayout {
  const w = Math.round(PANEL_W * s);
  const pad = Math.round(SIGNPOST_BUTTON_PAD * s);
  const bodyH = Math.round(SIGNPOST_BUTTON_H * s) + pad * 2;
  const probe = sectionAt(0, 0, w, bodyH, s);
  const panel = panelRect(probe.frame.h, screen, s);
  const section = sectionAt(panel.x, panel.y, w, bodyH, s);
  const button: ButtonHit = {
    action: 'demolish',
    enabled: true,
    rect: {
      x: section.body.x + pad,
      y: section.body.y + pad,
      w: section.body.w - pad * 2,
      h: Math.round(SIGNPOST_BUTTON_H * s),
    },
  };
  return { kind: 'signpost', panel, section, button };
}
