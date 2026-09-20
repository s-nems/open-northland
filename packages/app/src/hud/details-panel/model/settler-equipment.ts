import type { EquipCategory } from '@open-northland/data';
import { components, systems } from '@open-northland/sim';
import { num } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';
import { remainingPct } from './bars.js';
import { type Comp, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';
import { HUMANWINDOW } from './humanwindow.js';

/** The equipment slot groups the sim `Equipment` component carries. Aliasing the content category makes
 *  a category added to the data schema a compile error here. */
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
  /** How much of an occupied wearing item is left, as a percent: a fresh item reads 100 and drains with
   *  use, the inverse of the sim's rising `degreeOfUse`. Null for an empty slot or a permanent good. */
  readonly conditionPct: number | null;
}

/** One labeled equipment row, keyed by a `humanwindow` label id with a pinned fallback. The base rows
 *  carry one slot; the misc `Ekwipunek` row carries {@link components.MISC_EQUIP_SLOTS}. */
export interface EquipRow {
  readonly titleId: number;
  readonly fallback: string;
  /** Which sim `Equipment` field this row shows - the slot address its action buttons order against. */
  readonly group: EquipGroup;
  readonly slots: readonly EquipSlotModel[];
  /** Whether this settler may still put something in the row; false for a fighter's stray tool, which
   *  the sim refuses to re-equip. */
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

/** One equipment slot → its panel model; only a good with `equip.wears` carries a condition percent. */
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
 * The settler's equipment as labeled rows, combat gear first, from the sim `Equipment` component; a
 * settler without one shows every base slot empty. Which rows a trade offers follows the job: Broń/Zbroja
 * are the original's soldier-only equip slots (`tribetypes` `allowequip`) and a fighter keeps no tool.
 * Two escapes keep worn gear reachable: a row the job would not offer still shows while something is
 * worn in it, and a settler carrying the combat `Weapon` component keeps its arms rows. A woman and a
 * child get no rows at all: the sim's `mayChangeEquipment` lets them wear nothing, where a hero still
 * shows the fixed arms of its class.
 */
export function equipmentRows(ctx: UnitPanelModelContext, comps: Comp): EquipRow[] {
  const slots = messages().hud.equipmentSlots;
  const eq = comps.Equipment as RawEquipment | undefined;
  const s = (comps.Settler ?? {}) as Comp;
  const rows: EquipRow[] = [];
  const jobType = num(s.jobType);
  const job = jobType === undefined ? undefined : ctx.jobs.find((j) => j.typeId === jobType);
  const fighter = job !== undefined && systems.isFighterJobRow(job);
  const hero = job !== undefined && systems.isHeroJobRow(job);
  if (!hero && ('Female' in comps || 'Age' in comps)) return [];
  if (fighter || 'Weapon' in comps || eq?.weapon != null || eq?.armor != null) {
    rows.push({
      titleId: HUMANWINDOW.weapon,
      fallback: slots.weapon,
      group: 'weapon',
      slots: [slotModel(ctx, eq?.weapon)],
      wearable: !hero,
    });
    rows.push({
      titleId: HUMANWINDOW.armor,
      fallback: slots.armor,
      group: 'armor',
      slots: [slotModel(ctx, eq?.armor)],
      wearable: !hero,
    });
  }
  rows.push({
    titleId: HUMANWINDOW.boots,
    fallback: slots.boots,
    group: 'boots',
    slots: [slotModel(ctx, eq?.boots)],
    wearable: !hero,
  });
  if (!fighter || eq?.tool != null) {
    rows.push({
      titleId: HUMANWINDOW.tools,
      fallback: slots.tools,
      group: 'tool',
      slots: [slotModel(ctx, eq?.tool)],
      wearable: !fighter && !hero,
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
    wearable: !hero,
  });
  return rows;
}
