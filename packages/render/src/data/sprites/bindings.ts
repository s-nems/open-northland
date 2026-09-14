import type { SpriteKind } from '../scene/index.js';
import type {
  BuildingTypeBinding,
  ResourceTypeBinding,
  SignpostBinding,
  StockpileBinding,
} from './layered-bindings.js';
import type { SettlerStateBinding } from './settler-bindings.js';

export type { SpriteKind };

/**
 * Which atlas bob id draws each drawable kind. A plain number is the kind's single
 * all-types/all-states frame; a table binds per state, type or good. An absent optional entry draws the
 * placeholder, so a sparse sheet stays valid.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number | BuildingTypeBinding;
  resource: number | ResourceTypeBinding;
  stockpile?: number | StockpileBinding;
  /** A felled tree's stump/debris. */
  stump?: number | ResourceTypeBinding;
  /** A freshly-felled trunk lying on the ground (the `landscapeToPickup` stage). */
  trunk?: number | ResourceTypeBinding;
  /** A wild berry bush, per fruited-record variant. */
  berrybush?: number | ResourceTypeBinding;
  /** A closed treasure chest, per `[GfxLandscape]` record (wooden or magical). */
  chest?: number | ResourceTypeBinding;
  /** The post and direction-board frames of a scout's signpost. */
  signpost?: SignpostBinding;
}>;
