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
 * Which atlas bob id draws each drawable kind, filled from the extracted IR. A plain number is the
 * kind's single all-types/all-states frame; a table binds per state, type or good. An absent optional
 * entry draws the placeholder, so a sparse sheet stays valid.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number | BuildingTypeBinding;
  resource: number | ResourceTypeBinding;
  stockpile?: number | StockpileBinding;
  /** A felled tree's stump/debris, drawn per-good from the dead-tree atlas (`ls_trees_dead`). */
  stump?: number | ResourceTypeBinding;
  /** A freshly-felled trunk lying on the ground (the `landscapeToPickup` stage) before collection. */
  trunk?: number | ResourceTypeBinding;
  /** A wild berry bush, per fruited-record variant with a three-level list (1 bare, 2 flowering, 3 ripe). */
  berrybush?: number | ResourceTypeBinding;
  /** The post and direction-board frames of a scout's signpost (the decoded `ls_guidepost` atlas). */
  signpost?: SignpostBinding;
}>;
