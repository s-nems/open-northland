import type { DrawItem } from '../scene/draw-item.js';
import type { BuildingDraw } from './layered-bindings.js';
import { atomicFrame, DEFAULT_FACING, frameOf } from './settler.js';
import type { SpriteFrameRef } from './settler-bindings.js';
import type { VehicleBinding, VehicleLook } from './vehicle-bindings.js';

/** Ticks per catapult shot: the original's attack cadence is the 48-tick attack clip
 *  (docs/formats/VEHICLES.md "Catapult"), which the render stretches the shot's frame lists over. */
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
  return vehicleLookOf(binding, item.tribe, item.typeId);
}

function vehicleLookOf(
  binding: VehicleBinding,
  tribe: number | undefined,
  vehicleType: number,
): VehicleLook | undefined {
  const own = tribe !== undefined ? binding.byTribe[tribe]?.[vehicleType] : undefined;
  return own ?? binding.byTribe[binding.fallbackTribe]?.[vehicleType];
}

/**
 * The ship an under-construction yard building rises as (`VehicleBinding.shipYards`): the first frame of
 * its tribe's moored hull at the launch facing, the look the launched ship stands in. `null` for any
 * other building or a ship no tribe binds.
 */
export function resolveShipYardSiteDraw(
  binding: VehicleBinding | undefined,
  item: DrawItem,
): VehicleDraw | null {
  const yards = binding?.shipYards;
  if (binding === undefined || yards === undefined || item.builtPct === undefined) return null;
  const vehicleType = item.typeId === undefined ? undefined : yards.vehicleByHouse[item.typeId];
  if (vehicleType === undefined) return null;
  const look = vehicleLookOf(binding, item.tribe, vehicleType);
  if (look === undefined) return null;
  const bob = frameOf(look.mooredIdle ?? look.idle, yards.facing, 0);
  return { bob, layer: look.layer, sway: 'none', indexed: look.indexed === true };
}

/** The drive clip a moving vehicle plays: per hauled good, then any-cargo, then empty, then the wait.
 *  A ship sails on its empty drive whatever it carries: its loaded drive is the furled hull, and the
 *  sails stay set until it moors (owner's choice). */
export function vehicleMovingRef(look: VehicleLook, item: DrawItem): SpriteFrameRef {
  const loaded = item.carrying === true && look.afloat !== true;
  const byGood = loaded && item.carryGood !== undefined ? look.movingByGood?.[item.carryGood] : undefined;
  return byGood ?? (loaded ? look.loadedMoving : undefined) ?? look.moving ?? look.idle;
}

/** Whether a vehicle is a ship out at sea, and whether under way; a moored ship lies at the shore. */
export type VehicleAfloat = 'none' | 'atSea' | 'sailing';

export function vehicleAfloat(look: VehicleLook, item: DrawItem): VehicleAfloat {
  if (look.afloat !== true || item.moored === true) return 'none';
  const attacking = item.task === 'attacks' && look.attack !== undefined;
  return item.state === 'moving' && !attacking ? 'sailing' : 'atSea';
}

/** A vehicle's frame and whether it rides the swell this frame: a ship at sea, sailing or standing. */
export interface VehicleDraw extends BuildingDraw {
  readonly sway: VehicleAfloat;
  /** The frame is the indexed body, read through the vehicle colour LUT. */
  readonly indexed: boolean;
}

/**
 * The frame a vehicle draws, or `null` for a type its tribe and the fallback tribe both lack. An
 * attacking vehicle plays its shot over the attack cadence, a moving one its drive on the gait clock, and a
 * standing one its wait on the free tick. A ship's sails are furled only while it lies moored.
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
  const sway = vehicleAfloat(look, item);
  const indexed = look.indexed === true;
  let bob: number;
  if (item.task === 'attacks' && look.attack !== undefined) {
    bob = atomicFrame(look.attack, facing, attackPhase(tick, item.attackClipStart), undefined);
  } else if (item.state === 'moving') {
    bob = frameOf(vehicleMovingRef(look, item), facing, gaitClock);
  } else {
    const idle = item.moored === true ? (look.mooredIdle ?? look.idle) : look.idle;
    bob = frameOf(idle, facing, tick);
  }
  return { bob, layer: look.layer, sway, indexed };
}
