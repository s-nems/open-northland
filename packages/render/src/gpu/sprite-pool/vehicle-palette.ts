import type { DrawItem } from '../../data/scene/index.js';
import { vehicleLookFor } from '../../data/sprites/index.js';
import { type PaletteLut, type SpriteSheet, vehicleLutRow } from '../sprite-sheet.js';
import { cartDriveLook } from './cart-drive.js';
import { humanLutRow } from './human-palette-row.js';

/** The LUT a vehicle is drawn through: the human LUT while a crewed cart draws as its driver, the
 *  vehicle LUT for an indexed look, none for a baked look. */
export function vehiclePalette(sheet: SpriteSheet | undefined, item: DrawItem): PaletteLut | undefined {
  if (cartDriveLook(sheet, item) !== undefined) return sheet?.palette;
  const binding = sheet?.bindings.vehicle;
  const indexed = binding !== undefined && vehicleLookFor(binding, item)?.indexed === true;
  return indexed ? sheet?.vehiclePalette : undefined;
}

/** The row a vehicle drawn through `palette` reads: its driver's human LUT row while it draws as its
 *  driver, else its owner's row of the vehicle LUT. */
export function vehicleBodyRow(sheet: SpriteSheet | undefined, item: DrawItem, palette: PaletteLut): number {
  return palette === sheet?.palette ? humanLutRow(sheet, item) : vehicleLutRow(palette, item.player);
}
