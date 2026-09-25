import { constructionBillForType, type Fixed, fx, systems, type WorldSnapshot } from '@open-northland/sim';
import { actorsOf, isSettler, num, type SnapshotEntity } from '../../../game/snapshot.js';
import { goodCategoryTab } from '../../good-categories.js';
import {
  type BuildingDef,
  type BuildingStockContext,
  goodDef,
  goodLabel,
  type UnitPanelModelContext,
} from './context.js';

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

/** One material line of a construction site's cost - the "delivered / needed" a site's bill reads. */
export interface ConstructionBillRow {
  readonly goodType: number;
  /** The good's string id - the HUD's icon key. */
  readonly goodId?: string;
  readonly label: string;
  /** Units already in the site's hold, capped at the line's need (surplus never reads over-full). */
  readonly delivered: number;
  readonly needed: number;
}

/** A bill line in the Construction section, which also counts what is on its way. */
export interface ConstructionRow extends ConstructionBillRow {
  /** Units reserved by live construction-supply errands for this site and good. */
  readonly inbound: number;
}

export type ConstructionStatus = 'missing-materials' | 'delivery-en-route' | 'no-builder';

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
  /** The site's current, evidence-backed bottleneck; null while no stall is proven. */
  readonly status: ConstructionStatus | null;
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

/** The pending bonus output per good as a fraction of a unit (`ProductionBonus.remainders`, banked in
 *  tenths). Empty for a building without the component. */
function bonusFractions(productionBonus: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const remainders = (productionBonus as { remainders?: unknown } | undefined)?.remainders;
  if (!Array.isArray(remainders)) return out;
  for (const pair of remainders) {
    if (!Array.isArray(pair)) continue;
    const goodType = num(pair[0]);
    const tenths = num(pair[1]);
    if (goodType !== undefined && tenths !== undefined) {
      out.set(goodType, tenths / systems.OUTPUT_TENTHS_PER_UNIT);
    }
  }
  return out;
}

/**
 * The Magazyn rows: every good the building can store (its `def.stock` slots) with its current amount, 0
 * when empty, matching the original window, which lists a store's accepted goods rather than whatever it
 * happens to hold. Rows keep the declared slot order so a store's rows never swap places mid-work.
 */
export function stockRows(
  ctx: BuildingStockContext,
  def: BuildingDef | undefined,
  stockpile: unknown,
  productionBonus?: unknown,
): StockRow[] {
  const live = liveAmounts(stockpile);
  const fractions = bonusFractions(productionBonus);
  // A species slot counts the herd grazing outside, so it belongs to Produkcja, not Magazyn.
  const slots = (def?.stock ?? []).filter((slot) => ctx.livestockTribeOfGood?.(slot.goodType) == null);
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
  ctx: BuildingStockContext,
  def: BuildingDef | undefined,
): readonly { readonly goodType: number; readonly amount: number }[] {
  if (def?.upgradeTarget === undefined) return [];
  return ctx.buildings.find((b) => b.typeId === def.upgradeTarget)?.construction ?? [];
}

/**
 * One row per line of the bill a site is being raised against - the type's from-scratch cumulative
 * bill, or for an upgrading building the target tier's level-difference cost - each with how much the
 * building's hold already has. A finished building has no site, so the caller decides whether its bill
 * means anything; this is the reading, not that test.
 */
export function constructionBillRows(
  ctx: BuildingStockContext,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): ConstructionBillRow[] {
  const live = liveAmounts(ent.components.Stockpile);
  const upgrading = ent.components.Upgrading !== undefined;
  const bill =
    def === undefined
      ? []
      : upgrading
        ? upgradeTargetBill(ctx, def)
        : constructionBillForType(ctx.buildings, def.typeId);
  return bill.map((line) => {
    const goodId = goodDef(ctx, line.goodType)?.id;
    return {
      goodType: line.goodType,
      label: goodLabel(ctx, line.goodType),
      delivered: Math.min(live.get(line.goodType) ?? 0, line.amount),
      needed: line.amount,
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
}

/** The Construction section's model: the site's bill plus what is on its way. Null for a finished
 *  building. */
export function constructionModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): ConstructionModel | null {
  if (ent.components.UnderConstruction === undefined) return null;
  const activity = constructionActivity(snapshot, ent.id);
  const rows = constructionBillRows(ctx, def, ent).map((row) => ({
    ...row,
    inbound: Math.min(activity.inbound.get(row.goodType) ?? 0, Math.max(0, row.needed - row.delivered)),
  }));
  return { rows, status: constructionStatus(ent, rows, activity.hasBuilder) };
}

/** One bounded actor pass collects the two live facts the selected site's construction status needs. */
function constructionActivity(
  snapshot: WorldSnapshot,
  siteId: number,
): { readonly inbound: ReadonlyMap<number, number>; readonly hasBuilder: boolean } {
  const inbound = new Map<number, number>();
  let hasBuilder = false;
  for (const actor of actorsOf(snapshot)) {
    if (!isSettler(actor)) continue;
    const assignment = actor.components.SiteAssignment as { readonly site?: unknown } | undefined;
    if (num(assignment?.site) === siteId) hasBuilder = true;
    const run = actor.components.SupplyRun as
      | {
          readonly site?: unknown;
          readonly goodType?: unknown;
          readonly amount?: unknown;
          readonly source?: unknown;
        }
      | undefined;
    if (run === undefined || num(run.site) !== siteId) continue;
    const goodType = num(run?.goodType);
    const amount = num(run?.amount);
    if (goodType === undefined || amount === undefined || amount <= 0) continue;
    if (!supplyRunIsLive(actor, run, goodType)) continue;
    inbound.set(goodType, (inbound.get(goodType) ?? 0) + amount);
  }
  return { inbound, hasBuilder };
}

/** Whether the errand is visibly under way: a SupplyRun outlives its errand until the settler's next
 * planner pass, so one with no load, no route and no matching atomic is awaiting cleanup and is not
 * shown as a delivery. Route accessibility is deliberately not inferred here. */
function supplyRunIsLive(
  actor: SnapshotEntity,
  run: { readonly site?: unknown; readonly goodType?: unknown; readonly source?: unknown },
  goodType: number,
): boolean {
  const carrying = actor.components.Carrying as
    | { readonly goodType?: unknown; readonly amount?: unknown }
    | undefined;
  if (num(carrying?.goodType) === goodType && (num(carrying?.amount) ?? 0) > 0) return true;
  if (
    actor.components.MoveGoal !== undefined ||
    actor.components.PathRequest !== undefined ||
    actor.components.PathFollow !== undefined
  ) {
    return true;
  }
  const atomic = actor.components.CurrentAtomic as
    | {
        readonly effect?: {
          readonly kind?: unknown;
          readonly from?: unknown;
          readonly store?: unknown;
          readonly goodType?: unknown;
        };
      }
    | undefined;
  const effect = atomic?.effect;
  return (
    (effect?.kind === 'pickup' &&
      num(effect.from) === num(run.source) &&
      num(effect.goodType) === goodType) ||
    (effect?.kind === 'pileup' && num(effect.store) === num(run.site))
  );
}

function constructionStatus(
  ent: SnapshotEntity,
  rows: readonly ConstructionRow[],
  hasBuilder: boolean,
): ConstructionStatus | null {
  const needed = rows.reduce((sum, row) => sum + row.needed, 0);
  const delivered = rows.reduce((sum, row) => sum + row.delivered, 0);
  const inbound = rows.reduce(
    (sum, row) => sum + Math.min(row.inbound, Math.max(0, row.needed - row.delivered)),
    0,
  );
  const materialFraction = needed <= 0 ? fx.fromInt(1) : fx.div(fx.fromInt(delivered), fx.fromInt(needed));
  const labor = (num((ent.components.UnderConstruction as { readonly labor?: unknown } | undefined)?.labor) ??
    0) as Fixed;

  // A free site finishes in the construction system without either gate; a transient pre-system snapshot
  // therefore has no player-actionable stall to report.
  if (needed <= 0) return null;

  // Material is the live bottleneck only once the hammers have caught up with what is already on site.
  if (delivered < needed && labor >= materialFraction) {
    return inbound > 0 ? 'delivery-en-route' : 'missing-materials';
  }
  // A site with material ahead of labor can prove that builder work is needed. SiteAssignment is the
  // builder drive's persistent crew membership; no route inference is involved.
  if (labor < materialFraction && !hasBuilder) return 'no-builder';
  return null;
}

/** The Upgrade button's pre-commit cost rows: the same level-difference bill a running upgrade shows. */
export function upgradeCostRows(ctx: UnitPanelModelContext, def: BuildingDef | undefined): UpgradeCostRow[] {
  return upgradeTargetBill(ctx, def).map((line) => ({
    goodType: line.goodType,
    label: goodLabel(ctx, line.goodType),
    amount: line.amount,
  }));
}
