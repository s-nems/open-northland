import {
  type CompactLayout,
  layoutCompact,
  layoutPalisade,
  layoutSignpost,
  type PalisadeLayout,
  type SignpostLayout,
} from './layout/index.js';
import type {
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  PalisadePanelModel,
  SignpostPanelModel,
  UnitPanelModel,
} from './model/index.js';

/**
 * A selection's model paired with the geometry laid out for it, discriminated by the layout's kind rather
 * than the model's: one `compact` strip serves both multi-select model kinds. A single settler, vehicle or
 * building has no view here: the DOM panels show it.
 */
export type PanelView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'signpost'; readonly model: SignpostPanelModel; readonly layout: SignpostLayout }
  | { readonly kind: 'palisade'; readonly model: PalisadePanelModel; readonly layout: PalisadeLayout }
  | {
      readonly kind: 'compact';
      readonly model: MultiSettlerPanelModel | GenericSelectionPanelModel;
      readonly layout: CompactLayout;
    };

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
      return EMPTY_PANEL_VIEW;
    case 'signpost':
      return { kind: 'signpost', model, layout: layoutSignpost(screen, s) };
    case 'palisade':
      return { kind: 'palisade', model, layout: layoutPalisade(model, screen, s) };
    case 'multi-settler':
    case 'generic':
      return { kind: 'compact', model, layout: layoutCompact(screen, s) };
  }
}
