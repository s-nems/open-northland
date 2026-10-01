import { layoutPalisade, layoutSignpost, type PalisadeLayout, type SignpostLayout } from './layout/index.js';
import type { PalisadePanelModel, SignpostPanelModel, UnitPanelModel } from './model/index.js';

/** A selection's model paired with the geometry laid out for it. A settler, vehicle, building or group
 *  has no view here: the DOM panels show it. */
export type PanelView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'signpost'; readonly model: SignpostPanelModel; readonly layout: SignpostLayout }
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
      return EMPTY_PANEL_VIEW;
    case 'signpost':
      return { kind: 'signpost', model, layout: layoutSignpost(screen, s) };
    case 'palisade':
      return { kind: 'palisade', model, layout: layoutPalisade(model, screen, s) };
  }
}
