import type { WorldSnapshot } from '@open-northland/sim';
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
  type UnitPanelModelContext,
} from './context.js';

/**
 * The PURE building half of the details-panel model: the Magazyn stock rows, the per-trade worker slots,
 * and the Produkcja section (a workshop's recipe cycle or a farm's live field state) — all with no
 * Pixi/DOM in sight. The orchestrator in `index.ts` assembles a {@link BuildingPanelModel} from these.
 */

export interface StockRow {
  readonly goodType: number;
  /** The good's STRING id (stable across content sets) — the key the HUD resolves its icon by. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** The good's declared store ceiling (its `stock` slot capacity) — the row then reads "7.0 / 25.0".
   *  Undefined for a good the building holds without a declared slot (a dynamic drop): amount only. */
  readonly capacity?: number;
  /** The stock-window category tab (0–7) this good belongs to — see `stock-tabs.ts`. */
  readonly category: number;
}

/** One worker SLOT of a building, as a filled/capacity line — e.g. "Cieśla 1/3", "Tragarz 1/1",
 *  "Zbieracz 0/1". One per declared `workers` slot, so each trade shows its own limit, not one aggregate. */
export interface WorkerSlotRow {
  readonly jobType: number;
  readonly label: string;
  /** Settlers currently bound to this building for this job. */
  readonly filled: number;
  /** The slot's `count` — how many of this job the building employs. */
  readonly capacity: number;
}

/**
 * The Produkcja section's content, one of two shapes:
 *  - `recipe` — a workshop's abstract cycle (its outputs + the running cycle's progress bar);
 *  - `fields` — a FARM's live field state (the produced good's icon + the sown/growing/ripe counters),
 *    for a workplace producing a field-farmed good (`farming` on the good, no recipe): there is no
 *    recipe to show, the "production" IS the fields its farmers work around the building.
 */
export type ProductionModel =
  | {
      readonly kind: 'recipe';
      /** The FIRST output's STRING id — the row's icon key (like {@link StockRow.goodId}). */
      readonly goodId?: string;
      readonly label: string;
      /**
       * One 0..100 progress per IN-FLIGHT batch (the sim `Production.cycles` list — each operator
       * works its own independent batch, so a twin-staffed mill shows two bars). Empty when the
       * workplace is idle.
       */
      readonly pcts: readonly number[];
      /**
       * The bar rows the section RESERVES — `max(1, operator headcount, pcts.length)`, so the panel
       * geometry is stable while batches start/finish staggered (a mill always shows two bar rows,
       * empty or not), instead of growing/shrinking a row mid-work. The single source both the
       * layout's height math and the section's bar loop consume — they can never drift apart.
       */
      readonly rows: number;
    }
  | {
      readonly kind: 'fields';
      /** The farmed good's STRING id — the icon key (like {@link StockRow.goodId}). */
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
   *  lists ("Cieśla 1/3 · Tragarz 1/1 · Zbieracz 0/1"). Empty for a building that employs nobody. */
  readonly workerSlots: readonly WorkerSlotRow[];
  readonly showDefense: boolean;
  /** Approximation until a real building-defense mode component exists. */
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
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
 * The Magazyn rows: every good the building can STORE (its `def.stock` slots), shown with its current
 * amount — 0 when empty — so each storable good appears with its own icon, matching the original stock
 * window (which lists a store's accepted goods, not only what it currently holds). A good held but not in
 * the declared slots (defensive — dynamic drops) is appended.
 *
 * Ordering: the DECLARED slot order, stable while amounts change — a compact store's rows (the mill's
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
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (goodType: number): void => {
    if (seen.has(goodType)) return;
    seen.add(goodType);
    order.push(goodType);
  };
  // Declared slot → its capacity, so each row can read "amount / capacity" (a dynamic drop has none).
  const capacities = new Map<number, number>();
  for (const slot of def?.stock ?? []) {
    push(slot.goodType);
    capacities.set(slot.goodType, slot.capacity);
  }
  for (const goodType of live.keys()) push(goodType);

  return order.map((goodType) => {
    const goodId = goodDef(ctx, goodType)?.id;
    const capacity = capacities.get(goodType);
    return {
      goodType,
      // The stock row's display name (localized content name, else the id) — shown by the hover tooltip;
      // the row itself draws only the icon + amount, so a nicer name here doesn't change the drawn row.
      label: goodLabel(ctx, goodType),
      amount: live.get(goodType) ?? 0,
      category: goodCategoryTab(goodId),
      ...(goodId !== undefined ? { goodId } : {}),
      ...(capacity !== undefined ? { capacity } : {}),
    };
  });
}

/** How many settlers are currently BOUND to `buildingId`, per job — the per-slot "filled" count. */
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
 * filled/capacity — so the panel lists "Cieśla 1/3 · Tragarz 1/1 · Zbieracz 0/1" instead of one aggregate
 * "Pracownicy 4/5". A building that employs nobody (a home) yields no rows.
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

/** Count a FARM's fields in the snapshot: every `Crop` whose `farm` is this building, split into still
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
  // A FARM produces a field-farmed good — checked BEFORE the recipe, mirroring the sim: farmWorkGood
  // ignores recipe presence and ai.ts ranks the farmer rung above the producer rung precisely because
  // real extracted content synthesizes an abstract recipe from `logicproduction` for every producer.
  // Wherever the sim farms, the panel must show live field state, never a dead recipe bar.
  const recipe = def?.recipe;
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
  const production = ent.components.Production as { cycles?: unknown } | undefined;
  const outputs = recipe?.outputs ?? def?.produces?.map((goodType) => ({ goodType, amount: 1 })) ?? [];
  if (production === undefined && recipe === undefined && outputs.length === 0) return null;
  const out = outputs.map((o) => `${goodLabel(ctx, o.goodType)} x${o.amount}`).join(', ');
  const firstOutId = outputs[0] === undefined ? undefined : goodDef(ctx, outputs[0].goodType)?.id;
  // One progress per in-flight batch (each operator grinds its own — the panel bars one per cycle).
  const rawCycles = Array.isArray(production?.cycles) ? production.cycles : [];
  const pcts = rawCycles.map((c) => {
    const cycle = c as { elapsed?: unknown; duration?: unknown } | null;
    return pctRatio(num(cycle?.elapsed), num(cycle?.duration));
  });
  return {
    kind: 'recipe',
    label: out.length > 0 ? out : messages().hud.readyToWork,
    pcts,
    rows: Math.max(1, operatorHeadcount(ctx, def), pcts.length),
    ...(firstOutId !== undefined ? { goodId: firstOutId } : {}),
  };
}

/**
 * The declared OPERATOR headcount of a workplace — its `workers` slot counts minus the carrier
 * transport slots (mirrors the sim's `operatorJobsOf`: a carrier-ONLY building keeps its slots, the
 * well's carrier IS its operator). This is the batch ceiling, so the Produkcja section reserves this
 * many bar rows and keeps a stable height while batches start/finish staggered.
 */
export function operatorHeadcount(ctx: UnitPanelModelContext, def: BuildingDef | undefined): number {
  const slots = def?.workers ?? [];
  const operators = slots.filter((s) => ctx.jobs.find((j) => j.typeId === s.jobType)?.id !== 'carrier');
  const counted = operators.length > 0 ? operators : slots;
  return counted.reduce((sum, s) => sum + s.count, 0);
}
