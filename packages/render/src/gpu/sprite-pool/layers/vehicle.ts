import { clamp01 } from '../../../data/math.js';
import type { DrawItem } from '../../../data/scene/index.js';
import {
  resolveShipYardSiteDraw,
  resolveVehicleDraw,
  type VehicleDraw,
} from '../../../data/sprites/index.js';
import type { WindSway } from '../../../data/weather/climate.js';
import { sailWind } from '../../sway/cloth-wind.js';
import { shipSway } from '../../sway/ship.js';
import type { SpriteSheet } from '../../textures/sprite-sheet.js';
import { cartDriveLook, pushCartDriveLayers } from './cart-drive.js';
import { hasLoadedFamily, layeredLayerFor, pushLayeredWithShadow } from './layered.js';
import { LayerBuffer } from './resolved-layer.js';

/** Scratch for {@link pushVehicleLayers}: the `[shadow, body]` before the swell. */
const VEHICLE_BODY = new LayerBuffer();

/**
 * Append a vehicle's `[shadow, body]`; false appends nothing. Every look names its family atlas, so an
 * unloaded one draws the placeholder, never a human frame from the shared body atlas. A ship at sea rolls,
 * heaves and fills its sail; a moored one and a fog ghost lie still. A cart its trader drives from inside
 * draws the driving figure instead (`./cart-drive.ts`).
 */
export function pushVehicleLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  item: DrawItem,
  tick: number,
  gaitClock: number,
  seaClock: number,
  wind?: WindSway,
): boolean {
  const driven = cartDriveLook(sheet, item);
  if (driven !== undefined) return pushCartDriveLayers(out, sheet, driven, item, tick, gaitClock);
  const draw = resolveVehicleDraw(sheet.bindings.vehicle, item, tick, gaitClock);
  if (draw === null || !hasLoadedFamily(sheet, draw)) return false;
  VEHICLE_BODY.reset();
  if (!pushLayeredWithShadow(VEHICLE_BODY, sheet, 'vehicle', draw)) return false;
  const still = draw.sway === 'none' || item.ghost === true;
  const underSail = draw.sway === 'sailing';
  const sway = still ? null : shipSway(seaClock, item.x, item.y, underSail);
  const sails =
    !still && draw.indexed && draw.layer !== undefined
      ? sheet.vehiclePalette?.sailRanges?.[draw.layer]
      : undefined;
  const cloth = sails === undefined ? undefined : sailWind(sails, seaClock, item.x, item.y, underSail, wind);
  for (const layer of VEHICLE_BODY.finish()) {
    out.push(
      sway === null || layer.shadow
        ? layer
        : { ...layer, shear: sway.shear, dy: sway.dy, ...(cloth !== undefined ? { cloth } : {}) },
    );
  }
  return true;
}

/**
 * Append a ship yard site's ship, rising from the bottom with its build progress like a stage without a
 * time sheet; false when `item` is no such site. Like the other construction stages it casts no shadow.
 */
export function pushShipYardSiteLayers(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem): boolean {
  const draw = shipYardSiteDraw(sheet, item);
  if (draw === null) return false;
  const resolved = layeredLayerFor(sheet, 'vehicle', draw);
  if (resolved === null) return false;
  out.push({ ...resolved, reveal: clamp01((item.builtPct ?? 0) / 100) });
  return true;
}

/** The ship `item` rises as when it is a ship yard site whose ship atlas loaded, which both its layers
 *  and its pool class go by. */
export function shipYardSiteDraw(sheet: SpriteSheet | undefined, item: DrawItem): VehicleDraw | null {
  if (sheet === undefined) return null;
  const draw = resolveShipYardSiteDraw(sheet.bindings.vehicle, item);
  return draw !== null && hasLoadedFamily(sheet, draw) ? draw : null;
}
