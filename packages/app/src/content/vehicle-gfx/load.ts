import type { SpriteLayer, VehicleBinding } from '@open-northland/render';
import { loadLayer, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import {
  buildVehicleBinding,
  type DrawableFrames,
  vehicleAtlasStems,
  vehicleGraphicsRows,
} from './bindings.js';

/** The vehicle half of the sheet: the binding and exactly the family atlases it draws from. */
export interface VehicleSheet {
  readonly binding: VehicleBinding | undefined;
  readonly families: Record<string, SpriteLayer>;
}

/**
 * Load every vehicle body the IR binds, whatever tribes the world fields: the bodies are shared across
 * tribes (three cart palettes, two ship libraries), so the whole table costs five pages.
 */
export async function loadVehicleSheet(
  ir: ContentIr | null,
  fallbackTribe: number,
  attackFxLoaded: boolean,
): Promise<VehicleSheet> {
  const rows = vehicleGraphicsRows(ir);
  const { stems, shadowByStem } = vehicleAtlasStems(rows);
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
  return { binding: buildVehicleBinding(rows, loaded, frames, fallbackTribe, attackFxLoaded), families };
}
