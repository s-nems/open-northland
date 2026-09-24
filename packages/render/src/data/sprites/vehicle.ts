import type { DrawItem } from '../scene/draw-item.js';
import type { BuildingDraw } from './layered-bindings.js';
import { DEFAULT_FACING, frameOf } from './settler.js';
import type { SpriteFrameRef } from './settler-bindings.js';
import type { VehicleBinding, VehicleLook } from './vehicle-bindings.js';

/** Ticks per catapult shot: the original's attack cadence is the 48-tick attack clip
 *  (docs/formats/VEHICLES.md "Catapult"), and the render loops the clip on it. */
export const VEHICLE_ATTACK_TICKS = 48;

/** Where in its attack cycle a vehicle is at `tick`: counted from the sim's clip start when the
 *  snapshot carries one, else from the global cadence for a vehicle merely posed as attacking. */
export function attackPhase(tick: number, clipStart?: number): number {
  const elapsed = clipStart === undefined ? tick : tick - clipStart;
  return ((elapsed % VEHICLE_ATTACK_TICKS) + VEHICLE_ATTACK_TICKS) % VEHICLE_ATTACK_TICKS;
}

/** The look of `item`'s tribe and type, the fallback tribe's when its own tribe binds none. */
export function vehicleLookFor(binding: VehicleBinding, item: DrawItem): VehicleLook | undefined {
  if (item.typeId === undefined) return undefined;
  const own = item.tribe !== undefined ? binding.byTribe[item.tribe]?.[item.typeId] : undefined;
  return own ?? binding.byTribe[binding.fallbackTribe]?.[item.typeId];
}

/** The drive clip a moving vehicle plays: per hauled good, then any-cargo, then empty, then the wait. */
export function vehicleMovingRef(look: VehicleLook, item: DrawItem): SpriteFrameRef {
  const loaded = item.carrying === true;
  const byGood = loaded && item.carryGood !== undefined ? look.movingByGood?.[item.carryGood] : undefined;
  return byGood ?? (loaded ? look.loadedMoving : undefined) ?? look.moving ?? look.idle;
}

/** A vehicle's frame and whether it rides the swell this frame: a ship at sea, sailing or standing. */
export interface VehicleDraw extends BuildingDraw {
  readonly sway: 'none' | 'atSea' | 'sailing';
  /** The frame is the indexed body, read through the vehicle colour LUT. */
  readonly indexed: boolean;
}

/**
 * The frame a vehicle draws, or `null` for a type its tribe and the fallback tribe both lack. An
 * attacking vehicle loops its shot on the attack cadence, a moving one its drive on the gait clock, and a
 * standing one its wait on the free tick, the furled-sail hull while a ship lies moored.
 */
export function resolveVehicleDraw(
  binding: VehicleBinding | undefined,
  item: DrawItem,
  tick: number,
  gaitClock: number = tick,
): VehicleDraw | null {
  if (binding === undefined) return null;
  const look = vehicleLookFor(binding, item);
  if (look === undefined) return null;
  const facing = item.facing ?? DEFAULT_FACING;
  const afloat = look.afloat === true && item.moored !== true;
  const indexed = look.indexed === true;
  let bob: number;
  if (item.task === 'attacks' && look.attack !== undefined) {
    bob = frameOf(look.attack, facing, attackPhase(tick, item.attackClipStart));
  } else if (item.state === 'moving') {
    bob = frameOf(vehicleMovingRef(look, item), facing, gaitClock);
    return { bob, layer: look.layer, sway: afloat ? 'sailing' : 'none', indexed };
  } else {
    const idle = item.moored === true ? (look.mooredIdle ?? look.idle) : look.idle;
    bob = frameOf(idle, facing, tick);
  }
  return { bob, layer: look.layer, sway: afloat ? 'atSea' : 'none', indexed };
}
