import type { EquipCategory } from '@open-northland/data';
import { components, systems } from '@open-northland/sim';
import { num } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';
import { remainingPct } from './bars.js';
import { type Comp, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';
import { HUMANWINDOW } from './humanwindow.js';

/** The equipment slot groups the sim `Equipment` component carries - the row identity and the slot
 *  address an equip/swap/take-off order names (`misc` rows address their slot by index). The content
 *  category itself, so a category added to the data schema surfaces here as a compile error. */
export type EquipGroup = EquipCategory;

/** One equipment slot's contents. Empty (`occupied` false, `conditionPct` null) for an unworn slot. */
export interface EquipSlotModel {
  /** Whether the slot holds a good - true even when the good's def failed to resolve (no icon/label),
   *  so the action buttons still read the slot as worn. */
  readonly occupied: boolean;
  /** The worn good's string id (the icon key); undefined when the slot is empty. */
  readonly goodId?: string;
  /** The worn good's display name (the action buttons' tooltip line) - undefined when empty. */
  readonly label?: string;
  /** How much of an occupied wearing item is LEFT, as a percent (a fresh item reads 100 and drains
   *  with use - the inverse of the sim's rising `degreeOfUse`; user rule 2026-07-23). Null when the
   *  slot is empty or holds a permanent good (weapon/armour/amulet). */
  readonly conditionPct: number | null;
}

/**
 * One labeled equipment row - the original's `Buty`/`Narzędzia`/`Broń`/`Zbroja`/`Ekwipunek` lines, each
 * a `humanwindow` label id (+ pinned fallback) and its slot(s). Single-slot rows (boots/tool/weapon/
 * armour) carry one; the misc `Ekwipunek` row carries {@link components.MISC_EQUIP_SLOTS}.
 */
export interface EquipRow {
  readonly titleId: number;
  readonly fallback: string;
  /** Which sim `Equipment` field this row shows - the slot address its action buttons order against. */
  readonly group: EquipGroup;
  readonly slots: readonly EquipSlotModel[];
  /** Whether this settler may still PUT something in the row (false only for a fighter's stray tool,
   *  which the sim refuses to re-equip): the layout then offers the take-off cross alone, so no button
   *  opens a menu that is empty by rule rather than by stock. */
  readonly wearable: boolean;
}

/** A cloned `Equipment` slot as it appears in the snapshot (`{ degreeOfUse, goodType }`), or empty. */
type RawEquipSlot = { readonly goodType?: unknown; readonly degreeOfUse?: unknown } | null | undefined;

/** The `Equipment` component as the snapshot serializes it (slots + the misc array). */
interface RawEquipment {
  readonly boots?: RawEquipSlot;
  readonly tool?: RawEquipSlot;
  readonly weapon?: RawEquipSlot;
  readonly armor?: RawEquipSlot;
  readonly misc?: unknown;
}

/** One equipment slot → its panel model. Empty when unworn/unresolved; an occupied wearing good
 *  (potion/shoes/tool) carries its remaining-condition percent, a permanent good (weapon/armour/
 *  amulet, `equip.wears` false) none. */
function slotModel(ctx: UnitPanelModelContext, slot: RawEquipSlot): EquipSlotModel {
  if (slot == null) return { occupied: false, conditionPct: null };
  const goodType = num(slot.goodType);
  if (goodType === undefined) return { occupied: false, conditionPct: null };
  const def = goodDef(ctx, goodType);
  const wears = def?.equip?.wears ?? false;
  return {
    occupied: true,
    conditionPct: wears ? remainingPct(num(slot.degreeOfUse)) : null,
    ...(def?.id !== undefined ? { goodId: def.id } : {}),
    label: goodLabel(ctx, goodType),
  };
}

/**
 * The settler's equipment as labeled rows: Broń + Zbroja for a fighter, then Buty, Narzędzia for a
 * civilian, and the misc Ekwipunek row (its {@link components.MISC_EQUIP_SLOTS} consumable slots) -
 * combat gear first (user order 2026-07-23). Reads the sim `Equipment` component; a settler without one
 * shows every base slot empty.
 *
 * Which rows a trade offers follows the JOB, so changing profession swaps the arms rows for the tool row
 * and back: Broń/Zbroja are the original's soldier-only equip slots (`tribetypes` `allowequip`), and a
 * fighter keeps no tool (the sim's rule - `shedToolOnEnlist`). Two escapes keep worn gear reachable
 * rather than stranded: a unit the job would not offer still shows its row while it is worn (so it can
 * be taken off), and an armed non-fighter (a hunter/scout carrying a combat `Weapon`) keeps its arms
 * rows.
 */
export function equipmentRows(ctx: UnitPanelModelContext, comps: Comp): EquipRow[] {
  const slots = messages().hud.equipmentSlots;
  const eq = comps.Equipment as RawEquipment | undefined;
  const s = (comps.Settler ?? {}) as Comp;
  const rows: EquipRow[] = [];
  const jobType = num(s.jobType);
  const job = jobType === undefined ? undefined : ctx.jobs.find((j) => j.typeId === jobType);
  const fighter = job !== undefined && systems.isFighterJobRow(job);
  if (fighter || 'Weapon' in comps || eq?.weapon != null || eq?.armor != null) {
    rows.push({
      titleId: HUMANWINDOW.weapon,
      fallback: slots.weapon,
      group: 'weapon',
      slots: [slotModel(ctx, eq?.weapon)],
      wearable: true,
    });
    rows.push({
      titleId: HUMANWINDOW.armor,
      fallback: slots.armor,
      group: 'armor',
      slots: [slotModel(ctx, eq?.armor)],
      wearable: true,
    });
  }
  rows.push({
    titleId: HUMANWINDOW.boots,
    fallback: slots.boots,
    group: 'boots',
    slots: [slotModel(ctx, eq?.boots)],
    wearable: true,
  });
  if (!fighter || eq?.tool != null) {
    rows.push({
      titleId: HUMANWINDOW.tools,
      fallback: slots.tools,
      group: 'tool',
      slots: [slotModel(ctx, eq?.tool)],
      wearable: !fighter,
    });
  }
  const misc = Array.isArray(eq?.misc) ? (eq.misc as RawEquipSlot[]) : [];
  const miscSlots: EquipSlotModel[] = [];
  for (let i = 0; i < components.MISC_EQUIP_SLOTS; i++) miscSlots.push(slotModel(ctx, misc[i] ?? null));
  rows.push({
    titleId: HUMANWINDOW.misc,
    fallback: slots.misc,
    group: 'misc',
    slots: miscSlots,
    wearable: true,
  });
  return rows;
}
