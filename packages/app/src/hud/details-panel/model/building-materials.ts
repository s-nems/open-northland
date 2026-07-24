import { constructionBillForType, type Fixed, fx } from '@open-northland/sim';
import { type entityById, num } from '../../../game/snapshot.js';
import { goodCategoryTab } from '../../good-categories.js';
import { pctRatio } from './bars.js';
import { type BuildingDef, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';

// The building's goods model: the Magazyn stock rows plus the construction-site / upgrade material bills.
// Both read the same {@link liveAmounts} stockpile holdings. Pure - no Pixi/DOM.

export interface StockRow {
  readonly goodType: number;
  /** The good's string id (stable across content sets) — the key the HUD resolves its icon by. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** The good's declared store ceiling (its `stock` slot capacity) — the row reads "7.0 / 25.0". */
  readonly capacity?: number;
  /** The stock-window category tab (0–7) this good belongs to — see `hud/good-categories.ts`. */
  readonly category: number;
}

/** One material line of a construction site's cost — the Construction row "delivered / needed". */
export interface ConstructionRow {
  readonly goodType: number;
  /** The good's string id — the HUD's icon key (like {@link StockRow.goodId}). */
  readonly goodId?: string;
  readonly label: string;
  /** Units already in the site's hold, capped at the line's need (surplus never reads over-full). */
  readonly delivered: number;
  readonly needed: number;
}

/** One material line of the Upgrade button's cost preview — a required good and its quantity. Unlike
 *  {@link ConstructionRow} there is no "delivered" half: this is the bill shown before the upgrade
 *  starts (the hover tooltip), not a running site's progress. */
export interface UpgradeCostRow {
  readonly goodType: number;
  readonly label: string;
  readonly amount: number;
}

/** The Construction section's content — present only while the building carries `UnderConstruction`. */
export interface ConstructionModel {
  /** The health ramp 0..100 (the sim raises `Health` in step with `built`), or null when the type
   *  declares no hitpoints pool — the gauge then falls back to `builtPct`. */
  readonly hpPct: number | null;
  readonly rows: readonly ConstructionRow[];
}

/** The current holdings of a building's {@link Stockpile}, as a goodType→amount map. */
function liveAmounts(stockpile: unknown): Map<number, number> {
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

/** The pending experience-bonus fraction per good (`ProductionBonus.remainders`, `Fixed` → float),
 *  for display only — withdrawal never sees these. Empty for a building without the component. */
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
 * The Magazyn rows: every good the building can store (its `def.stock` slots), shown with its current
 * amount — 0 when empty — so each storable good appears with its own icon, matching the original stock
 * window (which lists a store's accepted goods, not whatever it happens to hold). Held goods outside
 * the declared slots never show (and a slot-less building gets no Magazyn at all): a farm's leftover
 * construction wood, or a home's accumulating upgrade materials, are not store stock and reading them
 * as "drewno: 0 / kamień: 2" was noise (user feedback 2026-07-14).
 *
 * Ordering: the declared slot order, stable while amounts change — a compact store's rows (the mill's
 * Pszenica/Mąka) must never swap places mid-work (user feedback 2026-07-11). Only the big tabbed store
 * bubbles its held goods up, and it does so at draw time (`sections.ts`), where the fixed row cap
 * (`MAX_STOCK_ROWS × 2` with a `+N`) makes visibility worth the reshuffle.
 *
 * Each row carries its `category` (the stock tab it belongs to, via {@link goodCategoryTab}); the render
 * filters the list to the active tab. The good→category mapping is a named approximation (not in the
 * extracted data — see `hud/good-categories.ts`), so the tab assignment is provisional, not source-pinned.
 */
export function stockRows(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  stockpile: unknown,
  productionBonus?: unknown,
): StockRow[] {
  const live = liveAmounts(stockpile);
  const fractions = bonusFractions(productionBonus);
  return (def?.stock ?? []).map((slot) => {
    const goodId = goodDef(ctx, slot.goodType)?.id;
    return {
      goodType: slot.goodType,
      // The stock row's display name (localized content name, else the id) — shown by the hover tooltip;
      // the row itself draws only the icon + amount, so a nicer name here doesn't change the drawn row.
      label: goodLabel(ctx, slot.goodType),
      // Whole units plus the pending experience-bonus fraction (see ProductionBonus) — display only.
      // Floored to one decimal (a 0.97 pending fraction must not read as an extractable whole unit)
      // and clamped at the slot capacity (a capacity-blocked banked unit must not read as overfull).
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

/**
 * The upgrade target tier's own construction bill — the level-difference cost the sim charges to raise
 * `def` one tier (`constructionBillOf`'s upgrading branch). Empty when the type has no upgrade target or
 * the target declares no cost. Shared by the running-upgrade site's rows ({@link constructionModel}) and
 * the pre-commit cost preview ({@link upgradeCostRows}) so the two can never disagree.
 */
function upgradeTargetBill(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
): readonly { readonly goodType: number; readonly amount: number }[] {
  if (def?.upgradeTarget === undefined) return [];
  return ctx.buildings.find((b) => b.typeId === def.upgradeTarget)?.construction ?? [];
}

/**
 * The Construction-window model of a site: one row per line of the site's bill — the type's
 * FROM-SCRATCH cumulative bill ({@link constructionBillForType}), or for an UPGRADING building
 * (`Upgrading` beside the marker) the target tier's own cost (the level difference — exactly what the
 * sim demands, mirroring `constructionBillOf`) — with how much of it the site's hold already has, plus
 * the health ramp. Null for a finished building (no `UnderConstruction` marker).
 */
export function constructionModel(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  ent: NonNullable<ReturnType<typeof entityById>>,
): ConstructionModel | null {
  if (ent.components.UnderConstruction === undefined) return null;
  const live = liveAmounts(ent.components.Stockpile);
  const health = ent.components.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  const hitpoints = num(health?.hitpoints);
  const max = num(health?.max);
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
  return {
    hpPct: hitpoints !== undefined && max !== undefined && max > 0 ? pctRatio(hitpoints, max) : null,
    rows,
  };
}

/**
 * The Upgrade button's pre-commit cost rows — the {@link upgradeTargetBill} (the same level-difference
 * bill {@link constructionModel} shows once the upgrade is running), as {goodType, label, amount} rows.
 * Empty when the type has no upgrade target or the target declares no build cost.
 */
export function upgradeCostRows(ctx: UnitPanelModelContext, def: BuildingDef | undefined): UpgradeCostRow[] {
  return upgradeTargetBill(ctx, def).map((line) => ({
    goodType: line.goodType,
    label: goodLabel(ctx, line.goodType),
    amount: line.amount,
  }));
}
