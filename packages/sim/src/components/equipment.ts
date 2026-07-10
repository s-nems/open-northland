import type { Fixed } from '../core/fixed.js';
import { defineComponent } from '../ecs/world.js';

/**
 * The number of general "misc" consumable slots a character carries (mead / potions / amulets). The
 * equipment CATEGORIES are source-pinned (see {@link Equipment}), but the per-category slot COUNTS are
 * NOT in any readable data or in the reversed GUI code — OpenVikings proves an `(equipmentType, slot)`
 * model (`MiscWindows_HumanChangeEquippedGoodsWindow_Open`) but not the slot counts. So `4` is a named
 * APPROXIMATION (the count the feature request assumed); revise it if the original count is recovered.
 */
export const MISC_EQUIP_SLOTS = 4;

/**
 * One occupied equipment slot: the worn good + how used-up it is.
 *
 * `goodType` is the equip good's `typeId` (the original's equippable ids 30–55 — shoes/tools/armour/
 * weapons/mead/potions/amulets), resolved against the content `goods` table for its icon, name and
 * {@link import('@vinland/data').EquipClass}.
 *
 * `degreeOfUse` is a {@link Fixed} fraction in `[0, ONE]` — how used-up a WEARING item is (`0` = fresh,
 * `ONE` = spent), the original's "degree of use" the equip window shows as a percentage. It is always
 * `0` for a non-wearing good (weapons/armour/amulets never wear — the good's `equip.wears` is false;
 * source basis: manual "Unused items ... can be used again"). No consumption drive reduces it yet —
 * this slice MODELS and DISPLAYS the field; the drink/consume drive (which would decrement it, faithful
 * to potion "2 uses"/"5 uses") is deferred.
 */
export interface EquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUse: Fixed;
}

/**
 * A character's worn **equipment** — the player-facing inventory the original's equip window shows. The
 * slot kinds are source-pinned to the manual's Equipment section: everyone can wear `boots` (shoes), a
 * `tool` (wooden/iron), and {@link MISC_EQUIP_SLOTS} `misc` consumables (mead/potions/amulets); a
 * soldier additionally carries a `weapon` and `armor`. Each slot holds one {@link EquipmentSlot} or is
 * `null` (empty). `misc` is a fixed-length array of {@link MISC_EQUIP_SLOTS} entries.
 *
 * This is the equipment INVENTORY/display axis, distinct from the combat {@link Weapon}/{@link Armor}
 * components (which carry the `weaponTypeId`/`armorClass` the CombatSystem resolves damage through):
 * wiring the two together — equipping a weapon good actually granting the combat `Weapon` — is the
 * deferred "equip drive" (see the barracks-recruitment plan step). For now a scene stamps both when it
 * wants a unit that both displays and fights.
 *
 * It is a **separate optional component** (like {@link Weapon}/{@link Armor}/{@link JobAssignment}):
 * only an explicitly-equipped unit carries one, so a bare settler — every animal, every golden/slice
 * settler — has none and the state hash stays byte-identical (adding this component changes no existing
 * scenario). Determinism: every field is a whole integer id or a {@link Fixed} scaled integer, stamped
 * from command data and read by pure UI/queries — no RNG, no wall-clock.
 */
export const Equipment = defineComponent<{
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
  weapon: EquipmentSlot | null;
  armor: EquipmentSlot | null;
  misc: ReadonlyArray<EquipmentSlot | null>;
}>('Equipment');
