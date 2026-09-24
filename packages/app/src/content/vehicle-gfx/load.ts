import type { SpriteLayer, VehicleBinding, VehicleColourLut } from '@open-northland/render';
import { loadLayer, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import { loadTextureIfPresent } from '../net.js';
import {
  buildVehicleBinding,
  type DrawableFrames,
  SHIP_SAIL_INDEX_RANGES,
  vehicleAtlasStems,
  vehicleGraphicsRows,
  vehicleOwnerFamily,
} from './bindings.js';

/** The ship types of the IR, by the sim's rule (`isShipVehicle`: a type with passenger slots). */
function shipTypes(ir: ContentIr | null): ReadonlySet<number> {
  const ships = new Set<number>();
  for (const row of ir?.vehicles ?? []) {
    if (row.typeId !== undefined && (row.passengerSlots ?? 0) > 0) ships.add(row.typeId);
  }
  return ships;
}

/** The vehicle half of the sheet: the binding, exactly the family atlases it draws from, and the owner
 *  colour LUT when the pipeline emitted one. */
export interface VehicleSheet {
  readonly binding: VehicleBinding | undefined;
  readonly families: Record<string, SpriteLayer>;
  readonly palette: VehicleColourLut | undefined;
}

/** The owner-colour LUT of a palette family (`/bobs/<family>.lut.png`, one row per member), its row
 *  count read off the texture; `undefined` when the pipeline hasn't produced it. */
async function loadOwnerLut(family: string | undefined): Promise<VehicleColourLut | undefined> {
  if (family === undefined) return undefined;
  const source = await loadTextureIfPresent(`/bobs/${family}.lut.png`);
  if (source === undefined) return undefined;
  return { source, colours: source.pixelHeight, sailRanges: SHIP_SAIL_INDEX_RANGES };
}

/**
 * Load every vehicle body the IR binds, whatever tribes the world fields: the bodies are shared across
 * tribes (three cart palettes, two ship libraries), so the whole table costs five pages. With the ships'
 * owner LUT served, their libraries load as the indexed body instead of the baked first palette.
 */
export async function loadVehicleSheet(ir: ContentIr | null, fallbackTribe: number): Promise<VehicleSheet> {
  const rows = vehicleGraphicsRows(ir);
  const family = vehicleOwnerFamily(rows);
  const palette = await loadOwnerLut(family);
  const ownerFamily = palette === undefined ? undefined : family;
  const { stems, shadowByStem } = vehicleAtlasStems(rows, ownerFamily);
  const families: Record<string, SpriteLayer> = {};
  await Promise.all(
    [...stems].map(async (stem) => {
      try {
        families[stem] = await loadLayer(stem, shadowByStem.get(stem));
      } catch (err) {
        if (!(err instanceof MissingAtlasError)) throw err; // a real decode bug still surfaces
      }
    }),
  );
  const loaded = new Set(Object.keys(families));
  const frames: DrawableFrames = new Map(
    Object.entries(families).map(([stem, layer]) => {
      const drawable = new Set<number>();
      for (const [id, frame] of layer.atlas.frames) if (frame.width > 0 && frame.height > 0) drawable.add(id);
      return [stem, drawable] as const;
    }),
  );
  return {
    binding: buildVehicleBinding(rows, loaded, frames, fallbackTribe, {
      ships: shipTypes(ir),
      ...(ownerFamily !== undefined ? { ownerFamily } : {}),
    }),
    families,
    palette,
  };
}
