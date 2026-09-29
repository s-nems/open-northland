import {
  type CharacterPalette,
  createHumanPaletteIdentity,
  type HumanPaletteIdentity,
} from '../../data/palettes/human-palettes.js';
import type { DrawItem } from '../../data/scene/index.js';
import { HUMAN_HEAD_ROW_OFFSET } from '../human-palette-lut.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { cartDriveLook } from './cart-drive.js';
import { humanCharacter } from './character-layers.js';
import type { ResolvedLayer } from './resolved-layer.js';

/** The look of a character loaded without palette data: the book's fallback base alone. */
const BASE_ONLY: CharacterPalette = { body: '', head: '', random: [] };

/** `human_armor_000`'s tier, which a soldier wearing no armor applies. */
const UNARMORED_TIER = 0;

/** Scratch {@link humanLutRow} resolves into, so the per-frame path allocates nothing. */
const scratch = createHumanPaletteIdentity(BASE_ONLY);

/**
 * Write the palette identity `item` draws with into `out`: an indexed settler's own, or a driven cart's
 * driver with the cart's recipe. False for anything drawn without the human LUT.
 *
 * Approximations, since the sim keeps no palette history: the palettes are recomposed from what the human
 * is now, not built up over its life.
 * - A job's `[jobchangegraphics]` recipe (its own record's, else its base job's) applies whenever the
 *   human holds that job, not only after changing into it.
 * - The rolled `gfxpaletterandom` recipe comes from the current look's record, so a civilist turned
 *   soldier rolls from the soldier's list and a child's roll switches when it grows up.
 * - The armor recipe follows the armor worn now, tier 0 for a soldier wearing none; the original applies
 *   it at the job change, with the armor worn then.
 *
 * A fixed-by-job character (the heroes) is an authored identity: its worn armor still counts in combat
 * but adds no armor recipe.
 */
export function humanPaletteIdentity(
  sheet: SpriteSheet | undefined,
  item: DrawItem,
  out: HumanPaletteIdentity,
): boolean {
  const lut = sheet?.palette;
  const characters = sheet?.characters;
  if (lut === undefined || characters === undefined) return false;
  if (item.kind === 'vehicle') {
    const driven = cartDriveLook(sheet, item);
    const driver = item.driver;
    if (driven === undefined || driver === undefined) return false;
    out.look = driven.character.palette ?? BASE_ONLY;
    out.player = item.player ?? 0;
    out.female = driver.female === true;
    out.jobChange = lut.book.jobChangeRecipe(driver.tribe, driver.jobType);
    out.armorTier = undefined;
    out.cart = driven.cartRecipe;
    out.carried = undefined;
    out.seed = driver.ref;
    return true;
  }
  if (item.tribe !== undefined && characters.animals?.tribes.has(item.tribe) === true) return false;
  const young = item.young === true;
  const character = humanCharacter(characters, item.tribe, item.jobType, young, item.weaponGood, item.ref);
  if (character.indexed === false) return false;
  const table = (item.tribe !== undefined ? characters.byTribe?.[item.tribe] : undefined) ?? characters;
  const fixed = !young && item.jobType !== undefined && table.fixedByJob?.[item.jobType] !== undefined;
  const armorGood = item.armorGood;
  out.look = character.palette ?? BASE_ONLY;
  out.player = item.player ?? 0;
  out.female = item.female === true;
  out.jobChange = lut.book.jobChangeRecipe(item.tribe, item.jobType);
  const worn = armorGood == null ? undefined : lut.armor.tierByGood.get(armorGood);
  const soldier = item.jobType !== undefined && lut.armor.soldierJobs.has(item.jobType);
  out.armorTier = fixed ? undefined : (worn ?? (soldier ? UNARMORED_TIER : undefined));
  out.cart = undefined;
  out.carried = item.carrying === true ? item.carryGood : undefined;
  out.seed = item.ref;
  return true;
}

/** The human LUT body row `item` reads this frame, 0 when it draws without the human LUT. */
export function humanLutRow(sheet: SpriteSheet | undefined, item: DrawItem): number {
  const lut = sheet?.palette;
  if (lut === undefined || !humanPaletteIdentity(sheet, item, scratch)) return 0;
  return lut.rowFor(item.ref, scratch);
}

/** The row one resolved layer reads: its human's head row for a head overlay, else `bodyRow`. */
export function humanLayerRow(layer: Pick<ResolvedLayer, 'head'>, bodyRow: number): number {
  return layer.head === true ? bodyRow + HUMAN_HEAD_ROW_OFFSET : bodyRow;
}
