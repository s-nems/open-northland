import type { DrawItem } from '../../data/scene/index.js';
import { vehicleLookFor } from '../../data/sprites/index.js';
import { type PaletteLut, paletteBlockRow, type SpriteSheet, vehicleLutRow } from '../sprite-sheet.js';
import { type CartDriveLook, cartDriveLook } from './cart-drive.js';

/** The LUT a vehicle is drawn through: the settler LUT while a crewed cart draws as its driver, the
 *  vehicle LUT for an indexed look, none for a baked look. */
export function vehiclePalette(sheet: SpriteSheet | undefined, item: DrawItem): PaletteLut | undefined {
  if (cartDriveLook(sheet, item) !== undefined) return sheet?.palette;
  const binding = sheet?.bindings.vehicle;
  const indexed = binding !== undefined && vehicleLookFor(binding, item)?.indexed === true;
  return indexed ? sheet?.vehiclePalette : undefined;
}

/** The row a vehicle drawn through `palette` reads: the driver's block of the settler LUT while it draws
 *  as its driver, else its owner's row of the vehicle LUT. */
export function vehicleBodyRow(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  palette: PaletteLut,
  driven: CartDriveLook | undefined = cartDriveLook(sheet, item),
): number {
  const settler = sheet?.palette;
  return driven !== undefined && settler !== undefined
    ? paletteBlockRow(settler, item.player, driven.paletteBlock)
    : vehicleLutRow(palette, item.player);
}
