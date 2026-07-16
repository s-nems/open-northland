import type { Rect } from '../../geometry.js';
import type { UnitPanelModel } from '../model/index.js';
import { type BuildingLayout, type ButtonHit, layoutBuilding } from './building.js';
import { layoutSettler, type SettlerLayout } from './settler.js';
import { PANEL_W, panelRect, ROW_H, type SectionRect, sectionAt } from './shared.js';

export * from './building.js';
export * from './settler.js';
export { ROW_H, type SectionRect } from './shared.js';

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

/** Compact (multi/generic) rows: the count lives in the headline, the body is the controls hint. */
const COMPACT_ROWS = 1;
/** The signpost tear-down button height/side inset (matches the settler assign button's proportions). */
const SIGNPOST_BUTTON_H = 18;
const SIGNPOST_BUTTON_PAD = 2;

/**
 * Apply `fn` to every rect in a layout, returning a new layout of the same shape. The off-screen
 * supersample draw layout is derived from the on-canvas hit layout this way — scaled by the oversample /
 * display ratio and re-origined to the texture (see `panel.ts`) — so the drawn geometry equals the
 * hit-tested geometry by construction, never by two independent `layoutDetails` roundings agreeing.
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
      underline: fn(layout.underline),
      buttons: layout.buttons.map((b) => ({ ...b, rect: fn(b.rect) })),
      construction: layout.construction ? sec(layout.construction) : null,
      defence: layout.defence ? sec(layout.defence) : null,
      production: layout.production ? sec(layout.production) : null,
      productionRowRects: layout.productionRowRects.map(fn),
      stock: layout.stock ? sec(layout.stock) : null,
      stockTabHits: layout.stockTabHits.map(fn),
      workers: sec(layout.workers),
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
      assignButton: { ...layout.assignButton, rect: fn(layout.assignButton.rect) },
      assignIcon: fn(layout.assignIcon),
      assignLabel: fn(layout.assignLabel),
      gatherChoiceHits: layout.gatherChoiceHits.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
      craftChoiceHits: layout.craftChoiceHits.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
      experience: sec(layout.experience),
      expRow: fn(layout.expRow),
      equipment: sec(layout.equipment),
      equipRows: layout.equipRows.map((r) => ({ label: fn(r.label), slots: r.slots.map(fn) })),
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

/**
 * Build the selection panel's geometry for the current model, dispatching to the per-kind layout: the
 * compact multi/generic strip inline, the settler stack ({@link layoutSettler}), or the building stack
 * ({@link layoutBuilding}). Returns null for an empty selection.
 */
export function layoutDetails(
  model: UnitPanelModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): DetailsLayout | null {
  if (model.kind === 'empty') return null;

  if (model.kind === 'multi-settler' || model.kind === 'generic') {
    const w = Math.round(PANEL_W * s);
    const bodyH = COMPACT_ROWS * Math.round(ROW_H * s);
    const probe = sectionAt(0, 0, w, bodyH, s);
    const panel = panelRect(probe.frame.h, screen, s);
    return { kind: 'compact', panel, section: sectionAt(panel.x, panel.y, w, bodyH, s) };
  }

  if (model.kind === 'signpost') {
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

  if (model.kind === 'settler') return layoutSettler(model, screen, s);
  return layoutBuilding(model, screen, s);
}
