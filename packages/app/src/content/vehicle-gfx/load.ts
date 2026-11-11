import type { VehicleGraphics } from '@open-northland/data';
import {
  GFX_DIR_TO_FACING,
  type SpriteLayer,
  type VehicleBinding,
  type VehicleColourLut,
  type VehicleYardSites,
} from '@open-northland/render';
import { components } from '@open-northland/sim';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import { atomicClipTicks } from '../ir/joins.js';
import { loadLayer, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import { loadTextureIfPresent } from '../net.js';
import { contentUrl } from '../url.js';
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

/** The yard houses, each to the vehicle type it launches, with the facing a launched vehicle takes. */
function vehicleYards(ir: ContentIr | null): VehicleYardSites | undefined {
  const vehicleByHouse: Record<number, number> = {};
  let any = false;
  for (const house of ir?.buildings ?? []) {
    if (house.typeId === undefined || house.vehicleType === undefined) continue;
    vehicleByHouse[house.typeId] = house.vehicleType;
    any = true;
  }
  const facing = GFX_DIR_TO_FACING[components.VEHICLE_SPAWN_FACING];
  return any ? { vehicleByHouse, facing } : undefined;
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
  const source = await loadTextureIfPresent(contentUrl(`/bobs/${family}.lut.png`));
  if (source === undefined) return undefined;
  return { source, colours: source.pixelHeight, sailRanges: SHIP_SAIL_INDEX_RANGES };
}

/** The ticks of the attack clip each row's tribe binds for its job, per tribe resolved once. */
function attackClipTicks(ir: ContentIr | null): (row: VehicleGraphics) => number | undefined {
  const byTribe = new Map<number, ReturnType<typeof atomicClipTicks>>();
  return (row) => {
    let ticks = byTribe.get(row.tribe);
    if (ticks === undefined) {
      ticks = atomicClipTicks(ir, row.tribe);
      byTribe.set(row.tribe, ticks);
    }
    return ticks(row.job, ATTACK_ATOMIC);
  };
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
  const ships = shipTypes(ir);
  const yards = vehicleYards(ir);
  const binding = buildVehicleBinding(rows, loaded, frames, fallbackTribe, {
    ships,
    attackTicks: attackClipTicks(ir),
    ...(ownerFamily !== undefined ? { ownerFamily } : {}),
    ...(yards !== undefined ? { vehicleYards: yards } : {}),
  });
  return { binding, families, palette };
}
