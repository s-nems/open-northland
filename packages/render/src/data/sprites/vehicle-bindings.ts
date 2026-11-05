import type { SpriteFrameRef } from './settler-bindings.js';

/**
 * One tribe's look for one vehicle type: the served family atlas its clips index and the clips per
 * state, all in that atlas's own bob-id space (the IR's `vehicleGraphics` row already resolved the
 * `[bobseq]` offsets). Every slot but `idle` is optional and falls back down the chain
 * `loaded → unloaded → idle`, which is what the shipped data's holes need: a cart with a wait but no
 * drive stands still while it moves, a ship whose loaded hull has no frames sails with the empty one.
 * The atlas is one bake for every owner unless the look is {@link VehicleLook.indexed}.
 */
export interface VehicleLook {
  readonly layer: string;
  /** The wait (`[gfxanimatomic]` action 2), looped on the free tick. */
  readonly idle: SpriteFrameRef;
  /** The wait of a ship lying moored: the second hull (action 4), whose sails are furled and whose
   *  deck carries cargo (observation of the `ls_vehicles` frames). Sailing and standing at sea play
   *  {@link idle}, the sails set. */
  readonly mooredIdle?: SpriteFrameRef;
  /** The unloaded drive (`[gfxwalkatomic]` good 0), clocked by the motion track. */
  readonly moving?: SpriteFrameRef;
  /** The drive per hauled good; a good absent here plays {@link loadedMoving}. */
  readonly movingByGood?: Readonly<Record<number, SpriteFrameRef>>;
  /** The drive with any cargo aboard, for a good {@link movingByGood} does not list. */
  readonly loadedMoving?: SpriteFrameRef;
  /** The catapult's shot (action 81), played over the attack cadence while the vehicle attacks. */
  readonly attack?: SpriteFrameRef;
  /** A ship: it rides the swell at sea (`gpu/sway/ship.ts`) and lies still moored. */
  readonly afloat?: boolean;
  /** {@link layer} is the indexed body, drawn per owner through the sheet's vehicle colour LUT. */
  readonly indexed?: boolean;
}

/** Per-type looks of one tribe. */
export type VehicleTribeLooks = Readonly<Record<number, VehicleLook>>;

/**
 * The vehicle binding: a tribe's own looks, else the base tribe's under `fallbackTribe` (the shipped
 * data binds no Egyptian vehicle), and a type absent from both draws the placeholder.
 */
export interface VehicleBinding {
  readonly byTribe: Readonly<Record<number, VehicleTribeLooks>>;
  readonly fallbackTribe: number;
  /** The yards whose construction site draws the ship it launches; see {@link ShipYardSites}. */
  readonly shipYards?: ShipYardSites;
}

/**
 * The ship yard houses whose site rises as the finished ship rather than the house's own stage art: the
 * data gives every tribe's yard one viking longship stage, which matches only some tribes' ships. The
 * site draws its tribe's moored ship at the facing it launches in, in its owner's colour, and takes no
 * damage paint (approximation, owner's choice).
 */
export interface ShipYardSites {
  /** The vehicle type each yard house type launches. */
  readonly vehicleByHouse: Readonly<Record<number, number>>;
  /** The render facing a launched vehicle takes. */
  readonly facing: number;
}
