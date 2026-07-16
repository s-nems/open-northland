import { constructionBillForType, type WorldSnapshot } from '@open-northland/sim';
import { type entityById, isSettler, num } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';
import { goodCategoryTab } from '../stock-tabs.js';
import { pctRatio } from './bars.js';
import {
  type BuildingDef,
  type Comp,
  goodDef,
  goodLabel,
  jobDisplayName,
  recipeOutputs,
  type UnitPanelModelContext,
} from './context.js';

/**
 * The pure building half of the details-panel model: the Magazyn stock rows, the per-trade worker slots,
 * and the Produkcja section (a workshop's recipe cycle or a farm's live field state) — all with no
 * Pixi/DOM in sight. The orchestrator in `index.ts` assembles a {@link BuildingPanelModel} from these.
 */

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

/** The Construction section's content — present only while the building carries `UnderConstruction`. */
export interface ConstructionModel {
  /** The health ramp 0..100 (the sim raises `Health` in step with `built`), or null when the type
   *  declares no hitpoints pool — the gauge then falls back to `builtPct`. */
  readonly hpPct: number | null;
  readonly rows: readonly ConstructionRow[];
}

export interface StockRow {
  readonly goodType: number;
  /** The good's string id (stable across content sets) — the key the HUD resolves its icon by. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** The good's declared store ceiling (its `stock` slot capacity) — the row reads "7.0 / 25.0". */
  readonly capacity?: number;
  /** The stock-window category tab (0–7) this good belongs to — see `stock-tabs.ts`. */
  readonly category: number;
}

/** One worker slot of a building, as a filled/capacity line — e.g. "Cieśla 1/3", "Tragarz 1/1",
 *  "Zbieracz 0/1". One per declared `workers` slot, so each trade shows its own limit, not one aggregate. */
export interface WorkerSlotRow {
  readonly jobType: number;
  readonly label: string;
  /** Settlers currently bound to this building for this job. */
  readonly filled: number;
  /** The slot's `count` — how many of this job the building employs. */
  readonly capacity: number;
}

/** One product row of a workshop's Produkcja section — its icon/name on the left, the bar's live
 *  progress, and the hover tooltip naming the recipe's inputs. */
export interface ProductionRow {
  readonly goodType: number;
  /** The product's string id — the row's icon key (like {@link StockRow.goodId}). */
  readonly goodId?: string;
  readonly label: string;
  /**
   * The row's bar: the FRONT-RUNNER batch of this product — the highest progress among the in-flight
   * `Production.cycles` crafting it (a finished batch deposits and leaves the list, so the bar hands
   * over to the next-furthest batch). 0 when none runs.
   */
  readonly pct: number;
  /** The hover tooltip's ingredient list — one "- Żelazo ×2" line per recipe input (newline-joined; the
   *  panel prefixes the product name line), or the no-materials label for an input-less craft; empty
   *  when the inputs are unknown (no recipe). */
  readonly inputs: string;
}

/**
 * The Produkcja section's content, one of two shapes:
 *  - `recipe` — a workshop's per-product rows (one bar per producible good — a smithy 2 lists all
 *    five wares; see {@link ProductionRow});
 *  - `fields` — a farm's live field state (the produced good's icon + the sown/growing/ripe counters),
 *    for a workplace producing a field-farmed good (`farming` on the good, no recipe): there is no
 *    recipe to show, the "production" is the fields its farmers work around the building.
 */
export type ProductionModel =
  | {
      readonly kind: 'recipe';
      /** One row per producible good (recipe order) — the single source both the layout's height math
       *  and the section's row loop consume, so they can never drift apart. Never empty. */
      readonly rows: readonly ProductionRow[];
    }
  | {
      readonly kind: 'fields';
      /** The farmed good's string id — the icon key (like {@link StockRow.goodId}). */
      readonly goodId?: string;
      /** The farmed good's display name. */
      readonly label: string;
      /** All standing fields of this farm (growing + ripe). */
      readonly sown: number;
      /** Fields still growing (below their top stage). */
      readonly growing: number;
      /** Ripe fields awaiting the scythe. */
      readonly ripe: number;
    };

/** The residents view of a `home`-kind building: its families (each a member id list, drawn grouped in
 *  the field) and the family-slot capacity (`logichomesize`) for the "Rodziny 1/3" line. */
export interface HomeResidentsModel {
  /** One entry per resident family, in ascending head-id order; members ids, adults before the child. */
  readonly families: readonly { readonly members: readonly number[] }[];
  /** Family slots this home tier offers (`homeSize`). */
  readonly capacity: number;
}

export interface BuildingPanelModel {
  readonly kind: 'building';
  readonly entityId: number;
  readonly typeId: number;
  readonly title: string;
  readonly category: string;
  readonly owner: string;
  readonly tribe: string;
  readonly level: number;
  readonly builtPct: number;
  readonly stock: readonly StockRow[];
  /** One row per worker slot (trade), each with its filled/capacity — the per-trade limits the panel
   *  lists. See {@link workerSlotsFor}. */
  readonly workerSlots: readonly WorkerSlotRow[];
  /** Non-null for a `home`-kind building: the workers window becomes the residents window
   *  ("Mieszkańcy" + "Rodziny 1/3" + the family-grouped sprite field). */
  readonly home: HomeResidentsModel | null;
  readonly showDefense: boolean;
  /** Approximation until a real building-defense mode component exists. */
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
  /** Non-null while the building is a construction site — the panel then swaps its production/stock/
   *  workers windows for the one Construction window (those sections mean nothing before completion). */
  readonly construction: ConstructionModel | null;
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
 * extracted data — see `stock-tabs.ts`), so the tab assignment is provisional, not source-pinned.
 */
export function stockRows(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  stockpile: unknown,
): StockRow[] {
  const live = liveAmounts(stockpile);
  return (def?.stock ?? []).map((slot) => {
    const goodId = goodDef(ctx, slot.goodType)?.id;
    return {
      goodType: slot.goodType,
      // The stock row's display name (localized content name, else the id) — shown by the hover tooltip;
      // the row itself draws only the icon + amount, so a nicer name here doesn't change the drawn row.
      label: goodLabel(ctx, slot.goodType),
      amount: live.get(slot.goodType) ?? 0,
      category: goodCategoryTab(goodId),
      capacity: slot.capacity,
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
}

/**
 * The Construction-window model of a site: one row per line of the type's FROM-SCRATCH construction bill
 * ({@link constructionBillForType} — a home tier's whole cumulative chain cost, exactly what the sim
 * demands before the site finishes) with how much of it the site's hold already has (the same Stockpile
 * the finished building will store into — the sim keeps one hold, so the panel is what separates
 * "materials for the build" from "the store"), plus the health ramp. Null for a finished building (no
 * `UnderConstruction` marker).
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
  const bill = def === undefined ? [] : constructionBillForType(ctx.buildings, def.typeId);
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

/** How many settlers are currently bound to `buildingId`, per job — the per-slot "filled" count. */
function boundCountsByJob(snapshot: WorldSnapshot, buildingId: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    if (num(assignment?.workplace) !== buildingId) continue;
    const jobType = num((e.components.Settler as Comp | undefined)?.jobType);
    if (jobType === undefined) continue;
    counts.set(jobType, (counts.get(jobType) ?? 0) + 1);
  }
  return counts;
}

/**
 * The per-trade worker rows: one per declared `workers` slot (in declared order), each with its
 * filled/capacity. A building that employs nobody (a home) yields no rows.
 */
export function workerSlotsFor(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  buildingId: number,
): WorkerSlotRow[] {
  const counts = boundCountsByJob(snapshot, buildingId);
  return (def?.workers ?? []).map((slot) => ({
    jobType: slot.jobType,
    label: jobDisplayName(ctx, slot.jobType),
    filled: counts.get(slot.jobType) ?? 0,
    capacity: slot.count,
  }));
}

/** Count a farm's fields in the snapshot: every `Crop` whose `farm` is this building, split into still
 *  growing vs ripe (`stage >= stages`). One entity pass, shared shape with the other snapshot scans. */
function fieldCounts(snapshot: WorldSnapshot, buildingId: number): { growing: number; ripe: number } {
  let growing = 0;
  let ripe = 0;
  for (const e of snapshot.entities) {
    const crop = e.components.Crop as { farm?: unknown; stage?: unknown; stages?: unknown } | undefined;
    if (crop === undefined || num(crop.farm) !== buildingId) continue;
    const stage = num(crop.stage) ?? 0;
    const stages = num(crop.stages) ?? Number.POSITIVE_INFINITY;
    if (stage >= stages) ripe++;
    else growing++;
  }
  return { growing, ripe };
}

export function productionModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  ent: NonNullable<ReturnType<typeof entityById>>,
): ProductionModel | null {
  // A farm produces a field-farmed good — checked before the recipes, mirroring the sim: farmWorkGood
  // ignores recipe presence and ai.ts ranks the farmer rung above the producer rung precisely because
  // real extracted content synthesizes abstract recipes from `logicproduction` for every producer.
  // Wherever the sim farms, the panel must show live field state, never a dead recipe bar.
  const fieldGood = (def?.produces ?? []).map((g) => goodDef(ctx, g)).find((g) => g?.farming !== undefined);
  if (fieldGood !== undefined) {
    const { growing, ripe } = fieldCounts(snapshot, ent.id);
    return {
      kind: 'fields',
      label: fieldGood.name ?? fieldGood.id,
      sown: growing + ripe,
      growing,
      ripe,
      ...(fieldGood.id !== undefined ? { goodId: fieldGood.id } : {}),
    };
  }
  const outputs = recipeOutputs(def);
  if (outputs.length === 0) return null; // not a producer — no Produkcja window
  // The front-runner batch per product: the highest progress among the cycles crafting that good
  // (a completed batch deposits and leaves the list, so the bar hands over to the runner-up).
  const production = ent.components.Production as { cycles?: unknown } | undefined;
  const bestPct = new Map<number, number>();
  for (const c of Array.isArray(production?.cycles) ? production.cycles : []) {
    const cycle = c as { elapsed?: unknown; duration?: unknown; goodType?: unknown } | null;
    const good = num(cycle?.goodType);
    if (good === undefined) continue;
    const pct = pctRatio(num(cycle?.elapsed), num(cycle?.duration));
    if (pct > (bestPct.get(good) ?? -1)) bestPct.set(good, pct);
  }
  const inputsByProduct = new Map<number, string>();
  for (const recipe of def?.recipes ?? []) {
    const product = recipe.outputs[0]?.goodType;
    if (product === undefined || inputsByProduct.has(product)) continue;
    inputsByProduct.set(product, recipeInputsLabel(ctx, recipe.inputs));
  }
  const rows = outputs.map((o) => {
    const goodId = goodDef(ctx, o.goodType)?.id;
    return {
      goodType: o.goodType,
      label: o.amount > 1 ? `${goodLabel(ctx, o.goodType)} ×${o.amount}` : goodLabel(ctx, o.goodType),
      pct: bestPct.get(o.goodType) ?? 0,
      inputs: inputsByProduct.get(o.goodType) ?? '',
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
  return { kind: 'recipe', rows };
}

/** A recipe's inputs as the tooltip's ingredient lines — one "- Żelazo ×2" per line — or the
 *  no-materials label for an input-less craft (the well). */
function recipeInputsLabel(
  ctx: UnitPanelModelContext,
  inputs: readonly { goodType: number; amount: number }[],
): string {
  if (inputs.length === 0) return messages().hud.recipeNoInputs;
  return inputs.map((i) => `- ${goodLabel(ctx, i.goodType)} ×${i.amount}`).join('\n');
}
