import type { SpriteKind } from '../scene/index.js';
import type {
  BuildingTypeBinding,
  CraftFxBinding,
  PalisadeBinding,
  ResourceTypeBinding,
  SignpostBinding,
  StockpileBinding,
} from './layered-bindings.js';
import type { SettlerStateBinding } from './settler-bindings.js';
import type { VehicleBinding } from './vehicle-bindings.js';

export type { SpriteKind };

/** A persistent swarm's fish art and heading frames. */
export interface FishBinding {
  readonly layer: string;
  readonly bobs: readonly number[];
  readonly ticksPerFrame: number;
}

/**
 * Which atlas bob id draws each drawable kind. A plain number is the kind's single
 * all-types/all-states frame; a table binds per state, type or good. An absent optional entry draws the
 * placeholder, so a sparse sheet stays valid.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number | BuildingTypeBinding;
  resource: number | ResourceTypeBinding;
  palisade?: number | PalisadeBinding;
  fish?: FishBinding;
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
  /** The effects an in-house program stages beside its worker (a cauldron's fire and smoke). */
  craftfx?: CraftFxBinding;
  /** The carts, ships and catapults, per tribe and type. */
  vehicle?: VehicleBinding;
}>;

/** The decor kinds with no shared kind layer, each bound under its own key. A ground drop's kind and
 *  binding key differ. */
export const DECOR_BINDING_KEY = {
  grounddrop: 'trunk',
  stump: 'stump',
  berrybush: 'berrybush',
  chest: 'chest',
} as const satisfies Partial<Record<SpriteKind, keyof SpriteBindings>>;
