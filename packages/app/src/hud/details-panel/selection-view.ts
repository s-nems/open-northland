import {
  type BuildingLayout,
  type CompactLayout,
  layoutBuilding,
  layoutCompact,
  layoutPalisade,
  layoutSettler,
  layoutSignpost,
  layoutVehicle,
  type PalisadeLayout,
  type SettlerLayout,
  type SignpostLayout,
  type VehicleLayout,
} from './layout/index.js';
import type {
  BuildingPanelModel,
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  PalisadePanelModel,
  SettlerPanelModel,
  SignpostPanelModel,
  UnitPanelModel,
  VehiclePanelModel,
} from './model/index.js';

/**
 * A selection's model paired with the geometry laid out for it, discriminated by the layout's kind rather
 * than the model's: one `compact` strip serves both multi-select model kinds.
 */
export type PanelView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'building'; readonly model: BuildingPanelModel; readonly layout: BuildingLayout }
  | { readonly kind: 'settler'; readonly model: SettlerPanelModel; readonly layout: SettlerLayout }
  | { readonly kind: 'signpost'; readonly model: SignpostPanelModel; readonly layout: SignpostLayout }
  | { readonly kind: 'palisade'; readonly model: PalisadePanelModel; readonly layout: PalisadeLayout }
  | { readonly kind: 'vehicle'; readonly model: VehiclePanelModel; readonly layout: VehicleLayout }
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
    case 'palisade':
      return { kind: 'palisade', model, layout: layoutPalisade(model, screen, s) };
    case 'vehicle':
      return { kind: 'vehicle', model, layout: layoutVehicle(model, screen, s) };
    case 'multi-settler':
    case 'generic':
      return { kind: 'compact', model, layout: layoutCompact(screen, s) };
  }
}
