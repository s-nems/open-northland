import type { DrawItem } from '../../../data/scene/index.js';
import { vehicleLookFor } from '../../../data/sprites/index.js';
import { type PaletteLut, type SpriteSheet, vehicleLutRow } from '../../textures/sprite-sheet.js';
import { cartDriveLook } from './cart-drive.js';
import type { HumanPaletteRow } from './human-palette-row.js';
import { shipYardSiteDraw } from './vehicle.js';

/** The LUT a vehicle is drawn through: the human LUT while a crewed cart draws as its driver, the
 *  vehicle LUT for an indexed look, none for a baked look. */
export function vehiclePalette(sheet: SpriteSheet | undefined, item: DrawItem): PaletteLut | undefined {
  if (cartDriveLook(sheet, item) !== undefined) return sheet?.palette;
  const binding = sheet?.bindings.vehicle;
  const indexed = binding !== undefined && vehicleLookFor(binding, item)?.indexed === true;
  return indexed ? sheet?.vehiclePalette : undefined;
}

/** The LUT a ship yard site is drawn through: the vehicle LUT while it rises as an indexed ship. */
export function shipYardSitePalette(sheet: SpriteSheet | undefined, item: DrawItem): PaletteLut | undefined {
  const indexed = shipYardSiteDraw(sheet, item)?.indexed === true;
  return indexed ? sheet?.vehiclePalette : undefined;
}

/** The row a vehicle drawn through `palette` reads: its driver's human LUT row while it draws as its
 *  driver, else its owner's row of the vehicle LUT. */
export function vehicleBodyRow(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  palette: PaletteLut,
  human: HumanPaletteRow,
): number {
  return palette === sheet?.palette ? human.row(sheet, item) : vehicleLutRow(palette, item.player);
}
