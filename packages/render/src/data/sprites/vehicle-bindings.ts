import type { InHouseOverlay } from '../scene/in-house.js';
import type { SpriteFrameRef } from './settler-bindings.js';

/**
 * One tribe's look for one vehicle type: the served family atlas its clips index and the clips per
 * state, all in that atlas's own bob-id space (the IR's `vehicleGraphics` row already resolved the
 * `[bobseq]` offsets). Every slot but `idle` is optional and falls back down the chain
 * `loaded → unloaded → idle`, which is what the shipped data's holes need: a cart with a wait but no
 * drive stands still while it moves, a ship whose loaded hull has no frames sails with the empty one.
 * The atlas is one bake for every owner: a ship's team colour is not drawn yet (docs/formats/VEHICLES.md
 * "Graphics" names the LUT route for it).
 */
export interface VehicleLook {
  readonly layer: string;
  /** The wait (`[gfxanimatomic]` action 2), looped on the free tick. */
  readonly idle: SpriteFrameRef;
  /** The wait with cargo aboard: the ships' second hull (action 4). */
  readonly loadedIdle?: SpriteFrameRef;
  /** The unloaded drive (`[gfxwalkatomic]` good 0), clocked by the motion track. */
  readonly moving?: SpriteFrameRef;
  /** The drive per hauled good; a good absent here plays {@link loadedMoving}. */
  readonly movingByGood?: Readonly<Record<number, SpriteFrameRef>>;
  /** The drive with any cargo aboard, for a good {@link movingByGood} does not list. */
  readonly loadedMoving?: SpriteFrameRef;
  /** The catapult's shot (action 81), looped on the attack cadence while the vehicle attacks. */
  readonly attack?: SpriteFrameRef;
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
  /** The effect staged at an attacking catapult while its shot's smoke lingers, drawn through the
   *  `craftfx` binding by name; absent stages nothing. */
  readonly attackFx?: InHouseOverlay;
}
