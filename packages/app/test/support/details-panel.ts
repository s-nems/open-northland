import type { EntitySnapshot } from '@open-northland/sim';
import { buildUnitPanelModel, type UnitPanelModel } from '../../src/hud/details-panel/index.js';
import { type PanelView, panelViewFor } from '../../src/hud/details-panel/selection-view.js';
import type { Rect } from '../../src/hud/geometry.js';
import { sandboxCtx, snapshotOf } from './sandbox.js';

/** A desktop screen the bottom-right panel fits in whole, so no layout clamps to the viewport. */
export const PANEL_SCREEN = { width: 1600, height: 1200 };

export const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The view for a model, narrowed to the expected kind - the model/layout pairing every panel geometry
 *  and pointer assertion starts from. Throws rather than returning a union the test would have to widen. */
export function viewOfKind<K extends PanelView['kind']>(
  model: UnitPanelModel,
  kind: K,
  s = 1,
): Extract<PanelView, { kind: K }> {
  const view = panelViewFor(model, PANEL_SCREEN, s);
  if (view.kind !== kind) throw new Error(`expected a ${kind} view, got ${view.kind}`);
  return view as Extract<PanelView, { kind: K }>;
}

/** The panel model for one selected entity against the sandbox content. */
export const panelModelOf = (entity: EntitySnapshot): UnitPanelModel =>
  buildUnitPanelModel(snapshotOf([entity]), new Set([entity.id]), sandboxCtx());
