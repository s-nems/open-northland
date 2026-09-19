import { constructionBillForType, type Fixed, fx } from '@open-northland/sim';
import { num, type SnapshotEntity } from '../../../game/snapshot.js';
import { goodCategoryTab } from '../../good-categories.js';
import { type BuildingDef, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';

export interface StockRow {
  readonly goodType: number;
  /** The good's string id (stable across content sets) - the key the HUD resolves its icon by. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** The good's declared store ceiling (its `stock` slot capacity) - the row reads "7.0 / 25.0". */
  readonly capacity?: number;
  /** The stock-window category tab (0-7) this good belongs to. */
  readonly category: number;
}

/** One material line of a construction site's cost - the Construction row "delivered / needed". */
export interface ConstructionRow {
  readonly goodType: number;
  /** The good's string id - the HUD's icon key. */
  readonly goodId?: string;
  readonly label: string;
  /** Units already in the site's hold, capped at the line's need (surplus never reads over-full). */
  readonly delivered: number;
  readonly needed: number;
}

/** One material line of the Upgrade button's cost preview: the bill shown before the upgrade starts, so
 *  it carries only the amount, nothing being delivered yet. */
export interface UpgradeCostRow {
  readonly goodType: number;
  readonly label: string;
  readonly amount: number;
}

/** The Construction section's content - present only while the building carries `UnderConstruction`. */
export interface ConstructionModel {
  readonly rows: readonly ConstructionRow[];
}

/** The current holdings of a building's `Stockpile`, as a goodType→amount map. */
export function liveAmounts(stockpile: unknown): Map<number, number> {
  const live = new Map<number, number>();
  const amounts = (stockpile as { amounts?: unknown } | undefined)?.amounts;
  if (!Array.isArray(amounts)) return live;
  for (const pair of amounts) {
    if (!Array.isArray(pair)) continue;
    const goodType = num(pair[0]);
    const amount = num(pair[1]);
    if (goodType !== undefined && amount !== undefined) live.set(goodType, amount);
  }
  return live;
}

/** The pending experience-bonus fraction per good (`ProductionBonus.remainders`, `Fixed` → float).
 *  Empty for a building without the component. */
function bonusFractions(productionBonus: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const remainders = (productionBonus as { remainders?: unknown } | undefined)?.remainders;
  if (!Array.isArray(remainders)) return out;
  for (const pair of remainders) {
    if (!Array.isArray(pair)) continue;
    const goodType = num(pair[0]);
    const raw = num(pair[1]);
    if (goodType !== undefined && raw !== undefined) out.set(goodType, fx.toFloat(raw as Fixed));
  }
  return out;
}

/**
 * The Magazyn rows: every good the building can store (its `def.stock` slots) with its current amount, 0
 * when empty, matching the original window, which lists a store's accepted goods rather than whatever it
 * happens to hold. Rows keep the declared slot order so a store's rows never swap places mid-work.
 */
export function stockRows(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  stockpile: unknown,
  productionBonus?: unknown,
): StockRow[] {
  const live = liveAmounts(stockpile);
  const fractions = bonusFractions(productionBonus);
  // A species slot counts the herd grazing outside, so it belongs to Produkcja, not Magazyn.
  const slots = (def?.stock ?? []).filter((slot) => ctx.isLivestockGood?.(slot.goodType) !== true);
  return slots.map((slot) => {
    const goodId = goodDef(ctx, slot.goodType)?.id;
    return {
      goodType: slot.goodType,
      // Shown by the hover tooltip only; the drawn row is just the icon and the amount.
      label: goodLabel(ctx, slot.goodType),
      // Whole units plus the pending bonus fraction, floored to one decimal so a 0.97 fraction never
      // reads as an extractable unit. Display only: a withdrawal still sees whole units.
      amount: Math.min(
        (live.get(slot.goodType) ?? 0) + Math.floor((fractions.get(slot.goodType) ?? 0) * 10) / 10,
        slot.capacity,
      ),
      category: goodCategoryTab(goodId),
      capacity: slot.capacity,
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
}

/** The upgrade target tier's own construction bill: the level-difference cost the sim charges to raise
 *  `def` one tier. Empty when the type has no upgrade target or the target declares no cost. */
function upgradeTargetBill(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
): readonly { readonly goodType: number; readonly amount: number }[] {
  if (def?.upgradeTarget === undefined) return [];
  return ctx.buildings.find((b) => b.typeId === def.upgradeTarget)?.construction ?? [];
}

/**
 * One row per line of the site's bill - the type's from-scratch cumulative bill, or for an upgrading
 * building the target tier's level-difference cost - each with how much the site's hold already has.
 * Null for a finished building.
 */
export function constructionModel(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): ConstructionModel | null {
  if (ent.components.UnderConstruction === undefined) return null;
  const live = liveAmounts(ent.components.Stockpile);
  const upgrading = ent.components.Upgrading !== undefined;
  const bill =
    def === undefined
      ? []
      : upgrading
        ? upgradeTargetBill(ctx, def)
        : constructionBillForType(ctx.buildings, def.typeId);
  const rows = bill.map((line) => {
    const goodId = goodDef(ctx, line.goodType)?.id;
    return {
      goodType: line.goodType,
      label: goodLabel(ctx, line.goodType),
      delivered: Math.min(live.get(line.goodType) ?? 0, line.amount),
      needed: line.amount,
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
  return { rows };
}

/** The Upgrade button's pre-commit cost rows: the same level-difference bill a running upgrade shows. */
export function upgradeCostRows(ctx: UnitPanelModelContext, def: BuildingDef | undefined): UpgradeCostRow[] {
  return upgradeTargetBill(ctx, def).map((line) => ({
    goodType: line.goodType,
    label: goodLabel(ctx, line.goodType),
    amount: line.amount,
  }));
}
