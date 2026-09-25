import type { DrawItem } from '../../data/scene/index.js';
import type { CartDriveAnim } from '../../data/sprites/index.js';
import type { SettlerCharacter, SpriteSheet } from '../sprite-sheet.js';
import { humanCharacter, pushComposedCharacterLayers } from './character-layers.js';
import type { LayerBuffer } from './resolved-layer.js';

/**
 * Original behavior: a handcart or ox cart whose trader or carrier commander rides inside is not drawn as
 * the cart. The cart's place shows one human figure, the driver with his cart (`[gfxwalkatomic]` job 25 with
 * the cart good while it drives, `[gfxanimatomic]` action 2 or 3 while it stands), in the commander's
 * tribe and player colours through the cart's palette patch; the driver himself is off the map. Any other
 * commander, and a cart nobody rides, draws the cart's own sprite.
 */
export interface CartDriveLook {
  readonly character: SettlerCharacter;
  readonly anim: CartDriveAnim;
  /** The settler LUT row block the figure reads. */
  readonly paletteBlock: number;
}

/** Looks already built, per character and vehicle type, so a driven cart allocates nothing per frame. */
const looksByCharacter = new WeakMap<SettlerCharacter, Map<number, CartDriveLook>>();

/**
 * The figure `item` draws in its cart's place, or undefined when it draws the cart. A tribe whose trader
 * body authors no driving figure borrows the base tribe's (approximation: the original falls back along
 * its own job chain, not traced).
 */
export function cartDriveLook(sheet: SpriteSheet | undefined, item: DrawItem): CartDriveLook | undefined {
  const drive = sheet?.cartDrive;
  const characters = sheet?.characters;
  const driver = item.driver;
  const typeId = item.typeId;
  if (drive === undefined || characters === undefined || driver === undefined || typeId === undefined)
    return undefined;
  if (item.ghost === true || !drive.commanderJobs.has(driver.jobType)) return undefined;
  const paletteBlock = drive.paletteBlockByVehicleType[typeId];
  if (paletteBlock === undefined) return undefined;
  const own = humanCharacter(characters, driver.tribe, drive.lookJob, false, undefined, item.ref);
  const character =
    own.binding.cartDrive?.[typeId] !== undefined
      ? own
      : humanCharacter(characters, undefined, drive.lookJob, false, undefined, item.ref);
  const anim = character.binding.cartDrive?.[typeId];
  if (anim === undefined) return undefined;
  let byType = looksByCharacter.get(character);
  if (byType === undefined) {
    byType = new Map();
    looksByCharacter.set(character, byType);
  }
  let look = byType.get(typeId);
  if (look === undefined || look.paletteBlock !== paletteBlock) {
    look = { character, anim, paletteBlock };
    byType.set(typeId, look);
  }
  return look;
}

/** Append the figure's layers, a character's with the cart gait in place of its own binding. */
export function pushCartDriveLayers(
  out: LayerBuffer,
  sheet: SpriteSheet,
  look: CartDriveLook,
  item: DrawItem,
  tick: number,
  gaitClock: number,
): boolean {
  return pushComposedCharacterLayers(out, sheet, look.character, look.anim, undefined, item, tick, gaitClock);
}
