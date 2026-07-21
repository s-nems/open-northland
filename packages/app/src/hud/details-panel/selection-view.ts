import {
  type BuildingLayout,
  type CompactLayout,
  layoutBuilding,
  layoutCompact,
  layoutSettler,
  layoutSignpost,
  type SettlerLayout,
  type SignpostLayout,
} from './layout/index.js';
import type {
  BuildingPanelModel,
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  SettlerPanelModel,
  SignpostPanelModel,
  UnitPanelModel,
} from './model/index.js';

/**
 * A selection's model paired with the geometry laid out for that exact model, so consumers narrow once
 * instead of re-proving the pairing. Discriminated by the layout's kind, not the model's: one `compact`
 * strip serves both multi-select model kinds.
 */
export type PanelView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'building'; readonly model: BuildingPanelModel; readonly layout: BuildingLayout }
  | { readonly kind: 'settler'; readonly model: SettlerPanelModel; readonly layout: SettlerLayout }
  | { readonly kind: 'signpost'; readonly model: SignpostPanelModel; readonly layout: SignpostLayout }
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
      return EMPTY_PANEL_VIEW;
    case 'building':
      return { kind: 'building', model, layout: layoutBuilding(model, screen, s) };
    case 'settler':
      return { kind: 'settler', model, layout: layoutSettler(model, screen, s) };
    case 'signpost':
      return { kind: 'signpost', model, layout: layoutSignpost(screen, s) };
    case 'multi-settler':
    case 'generic':
      return { kind: 'compact', model, layout: layoutCompact(screen, s) };
  }
}
