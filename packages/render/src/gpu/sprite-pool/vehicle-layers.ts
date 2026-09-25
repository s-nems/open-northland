import type { DrawItem } from '../../data/scene/index.js';
import { resolveVehicleDraw } from '../../data/sprites/index.js';
import { sailWind } from '../cloth-wind.js';
import { shipSway } from '../ship-sway.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { hasLoadedFamily, pushLayeredWithShadow } from './layered-layers.js';
import { LayerBuffer, type ResolvedLayer } from './resolved-layer.js';

/** Scratch for {@link pushVehicleLayers}: the `[shadow, body]` before the swell and the atlas size. */
const VEHICLE_BODY = new LayerBuffer();

/**
 * Append a vehicle's `[shadow, body]`; false appends nothing. Every look names its family atlas, so an
 * unloaded one draws the placeholder, never a human frame from the shared body atlas. A ship at sea rolls,
 * heaves and fills its sail; a moored one and a fog ghost lie still.
 */
export function pushVehicleLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  item: DrawItem,
  tick: number,
  gaitClock: number,
): boolean {
  const draw = resolveVehicleDraw(sheet.bindings.vehicle, item, tick, gaitClock);
  if (draw === null || !hasLoadedFamily(sheet, draw)) return false;
  VEHICLE_BODY.reset();
  if (!pushLayeredWithShadow(VEHICLE_BODY, sheet, 'vehicle', draw)) return false;
  const still = draw.sway === 'none' || item.ghost === true;
  const underSail = draw.sway === 'sailing';
  const sway = still ? null : shipSway(tick, item.x, item.y, underSail);
  const sails =
    !still && draw.indexed && draw.layer !== undefined
      ? sheet.vehiclePalette?.sailRanges?.[draw.layer]
      : undefined;
  const cloth = sails === undefined ? undefined : sailWind(sails, tick, item.x, item.y, underSail);
  for (const resolved of VEHICLE_BODY.finish()) {
    const layer = draw.indexed ? withAtlasSize(sheet, draw.layer, resolved) : resolved;
    out.push(
      sway === null || layer.shadow
        ? layer
        : { ...layer, shear: sway.shear, dy: sway.dy, ...(cloth !== undefined ? { cloth } : {}) },
    );
  }
  return true;
}

/** An indexed look draws as paletted meshes, which sample their page by UV and so need its size. */
function withAtlasSize(sheet: SpriteSheet, family: string | undefined, layer: ResolvedLayer): ResolvedLayer {
  const body = family === undefined ? undefined : sheet.families?.[family];
  const atlas = layer.shadow === true ? body?.shadow?.atlas : body?.atlas;
  return atlas === undefined ? layer : { ...layer, atlasW: atlas.width, atlasH: atlas.height };
}
