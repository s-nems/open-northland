import { layoutPalisade, type PalisadeLayout } from './layout/index.js';
import type { PalisadePanelModel, UnitPanelModel } from './model/index.js';

/** A selection's model paired with the geometry laid out for it. A gate, settler, vehicle, building or group
 *  has no view here: the DOM panels show it. */
export type PanelView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'palisade'; readonly model: PalisadePanelModel; readonly layout: PalisadeLayout };

export const EMPTY_PANEL_VIEW: PanelView = { kind: 'empty' };

export function panelViewFor(
  model: UnitPanelModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): PanelView {
  switch (model.kind) {
    case 'empty':
    case 'settler':
    case 'vehicle':
    case 'building':
    case 'group':
    case 'signpost':
      return EMPTY_PANEL_VIEW;
    case 'palisade':
      if (model.gateOpen !== null) return EMPTY_PANEL_VIEW;
      return { kind: 'palisade', model, layout: layoutPalisade(model, screen, s) };
  }
}
